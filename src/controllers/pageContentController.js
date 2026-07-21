const prisma = require('../config/prisma');
const { uploadToR2 } = require('../utils/fileUpload');
const { slugify } = require('../utils/slugify');
const { redisCache, buildCacheKey } = require('../utils/redisCache');
const { mergeStructuredData } = require('../utils/structuredData');

const PAGE_CONTENT_TTL = 1800; // 30 minutes — invalidated on every write
const cacheKeyFor = (subcategoryId) => buildCacheKey('page_content', subcategoryId);

const invalidatePageCache = async (subcategoryId) => {
  if (!subcategoryId) return;
  const key = cacheKeyFor(subcategoryId);
  await redisCache.del(key);
  console.log(`[Cache] Invalidated page content cache for subcategory: ${subcategoryId}`);
};

const buildErrorResponse = (res, message, error) => {
  console.error(message, error);
  return res.status(500).json({ error: message });
};

const debugLog = (label, payload) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(label, payload);
  }
};

const isTempId = (value) => typeof value === 'string' && value.startsWith('temp-');

// Tab slugs owned by the page template itself (Overview + the reserved
// Mock Tests / Previous Papers tabs). A custom tab must never claim one of
// these URLs, otherwise it shadows or gets shadowed by the reserved tab.
const RESERVED_TAB_KEYS = new Set(['overview', 'mock-tests', 'previous-papers', 'question-papers']);

