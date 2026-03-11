const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, adminAuth, checkPermission, requireRole } = require('../middleware/auth');
const activityLogger = require('../middleware/activityLogger');
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
  uploadExamPdfEn,
  uploadExamPdfHi,
  removeExamPdfEn,
  removeExamPdfHi,
  getAllUsers,
  getUserDetails,
  updateUserRole,
  toggleUserBlock
} = require('../controllers/adminExamController');
const {
  getAdminNavigationLinks,
  createNavigationLink,
  updateNavigationLink,
  deleteNavigationLink,
  reorderNavigationLinks
} = require('../controllers/navigationController');
const {
  getAdminFooterLinks,
  createFooterLink,
  updateFooterLink,
  deleteFooterLink,
  reorderFooterLinks
} = require('../controllers/footerController');
const { adminGetContact, adminUpsertContact } = require('../controllers/contactController');
const { adminGetAbout, adminUpsertAbout } = require('../controllers/aboutController');
const { adminGetPrivacyPolicy, adminUpsertPrivacyPolicy } = require('../controllers/privacyController');
const { adminGetDisclaimer, adminUpsertDisclaimer } = require('../controllers/disclaimerController');

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

const uploadPdf = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_PDF_SIZE) || 10485760
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF files are allowed.'));
    }
  }
});

router.use(authenticate);
router.use(adminAuth);

router.get('/exams', checkPermission('exams', 'read'), getAdminExams);
router.get('/exams/:id', checkPermission('exams', 'read'), getAdminExamById);
router.get('/exams/:id/sections-questions', checkPermission('exams', 'read'), getExamSectionsWithQuestions);
router.post('/exams', checkPermission('exams', 'create'), activityLogger('CREATE_EXAM', 'exam'), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), createExam);

router.post('/exams/bulk', checkPermission('exams', 'create'), activityLogger('BULK_CREATE_EXAM', 'exam'), upload.any(), bulkCreateExamWithContent);

router.post('/exams/draft', checkPermission('exams', 'create'), activityLogger('SAVE_DRAFT_EXAM', 'exam'), upload.any(), saveDraftExam);

router.put('/exams/:id/content', checkPermission('exams', 'update'), activityLogger('UPDATE_EXAM_CONTENT', 'exam'), upload.any(), updateExamWithContent);

router.put('/exams/:id', checkPermission('exams', 'update'), activityLogger('UPDATE_EXAM', 'exam'), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), updateExam);

router.delete('/exams/:id', requireRole('admin'), activityLogger('DELETE_EXAM', 'exam'), deleteExam);

router.post('/sections', checkPermission('exams', 'create'), activityLogger('CREATE_SECTION', 'section'), createSection);
router.put('/sections/:id', checkPermission('exams', 'update'), activityLogger('UPDATE_SECTION', 'section'), updateSection);
router.delete('/sections/:id', requireRole('admin'), activityLogger('DELETE_SECTION', 'section'), deleteSection);

router.get('/navigation', requireRole('admin'), getAdminNavigationLinks);
router.post('/navigation', requireRole('admin'), activityLogger('CREATE_NAVIGATION', 'navigation'), createNavigationLink);
router.put('/navigation/:id', requireRole('admin'), activityLogger('UPDATE_NAVIGATION', 'navigation'), updateNavigationLink);
router.delete('/navigation/:id', requireRole('admin'), activityLogger('DELETE_NAVIGATION', 'navigation'), deleteNavigationLink);
router.post('/navigation/reorder', requireRole('admin'), reorderNavigationLinks);

router.get('/footer', requireRole('admin'), getAdminFooterLinks);
router.post('/footer', requireRole('admin'), createFooterLink);
router.put('/footer/:id', requireRole('admin'), updateFooterLink);
router.delete('/footer/:id', requireRole('admin'), deleteFooterLink);
router.post('/footer/reorder', requireRole('admin'), reorderFooterLinks);

router.get('/contact', requireRole('admin'), adminGetContact);
router.put('/contact', requireRole('admin'), adminUpsertContact);

router.get('/about', requireRole('admin'), adminGetAbout);
router.put('/about', requireRole('admin'), adminUpsertAbout);

router.get('/privacy', requireRole('admin'), adminGetPrivacyPolicy);
router.put('/privacy', requireRole('admin'), adminUpsertPrivacyPolicy);

router.get('/disclaimer', requireRole('admin'), adminGetDisclaimer);
router.put('/disclaimer', requireRole('admin'), adminUpsertDisclaimer);

router.post('/questions', checkPermission('exams', 'create'), activityLogger('CREATE_QUESTION', 'question'), upload.single('image'), createQuestion);
router.put('/questions/:id', checkPermission('exams', 'update'), activityLogger('UPDATE_QUESTION', 'question'), upload.single('image'), updateQuestion);
router.delete('/questions/:id', requireRole('admin'), activityLogger('DELETE_QUESTION', 'question'), deleteQuestion);

// Immediate image upload endpoints
router.post('/questions/:id/upload-image', checkPermission('exams', 'update'), activityLogger('UPLOAD_QUESTION_IMAGE', 'question'), upload.single('image'), uploadQuestionImage);
router.delete('/questions/:id/remove-image', requireRole('admin'), activityLogger('REMOVE_QUESTION_IMAGE', 'question'), removeQuestionImage);

router.post('/options', checkPermission('exams', 'create'), activityLogger('CREATE_OPTION', 'option'), upload.single('image'), createOption);
router.put('/options/:id', checkPermission('exams', 'update'), activityLogger('UPDATE_OPTION', 'option'), upload.single('image'), updateOption);

router.post('/options/:id/upload-image', checkPermission('exams', 'update'), activityLogger('UPLOAD_OPTION_IMAGE', 'option'), upload.single('image'), uploadOptionImage);
router.delete('/options/:id/remove-image', requireRole('admin'), activityLogger('REMOVE_OPTION_IMAGE', 'option'), removeOptionImage);

// PDF upload endpoints for exams
router.post('/exams/:id/upload-pdf-en', checkPermission('exams', 'update'), activityLogger('UPLOAD_EXAM_PDF_EN', 'exam'), uploadPdf.single('pdf'), uploadExamPdfEn);
router.post('/exams/:id/upload-pdf-hi', checkPermission('exams', 'update'), activityLogger('UPLOAD_EXAM_PDF_HI', 'exam'), uploadPdf.single('pdf'), uploadExamPdfHi);
router.delete('/exams/:id/remove-pdf-en', requireRole('admin'), activityLogger('REMOVE_EXAM_PDF_EN', 'exam'), removeExamPdfEn);
router.delete('/exams/:id/remove-pdf-hi', requireRole('admin'), activityLogger('REMOVE_EXAM_PDF_HI', 'exam'), removeExamPdfHi);

router.get('/users', requireRole('admin'), getAllUsers);
router.get('/users/:id', requireRole('admin'), getUserDetails);
router.put('/users/:id/role', requireRole('admin'), activityLogger('UPDATE_USER_ROLE', 'user'), updateUserRole);
router.put('/users/:id/toggle-block', requireRole('admin'), activityLogger('TOGGLE_USER_BLOCK', 'user'), toggleUserBlock);

module.exports = router;
