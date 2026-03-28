const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/r2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const logger = require('../config/logger');

let sharp;
try {
  sharp = require('sharp');
} catch (_e) {
  logger.warn('sharp not available — images will be uploaded without compression');
  sharp = null;
}

const FOLDER_STRUCTURE = {
  EXAM_LOGOS: 'exams/logos',
  EXAM_THUMBNAILS: 'exams/thumbnails',
  EXAM_PDFS: 'exams/pdfs',
  QUESTION_IMAGES: 'questions/images',
  OPTION_IMAGES: 'options/images',
  USER_AVATARS: 'users/avatars',
  CATEGORY_LOGOS: 'categories/logos',
  SUBCATEGORY_LOGOS: 'subcategories/logos'
};

// Max dimensions per folder type — prevents huge images being stored
const RESIZE_CONFIG = {
  [FOLDER_STRUCTURE.EXAM_LOGOS]:       { width: 400,  height: 400,  quality: 85 },
  [FOLDER_STRUCTURE.EXAM_THUMBNAILS]:  { width: 800,  height: 600,  quality: 82 },
  [FOLDER_STRUCTURE.CATEGORY_LOGOS]:   { width: 300,  height: 300,  quality: 85 },
  [FOLDER_STRUCTURE.SUBCATEGORY_LOGOS]:{ width: 300,  height: 300,  quality: 85 },
  [FOLDER_STRUCTURE.USER_AVATARS]:     { width: 256,  height: 256,  quality: 85 },
  [FOLDER_STRUCTURE.QUESTION_IMAGES]:  { width: 1200, height: 900,  quality: 85 },
  [FOLDER_STRUCTURE.OPTION_IMAGES]:    { width: 600,  height: 400,  quality: 85 },
};

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
]);

/**
 * Compress an image buffer using sharp.
 * Returns { buffer, mimeType, extension } of the compressed image.
 * Falls back to original if sharp is unavailable or file is a PDF/SVG/GIF.
 */
const compressImage = async (file, folder) => {
  if (!sharp || !IMAGE_MIME_TYPES.has(file.mimetype)) {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: path.extname(file.originalname) };
  }

  // Don't compress GIFs (would lose animation)
  if (file.mimetype === 'image/gif') {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: '.gif' };
  }

  const config = RESIZE_CONFIG[folder] || { width: 1200, height: 1200, quality: 82 };

  try {
    const compressed = await sharp(file.buffer)
      .resize(config.width, config.height, {
        fit: 'inside',          // never upscale, preserve aspect ratio
        withoutEnlargement: true,
      })
      .webp({ quality: config.quality, effort: 4 })
      .toBuffer();

    // Only use compressed version if it's actually smaller
    if (compressed.length < file.buffer.length) {
      logger.info(`Compressed ${file.originalname}: ${(file.buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB`);
      return { buffer: compressed, mimeType: 'image/webp', extension: '.webp' };
    }

    // Fall back to original if compression didn't help (e.g. already tiny)
    return { buffer: file.buffer, mimeType: file.mimetype, extension: path.extname(file.originalname) };
  } catch (err) {
    logger.warn(`Image compression failed for ${file.originalname}, uploading original:`, err.message);
    return { buffer: file.buffer, mimeType: file.mimetype, extension: path.extname(file.originalname) };
  }
};

const uploadFile = async (file, folder, customFileName = null) => {
  try {
    // Compress image before uploading
    const { buffer, mimeType, extension } = await compressImage(file, folder);

    const fileName = customFileName
      ? customFileName.replace(/\.[^.]+$/, extension) // keep custom name, swap extension
      : `${uuidv4()}${extension}`;
    const key = `${folder}/${fileName}`;

    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      // Cache for 1 year — images are content-addressed by UUID
      CacheControl: 'public, max-age=31536000, immutable',
    };

    await r2Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = `${R2_PUBLIC_URL}/${key}`;
    logger.info(`File uploaded successfully: ${key}`);

    return { success: true, url: fileUrl, key, fileName };
  } catch (error) {
    logger.error('File upload error:', error);
    throw new Error('Failed to upload file to R2 storage');
  }
};

const deleteFile = async (fileKey) => {
  try {
    const deleteParams = {
      Bucket: R2_BUCKET_NAME,
      Key: fileKey,
    };

    await r2Client.send(new DeleteObjectCommand(deleteParams));
    
    logger.info(`File deleted successfully: ${fileKey}`);
    
    return { success: true };
  } catch (error) {
    logger.error('File deletion error:', error);
    throw new Error('Failed to delete file from R2 storage');
  }
};

const uploadExamLogo = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.EXAM_LOGOS);
};

const uploadExamThumbnail = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.EXAM_THUMBNAILS);
};

const uploadQuestionImage = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.QUESTION_IMAGES);
};

const uploadOptionImage = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.OPTION_IMAGES);
};

const uploadUserAvatar = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.USER_AVATARS);
};

const uploadCategoryLogo = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.CATEGORY_LOGOS);
};

const uploadSubcategoryLogo = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.SUBCATEGORY_LOGOS);
};

const uploadExamPdfEn = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.EXAM_PDFS);
};

const uploadExamPdfHi = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.EXAM_PDFS);
};

const extractKeyFromUrl = (url) => {
  if (!url || !url.includes(R2_PUBLIC_URL)) return null;
  return url.replace(`${R2_PUBLIC_URL}/`, '');
};

const uploadBuffer = async (buffer, filename, mimeType, folder = 'uploads') => {
  try {
    const key = `${folder}/${filename}`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });

    await r2Client.send(command);
    
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    logger.info(`Buffer uploaded successfully: ${publicUrl}`);
    
    return { url: publicUrl, key };
  } catch (error) {
    logger.error('Buffer upload error:', error);
    throw new Error('Failed to upload buffer to R2');
  }
};

module.exports = {
  uploadFile,
  uploadBuffer,
  deleteFile,
  uploadExamLogo,
  uploadExamThumbnail,
  uploadExamPdfEn,
  uploadExamPdfHi,
  uploadQuestionImage,
  uploadOptionImage,
  uploadUserAvatar,
  uploadCategoryLogo,
  uploadSubcategoryLogo,
  extractKeyFromUrl,
  FOLDER_STRUCTURE
};
