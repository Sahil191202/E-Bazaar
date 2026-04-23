import { EmailService } from '../services/email.service.js';

// Convenience wrapper used across controllers
export const sendEmail = async ({ to, subject, html, text }) => {
  return EmailService.send({ to, subject, html, text });
};

export const sendOrderConfirmationEmail = async (user, order) => {
  if (!user?.email) return;
  return EmailService.sendOrderConfirmation(user, order);
};

export const sendWelcomeEmail = async (user) => {
  if (!user?.email) return;
  return EmailService.sendWelcome(user);
};