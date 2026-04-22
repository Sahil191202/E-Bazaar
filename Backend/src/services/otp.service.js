import { getRedis } from '../config/redis.js';
import { generateOTP } from '../utils/generateToken.js';
import logger from '../utils/logger.js';

const OTP_TTL     = 5 * 60;       // 5 minutes
const MAX_ATTEMPTS = 5;

export class OtpService {
  static otpKey     = (phone) => `otp:${phone}`;
  static attemptsKey = (phone) => `otp_attempts:${phone}`;

  static async sendOTP(phone) {
    const redis = getRedis();
    const otp   = generateOTP(6);

    // Store OTP in Redis with TTL
    await redis.setEx(this.otpKey(phone), OTP_TTL, otp);

    // In production: send via SMS (Twilio / MSG91)
    // await SmsService.send(phone, `Your OTP is ${otp}. Valid for 5 minutes.`);
    logger.info(`OTP for ${phone}: ${otp}`); // Remove in production!

    return { success: true, message: 'OTP sent successfully' };
  }

  static async verifyOTP(phone, inputOtp) {
    const redis    = getRedis();
    const attempts = parseInt(await redis.get(this.attemptsKey(phone))) || 0;

    if (attempts >= MAX_ATTEMPTS) {
      throw new Error('Too many failed attempts. Please request a new OTP.');
    }

    const storedOtp = await redis.get(this.otpKey(phone));

    if (!storedOtp) {
      throw new Error('OTP expired or not found. Please request a new OTP.');
    }

    if (storedOtp !== inputOtp) {
      await redis.setEx(this.attemptsKey(phone), OTP_TTL, attempts + 1);
      throw new Error(`Invalid OTP. ${MAX_ATTEMPTS - attempts - 1} attempts remaining.`);
    }

    // Clear on success
    await redis.del(this.otpKey(phone));
    await redis.del(this.attemptsKey(phone));
    return true;
  }
}