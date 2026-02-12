const multer = require('multer');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/r2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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
    const fileExtension = path.extname(file.originalname);
    const fileName = `${folder}/${uuidv4()}${fileExtension}`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await r2Client.send(command);
    
    const fileUrl = `${R2_PUBLIC_URL}/${fileName}`;
    
    return {
      success: true,
      url: fileUrl,
      key: fileName
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
