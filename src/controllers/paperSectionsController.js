const prisma = require('../config/prisma');
const logger = require('../config/logger');

// Sections
const getAllSections = async (req, res) => {
  try {
    const sections = await prisma.paper_sections.findMany({
      orderBy: { display_order: 'asc' },
    });

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

    const section = await prisma.paper_sections.create({
      data: { name, description, display_order: display_order || 0 },
    });

    res.status(201).json({ success: true, data: section });
  } catch (error) {
    logger.error('Error creating section:', error);
    res.status(500).json({ success: false, message: 'Failed to create section' });
  }
};

const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const section = await prisma.paper_sections.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: section });
  } catch (error) {
    logger.error('Error updating section:', error);
    res.status(500).json({ success: false, message: 'Failed to update section' });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.paper_sections.delete({ where: { id } });
    res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) {
    logger.error('Error deleting section:', error);
    res.status(500).json({ success: false, message: 'Failed to delete section' });
  }
};

// Topics
const getTopicsBySection = async (req, res) => {
  try {
    const { section_id } = req.params;
    const topics = await prisma.paper_topics.findMany({
      where: { section_id },
      orderBy: { display_order: 'asc' },
    });
    res.json({ success: true, data: topics });
  } catch (error) {
    logger.error('Error fetching topics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch topics' });
  }
};

const getAllTopics = async (req, res) => {
  try {
    const rows = await prisma.paper_topics.findMany({
      include: { paper_sections: { select: { id: true, name: true } } },
      orderBy: { display_order: 'asc' },
    });
    const topics = rows.map(({ paper_sections, ...rest }) => ({ ...rest, section: paper_sections }));
    res.json({ success: true, data: topics });
  } catch (error) {
    logger.error('Error fetching all topics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch topics' });
  }
};

const createTopic = async (req, res) => {
  try {
    const { paper_section_id, name, description, display_order } = req.body;
    if (!paper_section_id || !name) return res.status(400).json({ success: false, message: 'paper_section_id and name are required' });

    const topic = await prisma.paper_topics.create({
      data: { section_id: paper_section_id, name, description, display_order: display_order || 0 },
    });

    res.status(201).json({ success: true, data: topic });
  } catch (error) {
    logger.error('Error creating topic:', error);
    res.status(500).json({ success: false, message: 'Failed to create topic' });
  }
};

const updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order } = req.body;
    const updateData = { updated_at: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const topic = await prisma.paper_topics.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: topic });
  } catch (error) {
    logger.error('Error updating topic:', error);
    res.status(500).json({ success: false, message: 'Failed to update topic' });
  }
};

const deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.paper_topics.delete({ where: { id } });
    res.json({ success: true, message: 'Topic deleted successfully' });
  } catch (error) {
    logger.error('Error deleting topic:', error);
    res.status(500).json({ success: false, message: 'Failed to delete topic' });
  }
};

const reorderSections = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    await prisma.$transaction(
      orderedIds.map((id, index) => prisma.paper_sections.update({ where: { id }, data: { display_order: index } }))
    );
    res.json({ success: true, message: 'Sections reordered successfully' });
  } catch (error) {
    logger.error('Reorder sections error:', error);
    res.status(500).json({ success: false, message: 'Failed to reorder sections' });
  }
};

const reorderTopics = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array' });
    }

    await prisma.$transaction(
      orderedIds.map((id, index) => prisma.paper_topics.update({ where: { id }, data: { display_order: index } }))
    );
    res.json({ success: true, message: 'Topics reordered successfully' });
  } catch (error) {
    logger.error('Reorder topics error:', error);
    res.status(500).json({ success: false, message: 'Failed to reorder topics' });
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
