import multer from 'multer';
import path   from 'path';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE      = 5 * 1024 * 1024; // 5MB per image

const storage = multer.diskStorage({
  destination: '/tmp/uploads',
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`));
  }
};

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 10 },
}).array('images', 10);

export const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 1 },
}).single('image');

// For CSV/Excel bulk upload
export const uploadFile = multer({
  storage: multer.diskStorage({ destination: '/tmp/uploads', filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`) }),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new ApiError(400, 'Only CSV or Excel files allowed'));
  },
}).single('file');