import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Memory storage, not disk storage: multer holds the uploaded file entirely
 * in a `Buffer` on `req.file.buffer` instead of writing it to a temp file on
 * disk for us. That buffer is exactly what we need in two places —
 * base64-encoding it for Gemini's multimodal input, and handing it to
 * upload.service.ts to persist wherever we ultimately want it (local disk
 * here; swap in an S3/Cloudinary upload there and nothing else in the app
 * changes). Memory storage is the right call for images this small
 * (MAX_UPLOAD_SIZE_MB below); for large files (video, multi-GB uploads)
 * you'd want disk or streaming storage instead so you don't hold gigabytes
 * in process memory per concurrent upload.
 */
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new AppError(`Unsupported image type: ${file.mimetype}. Use JPEG, PNG, or WEBP.`, 400));
      return;
    }
    callback(null, true);
  },
});
