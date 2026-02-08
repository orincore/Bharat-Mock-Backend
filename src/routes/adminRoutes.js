const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  getAdminExams,
  getAdminExamById,
  getExamSectionsWithQuestions,
  createExam,
  updateExam,
  updateExamWithContent,
  deleteExam,
  createSection,
  updateSection,
  deleteSection,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createOption,
  updateOption,
  bulkCreateExamWithContent,
  saveDraftExam,
  uploadQuestionImage,
  removeQuestionImage,
  uploadOptionImage,
  removeOptionImage,
  getAllUsers,
  getUserDetails,
  updateUserRole,
  toggleUserBlock
} = require('../controllers/adminExamController');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
  }
});

router.use(authenticate);
router.use(requireAdmin);

router.get('/exams', getAdminExams);
router.get('/exams/:id', getAdminExamById);
router.get('/exams/:id/sections-questions', getExamSectionsWithQuestions);
router.post('/exams', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), createExam);

router.post('/exams/bulk', upload.any(), bulkCreateExamWithContent);

router.post('/exams/draft', upload.any(), saveDraftExam);

router.put('/exams/:id/content', upload.any(), updateExamWithContent);

router.put('/exams/:id', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), updateExam);

router.delete('/exams/:id', deleteExam);

router.post('/sections', createSection);
router.put('/sections/:id', updateSection);
router.delete('/sections/:id', deleteSection);

router.post('/questions', upload.single('image'), createQuestion);
router.put('/questions/:id', upload.single('image'), updateQuestion);
router.delete('/questions/:id', deleteQuestion);

// Immediate image upload endpoints
router.post('/questions/:id/upload-image', upload.single('image'), uploadQuestionImage);
router.delete('/questions/:id/remove-image', removeQuestionImage);

router.post('/options', upload.single('image'), createOption);
router.put('/options/:id', upload.single('image'), updateOption);

router.post('/options/:id/upload-image', upload.single('image'), uploadOptionImage);
router.delete('/options/:id/remove-image', removeOptionImage);

router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/role', updateUserRole);
router.put('/users/:id/toggle-block', toggleUserBlock);

module.exports = router;
