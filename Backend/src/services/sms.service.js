import logger from '../utils/logger.js';

// Placeholder SMS service
// Firebase handles OTP SMS — this is for custom non-OTP SMS
// (order updates, delivery alerts for users without the app)

export class SmsService {

  static async send(phone, message) {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[SMS DEV] To: ${phone} | Message: ${message}`);
      return { success: true, dev: true };
    }

    // Integrate with MSG91, Twilio, or AWS SNS here
    // Example MSG91:
    // const response = await fetch('https://api.msg91.com/api/v5/flow/', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', authkey: process.env.MSG91_AUTH_KEY },
    //   body: JSON.stringify({ template_id: process.env.MSG91_TEMPLATE_ID, mobiles: phone, message }),
    // });
    // return response.json();

    logger.warn('SMS service not configured. Set up MSG91 or Twilio in sms.service.js');
    return { success: false, reason: 'not_configured' };
  }

  static async sendOrderUpdate(phone, orderId, status) {
    const messages = {
      confirmed:        `Your order ${orderId} is confirmed! Expected delivery in 5 days.`,
      shipped:          `Your order ${orderId} has been shipped.`,
      out_for_delivery: `Your order ${orderId} is out for delivery today!`,
      delivered:        `Your order ${orderId} has been delivered. Thank you!`,
      cancelled:        `Your order ${orderId} has been cancelled.`,
    };
    const message = messages[status];
    if (message) await this.send(phone, message);
  }
}