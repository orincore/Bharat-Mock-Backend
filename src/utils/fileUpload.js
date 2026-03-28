const multer = require('multer');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/r2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (_e) {
  sharp = null;
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/bmp', 'image/tiff',
]);

// Per-folder max dimensions
const RESIZE_CONFIG = {
  'homepage':              { width: 1920, height: 1080, quality: 82 },
  'page-banners':          { width: 1920, height: 600,  quality: 82 },
  'banners':               { width: 1920, height: 600,  quality: 82 },
  'exams/logos':           { width: 400,  height: 400,  quality: 85 },
  'exams/thumbnails':      { width: 800,  height: 600,  quality: 82 },
  'categories/logos':      { width: 300,  height: 300,  quality: 85 },
  'subcategories/logos':   { width: 300,  height: 300,  quality: 85 },
  'users/avatars':         { width: 256,  height: 256,  quality: 85 },
  'questions/images':      { width: 1200, height: 900,  quality: 85 },
  'options/images':        { width: 600,  height: 400,  quality: 85 },
  'test-series/logos':     { width: 400,  height: 400,  quality: 85 },
  'test-series/thumbnails':{ width: 800,  height: 600,  quality: 82 },
  'blog':                  { width: 1200, height: 800,  quality: 82 },
  'subscription-page':     { width: 1200, height: 800,  quality: 82 },
};

const DEFAULT_RESIZE = { width: 1920, height: 1080, quality: 82 };

/**
 * Convert any image to WebP and resize to sensible dimensions.
 * Returns { buffer, mimeType, extension }.
 * Passes through non-images (PDFs, videos, GIFs) unchanged.
 */
const toWebP = async (file, folder = 'uploads') => {
  const originalExt = path.extname(file.originalname || '').toLowerCase();

  // Skip non-images and GIFs
  if (!IMAGE_MIME_TYPES.has(file.mimetype) || file.mimetype === 'image/gif') {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }

  // Already tiny WebP — skip processing
  if (file.mimetype === 'image/webp' && file.buffer.length < 50 * 1024) {
    return { buffer: file.buffer, mimeType: 'image/webp', extension: '.webp' };
  }

  if (!sharp) {
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }

  // Match folder prefix to config
  const config = Object.keys(RESIZE_CONFIG).find(k => folder.startsWith(k))
    ? RESIZE_CONFIG[Object.keys(RESIZE_CONFIG).find(k => folder.startsWith(k))]
    : DEFAULT_RESIZE;

  try {
    const webpBuffer = await sharp(file.buffer)
      .resize(config.width, config.height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: config.quality, effort: 4, smartSubsample: true })
      .toBuffer();

    const savedPct = (((file.buffer.length - webpBuffer.length) / file.buffer.length) * 100).toFixed(0);
    console.info(`[upload] WebP: ${file.originalname} ${(file.buffer.length / 1024).toFixed(0)}KB → ${(webpBuffer.length / 1024).toFixed(0)}KB (${savedPct}% saved)`);

    return { buffer: webpBuffer, mimeType: 'image/webp', extension: '.webp' };
  } catch (err) {
    console.warn(`[upload] WebP conversion failed for ${file.originalname}, using original:`, err.message);
    return { buffer: file.buffer, mimeType: file.mimetype, extension: originalExt };
  }
};

const storage = multer.memoryStorage();

let warnedAboutAllowedTypes = false;

const DEFAULT_ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime'
];

const sanitizeAllowedTypes = (raw) =>
  raw
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);

const getAllowedFileTypes = () => {
  const envValue = process.env.ALLOWED_FILE_TYPES;
  if (!envValue) {
    if (!warnedAboutAllowedTypes) {
      console.warn('ALLOWED_FILE_TYPES env var missing. Falling back to default media types.');
      warnedAboutAllowedTypes = true;
    }
    process.env.ALLOWED_FILE_TYPES = DEFAULT_ALLOWED_FILE_TYPES.join(',');
    return DEFAULT_ALLOWED_FILE_TYPES;
  }

  const parsed = sanitizeAllowedTypes(envValue);
  if (!parsed.length) {
    console.warn('ALLOWED_FILE_TYPES env var was empty after parsing. Using defaults.');
    process.env.ALLOWED_FILE_TYPES = DEFAULT_ALLOWED_FILE_TYPES.join(',');
    return DEFAULT_ALLOWED_FILE_TYPES;
  }
  return parsed;
};

const fileFilter = (req, file, cb) => {
  const allowedTypes = getAllowedFileTypes();

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, videos, and PDFs are allowed.'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 150 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  },
  fileFilter
});

const uploadToR2 = async (file, folder = 'uploads') => {
  try {
    const originalSize = file.buffer.length;
    const { buffer, mimeType, extension } = await toWebP(file, folder);
    const compressedSize = buffer.length;
    const savedPct = originalSize > 0
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

    const fileName = `${folder}/${uuidv4()}${extension}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    await r2Client.send(command);

    const fileUrl = `${R2_PUBLIC_URL}/${fileName}`;

    return {
      success: true,
      url: fileUrl,
      key: fileName,
      original_size: originalSize,
      compressed_size: compressedSize,
      saved_pct: savedPct,
      mime_type: mimeType,
      original_name: file.originalname,
    };
  } catch (error) {
    throw new Error(`File upload failed: ${error.message}`);
  }
};

const deleteFromR2 = async (fileKey) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileKey,
    });

    await r2Client.send(command);
    
    return { success: true };
  } catch (error) {
    throw new Error(`File deletion failed: ${error.message}`);
  }
};

const getPresignedUrl = async (fileKey, expiresIn = 3600) => {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileKey,
    });

    const url = await getSignedUrl(r2Client, command, { expiresIn });
    
    return url;
  } catch (error) {
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
};

module.exports = {
  upload,
  uploadToR2,
  deleteFromR2,
  getPresignedUrl
};
