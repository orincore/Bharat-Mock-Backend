const supabase = require('../config/database');
const { uploadToR2 } = require('../utils/fileUpload');

const subscriptionPageController = {
  async getPageContent(req, res) {
    try {
      const [{ data: sectionsData, error: sectionsError }, { data: blocksData, error: blocksError }, { data: metaData, error: metaError }] = await Promise.all([
        supabase
          .from('subscription_page_sections')
          .select('*')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),
        supabase
          .from('subscription_page_blocks')
          .select('*')
          .order('display_order', { ascending: true }),
        supabase
          .from('subscription_page_meta')
          .select('*')
          .limit(1)
          .maybeSingle()
      ]);

      if (sectionsError || blocksError || metaError) {
        throw sectionsError || blocksError || metaError;
      }

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

      const { data, error } = await supabase
        .from('subscription_page_sections')
        .update(payload)
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Section not found'
        });
      }

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

      const { data, error } = await supabase
        .from('subscription_page_sections')
        .insert(payload)
        .select('*')
        .maybeSingle();

      if (error) {
        throw error;
      }

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
      const { data, error } = await supabase
        .from('subscription_page_sections')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Section not found'
        });
      }

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

      const { data, error } = await supabase
        .from('subscription_page_blocks')
        .update(payload)
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Block not found'
        });
      }

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

      const { data, error } = await supabase
        .from('subscription_page_blocks')
        .insert(payload)
        .select('*')
        .maybeSingle();

      if (error) {
        throw error;
      }

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
      const { data, error } = await supabase
        .from('subscription_page_blocks')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Block not found'
        });
      }

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
      const { data: existingMeta, error: metaFetchError } = await supabase
        .from('subscription_page_meta')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (metaFetchError) {
        throw metaFetchError;
      }

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

        const insertResult = await supabase
          .from('subscription_page_meta')
          .insert(insertPayload)
          .select('*')
          .maybeSingle();

        if (insertResult.error) {
          throw insertResult.error;
        }
        data = insertResult.data;
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

        const updateResult = await supabase
          .from('subscription_page_meta')
          .update(updatePayload)
          .eq('id', existingMeta.id)
          .select('*')
          .maybeSingle();

        if (updateResult.error) {
          throw updateResult.error;
        }

        data = updateResult.data;
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
