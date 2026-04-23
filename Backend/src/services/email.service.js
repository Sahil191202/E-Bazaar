import nodemailer from 'nodemailer';
import logger     from '../utils/logger.js';

let transporter;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool:            true,
    maxConnections:  5,
    maxMessages:     100,
  });

  return transporter;
};

export class EmailService {

  static async send({ to, subject, html, text }) {
    try {
      const info = await getTransporter().sendMail({
        from:    `"${process.env.APP_NAME || 'eCommerce'}" <${process.env.SMTP_USER}>`,
        to, subject, html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });
      logger.info(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (err) {
      logger.error(`Email failed to ${to}:`, err.message);
      throw err;
    }
  }

  static async sendOrderConfirmation(user, order) {
    const itemsHtml = order.items
      .map((i) => `<tr><td>${i.name}</td><td>${i.quantity}</td><td>₹${i.price}</td></tr>`)
      .join('');

    await this.send({
      to:      user.email,
      subject: `Order Confirmed — ${order.orderId}`,
      html: `
        <h2>Hi ${user.name}, your order is confirmed! 🎉</h2>
        <p>Order ID: <strong>${order.orderId}</strong></p>
        <table border="1" cellpadding="8">
          <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
          ${itemsHtml}
        </table>
        <p>Total: <strong>₹${order.totalAmount}</strong></p>
        <p>Estimated delivery: ${new Date(order.estimatedDelivery).toDateString()}</p>
      `,
    });
  }

  static async sendWelcome(user) {
    await this.send({
      to:      user.email,
      subject: 'Welcome to eCommerce! 🎉',
      html:    `<h2>Hi ${user.name}!</h2><p>Welcome to our platform. Happy shopping!</p>`,
    });
  }

  static async sendPasswordReset(user, resetLink) {
    await this.send({
      to:      user.email,
      subject: 'Reset your password',
      html: `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password. Valid for 1 hour.</p>
        <a href="${resetLink}">Reset Password</a>
        <p>If you didn't request this, ignore this email.</p>
      `,
    });
  }
}