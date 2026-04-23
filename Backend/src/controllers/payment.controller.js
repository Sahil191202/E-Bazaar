import { Payment }    from '../models/Payment.js';
import { Order }      from '../models/Order.js';
import { Transaction } from '../models/Transaction.js';
import { User }       from '../models/User.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }   from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';

// Customer: payment history
export const getMyPayments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [payments, total] = await Promise.all([
    Payment.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('order', 'orderId status totalAmount')
      .lean(),
    Payment.countDocuments({ customer: req.user._id }),
  ]);

  res.json(new ApiResponse(200, { payments }, 'Payments', paginationMeta(total, page, limit)));
});

// Customer: wallet balance + transaction history
export const getWallet = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [user, transactions, total] = await Promise.all([
    User.findById(req.user._id).select('walletBalance').lean(),
    Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments({ user: req.user._id }),
  ]);

  res.json(new ApiResponse(200, {
    walletBalance: user.walletBalance,
    transactions,
  }, 'Wallet', paginationMeta(total, page, limit)));
});

// Internal helper — create a transaction record
export const createTransaction = async ({
  userId, orderId, type, category,
  amount, description, referenceId, referenceType,
}) => {
  const user = await User.findById(userId).select('walletBalance');
  if (!user) throw new ApiError(404, 'User not found');

  const balanceBefore = user.walletBalance;
  const balanceAfter  = type === 'credit'
    ? balanceBefore + amount
    : balanceBefore - amount;

  if (balanceAfter < 0) throw new ApiError(400, 'Insufficient wallet balance');

  await User.findByIdAndUpdate(userId, { walletBalance: balanceAfter });

  return Transaction.create({
    user:          userId,
    order:         orderId,
    type, category, amount,
    balanceBefore,
    balanceAfter,
    description,
    referenceId,
    referenceType,
    status: 'completed',
  });
};

// Admin: all payments
export const adminGetPayments = asyncHandler(async (req, res) => {
  const { method, status, from, to } = req.query;
  const { page, limit, skip }        = getPagination(req.query);

  const filter = {};
  if (method) filter.method = method;
  if (status) filter.status = status;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to);
  }

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone email')
      .populate('order',    'orderId')
      .lean(),
    Payment.countDocuments(filter),
  ]);

  res.json(new ApiResponse(200, { payments }, 'All payments', paginationMeta(total, page, limit)));
});