const prisma = require('../config/prisma');
const { uploadToR2 } = require('../utils/fileUpload');

const subscriptionPageController = {
  async getPageContent(req, res) {
    try {
      const [sectionsData, blocksData, metaData] = await Promise.all([
        prisma.subscription_page_sections.findMany({
          where: { is_active: true },
          orderBy: { display_order: 'asc' },
        }),
        prisma.subscription_page_blocks.findMany({
          orderBy: { display_order: 'asc' },
        }),
        // BUGFIX (2026-07-20): this table has 2 rows in production when the code assumes
        // a singleton (found while migrating — see MIGRATION_TRACKER.md §4.5). A bare
        // findFirst()/`.limit(1)` with no ORDER BY is non-deterministic across calls.
        // Ordering by created_at makes which row is "the" meta row stable and
        // predictable — it does not resolve *why* there are two, which is a content
        // decision, not a code bug; flagging that separately.
        prisma.subscription_page_meta.findFirst({ orderBy: { created_at: 'asc' } }),
      ]);

      const sections = (sectionsData || []).map((section) => ({
        ...section,
        blocks: (blocksData || []).filter((block) => block.section_id === section.id)
      }));

      res.json({
        success: true,
        data: {
          sections,
          meta: metaData || null
        }
      });
    } catch (error) {
      console.error('Error fetching subscription page content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscription page content',
        error: error.message
      });
    }
  },

  async updateSection(req, res) {
    const { id } = req.params;
    const {
      section_key,
      section_type,
      title,
      subtitle,
      description,
      background_color,
      text_color,
      display_order,
      is_active,
      settings
    } = req.body;

    try {
      const payload = {
        section_key,
        section_type,
        title,
        subtitle,
        description,
        background_color,
        text_color,
        display_order,
        is_active,
        settings
      };

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      const existing = await prisma.subscription_page_sections.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Section not found'
        });
      }

      const data = await prisma.subscription_page_sections.update({
        where: { id },
        data: payload,
      });

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error updating section:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update section',
        error: error.message
      });
    }
  },

  async createSection(req, res) {
    const {
      section_key,
      section_type,
      title,
      subtitle,
      description,
      background_color,
      text_color,
      display_order,
      is_active,
      settings
    } = req.body;

    try {
      const payload = {
        section_key,
        section_type,
        title: title || null,
        subtitle: subtitle || null,
        description: description || null,
        background_color: background_color || null,
        text_color: text_color || null,
        display_order: display_order ?? 0,
        is_active: is_active !== undefined ? is_active : true,
        settings: settings || {}
      };

      const data = await prisma.subscription_page_sections.create({ data: payload });

      res.status(201).json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error creating section:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create section',
        error: error.message
      });
    }
  },

  async deleteSection(req, res) {
    const { id } = req.params;

    try {
      const existing = await prisma.subscription_page_sections.findUnique({ where: { id }, select: { id: true } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Section not found'
        });
      }

      await prisma.subscription_page_sections.delete({ where: { id } });

      res.json({
        success: true,
        message: 'Section deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting section:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete section',
        error: error.message
      });
    }
  },

  async updateBlock(req, res) {
    const { id } = req.params;
    const {
      section_id,
      block_type,
      title,
      content,
      icon,
      image_url,
      link_url,
      link_text,
      display_order,
      metadata
    } = req.body;

    try {
      const payload = {
        section_id,
        block_type,
        title,
        content,
        icon,
        image_url,
        link_url,
        link_text,
        display_order,
        metadata
      };

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      const existing = await prisma.subscription_page_blocks.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Block not found'
        });
      }

      const data = await prisma.subscription_page_blocks.update({
        where: { id },
        data: payload,
      });

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error updating block:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update block',
        error: error.message
      });
    }
  },

  async createBlock(req, res) {
    const {
      section_id,
      block_type,
      title,
      content,
      icon,
      image_url,
      link_url,
      link_text,
      display_order,
      metadata
    } = req.body;

    try {
      const payload = {
        section_id,
        block_type,
        title: title || null,
        content: content || null,
        icon: icon || null,
        image_url: image_url || null,
        link_url: link_url || null,
        link_text: link_text || null,
        display_order: display_order ?? 0,
        metadata: metadata || {}
      };

      const data = await prisma.subscription_page_blocks.create({ data: payload });

      res.status(201).json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error creating block:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create block',
        error: error.message
      });
    }
  },

  async deleteBlock(req, res) {
    const { id } = req.params;

    try {
      const existing = await prisma.subscription_page_blocks.findUnique({ where: { id }, select: { id: true } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Block not found'
        });
      }

      await prisma.subscription_page_blocks.delete({ where: { id } });

      res.json({
        success: true,
        message: 'Block deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting block:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete block',
        error: error.message
      });
    }
  },

  async updateMeta(req, res) {
    const {
      meta_title,
      meta_description,
      meta_keywords,
      og_title,
      og_description,
      og_image,
      canonical_url,
      structured_data
    } = req.body;

    try {
      // Same determinism fix as getPageContent — must target the same row consistently.
      const existingMeta = await prisma.subscription_page_meta.findFirst({ orderBy: { created_at: 'asc' } });

      let data;

      if (!existingMeta) {
        const insertPayload = {
          meta_title,
          meta_description,
          meta_keywords,
          og_title,
          og_description,
          og_image,
          canonical_url,
          structured_data: structured_data || {}
        };

        data = await prisma.subscription_page_meta.create({ data: insertPayload });
      } else {
        const updatePayload = {
          meta_title,
          meta_description,
          meta_keywords,
          og_title,
          og_description,
          og_image,
          canonical_url,
          structured_data
        };

        Object.keys(updatePayload).forEach((key) => {
          if (updatePayload[key] === undefined) {
            delete updatePayload[key];
          }
        });

        data = await prisma.subscription_page_meta.update({
          where: { id: existingMeta.id },
          data: updatePayload,
        });
      }

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error updating meta:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update meta information',
        error: error.message
      });
    }
  }
  ,

  async uploadMedia(req, res) {
    try {
      const file = req.file;
      const { folder } = req.body || {};

      if (!file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const uploadFolder = folder || 'subscription-page/media';
      const uploadResult = await uploadToR2(file, uploadFolder);

      if (!uploadResult?.url) {
        return res.status(500).json({ success: false, message: 'Failed to upload file' });
      }

      const detectFileType = (mime) => {
        if (!mime) return 'file';
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return 'file';
      };

      return res.status(201).json({
        success: true,
        file_url: uploadResult.url,
        file_name: uploadResult.fileName || file.originalname,
        file_type: detectFileType(file.mimetype),
        mime_type: file.mimetype,
        file_size: file.size
      });
    } catch (error) {
      console.error('Error uploading subscription media:', error);
      return res.status(500).json({ success: false, message: 'Failed to upload media', error: error.message });
    }
  }
};

module.exports = subscriptionPageController;
