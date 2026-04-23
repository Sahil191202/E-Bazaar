import { Review }   from '../models/Review.js';
import { Product }  from '../models/Product.js';
import { Order }    from '../models/Order.js';
import { UploadService } from '../services/upload.service.js';
import { ApiResponse }   from '../utils/ApiResponse.js';
import { ApiError }      from '../utils/ApiError.js';
import { asyncHandler }  from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';

// Customer: create review
export const createReview = asyncHandler(async (req, res) => {
  const { productId, orderId, rating, title, body } = req.body;

  // Verify purchase
  const order = await Order.findOne({
    _id:      orderId,
    customer: req.user._id,
    status:   'delivered',
    'items.product': productId,
  });
  if (!order) throw new ApiError(400, 'You can only review products from delivered orders');

  // One review per product per order
  const existing = await Review.findOne({ product: productId, customer: req.user._id, order: orderId });
  if (existing) throw new ApiError(409, 'You have already reviewed this product for this order');

  const vendorId = order.items.find(
    (i) => i.product.toString() === productId
  )?.vendor;

  // Upload review images
  let images = [];
  if (req.files?.length) {
    const uploaded = await UploadService.uploadMultiple(req.files, 'reviews');
    images = uploaded.map((u) => ({ url: u.url, publicId: u.publicId }));
  }

  const review = await Review.create({
    product:  productId,
    customer: req.user._id,
    order:    orderId,
    vendor:   vendorId,
    rating, title, body, images,
    isVerifiedPurchase: true,
  });

  // Update product rating summary
  const product = await Product.findById(productId);
  await product.updateRatingSummary(rating);
  await product.save();

  res.status(201).json(new ApiResponse(201, { review }, 'Review submitted'));
});

// Public: get reviews for a product
export const getProductReviews = asyncHandler(async (req, res) => {
  const { productId }            = req.params;
  const { rating, sort = 'newest' } = req.query;
  const { page, limit, skip }    = getPagination(req.query);

  const filter = { product: productId, isApproved: true };
  if (rating) filter.rating = Number(rating);

  const sortMap = {
    newest:  { createdAt: -1 },
    oldest:  { createdAt:  1 },
    highest: { rating: -1 },
    lowest:  { rating:  1 },
    helpful: { helpfulCount: -1 },
  };

  const [reviews, total, ratingStats] = await Promise.all([
    Review.find(filter)
      .sort(sortMap[sort] || sortMap.newest)
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name avatar')
      .lean(),
    Review.countDocuments(filter),
    Review.aggregate([
      { $match: { product: new (await import('mongoose')).default.Types.ObjectId(productId), isApproved: true } },
      {
        $group: {
          _id:     '$rating',
          count:   { $sum: 1 },
        },
      },
    ]),
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratingStats.forEach((r) => { distribution[r._id] = r.count; });

  res.json(new ApiResponse(200, { reviews, distribution }, 'Reviews', paginationMeta(total, page, limit)));
});

// Customer: get my reviews
export const getMyReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [reviews, total] = await Promise.all([
    Review.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('product', 'name images slug')
      .lean(),
    Review.countDocuments({ customer: req.user._id }),
  ]);

  res.json(new ApiResponse(200, { reviews }, 'My reviews', paginationMeta(total, page, limit)));
});

// Customer: mark review as helpful
export const markHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, 'Review not found');

  const alreadyVoted = review.helpfulVotes.includes(req.user._id);
  if (alreadyVoted) {
    review.helpfulVotes.pull(req.user._id);
    review.helpfulCount = Math.max(0, review.helpfulCount - 1);
  } else {
    review.helpfulVotes.push(req.user._id);
    review.helpfulCount += 1;
  }

  await review.save();
  res.json(new ApiResponse(200, { helpful: !alreadyVoted, count: review.helpfulCount }));
});

// Vendor: reply to review
export const vendorReplyToReview = asyncHandler(async (req, res) => {
  const { reply } = req.body;
  if (!reply) throw new ApiError(400, 'Reply text is required');

  const review = await Review.findOne({ _id: req.params.id, vendor: req.user._id });
  if (!review) throw new ApiError(404, 'Review not found');
  if (review.vendorReply) throw new ApiError(400, 'Already replied to this review');

  review.vendorReply    = reply;
  review.vendorRepliedAt = new Date();
  await review.save();

  res.json(new ApiResponse(200, null, 'Reply added'));
});

// Admin: flag/unflag review
export const adminFlagReview = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { isFlagged: true, flagReason: reason, isApproved: false },
    { new: true }
  );
  if (!review) throw new ApiError(404, 'Review not found');
  res.json(new ApiResponse(200, null, 'Review flagged'));
});