const pageContentController = {
  // Get all content for a subcategory page
  getPageContent: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      debugLog('[pageContentController.getPageContent]', { subcategoryId, userId: req.user?.id, adminRole: req.adminRole });

      // Check if user is admin or editor - they should see ALL content including inactive
      const isAdminOrEditor = req.user?.role && ['admin', 'editor'].includes(req.user.role.toLowerCase());

      // Serve from cache for public requests only (admins/editors always get fresh data)
      if (!isAdminOrEditor) {
        const cacheKey = cacheKeyFor(subcategoryId);
        const cached = await redisCache.get(cacheKey);
        if (cached) {
          console.log(`[Cache] HIT  page_content:${subcategoryId}`);
          return res.json(cached);
        }
        console.log(`[Cache] MISS page_content:${subcategoryId} — fetching from DB`);
      }

      let tabConfigRows, customTabs;
      try {
        [tabConfigRows, customTabs] = await Promise.all([
          prisma.subcategory_tab_config.findMany({
            where: { subcategory_id: subcategoryId, is_active: true },
            include: { subcategory_custom_tabs: { select: { id: true, title: true, description: true, tab_key: true } } },
            orderBy: { display_order: 'asc' }
          }),
          prisma.subcategory_custom_tabs.findMany({
            where: { subcategory_id: subcategoryId, is_active: true },
            orderBy: [{ display_order: 'asc' }, { title: 'asc' }]
          })
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch tab configuration', error);
      }

      const tabConfig = tabConfigRows.map(({ subcategory_custom_tabs, ...rest }) => ({ ...rest, custom_tab: subcategory_custom_tabs }));

      // For admin/editor: fetch ALL sections (including inactive)
      // For public: fetch only active sections
      const sectionsWhere = { subcategory_id: subcategoryId };
      if (!isAdminOrEditor) sectionsWhere.is_active = true;

      let sections;
      try {
        sections = await prisma.page_sections.findMany({
          where: sectionsWhere,
          orderBy: { display_order: 'asc' },
          take: 10000
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch sections', error);
      }

      // For admin/editor: fetch ALL blocks (including inactive)
      // For public: fetch only active blocks
      // Also fetch blocks that may have lost subcategory_id (via section_id join as fallback)
      const sectionIds = (sections || []).map(s => s.id).filter(Boolean);

      const blocksWhere = sectionIds.length > 0
        ? { OR: [{ subcategory_id: subcategoryId }, { section_id: { in: sectionIds } }] }
        : { subcategory_id: subcategoryId };
      if (!isAdminOrEditor) blocksWhere.is_active = true;

      let blocks;
      try {
        blocks = await prisma.page_content_blocks.findMany({
          where: blocksWhere,
          orderBy: [{ section_id: 'asc' }, { display_order: 'asc' }],
          take: 50000
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch blocks', error);
      }

      let seo;
      try {
        seo = await prisma.page_seo.findUnique({ where: { subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch SEO', error);
      }

      const groupedBlocks = (sections || []).map(section => ({
        ...section,
        blocks: (blocks || []).filter(block => block.section_id === section.id)
      }));

      const orphanBlocks = (blocks || []).filter(block => !block.section_id);

      // Group sidebar sections by tab for tab-specific sidebar support
      const sidebarsByTab = {};
      groupedBlocks.filter(s => s.is_sidebar).forEach(sidebar => {
        const tabKey = sidebar.sidebar_tab_id || 'shared';
        if (!sidebarsByTab[tabKey]) {
          sidebarsByTab[tabKey] = [];
        }
        sidebarsByTab[tabKey].push(sidebar);
      });

      const tocOrder = (seo?.structured_data?.toc_order) || {};
      const tabHeadings = (seo?.structured_data?.tab_headings) || {};
      const tabSeo = (seo?.structured_data?.tab_seo) || {};
      const pdfUrl = (seo?.structured_data?.pdf_url) || null;

      const responsePayload = {
        sections: groupedBlocks,
        orphanBlocks,
        seo: seo || null,
        customTabs: customTabs || [],
        tabConfig: tabConfig || [],
        sidebarsByTab,
        tocOrder,
        tabHeadings,
        tabSeo,
        pdfUrl
      };

      // Store in cache for public requests
      if (!isAdminOrEditor) {
        const cacheKey = cacheKeyFor(subcategoryId);
        await redisCache.set(cacheKey, responsePayload, PAGE_CONTENT_TTL);
        console.log(`[Cache] SET  page_content:${subcategoryId} (TTL ${PAGE_CONTENT_TTL}s)`);
      }

      res.json(responsePayload);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch page content', error);
    }
  },

  syncSections: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { sections = [], deletedSectionIds = [] } = req.body || {};

      if (!Array.isArray(sections)) {
        return res.status(400).json({ success: false, message: 'Sections payload must be an array' });
      }

      const sanitizedDeletedIds = Array.isArray(deletedSectionIds)
        ? deletedSectionIds.filter((id) => typeof id === 'string' && id.trim())
        : [];

      // Delete sections and their blocks in parallel
      if (sanitizedDeletedIds.length) {
        await Promise.all([
          prisma.page_content_blocks.deleteMany({ where: { section_id: { in: sanitizedDeletedIds } } }),
          prisma.page_sections.deleteMany({ where: { id: { in: sanitizedDeletedIds } } })
        ]);
      }

      // Fetch existing data in parallel — high take to avoid any default row cap
      let existingSections, existingBlocks;
      try {
        [existingSections, existingBlocks] = await Promise.all([
          prisma.page_sections.findMany({ where: { subcategory_id: subcategoryId }, select: { id: true }, take: 10000 }),
          prisma.page_content_blocks.findMany({ where: { subcategory_id: subcategoryId }, select: { id: true, section_id: true }, take: 50000 })
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch existing sections', error);
      }

      const existingBlocksBySection = new Map();
      (existingBlocks || []).forEach((block) => {
        if (!existingBlocksBySection.has(block.section_id)) {
          existingBlocksBySection.set(block.section_id, []);
        }
        existingBlocksBySection.get(block.section_id).push(block.id);
      });

      const upsertedSectionIds = [];
      const sectionsToInsert = [];
      const sectionsToUpdate = [];
      const sectionIdMap = new Map();

      // Prepare section operations
      for (const rawSection of sections) {
        if (!rawSection || !rawSection.title) continue;

        const rawSectionKey = rawSection.section_key || rawSection.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
        const sectionPayload = {
          section_key: rawSectionKey ? rawSectionKey.slice(0, 500) : null,
          title: rawSection.title?.slice(0, 500) || rawSection.title,
          subtitle: rawSection.subtitle || null,
          icon: rawSection.icon || null,
          background_color: rawSection.background_color || null,
          text_color: rawSection.text_color || null,
          display_order: rawSection.display_order ?? 0,
          is_collapsible: rawSection.is_collapsible ?? false,
          is_expanded: rawSection.is_expanded ?? true,
          is_active: rawSection.is_active ?? true,
          is_sidebar: rawSection.is_sidebar ?? false,
          sidebar_tab_id: rawSection.sidebar_tab_id ?? null,
          settings: rawSection.settings || {},
          custom_tab_id: rawSection.custom_tab_id || null,
          updated_by: req.user?.id || null
        };

        const sectionId = rawSection.id;

        if (!sectionId || sectionId.toString().startsWith('temp-')) {
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          sectionsToInsert.push({
            ...sectionPayload,
            subcategory_id: subcategoryId,
            created_by: req.user?.id || null
          });
          sectionIdMap.set(rawSection.id || tempId, { isNew: true, index: sectionsToInsert.length - 1, section: rawSection });
        } else {
          sectionsToUpdate.push({ id: sectionId, payload: sectionPayload, section: rawSection });
          sectionIdMap.set(sectionId, { isNew: false, id: sectionId, section: rawSection });
          upsertedSectionIds.push(sectionId);
        }
      }

      // Batch insert new sections — createManyAndReturn so we get generated ids back
      // (a plain createMany, the direct analogue of the original's bulk insert, doesn't
      // return rows; Postgres/Prisma preserve input order for a single multi-row INSERT
      // ... RETURNING, so index-based alignment with sectionsToInsert below still holds).
      let insertedSections = [];
      if (sectionsToInsert.length > 0) {
        try {
          insertedSections = await prisma.page_sections.createManyAndReturn({
            data: sectionsToInsert,
            select: { id: true }
          });
        } catch (error) {
          return buildErrorResponse(res, 'Failed to create sections', error);
        }

        insertedSections.forEach((inserted, idx) => {
          const entry = Array.from(sectionIdMap.values()).find(e => e.isNew && e.index === idx);
          if (entry) {
            const originalId = Array.from(sectionIdMap.entries()).find(([_, v]) => v === entry)?.[0];
            if (originalId) {
              sectionIdMap.set(originalId, { isNew: false, id: inserted.id, section: entry.section });
              upsertedSectionIds.push(inserted.id);
            }
          }
        });
      }

      // Batch update existing sections. Every id here came from the earlier findMany
      // (a real, pre-existing row), so this is always an UPDATE in practice — same
      // reasoning as the footer/navigation/test-series reorder-via-upsert conversions
      // elsewhere in this migration.
      if (sectionsToUpdate.length > 0) {
        try {
          await Promise.all(sectionsToUpdate.map(({ id, payload }) => prisma.page_sections.update({ where: { id }, data: payload })));
        } catch (error) {
          return buildErrorResponse(res, 'Failed to update sections', error);
        }
      }

      // Process blocks in batches
      const blocksToInsert = [];
      const blocksToUpdate = [];
      const blocksToDelete = [];

      for (const [, sectionInfo] of sectionIdMap.entries()) {
        const actualSectionId = sectionInfo.id;
        const rawSection = sectionInfo.section;
        const providedBlocks = Array.isArray(rawSection.blocks) ? rawSection.blocks : [];
        const upsertedBlockIds = [];

        for (const rawBlock of providedBlocks) {
          if (!rawBlock) continue;

          const blockPayload = {
            section_id: actualSectionId,
            subcategory_id: subcategoryId,
            block_type: rawBlock.block_type,
            content: rawBlock.content || {},
            settings: rawBlock.settings || {},
            display_order: rawBlock.display_order ?? 0,
            is_active: rawBlock.is_active ?? true,
            parent_block_id: rawBlock.parent_block_id || null,
            updated_by: req.user?.id || null
          };

          const blockId = rawBlock.id;

          if (!blockId || isTempId(blockId.toString())) {
            blocksToInsert.push({
              ...blockPayload,
              subcategory_id: subcategoryId,
              created_by: req.user?.id || null
            });
          } else {
            blocksToUpdate.push({ id: blockId, payload: blockPayload });
            upsertedBlockIds.push(blockId);
          }
        }

        // Collect blocks to delete for this section
        const existingBlockIds = existingBlocksBySection.get(actualSectionId) || [];
        const blockIdsToDelete = existingBlockIds.filter((blockId) => !upsertedBlockIds.includes(blockId));
        blocksToDelete.push(...blockIdsToDelete);
      }

      // Batch insert blocks
      if (blocksToInsert.length > 0) {
        try {
          await prisma.page_content_blocks.createMany({ data: blocksToInsert });
        } catch (error) {
          return buildErrorResponse(res, 'Failed to create blocks', error);
        }
      }

      // Batch update blocks — same "always an update, ids came from a real fetch" reasoning as sections above.
      if (blocksToUpdate.length > 0) {
        try {
          await Promise.all(blocksToUpdate.map(({ id, payload }) => prisma.page_content_blocks.update({ where: { id }, data: payload })));
        } catch (error) {
          return buildErrorResponse(res, 'Failed to update blocks', error);
        }
      }

      // Batch delete blocks
      if (blocksToDelete.length > 0) {
        await prisma.page_content_blocks.deleteMany({ where: { id: { in: blocksToDelete } } });
      }

      // Delete orphaned sections
      const sectionsToDelete = (existingSections || []).filter((section) => !upsertedSectionIds.includes(section.id));
      if (sectionsToDelete.length) {
        const sectionIds = sectionsToDelete.map((section) => section.id);
        await Promise.all([
          prisma.page_content_blocks.deleteMany({ where: { section_id: { in: sectionIds } } }),
          prisma.page_sections.deleteMany({ where: { id: { in: sectionIds } } })
        ]);
      }

      // Reconcile: the client always submits the FULL set of sections, so any section
      // that existed before but is no longer present was removed by the user. Delete
      // those orphans even if they weren't listed in deletedSectionIds — this is what
      // makes a deleted sidebar (or any removed section) actually disappear instead of
      // lingering. Guarded by `sections.length` so an empty/malformed payload can never
      // wipe the whole page.
      if (sections.length > 0) {
        const keepIds = new Set(upsertedSectionIds.map((id) => String(id)));
        const orphanIds = (existingSections || [])
          .map((s) => s.id)
          .filter((id) => !keepIds.has(String(id)));
        if (orphanIds.length) {
          await Promise.all([
            prisma.page_content_blocks.deleteMany({ where: { section_id: { in: orphanIds } } }),
            prisma.page_sections.deleteMany({ where: { id: { in: orphanIds } } })
          ]);
        }
      }

      // Fetch refreshed data in parallel — high take to avoid any default row cap
      let refreshedSections, refreshedBlocks;
      try {
        [refreshedSections, refreshedBlocks] = await Promise.all([
          prisma.page_sections.findMany({ where: { subcategory_id: subcategoryId }, orderBy: { display_order: 'asc' }, take: 10000 }),
          prisma.page_content_blocks.findMany({ where: { subcategory_id: subcategoryId }, orderBy: { display_order: 'asc' }, take: 50000 })
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch updated sections', error);
      }

      const groupedSections = (refreshedSections || []).map((section) => ({
        ...section,
        blocks: (refreshedBlocks || []).filter((block) => block.section_id === section.id)
      }));

      await invalidatePageCache(subcategoryId);
      res.json({
        success: true,
        sections: groupedSections,
        deletedSectionIds: [...sanitizedDeletedIds, ...(sectionsToDelete || []).map((section) => section.id)],
        upsertedSectionIds
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to sync sections', error);
    }
  },

  // Create a new section
  createSection: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const {
        section_key,
        title,
        subtitle,
        icon,
        background_color,
        text_color,
        display_order,
        is_collapsible,
        is_expanded,
        is_sidebar,
        settings,
        custom_tab_id
      } = req.body;

      let data;
      try {
        data = await prisma.page_sections.create({
          data: {
            subcategory_id: subcategoryId,
            section_key,
            title,
            subtitle: subtitle || null,
            icon: icon || null,
            background_color: background_color || null,
            text_color: text_color || null,
            display_order: display_order || 0,
            is_collapsible: is_collapsible || false,
            is_expanded: is_expanded ?? true,
            is_sidebar: is_sidebar || false,
            sidebar_tab_id: req.body.sidebar_tab_id || null,
            settings: settings || {},
            custom_tab_id: custom_tab_id || null,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create section', error);
      }

      await invalidatePageCache(subcategoryId);
      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create section', error);
    }
  },

  // Update a section
  updateSection: async (req, res) => {
    try {
      const { sectionId } = req.params;
      const {
        title,
        subtitle,
        icon,
        background_color,
        text_color,
        display_order,
        is_collapsible,
        is_expanded,
        is_active,
        is_sidebar,
        settings,
        custom_tab_id
      } = req.body;

      let data;
      try {
        data = await prisma.page_sections.update({
          where: { id: sectionId },
          data: {
            title: title ?? undefined,
            subtitle: subtitle ?? undefined,
            icon: icon ?? undefined,
            background_color: background_color ?? undefined,
            text_color: text_color ?? undefined,
            display_order: display_order ?? undefined,
            is_collapsible: is_collapsible ?? undefined,
            is_expanded: is_expanded ?? undefined,
            is_active: is_active ?? undefined,
            is_sidebar: is_sidebar ?? undefined,
            sidebar_tab_id: req.body.sidebar_tab_id !== undefined ? req.body.sidebar_tab_id : undefined,
            settings: settings ?? undefined,
            custom_tab_id: custom_tab_id ?? undefined,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Section not found' });
        }
        return buildErrorResponse(res, 'Failed to update section', error);
      }

      await invalidatePageCache(data.subcategory_id);
      res.json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update section', error);
    }
  },

  // Delete a section
  deleteSection: async (req, res) => {
    try {
      const { sectionId } = req.params;

      debugLog('[pageContentController.deleteSection]', {
        userId: req.user?.id,
        adminRole: req.adminRole,
        sectionId,
        body: req.body
      });

      let data;
      try {
        data = await prisma.page_sections.delete({ where: { id: sectionId }, select: { id: true, subcategory_id: true } });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Section not found' });
        }
        return buildErrorResponse(res, 'Failed to delete section', error);
      }

      await invalidatePageCache(data.subcategory_id);
      res.json({ message: 'Section deleted successfully', id: data.id });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete section', error);
    }
  },

  // Create a new content block
  createBlock: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const {
        section_id,
        block_type,
        content,
        settings,
        display_order,
        parent_block_id
      } = req.body;

      // Validate section_id exists in page_sections before inserting
      if (section_id) {
        let sectionExists;
        try {
          sectionExists = await prisma.page_sections.findUnique({ where: { id: section_id }, select: { id: true } });
        } catch (error) {
          return buildErrorResponse(res, 'Failed to validate section', error);
        }

        if (!sectionExists) {
          return res.status(400).json({ error: `Section ${section_id} does not exist in page_sections.` });
        }
      }

      let data;
      try {
        data = await prisma.page_content_blocks.create({
          data: {
            subcategory_id: subcategoryId,
            section_id: section_id || null,
            block_type,
            content,
            settings: settings || {},
            display_order: display_order || 0,
            parent_block_id: parent_block_id || null,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create block', error);
      }

      await invalidatePageCache(subcategoryId);
      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create block', error);
    }
  },

  // Update a content block
  updateBlock: async (req, res) => {
    try {
      const { blockId } = req.params;
      const {
        section_id,
        content,
        settings,
        display_order,
        is_active
      } = req.body;

      debugLog('[pageContentController.updateBlock]', {
        userId: req.user?.id,
        adminRole: req.adminRole,
        blockId,
        body: req.body
      });

      let data;
      try {
        data = await prisma.page_content_blocks.update({
          where: { id: blockId },
          data: {
            section_id: section_id ?? undefined,
            content: content ?? undefined,
            settings: settings ?? undefined,
            display_order: display_order ?? undefined,
            is_active: is_active ?? undefined,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Block not found' });
        }
        return buildErrorResponse(res, 'Failed to update block', error);
      }

      await invalidatePageCache(data.subcategory_id);
      res.json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update block', error);
    }
  },

  // Delete a content block
  deleteBlock: async (req, res) => {
    try {
      const { blockId } = req.params;

      debugLog('[pageContentController.deleteBlock]', {
        userId: req.user?.id,
        adminRole: req.adminRole,
        blockId,
        body: req.body
      });

      // Look up subcategory_id for cache invalidation before deleting (not in params for deleteBlock)
      const blockMeta = await prisma.page_content_blocks.findUnique({ where: { id: blockId }, select: { subcategory_id: true } });

      try {
        await prisma.page_content_blocks.delete({ where: { id: blockId } });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ error: 'Block not found' });
        }
        return buildErrorResponse(res, 'Failed to delete block', error);
      }

      await invalidatePageCache(blockMeta?.subcategory_id);
      res.json({ message: 'Block deleted successfully' });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete block', error);
    }
  },

  // Reorder blocks
  reorderBlocks: async (req, res) => {
    try {
      const { blocks } = req.body;

      debugLog('[pageContentController.reorderBlocks]', {
        userId: req.user?.id,
        adminRole: req.adminRole,
        blocks: blocks?.map(b => ({ id: b.id, order: b.display_order }))
      });

      for (const block of blocks) {
        // updateMany (not update) so a nonexistent id silently no-ops instead of
        // throwing, matching supabase-js's original .eq('id',...) no-op-on-0-rows
        // update behavior.
        await prisma.page_content_blocks.updateMany({ where: { id: block.id }, data: { display_order: block.display_order } });
      }

      // ⚠️ PRE-EXISTING BUG, preserved faithfully — see MIGRATION_TRACKER.md §4.5f.
      // existingSections/processedSectionIds/existingBlocks/processedBlockIds/operations
      // are not declared anywhere in this function — this is dead/copy-pasted code from
      // bulkSyncPageContent that was apparently never cleaned up. It already fails
      // `no-undef` lint on the pre-migration file today and always throws a
      // ReferenceError here at runtime, AFTER the block reorder updates above have
      // already succeeded — so this endpoint always returns a 500 to the client even
      // though the reorder itself silently works. Not fixed here per migration policy
      // (reproduce pre-existing bugs faithfully, flag for the client).
      // eslint-disable-next-line no-undef
      const sectionsToDelete = (existingSections || []).filter((section) => !processedSectionIds.has(section.id));
      if (sectionsToDelete.length) {
        debugLog('[bulkSyncPageContent.deleteSections]', { count: sectionsToDelete.length, sectionIds: sectionsToDelete.map((section) => section.id) });
        try {
          await prisma.page_sections.deleteMany({ where: { id: { in: sectionsToDelete.map((section) => section.id) } } });
        } catch (deleteSectionsError) {
          return buildErrorResponse(res, 'Failed to delete removed sections during bulk sync', deleteSectionsError);
        }
        // eslint-disable-next-line no-undef
        operations.sectionsDeleted += sectionsToDelete.length;
      }

      // eslint-disable-next-line no-undef
      const blocksToDelete = (existingBlocks || []).filter((block) => processedSectionIds.has(block.section_id) && !processedBlockIds.has(block.id));
      if (blocksToDelete.length) {
        debugLog('[bulkSyncPageContent.deleteBlocks]', { count: blocksToDelete.length, blockIds: blocksToDelete.map((block) => block.id) });
        try {
          await prisma.page_content_blocks.deleteMany({ where: { id: { in: blocksToDelete.map((block) => block.id) } } });
        } catch (deleteBlocksError) {
          return buildErrorResponse(res, 'Failed to delete removed blocks during bulk sync', deleteBlocksError);
        }
        // eslint-disable-next-line no-undef
        operations.blocksDeleted += blocksToDelete.length;
      }

      // Invalidate cache using subcategory_id from the first block (all blocks belong to same subcategory)
      const firstBlockSubcategoryId = blocks?.[0]?.subcategory_id;
      if (firstBlockSubcategoryId) await invalidatePageCache(firstBlockSubcategoryId);
      res.json({ message: 'Blocks reordered successfully' });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to reorder blocks', error);
    }
  },

  // Upload media
  uploadMedia: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const file = req.file;
      const {
        file_name,
        file_url,
        file_type,
        file_size,
        mime_type,
        alt_text,
        caption,
        width,
        height,
        metadata,
        folder
      } = req.body || {};

      const parseMetadata = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw);
        } catch (err) {
          return {};
        }
      };

      const detectFileType = (mime) => {
        if (!mime) return 'file';
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return 'file';
      };

      let finalFileUrl = file_url;
      let finalFileName = file_name;
      let finalFileType = file_type;
      let finalMimeType = mime_type;
      let finalFileSize = file_size;
      let finalWidth = width;
      let finalHeight = height;

      if (file) {
        const uploadFolder = folder || `page-content/${subcategoryId}`;
        const uploadResult = await uploadToR2(file, uploadFolder);
        if (!uploadResult?.url) {
          return res.status(500).json({ error: 'Failed to upload file to storage' });
        }

        finalFileUrl = uploadResult.url;
        finalFileName = uploadResult.fileName || file.originalname;
        finalMimeType = file.mimetype;
        finalFileSize = file.size;
        finalFileType = detectFileType(file.mimetype);
        finalWidth = width || null;
        finalHeight = height || null;
      }

      if (!finalFileUrl) {
        return res.status(400).json({ error: 'file_url is required when no file is uploaded' });
      }

      let data;
      try {
        data = await prisma.page_media.create({
          data: {
            subcategory_id: subcategoryId,
            file_name: finalFileName,
            file_url: finalFileUrl,
            file_type: finalFileType || detectFileType(finalMimeType),
            file_size: finalFileSize || null,
            mime_type: finalMimeType || null,
            alt_text: alt_text || null,
            caption: caption || null,
            width: finalWidth || null,
            height: finalHeight || null,
            metadata: parseMetadata(metadata),
            created_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to upload media', error);
      }

      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to upload media', error);
    }
  },

  // Get media library
  getMedia: async (req, res) => {
    console.log('Incoming admin request:', req.method, req.url, req.params, req.query, req.body);
    try {
      const { subcategoryId } = req.params;
      const { type } = req.query;

      const where = { subcategory_id: subcategoryId };
      if (type) where.file_type = type;

      let data;
      try {
        data = await prisma.page_media.findMany({ where, orderBy: { created_at: 'desc' } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch media', error);
      }

      res.json(data || []);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch media', error);
    }
  },

  // Update SEO settings
  updateSEO: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const {
        meta_title,
        meta_description,
        meta_keywords,
        og_title,
        og_description,
        og_image_url,
        canonical_url,
        robots_meta,
        structured_data,
        author_name
      } = req.body;

      // Pull existing structured_data so we can merge — saving one concern (schema
      // vs. tab_headings/toc/tab_seo) must never wipe the other (shared JSONB column).
      const existingSeo = await prisma.page_seo.findUnique({
        where: { subcategory_id: subcategoryId },
        select: { structured_data: true }
      });

      const seoPayload = {
        subcategory_id: subcategoryId,
        meta_title,
        meta_description,
        meta_keywords,
        og_title,
        og_description,
        og_image_url,
        canonical_url,
        robots_meta,
        structured_data: mergeStructuredData(existingSeo?.structured_data, structured_data),
        author_name: author_name || null
      };

      let data;
      try {
        data = await prisma.page_seo.upsert({
          where: { subcategory_id: subcategoryId },
          create: seoPayload,
          update: seoPayload
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to update SEO', error);
      }

      await invalidatePageCache(subcategoryId);
      res.json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update SEO', error);
    }
  },

  // Create page revision
  createRevision: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { change_summary } = req.body;

      debugLog('[pageContentController.createRevision]', {
        userId: req.user?.id,
        adminRole: req.adminRole,
        subcategoryId,
        body: req.body
      });

      let sections, blocks, seo;
      try {
        [sections, blocks, seo] = await Promise.all([
          prisma.page_sections.findMany({ where: { subcategory_id: subcategoryId } }),
          prisma.page_content_blocks.findMany({ where: { subcategory_id: subcategoryId } }),
          prisma.page_seo.findUnique({ where: { subcategory_id: subcategoryId } })
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch content snapshot', error);
      }

      const revisionRow = await prisma.page_revisions.findFirst({
        where: { subcategory_id: subcategoryId },
        select: { revision_number: true },
        orderBy: { revision_number: 'desc' }
      });

      const nextRevision = (revisionRow?.revision_number || 0) + 1;

      const contentSnapshot = {
        sections: sections || [],
        blocks: blocks || [],
        seo: seo || null
      };

      let data;
      try {
        data = await prisma.page_revisions.create({
          data: {
            subcategory_id: subcategoryId,
            revision_number: nextRevision,
            content_snapshot: contentSnapshot,
            change_summary: change_summary || 'Manual save',
            created_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create revision', error);
      }

      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create revision', error);
    }
  },

  // Get page revisions
  getRevisions: async (req, res) => {
    try {
      const { subcategoryId } = req.params;

      let rows;
      try {
        rows = await prisma.page_revisions.findMany({
          where: { subcategory_id: subcategoryId },
          include: { users: { select: { name: true } } },
          orderBy: { revision_number: 'desc' },
          take: 20
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch revisions', error);
      }

      // Original select('*, created_by:users(name)') replaces the raw created_by UUID
      // scalar in the response with the joined user object under the same key.
      const data = rows.map(({ users, ...rest }) => ({ ...rest, created_by: users }));

      res.json(data || []);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch revisions', error);
    }
  },

  // Restore a revision
  restoreRevision: async (req, res) => {
    try {
      const { subcategoryId, revisionId } = req.params;

      let revision;
      try {
        revision = await prisma.page_revisions.findFirst({
          where: { id: revisionId, subcategory_id: subcategoryId },
          select: { content_snapshot: true }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch revision', error);
      }

      if (!revision) {
        return res.status(404).json({ error: 'Revision not found' });
      }

      const snapshot = revision.content_snapshot || {};

      try {
        await prisma.page_content_blocks.deleteMany({ where: { subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to clear blocks', error);
      }

      try {
        await prisma.page_sections.deleteMany({ where: { subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to clear sections', error);
      }

      if (snapshot.sections?.length) {
        try {
          await prisma.page_sections.createMany({ data: snapshot.sections });
        } catch (error) {
          return buildErrorResponse(res, 'Failed to restore sections', error);
        }
      }

      if (snapshot.blocks?.length) {
        try {
          await prisma.page_content_blocks.createMany({ data: snapshot.blocks });
        } catch (error) {
          return buildErrorResponse(res, 'Failed to restore blocks', error);
        }
      }

      await invalidatePageCache(subcategoryId);
      res.json({ message: 'Revision restored successfully' });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to restore revision', error);
    }
  },

  bulkSyncPageContent: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { sections = [] } = req.body;

      if (!Array.isArray(sections)) {
        return res.status(400).json({ error: 'Sections payload must be an array.' });
      }

      let existingSections, existingBlocks;
      try {
        existingSections = await prisma.page_sections.findMany({ where: { subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch existing sections', error);
      }

      try {
        existingBlocks = await prisma.page_content_blocks.findMany({ where: { subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch existing blocks', error);
      }

      const existingSectionMap = new Map((existingSections || []).map((section) => [section.id, section]));
      const existingBlockMap = new Map((existingBlocks || []).map((block) => [block.id, block]));
      const processedSectionIds = new Set();
      const processedBlockIds = new Set();
      const sectionIdAliasMap = new Map();

      const operations = {
        sectionsCreated: 0,
        sectionsUpdated: 0,
        sectionsSkipped: 0,
        sectionsDeleted: 0,
        blocksCreated: 0,
        blocksUpdated: 0,
        blocksSkipped: 0,
        blocksDeleted: 0
      };

      const normalizeSectionPayload = (section = {}) => ({
        section_key: section.section_key || section.title?.toLowerCase().replace(/\s+/g, '-') || null,
        title: section.title || null,
        subtitle: section.subtitle || null,
        icon: section.icon || null,
        background_color: section.background_color || null,
        text_color: section.text_color || null,
        display_order: section.display_order ?? 0,
        is_collapsible: section.is_collapsible ?? false,
        is_expanded: section.is_expanded ?? true,
        is_sidebar: section.is_sidebar ?? false,
        sidebar_tab_id: section.sidebar_tab_id !== undefined ? section.sidebar_tab_id : null,
        settings: section.settings || {},
        custom_tab_id: section.custom_tab_id || null
      });

      const normalizeBlockPayload = (block = {}, sectionId) => ({
        subcategory_id: subcategoryId,
        section_id: sectionId || block.section_id || null,
        block_type: block.block_type,
        content: block.content,
        settings: block.settings || {},
        display_order: block.display_order ?? 0,
        parent_block_id: block.parent_block_id || null
      });

      const hasChanged = (incoming, existing) => {
        try {
          return JSON.stringify(incoming) !== JSON.stringify(existing);
        } catch (err) {
          debugLog('[bulkSyncPageContent.compare-error]', err);
          return true;
        }
      };

      for (const section of sections) {
        const sectionAlias = section.id || section.section_key || `temp-${Math.random().toString(36).slice(2)}`;
        const sectionPayload = normalizeSectionPayload(section);
        // Treat temp IDs as new sections — they don't exist in the DB
        const isTempSectionId = !section.id || isTempId(section.id);
        let sectionId = isTempSectionId ? null : section.id;
        const existingSection = !isTempSectionId ? existingSectionMap.get(section.id) : null;

        if (existingSection) {
          const existingComparable = normalizeSectionPayload(existingSection);

          if (hasChanged(sectionPayload, existingComparable)) {
            try {
              await prisma.page_sections.update({
                where: { id: section.id },
                data: { ...sectionPayload, updated_by: req.user?.id || null }
              });
            } catch (error) {
              return buildErrorResponse(res, 'Failed to update section during bulk sync', error);
            }

            operations.sectionsUpdated += 1;
          } else {
            operations.sectionsSkipped += 1;
          }
          processedSectionIds.add(section.id);
        } else {
          const insertPayload = {
            ...sectionPayload,
            subcategory_id: subcategoryId,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          };

          let data;
          try {
            data = await prisma.page_sections.create({ data: insertPayload });
          } catch (error) {
            return buildErrorResponse(res, 'Failed to create section during bulk sync', error);
          }

          sectionId = data.id;
          operations.sectionsCreated += 1;
          processedSectionIds.add(sectionId);
        }

        // Always use the persisted sectionId (never a temp/client-side ID)
        sectionIdAliasMap.set(sectionAlias, sectionId);

        const blocks = Array.isArray(section.blocks) ? section.blocks : [];

        for (const block of blocks) {
          const resolvedSectionId = sectionIdAliasMap.get(sectionAlias);

          // Skip block if we couldn't resolve a valid persisted section ID
          if (!resolvedSectionId || isTempId(resolvedSectionId)) {
            debugLog('[bulkSyncPageContent.skipBlock]', { reason: 'unresolved section_id', blockType: block.block_type });
            continue;
          }

          const blockPayload = normalizeBlockPayload(block, resolvedSectionId);

          if (block.id && existingBlockMap.has(block.id)) {
            const existingBlock = existingBlockMap.get(block.id);
            const comparableExisting = normalizeBlockPayload(existingBlock, existingBlock.section_id);

            if (hasChanged(blockPayload, comparableExisting)) {
              try {
                await prisma.page_content_blocks.update({
                  where: { id: block.id },
                  data: { ...blockPayload, updated_by: req.user?.id || null }
                });
              } catch (error) {
                return buildErrorResponse(res, 'Failed to update block during bulk sync', error);
              }

              operations.blocksUpdated += 1;
            } else {
              operations.blocksSkipped += 1;
            }
            processedBlockIds.add(block.id);
          } else {
            const insertPayload = {
              ...blockPayload,
              created_by: req.user?.id || null,
              updated_by: req.user?.id || null
            };

            try {
              await prisma.page_content_blocks.create({ data: insertPayload });
            } catch (error) {
              return buildErrorResponse(res, 'Failed to create block during bulk sync', error);
            }

            operations.blocksCreated += 1;
          }
        }
      }

      let refreshedSections;
      try {
        refreshedSections = await prisma.page_sections.findMany({
          where: { subcategory_id: subcategoryId },
          orderBy: { display_order: 'asc' }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch refreshed sections', error);
      }

      let refreshedBlocks;
      try {
        refreshedBlocks = await prisma.page_content_blocks.findMany({
          where: { subcategory_id: subcategoryId },
          orderBy: { display_order: 'asc' }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch refreshed blocks', error);
      }

      const grouped = (refreshedSections || []).map((section) => ({
        ...section,
        blocks: (refreshedBlocks || []).filter((block) => block.section_id === section.id)
      }));

      await invalidatePageCache(subcategoryId);
      res.json({
        success: true,
        summary: operations,
        sections: grouped
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to bulk sync page content', error);
    }
  },

  getCustomTabs: async (req, res) => {
    try {
      const { subcategoryId } = req.params;

      let data;
      try {
        data = await prisma.subcategory_custom_tabs.findMany({
          where: { subcategory_id: subcategoryId, is_active: true },
          orderBy: [{ display_order: 'asc' }, { title: 'asc' }]
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch custom tabs', error);
      }

      res.json({ success: true, data: data || [] });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch custom tabs', error);
    }
  },

  createCustomTab: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { title, description, display_order, tab_key } = req.body || {};

      if (!title) {
        return res.status(400).json({ success: false, message: 'Title is required' });
      }

      const normalizedKey = slugify(tab_key || title, { fallback: 'tab' }).slice(0, 190);

      if (RESERVED_TAB_KEYS.has(normalizedKey)) {
        return res.status(400).json({
          success: false,
          message: `"${normalizedKey}" is a reserved tab URL. Please choose a different tab title or key.`,
        });
      }

      const orderRow = await prisma.subcategory_custom_tabs.findFirst({
        where: { subcategory_id: subcategoryId },
        select: { display_order: true },
        orderBy: { display_order: 'desc' }
      });

      const nextOrder = typeof display_order === 'number'
        ? display_order
        : ((orderRow?.display_order ?? -1) + 1);

      let data;
      try {
        data = await prisma.subcategory_custom_tabs.create({
          data: {
            subcategory_id: subcategoryId,
            tab_key: normalizedKey,
            title,
            description: description || null,
            display_order: nextOrder,
            is_active: true,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create custom tab', error);
      }

      await invalidatePageCache(subcategoryId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create custom tab', error);
    }
  },

  updateCustomTab: async (req, res) => {
    try {
      const { tabId } = req.params;
      const { title, description, display_order, is_active, tab_key } = req.body || {};

      let nextTabKey = tab_key ? slugify(tab_key, { fallback: 'tab' }).slice(0, 190) : undefined;

      // Self-heal legacy collisions: if this tab currently squats on a reserved
      // URL (e.g. tab_key 'previous-papers' left over from an old title) and the
      // admin renames it, regenerate the key from the new title.
      if (nextTabKey === undefined && title) {
        const existing = await prisma.subcategory_custom_tabs.findUnique({
          where: { id: tabId },
          select: { tab_key: true }
        });

        if (existing && RESERVED_TAB_KEYS.has(existing.tab_key)) {
          nextTabKey = slugify(title, { fallback: 'tab' }).slice(0, 190);
        }
      }

      if (nextTabKey !== undefined && RESERVED_TAB_KEYS.has(nextTabKey)) {
        return res.status(400).json({
          success: false,
          message: `"${nextTabKey}" is a reserved tab URL. Please choose a different tab title or key.`,
        });
      }

      const updates = {
        title: title ?? undefined,
        description: description ?? undefined,
        display_order: display_order ?? undefined,
        is_active: typeof is_active === 'boolean' ? is_active : undefined,
        tab_key: nextTabKey,
        updated_by: req.user?.id || null
      };

      let data;
      try {
        data = await prisma.subcategory_custom_tabs.update({ where: { id: tabId }, data: updates });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ success: false, message: 'Custom tab not found' });
        }
        return buildErrorResponse(res, 'Failed to update custom tab', error);
      }

      await invalidatePageCache(data.subcategory_id);
      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update custom tab', error);
    }
  },

  deleteCustomTab: async (req, res) => {
    try {
      const { subcategoryId, tabId } = req.params;

      try {
        // deleteMany with the compound {id, subcategory_id} filter (never touch a tab
        // belonging to a different subcategory) — matching the original's compound
        // .eq('id',...).eq('subcategory_id',...). NOTE: the original never chained
        // .select().single() on this delete, so supabase-js never actually errored on a
        // 0-row delete — it always returned success regardless of whether a row matched.
        // Preserved exactly: no 404 branch on a 0-count deleteMany here.
        await prisma.subcategory_custom_tabs.deleteMany({ where: { id: tabId, subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to delete custom tab', error);
      }

      await invalidatePageCache(subcategoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete custom tab', error);
    }
  },

  reorderCustomTabs: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { tabIds } = req.body || {};

      if (!Array.isArray(tabIds)) {
        return res.status(400).json({ success: false, message: 'tabIds array is required' });
      }

      for (let index = 0; index < tabIds.length; index += 1) {
        const tabId = tabIds[index];
        await prisma.subcategory_custom_tabs.updateMany({
          where: { id: tabId, subcategory_id: subcategoryId },
          data: { display_order: index, updated_by: req.user?.id || null }
        });
      }

      await invalidatePageCache(subcategoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to reorder custom tabs', error);
    }
  },

  getTabConfig: async (req, res) => {
    try {
      const { subcategoryId } = req.params;

      let rows;
      try {
        rows = await prisma.subcategory_tab_config.findMany({
          where: { subcategory_id: subcategoryId, is_active: true },
          include: { subcategory_custom_tabs: { select: { id: true, title: true, description: true, tab_key: true } } },
          orderBy: { display_order: 'asc' }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch tab configuration', error);
      }

      const data = rows.map(({ subcategory_custom_tabs, ...rest }) => ({ ...rest, custom_tab: subcategory_custom_tabs }));

      res.json({ success: true, data: data || [] });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch tab configuration', error);
    }
  },

  initializeDefaultTabs: async (req, res) => {
    try {
      const { subcategoryId } = req.params;

      const existing = await prisma.subcategory_tab_config.findFirst({
        where: { subcategory_id: subcategoryId },
        select: { id: true }
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Tab configuration already exists for this subcategory'
        });
      }

      const defaultTabs = [
        {
          subcategory_id: subcategoryId,
          tab_type: 'overview',
          tab_label: 'Overview',
          tab_key: 'overview',
          display_order: 0,
          is_active: true,
          created_by: req.user?.id || null,
          updated_by: req.user?.id || null
        },
        {
          subcategory_id: subcategoryId,
          tab_type: 'mock-tests',
          tab_label: 'Mock Tests',
          tab_key: 'mock-tests',
          display_order: 1,
          is_active: true,
          created_by: req.user?.id || null,
          updated_by: req.user?.id || null
        },
        {
          subcategory_id: subcategoryId,
          tab_type: 'question-papers',
          tab_label: 'Previous Papers',
          tab_key: 'question-papers',
          display_order: 2,
          is_active: true,
          created_by: req.user?.id || null,
          updated_by: req.user?.id || null
        }
      ];

      let data;
      try {
        data = await prisma.subcategory_tab_config.createManyAndReturn({ data: defaultTabs });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to initialize default tabs', error);
      }

      await invalidatePageCache(subcategoryId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to initialize default tabs', error);
    }
  },

  createTabConfig: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { tab_type, tab_label, tab_key, custom_tab_id, display_order, is_active } = req.body || {};

      if (!tab_type || !tab_label) {
        return res.status(400).json({
          success: false,
          message: 'tab_type and tab_label are required'
        });
      }

      if (tab_type === 'custom' && !custom_tab_id) {
        return res.status(400).json({
          success: false,
          message: 'custom_tab_id is required for custom tab type'
        });
      }

      const normalizedKey = slugify(tab_key || tab_label, { fallback: 'tab' }).slice(0, 190);

      const orderRow = await prisma.subcategory_tab_config.findFirst({
        where: { subcategory_id: subcategoryId },
        select: { display_order: true },
        orderBy: { display_order: 'desc' }
      });

      const nextOrder = typeof display_order === 'number'
        ? display_order
        : ((orderRow?.display_order ?? -1) + 1);

      let data;
      try {
        data = await prisma.subcategory_tab_config.create({
          data: {
            subcategory_id: subcategoryId,
            tab_type,
            tab_label,
            tab_key: normalizedKey,
            custom_tab_id: custom_tab_id || null,
            display_order: nextOrder,
            is_active: is_active !== false,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          }
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create tab configuration', error);
      }

      await invalidatePageCache(subcategoryId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create tab configuration', error);
    }
  },

  updateTabConfig: async (req, res) => {
    try {
      const { tabConfigId } = req.params;
      const { tab_label, tab_key, display_order, is_active } = req.body || {};

      const updates = {
        tab_label: tab_label ?? undefined,
        tab_key: tab_key ? slugify(tab_key, { fallback: 'tab' }).slice(0, 190) : undefined,
        display_order: display_order ?? undefined,
        is_active: typeof is_active === 'boolean' ? is_active : undefined,
        updated_by: req.user?.id || null
      };

      let data;
      try {
        data = await prisma.subcategory_tab_config.update({ where: { id: tabConfigId }, data: updates });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ success: false, message: 'Tab configuration not found' });
        }
        return buildErrorResponse(res, 'Failed to update tab configuration', error);
      }

      await invalidatePageCache(data.subcategory_id);
      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update tab configuration', error);
    }
  },

  deleteTabConfig: async (req, res) => {
    try {
      const { subcategoryId, tabConfigId } = req.params;

      try {
        // Same note as deleteCustomTab above: the original never chained
        // .select().single() on this delete, so a 0-row match never actually produced a
        // 404 in practice — preserved exactly, no count check here.
        await prisma.subcategory_tab_config.deleteMany({ where: { id: tabConfigId, subcategory_id: subcategoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to delete tab configuration', error);
      }

      await invalidatePageCache(subcategoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete tab configuration', error);
    }
  },

  reorderTabConfig: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      const { tabConfigIds } = req.body || {};

      if (!Array.isArray(tabConfigIds)) {
        return res.status(400).json({ success: false, message: 'tabConfigIds array is required' });
      }

      for (let index = 0; index < tabConfigIds.length; index += 1) {
        const tabConfigId = tabConfigIds[index];
        await prisma.subcategory_tab_config.updateMany({
          where: { id: tabConfigId, subcategory_id: subcategoryId },
          data: { display_order: index, updated_by: req.user?.id || null }
        });
      }

      await invalidatePageCache(subcategoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to reorder tab configuration', error);
    }
  }
};

module.exports = pageContentController;
