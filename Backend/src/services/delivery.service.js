import bcrypt          from 'bcryptjs';
import { Delivery }    from '../models/Delivery.js';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { Order }       from '../models/Order.js';
import { ApiError }    from '../utils/ApiError.js';
import { getRedis, setCache, getCache, delCache } from '../config/redis.js';
import { generateOTP } from '../utils/generateToken.js';
import { NotificationService } from './notification.service.js';

// Per-delivery earning rate
const DELIVERY_BASE_EARNING    = parseFloat(process.env.DELIVERY_BASE_EARNING    || '40');  // ₹40 base
const DELIVERY_PER_KM_EARNING  = parseFloat(process.env.DELIVERY_PER_KM_EARNING  || '5');   // ₹5/km

export class DeliveryService {

  // ─── Calculate agent earning for a delivery ─────────────────────────────
  static calculateEarning(distanceKm = 0) {
    const earning = DELIVERY_BASE_EARNING + (distanceKm * DELIVERY_PER_KM_EARNING);
    return parseFloat(earning.toFixed(2));
  }

  // ─── Find nearest available agent ───────────────────────────────────────
  static async findNearestAgent(vendorLat, vendorLng, radiusKm = 10) {
    const radiusMeters = radiusKm * 1000;

    const agents = await DeliveryAgent.aggregate([
      {
        $geoNear: {
          near:          { type: 'Point', coordinates: [vendorLng, vendorLat] },
          distanceField: 'distance',
          maxDistance:   radiusMeters,
          query: {
            isOnline:      true,
            isActive:      true,
            kycStatus:     'approved',
            activeDelivery: null, // Not already on a delivery
          },
          spherical: true,
        },
      },
      { $limit: 5 },
      {
        $lookup: {
          from:         'users',
          localField:   'user',
          foreignField: '_id',
          as:           'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          agentCode:    1,
          distance:     1,
          avgRating:    1,
          totalDeliveries: 1,
          user: { _id: 1, name: 1, phone: 1, avatar: 1 },
        },
      },
    ]);

    return agents;
  }

  // ─── Auto-assign order to nearest agent ─────────────────────────────────
  static async autoAssign(orderId, vendorLat, vendorLng) {
    const agents = await this.findNearestAgent(vendorLat, vendorLng);
    if (!agents.length) throw new ApiError(404, 'No available agents nearby');

    const agent = agents[0]; // Pick nearest
    return this.assignToAgent(orderId, agent._id);
  }

  // ─── Assign order to specific agent ─────────────────────────────────────
  static async assignToAgent(orderId, agentId) {
    const order = await Order.findById(orderId);
    if (!order) throw new ApiError(404, 'Order not found');

    const agent = await DeliveryAgent.findById(agentId);
    if (!agent) throw new ApiError(404, 'Agent not found');
    if (!agent.isOnline || agent.activeDelivery) {
      throw new ApiError(400, 'Agent is unavailable');
    }

    // Get vendor from first item
    const vendorId = order.items[0]?.vendor;

    // Calculate earning (simplified — use actual distance in production)
    const earning = this.calculateEarning(0);

    // Create delivery record
    const delivery = await Delivery.create({
      order:       orderId,
      agent:       agentId,
      vendor:      vendorId,
      agentEarning: earning,
      events:      [{ event: 'assigned' }],
    });

    // Lock agent to this delivery
    await DeliveryAgent.findByIdAndUpdate(agentId, {
      activeDelivery: orderId,
    });

    // Update order
    order.items.forEach((i) => { i.deliveryAgent = agent.user; });
    order.statusHistory.push({ status: 'out_for_delivery', note: `Assigned to agent ${agent.agentCode}` });
    await order.save();

    // Notify agent
    await NotificationService.sendToUser(agent.user, {
      type:    'new_delivery',
      title:   'New Delivery Assignment!',
      message: `Order ${order.orderId} has been assigned to you. Please accept or reject within 2 minutes.`,
      data:    { orderId, deliveryId: delivery._id },
    });

    // Auto-reject timeout (2 min) — store in Redis
    const redis = getRedis();
    await redis.setEx(`delivery:timeout:${delivery._id}`, 120, orderId.toString());

    return delivery;
  }

  // ─── Generate delivery OTP ────────────────────────────────────────────────
  static async generateDeliveryOTP(deliveryId, orderId) {
    const otp    = generateOTP(4); // 4-digit OTP for delivery
    const hashed = await bcrypt.hash(otp, 10);

    // Store hashed OTP in Redis (30 min TTL)
    await setCache(`delivery:otp:${deliveryId}`, hashed, 30 * 60);

    return otp; // Return plain OTP to send to customer
  }

  // ─── Verify delivery OTP ──────────────────────────────────────────────────
  static async verifyDeliveryOTP(deliveryId, inputOtp) {
    const hashed = await getCache(`delivery:otp:${deliveryId}`);
    if (!hashed) throw new ApiError(400, 'OTP expired. Request a new one.');

    const isValid = await bcrypt.compare(inputOtp, hashed);
    if (!isValid) throw new ApiError(400, 'Invalid OTP');

    await delCache(`delivery:otp:${deliveryId}`);
    return true;
  }

  // ─── Update agent location in Redis (high-frequency) ─────────────────────
  static async updateAgentLocation(agentUserId, lat, lng) {
    const redis = getRedis();

    // Store in Redis sorted set for proximity queries (fast)
    await redis.geoAdd('agents:locations', {
      longitude: lng,
      latitude:  lat,
      member:    agentUserId.toString(),
    });

    // Also store as simple key for direct fetch
    await redis.setEx(
      `agent:location:${agentUserId}`,
      300, // 5 min TTL — goes offline if no update
      JSON.stringify({ lat, lng, updatedAt: new Date() })
    );
  }

  // ─── Get agent location from Redis ────────────────────────────────────────
  static async getAgentLocation(agentUserId) {
    const data = await getCache(`agent:location:${agentUserId}`);
    return data;
  }

  // ─── Persist location to MongoDB (every 5 min — called by background job) ─
  static async persistAgentLocation(agentUserId) {
    const location = await this.getAgentLocation(agentUserId);
    if (!location) return;

    await DeliveryAgent.findOneAndUpdate(
      { user: agentUserId },
      {
        lastLocation:   { type: 'Point', coordinates: [location.lng, location.lat] },
        lastLocationAt: location.updatedAt,
      }
    );
  }
}