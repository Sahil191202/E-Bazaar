import Razorpay from "razorpay";
import crypto   from "crypto";
import { ApiError } from "../utils/ApiError.js";

let razorpayInstance = null;

const getRazorpay = () => {
  if (razorpayInstance) return razorpayInstance;
  const key_id     = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("Razorpay credentials missing in environment variables");
  }
  razorpayInstance = new Razorpay({ key_id, key_secret });
  return razorpayInstance;
};

export class PaymentService {

  static async createRazorpayOrder({ amount, currency = "INR", receipt, notes = {} }) {
    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount:          Math.round(amount * 100),
      currency,
      receipt,
      notes,
      payment_capture: 1,
    });
    return order;
  }

  static verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const body     = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");
    if (expected !== razorpaySignature) {
      throw new ApiError(400, "Payment signature verification failed");
    }
    return true;
  }

  static async fetchPayment(razorpayPaymentId) {
    const razorpay = getRazorpay();  // ← fixed
    return razorpay.payments.fetch(razorpayPaymentId);
  }

  static async initiateRefund({ razorpayPaymentId, amount, notes = {} }) {
    const razorpay = getRazorpay();  // ← fixed
    const refund = await razorpay.payments.refund(razorpayPaymentId, {
      amount: Math.round(amount * 100),
      notes,
    });
    return refund;
  }

  static verifyWebhookSignature(body, signature) {
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest("hex");
    if (expected !== signature) {
      throw new ApiError(400, "Invalid webhook signature");
    }
    return true;
  }

  static calculateCommission(itemTotal, commissionRate) {
    const platformEarning = parseFloat(((itemTotal * commissionRate) / 100).toFixed(2));
    const vendorEarning   = parseFloat((itemTotal - platformEarning).toFixed(2));
    return { platformEarning, vendorEarning };
  }
}