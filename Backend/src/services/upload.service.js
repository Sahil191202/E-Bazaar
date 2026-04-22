import { v2 as cloudinary } from 'cloudinary';
import { ApiError }          from '../utils/ApiError.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class UploadService {

  static async uploadImage(filePath, folder = 'products') {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      transformation: [
        { width: 1200, height: 1200, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' },
      ],
    });
    return { url: result.secure_url, publicId: result.public_id };
  }

  static async uploadMultiple(files, folder = 'products') {
    const uploads = await Promise.all(files.map((f) => this.uploadImage(f.path, folder)));
    return uploads;
  }

  static async deleteImage(publicId) {
    await cloudinary.uploader.destroy(publicId);
  }

  static async deleteMultiple(publicIds) {
    if (!publicIds.length) return;
    await cloudinary.api.delete_resources(publicIds);
  }
}