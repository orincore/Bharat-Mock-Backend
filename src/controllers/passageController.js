const logger = require('../config/logger');
const {
  listPassagesForExam,
  getPassageById,
  createPassage,
  updatePassage,
  deletePassage,
} = require('../services/passageService');
const { uploadPassageImage } = require('../services/uploadService');

const listPassages = async (req, res) => {
  try {
    const { examId } = req.params;
    const passages = await listPassagesForExam(examId);
    res.json({ success: true, data: passages });
  } catch (error) {
    logger.error('Failed to list passages:', error, { examId: req.params.examId });
    res.status(500).json({ success: false, message: 'Failed to load passages' });
  }
};

const getPassage = async (req, res) => {
  try {
    const passage = await getPassageById(req.params.id);
    if (!passage) {
      return res.status(404).json({ success: false, message: 'Passage not found' });
    }
    res.json({ success: true, data: passage });
  } catch (error) {
    logger.error('Failed to fetch passage:', error, { id: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to load passage' });
  }
};

const createPassageController = async (req, res) => {
  try {
    const { examId } = req.params;
    const { title, content, content_hi: contentHi } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Passage content is required' });
    }

    const passage = await createPassage({ examId, title, content, contentHi });
    res.status(201).json({ success: true, data: passage });
  } catch (error) {
    logger.error('Failed to create passage:', error, { examId: req.params.examId });
    res.status(500).json({ success: false, message: 'Failed to create passage' });
  }
};

const updatePassageController = async (req, res) => {
  try {
    const { title, content, content_hi: contentHi } = req.body;

    if (content !== undefined && !content.trim()) {
      return res.status(400).json({ success: false, message: 'Passage content cannot be empty' });
    }

    const passage = await updatePassage(req.params.id, { title, content, contentHi });
    res.json({ success: true, data: passage });
  } catch (error) {
    logger.error('Failed to update passage:', error, { id: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to update passage' });
  }
};

const deletePassageController = async (req, res) => {
  try {
    await deletePassage(req.params.id);
    res.json({ success: true, message: 'Passage deleted' });
  } catch (error) {
    logger.error('Failed to delete passage:', error, { id: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to delete passage' });
  }
};

// Stateless upload used by the passage rich-text editor: uploads the pasted/inserted
// image and hands back a URL to embed inline in the passage's HTML content — mirrors
// uploadExplanationImage, which does the same for the explanation rich-text field.
const uploadPassageImageController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const imageResult = await uploadPassageImage(req.file);
    res.json({
      success: true,
      message: 'Passage image uploaded successfully',
      data: { image_url: imageResult.url },
    });
  } catch (error) {
    logger.error('Failed to upload passage image:', error);
    res.status(500).json({ success: false, message: 'Server error while uploading passage image' });
  }
};

module.exports = {
  listPassages,
  getPassage,
  createPassage: createPassageController,
  updatePassage: updatePassageController,
  deletePassage: deletePassageController,
  uploadPassageImage: uploadPassageImageController,
};
