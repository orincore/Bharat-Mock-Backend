const prisma = require('../config/prisma');
const { uploadToR2 } = require('../utils/fileUpload');
const { slugify } = require('../utils/slugify');
const { redisCache, buildCacheKey } = require('../utils/redisCache');
const { mergeStructuredData } = require('../utils/structuredData');

// Tab slugs owned by the page template itself (Overview + the reserved
// Mock Tests / Previous Papers tabs). A custom tab must never claim one of
// these URLs, otherwise it shadows or gets shadowed by the reserved tab.
const RESERVED_TAB_KEYS = new Set(['overview', 'mock-tests', 'previous-papers', 'question-papers']);

const PAGE_CONTENT_TTL = 1800; // 30 minutes — invalidated on every write
const cacheKeyFor = (categoryId) => buildCacheKey('category_page_content', categoryId);

const invalidateCategoryCache = async (categoryId) => {
  if (!categoryId) return;
  const key = cacheKeyFor(categoryId);
  await redisCache.del(key);
  console.log(`[Cache] Invalidated category page content cache for category: ${categoryId}`);
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

const categoryPageContentController = {
  // Get all content for a category page
  getPageContent: async (req, res) => {
    try {
      const { categoryId } = req.params;

      // Serve from cache for public requests (admins always get fresh data)
      const isAdminOrEditor = req.user?.role && ['admin', 'editor'].includes(req.user.role.toLowerCase());
      if (!isAdminOrEditor) {
        const cacheKey = cacheKeyFor(categoryId);
        const cached = await redisCache.get(cacheKey);
        if (cached) {
          console.log(`[Cache] HIT  category_page_content:${categoryId}`);
          return res.json(cached);
        }
        console.log(`[Cache] MISS category_page_content:${categoryId} — fetching from DB`);
      }

      let customTabs, sections, blocks, seo;
      try {
        [customTabs, sections, blocks, seo] = await Promise.all([
          prisma.category_custom_tabs.findMany({
            where: { category_id: categoryId, is_active: true },
            orderBy: [{ display_order: 'asc' }, { title: 'asc' }],
          }),
          // Always fetch only active sections — soft-deleted (is_active:false) must not appear in either admin or public view
          prisma.page_sections.findMany({
            where: { category_id: categoryId, is_active: true },
            orderBy: { display_order: 'asc' },
          }),
          // Always fetch only active blocks — soft-deleted blocks must not appear in either admin or public view
          prisma.page_content_blocks.findMany({
            where: { category_id: categoryId, is_active: true },
            orderBy: [{ section_id: 'asc' }, { display_order: 'asc' }],
          }),
          prisma.page_seo.findUnique({ where: { category_id: categoryId } }),
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch page content', error);
      }

      const groupedBlocks = (sections || []).map(section => ({
        ...section,
        blocks: (blocks || []).filter(block => block.section_id === section.id)
      }));

      const orphanBlocks = (blocks || []).filter(block => !block.section_id);

      const tocOrder = (seo?.structured_data?.toc_order) || {};
      const tabHeadings = (seo?.structured_data?.tab_headings) || {};
      const tabSeo = (seo?.structured_data?.tab_seo) || {};
      const pdfUrl = (seo?.structured_data?.pdf_url) || null;

      const responsePayload = {
        sections: groupedBlocks,
        orphanBlocks,
        seo: seo || null,
        customTabs: customTabs || [],
        tocOrder,
        tabHeadings,
        tabSeo,
        pdfUrl
      };

      if (!isAdminOrEditor) {
        const cacheKey = cacheKeyFor(categoryId);
        await redisCache.set(cacheKey, responsePayload, PAGE_CONTENT_TTL);
        console.log(`[Cache] SET  category_page_content:${categoryId} (TTL ${PAGE_CONTENT_TTL}s)`);
      }

      res.json(responsePayload);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch page content', error);
    }
  },

  // Bulk sync page content for category
  bulkSyncPageContent: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const { sections = [] } = req.body;

      if (!Array.isArray(sections)) {
        return res.status(400).json({ error: 'Sections payload must be an array.' });
      }

      let existingSections, existingBlocks;
      try {
        existingSections = await prisma.page_sections.findMany({ where: { category_id: categoryId } });
      } catch (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch existing sections', sectionsError);
      }

      try {
        existingBlocks = await prisma.page_content_blocks.findMany({ where: { category_id: categoryId } });
      } catch (blocksError) {
        return buildErrorResponse(res, 'Failed to fetch existing blocks', blocksError);
      }

      const existingSectionMap = new Map((existingSections || []).map((s) => [s.id, s]));
      const existingBlockMap = new Map((existingBlocks || []).map((b) => [b.id, b]));
      const sectionIdAliasMap = new Map();

      const operations = {
        sectionsCreated: 0,
        sectionsUpdated: 0,
        sectionsSkipped: 0,
        blocksCreated: 0,
        blocksUpdated: 0,
        blocksSkipped: 0
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
        settings: section.settings || {},
        category_custom_tab_id: section.category_custom_tab_id || section.custom_tab_id || null
      });

      const normalizeBlockPayload = (block = {}, sectionId) => ({
        category_id: categoryId,
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
          return true;
        }
      };

      for (const section of sections) {
        const sectionAlias = section.id || section.section_key || `temp-${Math.random().toString(36).slice(2)}`;
        const sectionPayload = normalizeSectionPayload(section);
        let sectionId = section.id;
        let existingSection = section.id ? existingSectionMap.get(section.id) : null;

        // Fallback: try matching by section_key when id is missing (e.g., cloned sections)
        if (!existingSection && section.section_key) {
          existingSection = (existingSections || []).find((candidate) => (
            candidate.section_key === section.section_key
            && (candidate.category_custom_tab_id || candidate.custom_tab_id || null) === sectionPayload.category_custom_tab_id
          ));
          if (existingSection) {
            sectionId = existingSection.id;
          }
        }

        if (existingSection) {
          const existingComparable = normalizeSectionPayload(existingSection);

          if (hasChanged(sectionPayload, existingComparable)) {
            try {
              await prisma.page_sections.update({
                where: { id: section.id },
                data: { ...sectionPayload, updated_by: req.user?.id || null },
              });
            } catch (error) {
              return buildErrorResponse(res, 'Failed to update section during bulk sync', error);
            }
            operations.sectionsUpdated += 1;
          } else {
            operations.sectionsSkipped += 1;
          }
        } else {
          const insertPayload = {
            ...sectionPayload,
            category_id: categoryId,
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
        }

        sectionIdAliasMap.set(sectionAlias, sectionId || section.id);

        const blocks = Array.isArray(section.blocks) ? section.blocks : [];
        const blocksToProcess = [];

        for (const block of blocks) {
          const resolvedSectionId = sectionIdAliasMap.get(sectionAlias);
          const blockPayload = normalizeBlockPayload(block, resolvedSectionId);

          if (block.id && existingBlockMap.has(block.id)) {
            const existingBlock = existingBlockMap.get(block.id);
            const comparableExisting = normalizeBlockPayload(existingBlock, existingBlock.section_id);

            if (hasChanged(blockPayload, comparableExisting)) {
              blocksToProcess.push({
                type: 'update',
                id: block.id,
                payload: { ...blockPayload, updated_by: req.user?.id || null }
              });
            } else {
              operations.blocksSkipped += 1;
            }
          } else {
            blocksToProcess.push({
              type: 'insert',
              payload: {
                ...blockPayload,
                created_by: req.user?.id || null,
                updated_by: req.user?.id || null
              }
            });
          }
        }

        // Batch process blocks for this section
        const updateBlocks = blocksToProcess.filter(b => b.type === 'update');
        const insertBlocks = blocksToProcess.filter(b => b.type === 'insert');

        const blockOps = [];

        // Every updateBlocks entry's id came from existingBlockMap (a real, pre-existing
        // row), so this is always an UPDATE in practice — same reasoning used for the
        // footer/navigation reorder-via-upsert conversions elsewhere in this migration.
        if (updateBlocks.length > 0) {
          blockOps.push(...updateBlocks.map(b => prisma.page_content_blocks.update({ where: { id: b.id }, data: b.payload })));
          operations.blocksUpdated += updateBlocks.length;
        }

        if (insertBlocks.length > 0) {
          blockOps.push(prisma.page_content_blocks.createMany({ data: insertBlocks.map(b => b.payload) }));
          operations.blocksCreated += insertBlocks.length;
        }

        if (blockOps.length > 0) {
          try {
            await Promise.all(blockOps);
          } catch (error) {
            return buildErrorResponse(res, 'Failed to sync blocks', error);
          }
        }
      }

      // Batch soft-delete removed sections
      const incomingSectionIds = new Set(
        sections.filter((s) => s.id && existingSectionMap.has(s.id)).map((s) => s.id)
      );
      const sectionsToDeactivate = Array.from(existingSectionMap.keys()).filter(id => !incomingSectionIds.has(id));

      if (sectionsToDeactivate.length > 0) {
        await Promise.all([
          prisma.page_sections.updateMany({ where: { id: { in: sectionsToDeactivate } }, data: { is_active: false, updated_by: req.user?.id || null } }),
          prisma.page_content_blocks.updateMany({ where: { section_id: { in: sectionsToDeactivate }, category_id: categoryId }, data: { is_active: false, updated_by: req.user?.id || null } }),
        ]);
        operations.sectionsDeleted = sectionsToDeactivate.length;
      }

      // Batch soft-delete removed blocks
      const incomingBlockIds = new Set();
      for (const section of sections) {
        const blocks = Array.isArray(section.blocks) ? section.blocks : [];
        for (const block of blocks) {
          if (block.id && existingBlockMap.has(block.id)) {
            incomingBlockIds.add(block.id);
          }
        }
      }

      const blocksToDeactivate = [];
      for (const [existingBlockId, existingBlock] of existingBlockMap) {
        if (!incomingBlockIds.has(existingBlockId) && incomingSectionIds.has(existingBlock.section_id)) {
          blocksToDeactivate.push(existingBlockId);
        }
      }

      if (blocksToDeactivate.length > 0) {
        await prisma.page_content_blocks.updateMany({ where: { id: { in: blocksToDeactivate } }, data: { is_active: false, updated_by: req.user?.id || null } });
        operations.blocksDeleted = blocksToDeactivate.length;
      }

      // Fetch refreshed data in parallel
      let refreshedSections, refreshedBlocks;
      try {
        [refreshedSections, refreshedBlocks] = await Promise.all([
          prisma.page_sections.findMany({ where: { category_id: categoryId, is_active: true }, orderBy: { display_order: 'asc' } }),
          prisma.page_content_blocks.findMany({ where: { category_id: categoryId, is_active: true }, orderBy: { display_order: 'asc' } }),
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch refreshed content', error);
      }

      const grouped = (refreshedSections || []).map((section) => ({
        ...section,
        blocks: (refreshedBlocks || []).filter((block) => block.section_id === section.id)
      }));

      await invalidateCategoryCache(categoryId);
      res.json({
        success: true,
        summary: operations,
        sections: grouped
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to bulk sync page content', error);
    }
  },

  // Create revision
  createRevision: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const { change_summary } = req.body;

      let sections, blocks, seo;
      try {
        [sections, blocks, seo] = await Promise.all([
          prisma.page_sections.findMany({ where: { category_id: categoryId } }),
          prisma.page_content_blocks.findMany({ where: { category_id: categoryId } }),
          prisma.page_seo.findUnique({ where: { category_id: categoryId } }),
        ]);
      } catch (error) {
        return buildErrorResponse(res, 'Failed to fetch content snapshot', error);
      }

      const revisionRow = await prisma.page_revisions.findFirst({
        where: { category_id: categoryId },
        select: { revision_number: true },
        orderBy: { revision_number: 'desc' },
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
            category_id: categoryId,
            revision_number: nextRevision,
            content_snapshot: contentSnapshot,
            change_summary: change_summary || 'Manual save',
            created_by: req.user?.id || null
          },
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create revision', error);
      }

      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create revision', error);
    }
  },

  // Custom tabs CRUD
  getCustomTabs: async (req, res) => {
    try {
      const { categoryId } = req.params;

      let data;
      try {
        data = await prisma.category_custom_tabs.findMany({
          where: { category_id: categoryId, is_active: true },
          orderBy: [{ display_order: 'asc' }, { title: 'asc' }],
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
      const { categoryId } = req.params;
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

      const orderRow = await prisma.category_custom_tabs.findFirst({
        where: { category_id: categoryId },
        select: { display_order: true },
        orderBy: { display_order: 'desc' },
      });

      const nextOrder = typeof display_order === 'number'
        ? display_order
        : ((orderRow?.display_order ?? -1) + 1);

      let data;
      try {
        data = await prisma.category_custom_tabs.create({
          data: {
            category_id: categoryId,
            tab_key: normalizedKey,
            title,
            description: description || null,
            display_order: nextOrder,
            is_active: true,
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          },
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to create custom tab', error);
      }

      await invalidateCategoryCache(categoryId);
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
      // URL and the admin renames it, regenerate the key from the new title.
      if (nextTabKey === undefined && title) {
        const existing = await prisma.category_custom_tabs.findUnique({
          where: { id: tabId },
          select: { tab_key: true },
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
        data = await prisma.category_custom_tabs.update({ where: { id: tabId }, data: updates });
      } catch (error) {
        if (error.code === 'P2025') {
          return res.status(404).json({ success: false, message: 'Custom tab not found' });
        }
        return buildErrorResponse(res, 'Failed to update custom tab', error);
      }

      await invalidateCategoryCache(data.category_id);
      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update custom tab', error);
    }
  },

  deleteCustomTab: async (req, res) => {
    try {
      const { categoryId, tabId } = req.params;

      try {
        await prisma.category_custom_tabs.deleteMany({ where: { id: tabId, category_id: categoryId } });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to delete custom tab', error);
      }

      await invalidateCategoryCache(categoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to delete custom tab', error);
    }
  },

  reorderCustomTabs: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const { tabIds } = req.body || {};

      if (!Array.isArray(tabIds)) {
        return res.status(400).json({ success: false, message: 'tabIds array is required' });
      }

      for (let index = 0; index < tabIds.length; index += 1) {
        const tabId = tabIds[index];
        await prisma.category_custom_tabs.updateMany({
          where: { id: tabId, category_id: categoryId },
          data: { display_order: index, updated_by: req.user?.id || null },
        });
      }

      await invalidateCategoryCache(categoryId);
      res.json({ success: true });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to reorder custom tabs', error);
    }
  },

  // Upload media for category
  uploadMedia: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const file = req.file;
      const { folder } = req.body || {};

      if (!file) {
        return res.status(400).json({ error: 'File is required' });
      }

      const uploadFolder = folder || `page-content/category/${categoryId}`;
      const uploadResult = await uploadToR2(file, uploadFolder);
      if (!uploadResult?.url) {
        return res.status(500).json({ error: 'Failed to upload file to storage' });
      }

      const detectFileType = (mime) => {
        if (!mime) return 'file';
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return 'file';
      };

      let data;
      try {
        data = await prisma.page_media.create({
          data: {
            category_id: categoryId,
            file_name: uploadResult.fileName || file.originalname,
            file_url: uploadResult.url,
            file_type: detectFileType(file.mimetype),
            file_size: file.size,
            mime_type: file.mimetype,
            created_by: req.user?.id || null
          },
        });
      } catch (error) {
        return buildErrorResponse(res, 'Failed to save media record', error);
      }

      res.status(201).json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to upload media', error);
    }
  },

  // Update SEO
  updateSEO: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const {
        meta_title, meta_description, meta_keywords,
        og_title, og_description, og_image_url,
        canonical_url, robots_meta, structured_data, author_name
      } = req.body;

      // Check if SEO record exists for this category. Pull structured_data too so
      // we can merge — saving one concern (schema vs. tab_headings/toc/tab_seo)
      // must never wipe the other (they share this JSONB column).
      const existing = await prisma.page_seo.findUnique({
        where: { category_id: categoryId },
        select: { id: true, structured_data: true },
      });

      const seoPayload = {
        category_id: categoryId,
        meta_title: meta_title || null,
        meta_description: meta_description || null,
        meta_keywords: meta_keywords || null,
        og_title: og_title || null,
        og_description: og_description || null,
        og_image_url: og_image_url || null,
        canonical_url: canonical_url || null,
        robots_meta: robots_meta || null,
        structured_data: mergeStructuredData(existing?.structured_data, structured_data),
        author_name: author_name || null
      };

      let data;
      try {
        if (existing?.id) {
          data = await prisma.page_seo.update({ where: { id: existing.id }, data: seoPayload });
        } else {
          data = await prisma.page_seo.create({ data: seoPayload });
        }
      } catch (error) {
        return buildErrorResponse(res, 'Failed to update SEO', error);
      }

      await invalidateCategoryCache(categoryId);
      res.json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update SEO', error);
    }
  }
};

module.exports = categoryPageContentController;
