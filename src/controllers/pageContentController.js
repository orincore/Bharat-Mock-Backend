const supabase = require('../config/database');
const { uploadToR2 } = require('../utils/fileUpload');

const buildErrorResponse = (res, message, error) => {
  console.error(message, error);
  return res.status(500).json({ error: message });
};

const debugLog = (label, payload) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(label, payload);
  }
};

const pageContentController = {
  // Get all content for a subcategory page
  getPageContent: async (req, res) => {
    try {
      const { subcategoryId } = req.params;
      debugLog('[pageContentController.getPageContent]', { subcategoryId, userId: req.user?.id, adminRole: req.adminRole });

      const { data: sections, error: sectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('subcategory_id', subcategoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch sections', sectionsError);
      }

      const { data: blocks, error: blocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('subcategory_id', subcategoryId)
        .eq('is_active', true)
        .order('section_id', { ascending: true })
        .order('display_order', { ascending: true });

      if (blocksError) {
        return buildErrorResponse(res, 'Failed to fetch blocks', blocksError);
      }

      const { data: seo, error: seoError } = await supabase
        .from('page_seo')
        .select('*')
        .eq('subcategory_id', subcategoryId)
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
        seo: seo || null
      });
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch page content', error);
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
        settings
      } = req.body;

      const { data, error } = await supabase
        .from('page_sections')
        .insert([
          {
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
            settings: settings || {},
            created_by: req.user?.id || null,
            updated_by: req.user?.id || null
          }
        ])
        .select('*')
        .single();

      if (error) {
        return buildErrorResponse(res, 'Failed to create section', error);
      }

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
        settings
      } = req.body;

      const { data, error } = await supabase
        .from('page_sections')
        .update({
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
          settings: settings ?? undefined,
          updated_by: req.user?.id || null
        })
        .eq('id', sectionId)
        .select('*')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Section not found' });
        }
        return buildErrorResponse(res, 'Failed to update section', error);
      }

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

      const { data, error } = await supabase
        .from('page_sections')
        .delete()
        .eq('id', sectionId)
        .select('id')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Section not found' });
        }
        return buildErrorResponse(res, 'Failed to delete section', error);
      }

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

      const { data, error } = await supabase
        .from('page_content_blocks')
        .insert([
          {
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
        ])
        .select('*')
        .single();

      if (error) {
        return buildErrorResponse(res, 'Failed to create block', error);
      }

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

      const { data, error } = await supabase
        .from('page_content_blocks')
        .update({
          section_id: section_id ?? undefined,
          content: content ?? undefined,
          settings: settings ?? undefined,
          display_order: display_order ?? undefined,
          is_active: is_active ?? undefined,
          updated_by: req.user?.id || null
        })
        .eq('id', blockId)
        .select('*')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Block not found' });
        }
        return buildErrorResponse(res, 'Failed to update block', error);
      }

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

      const { error } = await supabase
        .from('page_content_blocks')
        .delete()
        .eq('id', blockId);

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Block not found' });
        }
        return buildErrorResponse(res, 'Failed to delete block', error);
      }

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
        const { error } = await supabase
          .from('page_content_blocks')
          .update({ display_order: block.display_order })
          .eq('id', block.id);

        if (error) {
          throw error;
        }
      }

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

      const { data, error } = await supabase
        .from('page_media')
        .insert([
          {
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
        ])
        .select('*')
        .single();

      if (error) {
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

      let query = supabase
        .from('page_media')
        .select('*')
        .eq('subcategory_id', subcategoryId)
        .order('created_at', { ascending: false });

      if (type) {
        query = query.eq('file_type', type);
      }

      const { data, error } = await query;

      if (error) {
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
        structured_data
      } = req.body;

      const { data, error } = await supabase
        .from('page_seo')
        .upsert({
          subcategory_id: subcategoryId,
          meta_title,
          meta_description,
          meta_keywords,
          og_title,
          og_description,
          og_image_url,
          canonical_url,
          robots_meta,
          structured_data: structured_data || {}
        }, { onConflict: 'subcategory_id' })
        .select('*')
        .single();

      if (error) {
        return buildErrorResponse(res, 'Failed to update SEO', error);
      }

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

      const [sectionsRes, blocksRes, seoRes] = await Promise.all([
        supabase
          .from('page_sections')
          .select('*')
          .eq('subcategory_id', subcategoryId),
        supabase
          .from('page_content_blocks')
          .select('*')
          .eq('subcategory_id', subcategoryId),
        supabase
          .from('page_seo')
          .select('*')
          .eq('subcategory_id', subcategoryId)
          .maybeSingle()
      ]);

      if (sectionsRes.error || blocksRes.error || seoRes.error) {
        return buildErrorResponse(res, 'Failed to fetch content snapshot', sectionsRes.error || blocksRes.error || seoRes.error);
      }

      const { data: revisionRow, error: revisionError } = await supabase
        .from('page_revisions')
        .select('revision_number')
        .eq('subcategory_id', subcategoryId)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revisionError && revisionError.code !== 'PGRST116') {
        return buildErrorResponse(res, 'Failed to fetch revision number', revisionError);
      }

      const nextRevision = (revisionRow?.revision_number || 0) + 1;

      const contentSnapshot = {
        sections: sectionsRes.data || [],
        blocks: blocksRes.data || [],
        seo: seoRes.data || null
      };

      const { data, error } = await supabase
        .from('page_revisions')
        .insert([
          {
            subcategory_id: subcategoryId,
            revision_number: nextRevision,
            content_snapshot: contentSnapshot,
            change_summary: change_summary || 'Manual save',
            created_by: req.user?.id || null
          }
        ])
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

  // Get page revisions
  getRevisions: async (req, res) => {
    try {
      const { subcategoryId } = req.params;

      const { data, error } = await supabase
        .from('page_revisions')
        .select('*, created_by:users(name)')
        .eq('subcategory_id', subcategoryId)
        .order('revision_number', { ascending: false })
        .limit(20);

      if (error) {
        return buildErrorResponse(res, 'Failed to fetch revisions', error);
      }

      res.json(data || []);
    } catch (error) {
      return buildErrorResponse(res, 'Failed to fetch revisions', error);
    }
  },

  // Restore a revision
  restoreRevision: async (req, res) => {
    try {
      const { subcategoryId, revisionId } = req.params;

      const { data: revision, error: revisionError } = await supabase
        .from('page_revisions')
        .select('content_snapshot')
        .eq('id', revisionId)
        .eq('subcategory_id', subcategoryId)
        .single();

      if (revisionError) {
        if (revisionError.code === 'PGRST116') {
          return res.status(404).json({ error: 'Revision not found' });
        }
        return buildErrorResponse(res, 'Failed to fetch revision', revisionError);
      }

      const snapshot = revision.content_snapshot || {};

      const deleteBlocks = await supabase
        .from('page_content_blocks')
        .delete()
        .eq('subcategory_id', subcategoryId);

      if (deleteBlocks.error) {
        return buildErrorResponse(res, 'Failed to clear blocks', deleteBlocks.error);
      }

      const deleteSections = await supabase
        .from('page_sections')
        .delete()
        .eq('subcategory_id', subcategoryId);

      if (deleteSections.error) {
        return buildErrorResponse(res, 'Failed to clear sections', deleteSections.error);
      }

      if (snapshot.sections?.length) {
        const insertSections = await supabase
          .from('page_sections')
          .insert(snapshot.sections);

        if (insertSections.error) {
          return buildErrorResponse(res, 'Failed to restore sections', insertSections.error);
        }
      }

      if (snapshot.blocks?.length) {
        const insertBlocks = await supabase
          .from('page_content_blocks')
          .insert(snapshot.blocks);

        if (insertBlocks.error) {
          return buildErrorResponse(res, 'Failed to restore blocks', insertBlocks.error);
        }
      }

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

      const { data: existingSections, error: sectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('subcategory_id', subcategoryId);

      if (sectionsError) {
        return buildErrorResponse(res, 'Failed to fetch existing sections', sectionsError);
      }

      const { data: existingBlocks, error: blocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('subcategory_id', subcategoryId);

      if (blocksError) {
        return buildErrorResponse(res, 'Failed to fetch existing blocks', blocksError);
      }

      const existingSectionMap = new Map((existingSections || []).map((section) => [section.id, section]));
      const existingBlockMap = new Map((existingBlocks || []).map((block) => [block.id, block]));
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
        settings: section.settings || {}
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
        let sectionId = section.id;
        const existingSection = section.id ? existingSectionMap.get(section.id) : null;

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
            subcategory_id: subcategoryId,
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

      const { data: refreshedSections, error: refreshedSectionsError } = await supabase
        .from('page_sections')
        .select('*')
        .eq('subcategory_id', subcategoryId)
        .order('display_order', { ascending: true });

      if (refreshedSectionsError) {
        return buildErrorResponse(res, 'Failed to fetch refreshed sections', refreshedSectionsError);
      }

      const { data: refreshedBlocks, error: refreshedBlocksError } = await supabase
        .from('page_content_blocks')
        .select('*')
        .eq('subcategory_id', subcategoryId)
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
  }
};

module.exports = pageContentController;
