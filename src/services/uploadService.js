const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } = require('../config/r2');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const logger = require('../config/logger');

const FOLDER_STRUCTURE = {
  EXAM_LOGOS: 'exams/logos',
  EXAM_THUMBNAILS: 'exams/thumbnails',
  QUESTION_IMAGES: 'questions/images',
  OPTION_IMAGES: 'options/images',
  USER_AVATARS: 'users/avatars',
  CATEGORY_LOGOS: 'categories/logos',
  SUBCATEGORY_LOGOS: 'subcategories/logos'
};

const uploadFile = async (file, folder, customFileName = null) => {
  try {
    const fileExtension = path.extname(file.originalname);
    const fileName = customFileName || `${uuidv4()}${fileExtension}`;
    const key = `${folder}/${fileName}`;

    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await r2Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = `${R2_PUBLIC_URL}/${key}`;
    
    logger.info(`File uploaded successfully: ${key}`);
    
    return {
      success: true,
      url: fileUrl,
      key: key,
      fileName: fileName
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

const uploadUserAvatar = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.USER_AVATARS);
};

const uploadCategoryLogo = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.CATEGORY_LOGOS);
};

const uploadSubcategoryLogo = async (file) => {
  return uploadFile(file, FOLDER_STRUCTURE.SUBCATEGORY_LOGOS);
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
  uploadQuestionImage,
  uploadOptionImage,
  uploadUserAvatar,
  uploadCategoryLogo,
  uploadSubcategoryLogo,
  extractKeyFromUrl,
  FOLDER_STRUCTURE
};
