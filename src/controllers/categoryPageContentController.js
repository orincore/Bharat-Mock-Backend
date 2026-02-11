const supabase = require('../config/database');
const { uploadToR2 } = require('../utils/fileUpload');
const { slugify } = require('../utils/slugify');

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

      const { data: customTabs, error: tabsError } = await supabase
        .from('category_custom_tabs')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('title', { ascending: true });

      if (tabsError) {
        return buildErrorResponse(res, 'Failed to fetch custom tabs', tabsError);
      }

      const { data: sections, error: sectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch sections', sectionsError);
      }

      const { data: blocks, error: blocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('section_id', { ascending: true })
        .order('display_order', { ascending: true });

      if (blocksError) {
        return buildErrorResponse(res, 'Failed to fetch blocks', blocksError);
      }

      const { data: seo, error: seoError } = await supabase
        .from('page_seo')
        .select('*')
        .eq('category_id', categoryId)
        .maybeSingle();

      if (seoError) {
        return buildErrorResponse(res, 'Failed to fetch SEO', seoError);
      }

      const groupedBlocks = (sections || []).map(section => ({
        ...section,
        blocks: (blocks || []).filter(block => block.section_id === section.id)
      }));

      const orphanBlocks = (blocks || []).filter(block => !block.section_id);

      res.json({
        sections: groupedBlocks,
        orphanBlocks,
        seo: seo || null,
        customTabs: customTabs || []
      });
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

      const { data: existingSections, error: sectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('category_id', categoryId);

      if (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch existing sections', sectionsError);
      }

      const { data: existingBlocks, error: blocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('category_id', categoryId);

      if (blocksError) {
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
            const { error } = await supabase
              .from('page_sections')
              .update({
                ...sectionPayload,
                updated_by: req.user?.id || null
              })
              .eq('id', section.id);

            if (error) {
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

          const { data, error } = await supabase
            .from('page_sections')
            .insert([insertPayload])
            .select('*')
            .single();

          if (error) {
            return buildErrorResponse(res, 'Failed to create section during bulk sync', error);
          }

          sectionId = data.id;
          operations.sectionsCreated += 1;
        }

        sectionIdAliasMap.set(sectionAlias, sectionId || section.id);

        const blocks = Array.isArray(section.blocks) ? section.blocks : [];

        for (const block of blocks) {
          const resolvedSectionId = sectionIdAliasMap.get(sectionAlias);
          const blockPayload = normalizeBlockPayload(block, resolvedSectionId);

          if (block.id && existingBlockMap.has(block.id)) {
            const existingBlock = existingBlockMap.get(block.id);
            const comparableExisting = normalizeBlockPayload(existingBlock, existingBlock.section_id);

            if (hasChanged(blockPayload, comparableExisting)) {
              const { error } = await supabase
                .from('page_content_blocks')
                .update({
                  ...blockPayload,
                  updated_by: req.user?.id || null
                })
                .eq('id', block.id);

              if (error) {
                return buildErrorResponse(res, 'Failed to update block during bulk sync', error);
              }
              operations.blocksUpdated += 1;
            } else {
              operations.blocksSkipped += 1;
            }
          } else {
            const insertPayload = {
              ...blockPayload,
              created_by: req.user?.id || null,
              updated_by: req.user?.id || null
            };

            const { error } = await supabase
              .from('page_content_blocks')
              .insert([insertPayload]);

            if (error) {
              return buildErrorResponse(res, 'Failed to create block during bulk sync', error);
            }
            operations.blocksCreated += 1;
          }
        }
      }

      // Soft-delete sections that were removed (not present in the incoming payload)
      const incomingSectionIds = new Set(
        sections.filter((s) => s.id && existingSectionMap.has(s.id)).map((s) => s.id)
      );
      for (const [existingId] of existingSectionMap) {
        if (!incomingSectionIds.has(existingId)) {
          await supabase
            .from('page_sections')
            .update({ is_active: false, updated_by: req.user?.id || null })
            .eq('id', existingId);

          // Also soft-delete blocks belonging to the removed section
          await supabase
            .from('page_content_blocks')
            .update({ is_active: false, updated_by: req.user?.id || null })
            .eq('section_id', existingId)
            .eq('category_id', categoryId);

          operations.sectionsDeleted = (operations.sectionsDeleted || 0) + 1;
        }
      }

      // Soft-delete blocks that were removed from surviving sections
      const incomingBlockIds = new Set();
      for (const section of sections) {
        const blocks = Array.isArray(section.blocks) ? section.blocks : [];
        for (const block of blocks) {
          if (block.id && existingBlockMap.has(block.id)) {
            incomingBlockIds.add(block.id);
          }
        }
      }
      for (const [existingBlockId, existingBlock] of existingBlockMap) {
        // Only delete blocks whose parent section is still active (surviving sections)
        if (!incomingBlockIds.has(existingBlockId) && incomingSectionIds.has(existingBlock.section_id)) {
          await supabase
            .from('page_content_blocks')
            .update({ is_active: false, updated_by: req.user?.id || null })
            .eq('id', existingBlockId);

          operations.blocksDeleted = (operations.blocksDeleted || 0) + 1;
        }
      }

      const { data: refreshedSections, error: refreshedSectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (refreshedSectionsError) {
        return buildErrorResponse(res, 'Failed to fetch refreshed sections', refreshedSectionsError);
      }

      const { data: refreshedBlocks, error: refreshedBlocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (refreshedBlocksError) {
        return buildErrorResponse(res, 'Failed to fetch refreshed blocks', refreshedBlocksError);
      }

      const grouped = (refreshedSections || []).map((section) => ({
        ...section,
        blocks: (refreshedBlocks || []).filter((block) => block.section_id === section.id)
      }));

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

      const [sectionsRes, blocksRes, seoRes] = await Promise.all([
        supabase.from('page_sections').select('*').eq('category_id', categoryId),
        supabase.from('page_content_blocks').select('*').eq('category_id', categoryId),
        supabase.from('page_seo').select('*').eq('category_id', categoryId).maybeSingle()
      ]);

      if (sectionsRes.error || blocksRes.error || seoRes.error) {
        return buildErrorResponse(res, 'Failed to fetch content snapshot', sectionsRes.error || blocksRes.error || seoRes.error);
      }

      const { data: revisionRow } = await supabase
        .from('page_revisions')
        .select('revision_number')
        .eq('category_id', categoryId)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextRevision = (revisionRow?.revision_number || 0) + 1;

      const contentSnapshot = {
        sections: sectionsRes.data || [],
        blocks: blocksRes.data || [],
        seo: seoRes.data || null
      };

      const { data, error } = await supabase
        .from('page_revisions')
        .insert([{
          category_id: categoryId,
          revision_number: nextRevision,
          content_snapshot: contentSnapshot,
          change_summary: change_summary || 'Manual save',
          created_by: req.user?.id || null
        }])
        .select('*')
        .single();

      if (error) {
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

      const { data, error } = await supabase
        .from('category_custom_tabs')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('title', { ascending: true });

      if (error) {
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

      const normalizedKey = (tab_key || slugify(title)).slice(0, 190);

      const { data: orderRow } = await supabase
        .from('category_custom_tabs')
        .select('display_order')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrder = typeof display_order === 'number'
        ? display_order
        : ((orderRow?.display_order ?? -1) + 1);

      const { data, error } = await supabase
        .from('category_custom_tabs')
        .insert([{
          category_id: categoryId,
          tab_key: normalizedKey,
          title,
          description: description || null,
          display_order: nextOrder,
          is_active: true,
          created_by: req.user?.id || null,
          updated_by: req.user?.id || null
        }])
        .select('*')
        .single();

      if (error) {
        return buildErrorResponse(res, 'Failed to create custom tab', error);
      }

      res.status(201).json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to create custom tab', error);
    }
  },

  updateCustomTab: async (req, res) => {
    try {
      const { tabId } = req.params;
      const { title, description, display_order, is_active, tab_key } = req.body || {};

      const updates = {
        title: title ?? undefined,
        description: description ?? undefined,
        display_order: display_order ?? undefined,
        is_active: typeof is_active === 'boolean' ? is_active : undefined,
        tab_key: tab_key ? tab_key.slice(0, 190) : undefined,
        updated_by: req.user?.id || null
      };

      const { data, error } = await supabase
        .from('category_custom_tabs')
        .update(updates)
        .eq('id', tabId)
        .select('*')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ success: false, message: 'Custom tab not found' });
        }
        return buildErrorResponse(res, 'Failed to update custom tab', error);
      }

      res.json({ success: true, data });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update custom tab', error);
    }
  },

  deleteCustomTab: async (req, res) => {
    try {
      const { categoryId, tabId } = req.params;

      const { error } = await supabase
        .from('category_custom_tabs')
        .delete()
        .eq('id', tabId)
        .eq('category_id', categoryId);

      if (error) {
        return buildErrorResponse(res, 'Failed to delete custom tab', error);
      }

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
        const { error } = await supabase
          .from('category_custom_tabs')
          .update({ display_order: index, updated_by: req.user?.id || null })
          .eq('id', tabId)
          .eq('category_id', categoryId);

        if (error) {
          throw error;
        }
      }

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

      const { data, error } = await supabase
        .from('page_media')
        .insert([{
          category_id: categoryId,
          file_name: uploadResult.fileName || file.originalname,
          file_url: uploadResult.url,
          file_type: detectFileType(file.mimetype),
          file_size: file.size,
          mime_type: file.mimetype,
          created_by: req.user?.id || null
        }])
        .select('*')
        .single();

      if (error) {
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
        canonical_url, robots_meta, structured_data
      } = req.body;

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
        structured_data: structured_data || {}
      };

      // Check if SEO record exists for this category
      const { data: existing } = await supabase
        .from('page_seo')
        .select('id')
        .eq('category_id', categoryId)
        .maybeSingle();

      let data, error;
      if (existing?.id) {
        ({ data, error } = await supabase
          .from('page_seo')
          .update(seoPayload)
          .eq('id', existing.id)
          .select('*')
          .single());
      } else {
        ({ data, error } = await supabase
          .from('page_seo')
          .insert([seoPayload])
          .select('*')
          .single());
      }

      if (error) {
        return buildErrorResponse(res, 'Failed to update SEO', error);
      }

      res.json(data);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to update SEO', error);
    }
  }
};

module.exports = categoryPageContentController;
