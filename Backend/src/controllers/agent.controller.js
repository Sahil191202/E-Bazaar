import bcrypt           from 'bcryptjs';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { Delivery }      from '../models/Delivery.js';
import { Order }         from '../models/Order.js';
import { User }          from '../models/User.js';
import { DeliveryService } from '../services/delivery.service.js';
import { UploadService }   from '../services/upload.service.js';
import { NotificationService } from '../services/notification.service.js';
import { ApiResponse }   from '../utils/ApiResponse.js';
import { ApiError }      from '../utils/ApiError.js';
import { asyncHandler }  from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { getCache, setCache }  from '../config/redis.js';
import { uploadImages, uploadSingle } from '../middlewares/upload.middleware.js';

// ─────────────────────────────────────────────────────────────────────────────
//  ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

export const registerAgent = asyncHandler(async (req, res) => {
  const existing = await DeliveryAgent.findOne({ user: req.user._id });
  if (existing) throw new ApiError(409, 'Agent profile already exists');

  const { vehicleType, vehicleNumber, vehicleModel, vehicleColor, serviceZones } = req.body;

  const agent = await DeliveryAgent.create({
    user: req.user._id,
    vehicle: {
      type:   vehicleType,
      number: vehicleNumber.toUpperCase(),
      model:  vehicleModel,
      color:  vehicleColor,
    },
    serviceZones: serviceZones || [],
  });

  // Upgrade user role
  await User.findByIdAndUpdate(req.user._id, { role: 'agent' });

  res.status(201).json(new ApiResponse(201, { agent }, 'Agent registered. Please complete KYC.'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────────────────────────

export const getAgentProfile = asyncHandler(async (req, res) => {
  const agent = await DeliveryAgent.findOne({ user: req.user._id })
    .populate('user', 'name phone avatar')
    .populate('activeDelivery', 'orderId status deliveryAddress')
    .lean();

  if (!agent) throw new ApiError(404, 'Agent profile not found');
  res.json(new ApiResponse(200, { agent }));
});

export const updateAgentProfile = asyncHandler(async (req, res) => {
  const { vehicleNumber, vehicleModel, vehicleColor, serviceZones, bankDetails } = req.body;

  const agent = await DeliveryAgent.findOne({ user: req.user._id });
  if (!agent) throw new ApiError(404, 'Agent profile not found');

  if (vehicleNumber) agent.vehicle.number = vehicleNumber.toUpperCase();
  if (vehicleModel)  agent.vehicle.model  = vehicleModel;
  if (vehicleColor)  agent.vehicle.color  = vehicleColor;
  if (serviceZones)  agent.serviceZones   = serviceZones;
  if (bankDetails)   agent.bankDetails    = bankDetails;

  await agent.save();
  res.json(new ApiResponse(200, { agent }, 'Profile updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  KYC
// ─────────────────────────────────────────────────────────────────────────────

export const submitAgentKYC = asyncHandler(async (req, res) => {
  const agent = await DeliveryAgent.findOne({ user: req.user._id });
  if (!agent) throw new ApiError(404, 'Agent profile not found');
  if (agent.kycStatus === 'approved') throw new ApiError(400, 'KYC already approved');

  if (req.files?.length) {
    for (const file of req.files) {
      const docType  = file.fieldname;
      const uploaded = await UploadService.uploadImage(file.path, 'agents/kyc');
      agent.documents = agent.documents.filter((d) => d.type !== docType);
      agent.documents.push({
        type:    docType,
        url:     uploaded.url,
        publicId: uploaded.publicId,
        status:  'pending',
      });
    }
  }

  agent.kycStatus = 'pending';
  await agent.save();

  res.json(new ApiResponse(200, null, 'KYC submitted. Under review.'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  AVAILABILITY TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

export const toggleAvailability = asyncHandler(async (req, res) => {
  const agent = await DeliveryAgent.findOne({ user: req.user._id });
  if (!agent) throw new ApiError(404, 'Agent profile not found');

  if (agent.kycStatus !== 'approved') {
    throw new ApiError(403, 'KYC must be approved before going online');
  }

  // Can't go offline mid-delivery
  if (agent.isOnline && agent.activeDelivery) {
    throw new ApiError(400, 'Complete your active delivery before going offline');
  }

  agent.isOnline = !agent.isOnline;
  await agent.save();

  res.json(new ApiResponse(200, {
    isOnline: agent.isOnline,
  }, `You are now ${agent.isOnline ? 'Online' : 'Offline'}`));
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOCATION UPDATE (called frequently from mobile app — every 10-30 sec)
// ─────────────────────────────────────────────────────────────────────────────

export const updateLocation = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) throw new ApiError(400, 'lat and lng are required');
  if (lat < -90 || lat > 90)   throw new ApiError(400, 'Invalid latitude');
  if (lng < -180 || lng > 180) throw new ApiError(400, 'Invalid longitude');

  // Update in Redis (fast, frequent)
  await DeliveryService.updateAgentLocation(req.user._id, lat, lng);

  // If agent has active delivery, broadcast to customer via socket
  const agent = await DeliveryAgent.findOne({ user: req.user._id })
    .select('activeDelivery isOnline')
    .lean();

  if (agent?.activeDelivery) {
    const { getIO } = await import('../sockets/index.js');
    getIO()
      .to(`order:${agent.activeDelivery}`)
      .emit('agent:location', { lat, lng, timestamp: new Date() });
  }

  // Lightweight response — mobile calls this every few seconds
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET ACTIVE DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

export const getActiveDelivery = asyncHandler(async (req, res) => {
  const agent = await DeliveryAgent.findOne({ user: req.user._id })
    .select('activeDelivery')
    .lean();

  if (!agent?.activeDelivery) {
    return res.json(new ApiResponse(200, null, 'No active delivery'));
  }

  const delivery = await Delivery.findOne({
    order:  agent.activeDelivery,
    agent:  await DeliveryAgent.findOne({ user: req.user._id }).then((a) => a._id),
    status: { $nin: ['delivered', 'failed', 'cancelled'] },
  })
    .populate({
      path:   'order',
      select: 'orderId deliveryAddress items totalAmount isCOD customer',
      populate: { path: 'customer', select: 'name phone' },
    })
    .lean();

  if (!delivery) return res.json(new ApiResponse(200, null, 'No active delivery'));

  res.json(new ApiResponse(200, { delivery }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ACCEPT DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

export const acceptDelivery = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params;

  const agentDoc = await DeliveryAgent.findOne({ user: req.user._id });
  if (!agentDoc) throw new ApiError(404, 'Agent not found');

  const delivery = await Delivery.findById(deliveryId)
    .populate('order', 'orderId deliveryAddress items totalAmount isCOD customer');

  if (!delivery) throw new ApiError(404, 'Delivery not found');
  if (delivery.agent.toString() !== agentDoc._id.toString()) {
    throw new ApiError(403, 'This delivery is not assigned to you');
  }
  if (delivery.status !== 'assigned') {
    throw new ApiError(400, `Delivery is already ${delivery.status}`);
  }

  delivery.status     = 'accepted';
  delivery.acceptedAt = new Date();
  delivery.events.push({ event: 'accepted' });
  await delivery.save();

  // Remove auto-reject timeout from Redis
  const { getRedis } = await import('../config/redis.js');
  await getRedis().del(`delivery:timeout:${deliveryId}`);

  // Generate and send delivery OTP to customer
  const otp = await DeliveryService.generateDeliveryOTP(deliveryId, delivery.order._id);
  await NotificationService.sendToUser(delivery.order.customer, {
    type:    'delivery_otp',
    title:   'Your Delivery OTP',
    message: `Your delivery OTP is ${otp}. Share this with the delivery agent to confirm receipt.`,
    data:    { otp, orderId: delivery.order._id, deliveryId },
  });

  res.json(new ApiResponse(200, {
    delivery,
    vendorAddress: delivery.order.items[0]?.vendorAddress || null,
  }, 'Delivery accepted. OTP sent to customer.'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REJECT DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

export const rejectDelivery = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params;
  const { reason }     = req.body;

  const agentDoc = await DeliveryAgent.findOne({ user: req.user._id });
  const delivery = await Delivery.findById(deliveryId);

  if (!delivery || delivery.agent.toString() !== agentDoc._id.toString()) {
    throw new ApiError(404, 'Delivery not found');
  }
  if (delivery.status !== 'assigned') {
    throw new ApiError(400, 'Delivery cannot be rejected at this stage');
  }

  delivery.status       = 'cancelled';
  delivery.rejectedAt   = new Date();
  delivery.rejectReason = reason || 'Agent rejected';
  delivery.events.push({ event: 'rejected', note: reason });
  await delivery.save();

  // Free agent
  await DeliveryAgent.findByIdAndUpdate(agentDoc._id, { activeDelivery: null });

  // Try to auto-assign to next available agent
  const order = await Order.findById(delivery.order);
  try {
    const vendorLat = parseFloat(process.env.DEFAULT_VENDOR_LAT || '19.0760');
    const vendorLng = parseFloat(process.env.DEFAULT_VENDOR_LNG || '72.8777');
    await DeliveryService.autoAssign(delivery.order, vendorLat, vendorLng);
  } catch (e) {
    // No agents available — notify admin
    await NotificationService.notifyAdmins({
      type:    'no_agent_available',
      title:   'No Delivery Agent Available',
      message: `Order ${order?.orderId} could not be assigned. All agents rejected.`,
      data:    { orderId: delivery.order },
    });
  }

  res.json(new ApiResponse(200, null, 'Delivery rejected'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MARK PICKED UP (agent reached vendor and collected the order)
// ─────────────────────────────────────────────────────────────────────────────

export const markPickedUp = asyncHandler(async (req, res) => {
  const { deliveryId }    = req.params;
  const { lat, lng, note } = req.body;

  const { delivery, agentDoc } = await getAgentDelivery(deliveryId, req.user._id);

  if (delivery.status !== 'accepted') {
    throw new ApiError(400, 'Order must be accepted before marking pickup');
  }

  delivery.status      = 'picked_up';
  delivery.pickedUpAt  = new Date();
  delivery.pickupLocation = { lat, lng };
  delivery.events.push({ event: 'picked_up', location: { lat, lng }, note });
  await delivery.save();

  // Update order status
  await Order.findByIdAndUpdate(delivery.order, {
    status: 'out_for_delivery',
    $push:  {
      statusHistory: {
        status: 'out_for_delivery',
        note:   'Package picked up by delivery agent',
      },
    },
  });

  // Notify customer
  const order = await Order.findById(delivery.order).select('customer orderId');
  await NotificationService.sendToUser(order.customer, {
    type:    'order_update',
    title:   'Order Out for Delivery 🚴',
    message: `Your order ${order.orderId} has been picked up and is on its way!`,
    data:    { orderId: delivery.order, deliveryId },
  });

  res.json(new ApiResponse(200, { delivery }, 'Pickup confirmed'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  VERIFY OTP AND MARK DELIVERED
// ─────────────────────────────────────────────────────────────────────────────

export const verifyOTPAndDeliver = asyncHandler(async (req, res) => {
  const { deliveryId }    = req.params;
  const { otp, lat, lng } = req.body;

  const { delivery, agentDoc } = await getAgentDelivery(deliveryId, req.user._id);

  if (delivery.status !== 'picked_up') {
    throw new ApiError(400, 'Order must be picked up before delivery confirmation');
  }

  // Verify OTP
  await DeliveryService.verifyDeliveryOTP(deliveryId, otp);

  delivery.status           = 'delivered';
  delivery.deliveredAt      = new Date();
  delivery.deliveryLocation = { lat, lng };
  delivery.otpVerified      = true;
  delivery.otpVerifiedAt    = new Date();
  delivery.events.push({ event: 'otp_verified', location: { lat, lng } });
  delivery.events.push({ event: 'delivered',    location: { lat, lng } });
  await delivery.save();

  await finalizeDelivery(delivery, agentDoc);

  res.json(new ApiResponse(200, null, 'Delivery confirmed via OTP!'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  UPLOAD PROOF AND MARK DELIVERED (photo/signature)
// ─────────────────────────────────────────────────────────────────────────────

export const uploadProofAndDeliver = asyncHandler(async (req, res) => {
  const { deliveryId }    = req.params;
  const { lat, lng, otp } = req.body;

  const { delivery, agentDoc } = await getAgentDelivery(deliveryId, req.user._id);

  if (delivery.status !== 'picked_up') {
    throw new ApiError(400, 'Order must be picked up before delivery confirmation');
  }

  let proofImageUrl = null;
  let otpVerified   = false;

  // Upload proof photo if provided
  if (req.file) {
    const uploaded     = await UploadService.uploadImage(req.file.path, 'deliveries/proof');
    proofImageUrl      = uploaded.url;
    delivery.proofImageUrl    = uploaded.url;
    delivery.proofImagePublicId = uploaded.publicId;
  }

  // Also try OTP if provided alongside photo
  if (otp) {
    try {
      await DeliveryService.verifyDeliveryOTP(deliveryId, otp);
      otpVerified = true;
    } catch (e) {
      // OTP failed — photo proof takes over if image uploaded
      if (!proofImageUrl) throw e;
    }
  }

  if (!proofImageUrl && !otpVerified) {
    throw new ApiError(400, 'Either OTP or photo proof is required');
  }

  delivery.status           = 'delivered';
  delivery.deliveredAt      = new Date();
  delivery.deliveryLocation = { lat, lng };
  delivery.otpVerified      = otpVerified;
  delivery.proofType        = otpVerified && proofImageUrl ? 'otp_and_photo' : otpVerified ? 'otp' : 'photo';
  delivery.events.push({ event: 'delivered', location: { lat, lng } });
  await delivery.save();

  await finalizeDelivery(delivery, agentDoc);

  res.json(new ApiResponse(200, null, 'Delivery confirmed with proof!'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MARK FAILED ATTEMPT
// ─────────────────────────────────────────────────────────────────────────────

export const markFailedAttempt = asyncHandler(async (req, res) => {
  const { deliveryId }    = req.params;
  const { reason, lat, lng } = req.body;

  if (!reason) throw new ApiError(400, 'Reason for failed attempt is required');

  const { delivery, agentDoc } = await getAgentDelivery(deliveryId, req.user._id);

  delivery.failedAttempts++;
  delivery.lastFailReason = reason;
  delivery.events.push({ event: 'failed_attempt', location: { lat, lng }, note: reason });

  // After 3 failed attempts — mark as failed and return to vendor
  if (delivery.failedAttempts >= 3) {
    delivery.status = 'failed';
    delivery.events.push({ event: 'returned_to_vendor' });

    // Free agent
    await DeliveryAgent.findByIdAndUpdate(agentDoc._id, { activeDelivery: null });
    await DeliveryAgent.findByIdAndUpdate(agentDoc._id, {
      $inc: { totalFailedAttempts: 1 },
    });

    // Update order
    await Order.findByIdAndUpdate(delivery.order, {
      status: 'cancelled',
      $push:  { statusHistory: { status: 'cancelled', note: 'Max delivery attempts reached' } },
    });

    // Notify customer
    const order = await Order.findById(delivery.order).select('customer orderId');
    await NotificationService.sendToUser(order.customer, {
      type:    'delivery_failed',
      title:   'Delivery Failed',
      message: `We could not deliver your order ${order.orderId} after 3 attempts. A refund will be initiated.`,
      data:    { orderId: delivery.order },
    });
  } else {
    // Notify customer of failed attempt
    const order = await Order.findById(delivery.order).select('customer orderId deliveryAddress');
    await NotificationService.sendToUser(order.customer, {
      type:    'delivery_failed_attempt',
      title:   'Delivery Attempt Failed',
      message: `Attempt ${delivery.failedAttempts}/3 failed: ${reason}. We'll try again.`,
      data:    { orderId: delivery.order, deliveryId },
    });
  }

  await delivery.save();
  res.json(new ApiResponse(200, {
    failedAttempts: delivery.failedAttempts,
    maxAttempts:    3,
    isFinal:        delivery.failedAttempts >= 3,
  }, 'Failed attempt recorded'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  RESEND DELIVERY OTP (if customer didn't receive it)
// ─────────────────────────────────────────────────────────────────────────────

export const resendDeliveryOTP = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params;

  const { delivery } = await getAgentDelivery(deliveryId, req.user._id);

  if (!['accepted', 'picked_up'].includes(delivery.status)) {
    throw new ApiError(400, 'Cannot resend OTP at this stage');
  }

  const otp = await DeliveryService.generateDeliveryOTP(deliveryId, delivery.order);

  const order = await Order.findById(delivery.order).select('customer orderId');
  await NotificationService.sendToUser(order.customer, {
    type:    'delivery_otp',
    title:   'Your Delivery OTP (Resent)',
    message: `Your delivery OTP is ${otp}. Valid for 30 minutes.`,
    data:    { otp, orderId: delivery.order, deliveryId },
  });

  res.json(new ApiResponse(200, null, 'OTP resent to customer'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELIVERY HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export const getDeliveryHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, from, to }  = req.query;

  const agentDoc = await DeliveryAgent.findOne({ user: req.user._id }).select('_id');
  if (!agentDoc) throw new ApiError(404, 'Agent not found');

  const filter = { agent: agentDoc._id };
  if (status) filter.status = status;
  if (from || to) {
    filter.assignedAt = {};
    if (from) filter.assignedAt.$gte = new Date(from);
    if (to)   filter.assignedAt.$lte = new Date(to);
  }

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('order', 'orderId deliveryAddress totalAmount isCOD')
      .select('status assignedAt deliveredAt agentEarning failedAttempts proofType earningSettled')
      .lean(),
    Delivery.countDocuments(filter),
  ]);

  res.json(new ApiResponse(200, { deliveries }, 'Delivery history', paginationMeta(total, page, limit)));
});

// ─────────────────────────────────────────────────────────────────────────────
//  EARNINGS DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export const getEarningsDashboard = asyncHandler(async (req, res) => {
  const agentDoc = await DeliveryAgent.findOne({ user: req.user._id })
    .select('totalEarnings pendingPayout totalPaidOut totalDeliveries avgRating')
    .lean();

  if (!agentDoc) throw new ApiError(404, 'Agent not found');

  // Today's earnings
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const todayDeliveries = await Delivery.aggregate([
    {
      $match: {
        agent:       agentDoc._id,
        status:      'delivered',
        deliveredAt: { $gte: todayStart },
      },
    },
    {
      $group: {
        _id:      null,
        earning:  { $sum: '$agentEarning' },
        count:    { $sum: 1 },
      },
    },
  ]);

  // This week's earnings
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weekDeliveries = await Delivery.aggregate([
    {
      $match: {
        agent:       agentDoc._id,
        status:      'delivered',
        deliveredAt: { $gte: weekStart },
      },
    },
    {
      $group: {
        _id:     null,
        earning: { $sum: '$agentEarning' },
        count:   { $sum: 1 },
      },
    },
  ]);

  res.json(new ApiResponse(200, {
    summary: agentDoc,
    today: {
      earning:       todayDeliveries[0]?.earning || 0,
      deliveryCount: todayDeliveries[0]?.count   || 0,
    },
    thisWeek: {
      earning:       weekDeliveries[0]?.earning || 0,
      deliveryCount: weekDeliveries[0]?.count   || 0,
    },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  RATE AGENT (Customer rates agent after delivery)
// ─────────────────────────────────────────────────────────────────────────────

export const rateAgent = asyncHandler(async (req, res) => {
  const { deliveryId }       = req.params;
  const { rating, feedback } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, 'Rating must be between 1 and 5');
  }

  const delivery = await Delivery.findById(deliveryId)
    .populate('order', 'customer');

  if (!delivery) throw new ApiError(404, 'Delivery not found');
  if (delivery.order.customer.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You can only rate your own deliveries');
  }
  if (delivery.status !== 'delivered') throw new ApiError(400, 'Can only rate completed deliveries');
  if (delivery.customerRating) throw new ApiError(400, 'Already rated');

  delivery.customerRating  = rating;
  delivery.customerFeedback = feedback;
  delivery.ratedAt         = new Date();
  await delivery.save();

  // Update agent avg rating
  const agentDoc = await DeliveryAgent.findById(delivery.agent);
  const newTotal = agentDoc.totalRatings + 1;
  const newAvg   = parseFloat(
    ((agentDoc.avgRating * agentDoc.totalRatings + rating) / newTotal).toFixed(2)
  );
  agentDoc.avgRating    = newAvg;
  agentDoc.totalRatings = newTotal;
  await agentDoc.save();

  res.json(new ApiResponse(200, null, 'Agent rated. Thank you!'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET AGENT CONTACT INFO (for customer — masked phone)
// ─────────────────────────────────────────────────────────────────────────────

export const getAgentContact = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const delivery = await Delivery.findOne({
    order:  orderId,
    status: { $in: ['accepted', 'picked_up', 'in_transit'] },
  })
    .populate({
      path:   'agent',
      select: 'user vehicle agentCode',
      populate: { path: 'user', select: 'name phone avatar' },
    })
    .lean();

  if (!delivery) throw new ApiError(404, 'No active delivery for this order');

  // Validate it's the customer's order
  const order = await Order.findById(orderId).select('customer');
  if (order.customer.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Access denied');
  }

  // Mask phone: 98765XXXXX
  const phone  = delivery.agent.user.phone;
  const masked = phone ? `${phone.slice(0, 5)}XXXXX` : null;

  res.json(new ApiResponse(200, {
    agent: {
      name:      delivery.agent.user.name,
      avatar:    delivery.agent.user.avatar,
      agentCode: delivery.agent.agentCode,
      vehicle:   delivery.agent.vehicle,
      phone:     masked,
      avgRating: delivery.agent.avgRating,
    },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN: ASSIGN ORDER TO AGENT
// ─────────────────────────────────────────────────────────────────────────────

export const adminAssignAgent = asyncHandler(async (req, res) => {
  const { orderId, agentUserId } = req.body;

  const agentDoc = await DeliveryAgent.findOne({ user: agentUserId });
  if (!agentDoc) throw new ApiError(404, 'Agent not found');

  const delivery = await DeliveryService.assignToAgent(orderId, agentDoc._id);
  res.json(new ApiResponse(200, { delivery }, 'Agent assigned'));
});

export const adminGetAgents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { isOnline, kycStatus } = req.query;

  const filter = {};
  if (isOnline  !== undefined) filter.isOnline  = isOnline === 'true';
  if (kycStatus)               filter.kycStatus = kycStatus;

  const [agents, total] = await Promise.all([
    DeliveryAgent.find(filter)
      .populate('user', 'name phone email avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('agentCode kycStatus isOnline isActive totalDeliveries avgRating vehicle activeDelivery')
      .lean(),
    DeliveryAgent.countDocuments(filter),
  ]);

  // Enrich with live Redis location
  const enriched = await Promise.all(agents.map(async (a) => {
    const loc = await DeliveryService.getAgentLocation(a.user._id);
    return { ...a, liveLocation: loc };
  }));

  res.json(new ApiResponse(200, { agents: enriched }, 'Agents', paginationMeta(total, page, limit)));
});

export const adminReviewAgentKYC = asyncHandler(async (req, res) => {
  const { agentId }       = req.params;
  const { action, reason } = req.body;

  const agent = await DeliveryAgent.findById(agentId);
  if (!agent) throw new ApiError(404, 'Agent not found');

  if (action === 'approve') {
    agent.kycStatus = 'approved';
  } else if (action === 'reject') {
    if (!reason) throw new ApiError(400, 'Rejection reason required');
    agent.kycStatus           = 'rejected';
    agent.kycRejectionReason  = reason;
  }

  await agent.save();

  await NotificationService.sendToUser(agent.user, {
    type:    'kyc_update',
    title:   action === 'approve' ? 'KYC Approved! ✅' : 'KYC Rejected',
    message: action === 'approve'
      ? 'Your KYC is approved. Go online to start accepting deliveries.'
      : `KYC rejected: ${reason}. Please re-submit.`,
  });

  res.json(new ApiResponse(200, null, `Agent KYC ${action}d`));
});

// ─────────────────────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getAgentDelivery = async (deliveryId, userId) => {
  const agentDoc = await DeliveryAgent.findOne({ user: userId });
  if (!agentDoc) throw new ApiError(404, 'Agent not found');

  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new ApiError(404, 'Delivery not found');
  if (delivery.agent.toString() !== agentDoc._id.toString()) {
    throw new ApiError(403, 'This delivery is not assigned to you');
  }

  return { delivery, agentDoc };
};

const finalizeDelivery = async (delivery, agentDoc) => {
  // Free agent for next delivery
  await DeliveryAgent.findByIdAndUpdate(agentDoc._id, {
    activeDelivery: null,
    $inc: {
      totalDeliveries: 1,
      totalEarnings:   delivery.agentEarning,
      pendingPayout:   delivery.agentEarning,
    },
  });

  // Mark order as delivered
  const now = new Date();
  await Order.findByIdAndUpdate(delivery.order, {
    status:      'delivered',
    deliveredAt: now,
    $set:        { 'items.$[].status': 'delivered', 'items.$[].deliveredAt': now },
    $push: {
      statusHistory: {
        status: 'delivered',
        note:   `Delivered. Proof: ${delivery.proofType}`,
      },
    },
  });

  // Notify customer
  const order = await Order.findById(delivery.order).select('customer orderId');
  await NotificationService.sendToUser(order.customer, {
    type:    'order_delivered',
    title:   'Order Delivered! 🎉',
    message: `Your order ${order.orderId} has been delivered. Enjoy!`,
    data:    { orderId: delivery.order, deliveryId: delivery._id },
  });
};