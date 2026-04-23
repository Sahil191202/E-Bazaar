import Razorpay from 'razorpay';
import crypto   from 'crypto';
import { ApiError } from '../utils/ApiError.js';

let razorpay;
const getRazorpay = () => {
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
};

export class PaymentService {

  // ─── Create Razorpay order (before payment) ─────────────────────────────
  static async createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    // Amount must be in paise (multiply by 100)
    const order = await razorpay.orders.create({
      amount:   Math.round(amount * 100),
      currency,
      receipt,
      notes,
      payment_capture: 1, // Auto-capture on success
    });
    return order;
  }

  // ─── Verify payment signature (CRITICAL security step) ──────────────────
  static verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const body      = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpaySignature) {
      throw new ApiError(400, 'Payment signature verification failed');
    }
    return true;
  }

  // ─── Fetch payment details from Razorpay ────────────────────────────────
  static async fetchPayment(razorpayPaymentId) {
    return razorpay.payments.fetch(razorpayPaymentId);
  }

  // ─── Initiate refund ────────────────────────────────────────────────────
  static async initiateRefund({ razorpayPaymentId, amount, notes = {} }) {
    const refund = await razorpay.payments.refund(razorpayPaymentId, {
      amount: Math.round(amount * 100), // paise
      notes,
    });
    return refund;
  }

  // ─── Verify webhook signature ────────────────────────────────────────────
  static verifyWebhookSignature(body, signature) {
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');

    if (expected !== signature) {
      throw new ApiError(400, 'Invalid webhook signature');
    }
    return true;
  }

  // ─── Calculate commission ────────────────────────────────────────────────
  static calculateCommission(itemTotal, commissionRate) {
    const platformEarning = parseFloat(((itemTotal * commissionRate) / 100).toFixed(2));
    const vendorEarning   = parseFloat((itemTotal - platformEarning).toFixed(2));
    return { platformEarning, vendorEarning };
  }
}