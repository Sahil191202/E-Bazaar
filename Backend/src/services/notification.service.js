import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import logger from "../utils/logger.js";
import { FCMService } from "./fcm.service.js";
import { isUserOnline } from '../utils/onlineStatus.js';

export class NotificationService {
  // ─── Send to a specific user ──────────────────────────────────────────────
  static async sendToUser(userId, { type, title, message, data = {} }) {
    try {
      // 1. Persist to DB
      const notif = await Notification.create({
        user: userId,
        type,
        title,
        message,
        data,
      });

      // 2. Try socket (if user is online)
      const online = await isUserOnline(userId);
      if (online) {
        try {
          const { getIO } = await import("../sockets/index.js");
          getIO().to(`user:${userId}`).emit("notification", {
            _id: notif._id,
            type,
            title,
            message,
            data,
            createdAt: notif.createdAt,
          });
        } catch (e) {
          /* non-critical */
        }
      } else {
        // 3. User is offline — send FCM push
        await FCMService.sendToUser(userId, {
          title,
          body: message,
          data: { type, notificationId: notif._id.toString(), ...data },
        });
      }

      return notif;
    } catch (err) {
      logger.error("Notification error:", err.message);
    }
  }

  // ─── Send to all admins ───────────────────────────────────────────────────
  static async notifyAdmins(payload) {
    const admins = await User.find({ role: "admin", isActive: true })
      .select("_id")
      .lean();
    await Promise.all(admins.map((a) => this.sendToUser(a._id, payload)));
  }

  // ─── Broadcast to a role segment ─────────────────────────────────────────
  static async broadcastToRole(role, { type, title, message, data = {} }) {
    // Create one broadcast notification record
    const notif = await Notification.create({
      user: null,
      type,
      title,
      message,
      data,
      isBroadcast: true,
      targetAudience: role === "all" ? "all" : `${role}s`,
    });

    // Emit to all connected sockets in that role room
    try {
      const { getIO } = await import("../sockets/index.js");
      const room = role === "all" ? "broadcast" : `role:${role}`;
      getIO().to(room).emit("notification", {
        _id: notif._id,
        type,
        title,
        message,
        data,
        createdAt: notif.createdAt,
      });
    } catch (e) {
      /* non-critical */
    }

    return notif;
  }

  // ─── Get user notifications ───────────────────────────────────────────────
  static async getUserNotifications(userId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({
        $or: [{ user: userId }, { isBroadcast: true }],
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments({
        $or: [{ user: userId }, { isBroadcast: true }],
      }),

      Notification.countDocuments({
        $or: [{ user: userId }, { isBroadcast: true }],
        isRead: false,
      }),
    ]);

    return { notifications, total, unreadCount };
  }

  // ─── Mark as read ─────────────────────────────────────────────────────────
  static async markRead(userId, notificationIds = []) {
    const filter = notificationIds.length
      ? { _id: { $in: notificationIds }, user: userId }
      : { user: userId, isRead: false };

    await Notification.updateMany(filter, { isRead: true, readAt: new Date() });
  }
}
