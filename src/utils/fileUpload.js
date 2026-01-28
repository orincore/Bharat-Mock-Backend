const multer = require('multer');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/r2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const storage = multer.memoryStorage();

let warnedAboutAllowedTypes = false;

const getAllowedFileTypes = () => {
  const envValue = process.env.ALLOWED_FILE_TYPES;
  if (!envValue) {
    if (!warnedAboutAllowedTypes) {
      console.warn('ALLOWED_FILE_TYPES env var missing. Falling back to default image/pdf types.');
      warnedAboutAllowedTypes = true;
    }
    return ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  }
  return envValue.split(',');
};

const fileFilter = (req, file, cb) => {
  const allowedTypes = getAllowedFileTypes();

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and PDFs are allowed.'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880
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
