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
  EXPLANATION_IMAGES: 'explanations/images',
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
  [FOLDER_STRUCTURE.EXPLANATION_IMAGES]:{ width: 1200, height: 900,  quality: 85 },
};

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
]);

/**
 * Convert and compress any image to WebP using sharp.
 * Always outputs WebP regardless of input format.
 * Falls back to original only if sharp is unavailable or file is PDF/SVG/GIF.
 */
const compressImage = async (file, folder) => {
  const originalExt = path.extname(file.originalname).toLowerCase();

  // Skip non-image files entirely (PDFs, SVGs, etc.)
  if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }

  // Skip GIFs — converting loses animation
  if (file.mimetype === 'image/gif') {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: '.gif' };
  }

  // Skip if already WebP and small enough (< 50KB) — no benefit
  if (file.mimetype === 'image/webp' && file.buffer.length < 50 * 1024) {
    return { buffer: file.buffer, mimeType: 'image/webp', extension: '.webp' };
  }

  if (!sharp) {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }

  const config = RESIZE_CONFIG[folder] || { width: 1920, height: 1080, quality: 82 };

  try {
    const webpBuffer = await sharp(file.buffer)
      .resize(config.width, config.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: config.quality, effort: 4, smartSubsample: true })
      .toBuffer();

    const savedKB = ((file.buffer.length - webpBuffer.length) / 1024).toFixed(0);
    logger.info(`WebP converted ${file.originalname}: ${(file.buffer.length / 1024).toFixed(0)}KB → ${(webpBuffer.length / 1024).toFixed(0)}KB (saved ${savedKB}KB)`);

    return { buffer: webpBuffer, mimeType: 'image/webp', extension: '.webp' };
  } catch (err) {
    logger.warn(`WebP conversion failed for ${file.originalname}, uploading original:`, err.message);
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }
};

const uploadFile = async (file, folder, customFileName = null) => {
  try {
    const originalSize = file.buffer.length;
    const { buffer, mimeType, extension } = await compressImage(file, folder);
    const compressedSize = buffer.length;
    const savedPct = originalSize > 0
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

    const fileName = customFileName
      ? customFileName.replace(/\.[^.]+$/, extension)
      : `${uuidv4()}${extension}`;
    const key = `${folder}/${fileName}`;

    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    };

    await r2Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = `${R2_PUBLIC_URL}/${key}`;
    logger.info(`File uploaded successfully: ${key}`);

    return {
      success: true,
      url: fileUrl,
      key,
      fileName,
      original_size: originalSize,
      compressed_size: compressedSize,
      saved_pct: savedPct,
      mime_type: mimeType,
      original_name: file.originalname,
    };
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

const uploadExplanationImage = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.EXPLANATION_IMAGES);
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
    let finalBuffer = buffer;
    let finalMimeType = mimeType;
    let finalFilename = filename;

    // Compress image buffers to WebP
    const fakeFile = { buffer, mimetype: mimeType, originalname: filename };
    const compressed = await compressImage(fakeFile, folder);

    if (compressed.extension === '.webp') {
      finalBuffer = compressed.buffer;
      finalMimeType = 'image/webp';
      // Replace extension in filename
      finalFilename = filename.replace(/\.[^.]+$/, '.webp');
    }

    const key = `${folder}/${finalFilename}`;
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: finalBuffer,
      ContentType: finalMimeType,
      CacheControl: 'public, max-age=31536000, immutable',
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
  uploadExplanationImage,
  uploadUserAvatar,
  uploadCategoryLogo,
  uploadSubcategoryLogo,
  extractKeyFromUrl,
  FOLDER_STRUCTURE
};
