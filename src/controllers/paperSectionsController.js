const supabase = require('../config/database');
const logger = require('../config/logger');

// Sections
const getAllSections = async (req, res) => {
  try {
    const { data: sections, error } = await supabase
      .from('paper_sections')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Error fetching paper sections:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch sections' });
    }

    res.json({ success: true, data: sections });
  } catch (error) {
    logger.error('Error in getAllSections:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const createSection = async (req, res) => {
  try {
    const { name, description, display_order } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

    const { data: section, error } = await supabase
      .from('paper_sections')
      .insert({ name, description, display_order: display_order || 0 })
      .select()
      .single();

    if (error) {
      logger.error('Error creating section:', error);
      return res.status(500).json({ success: false, message: 'Failed to create section' });
    }
    res.status(201).json({ success: true, data: section });
  } catch (error) {
    logger.error('Error in createSection:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const { data: section, error } = await supabase
      .from('paper_sections')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating section:', error);
      return res.status(500).json({ success: false, message: 'Failed to update section' });
    }
    res.json({ success: true, data: section });
  } catch (error) {
    logger.error('Error in updateSection:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('paper_sections').delete().eq('id', id);
    if (error) {
      logger.error('Error deleting section:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete section' });
    }
    res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteSection:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Topics
const getTopicsBySection = async (req, res) => {
  try {
    const { section_id } = req.params;
    const { data: topics, error } = await supabase
      .from('paper_topics')
      .select('*')
      .eq('section_id', section_id)
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Error fetching topics:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch topics' });
    }
    res.json({ success: true, data: topics });
  } catch (error) {
    logger.error('Error in getTopicsBySection:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getAllTopics = async (req, res) => {
  try {
    const { data: topics, error } = await supabase
      .from('paper_topics')
      .select('*, section:paper_sections(id, name)')
      .order('display_order', { ascending: true });

    if (error) {
      logger.error('Error fetching all topics:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch topics' });
    }
    res.json({ success: true, data: topics });
  } catch (error) {
    logger.error('Error in getAllTopics:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const createTopic = async (req, res) => {
  try {
    const { paper_section_id, name, description, display_order } = req.body;
    if (!paper_section_id || !name) return res.status(400).json({ success: false, message: 'paper_section_id and name are required' });

    const { data: topic, error } = await supabase
      .from('paper_topics')
      .insert({ section_id: paper_section_id, name, description, display_order: display_order || 0 })
      .select()
      .single();

    if (error) {
      logger.error('Error creating topic:', error);
      return res.status(500).json({ success: false, message: 'Failed to create topic' });
    }
    res.status(201).json({ success: true, data: topic });
  } catch (error) {
    logger.error('Error in createTopic:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const { data: topic, error } = await supabase
      .from('paper_topics')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating topic:', error);
      return res.status(500).json({ success: false, message: 'Failed to update topic' });
    }
    res.json({ success: true, data: topic });
  } catch (error) {
    logger.error('Error in updateTopic:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('paper_topics').delete().eq('id', id);
    if (error) {
      logger.error('Error deleting topic:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete topic' });
    }
    res.json({ success: true, message: 'Topic deleted successfully' });
  } catch (error) {
    logger.error('Error in deleteTopic:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const reorderSections = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    const updates = orderedIds.map((id, index) =>
      supabase.from('paper_sections').update({ display_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) return res.status(500).json({ success: false, message: 'Failed to reorder sections' });
    res.json({ success: true, message: 'Sections reordered successfully' });
  } catch (error) {
    logger.error('Reorder sections error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering sections' });
  }
};

const reorderTopics = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    const updates = orderedIds.map((id, index) =>
      supabase.from('paper_topics').update({ display_order: index }).eq('id', id)
    );
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) return res.status(500).json({ success: false, message: 'Failed to reorder topics' });
    res.json({ success: true, message: 'Topics reordered successfully' });
  } catch (error) {
    logger.error('Reorder topics error:', error);
    res.status(500).json({ success: false, message: 'Server error while reordering topics' });
  }
};

module.exports = {
  getAllSections,
  createSection,
  updateSection,
  deleteSection,
  getTopicsBySection,
  getAllTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderSections,
  reorderTopics,
};
