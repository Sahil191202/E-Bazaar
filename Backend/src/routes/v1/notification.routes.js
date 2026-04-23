import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { NotificationService } from '../../services/notification.service.js';
import { ApiResponse }  from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await NotificationService.getUserNotifications(req.user._id, { page: +page, limit: +limit });
  res.json(new ApiResponse(200, data));
}));

router.post('/read', asyncHandler(async (req, res) => {
  const { ids } = req.body; // optional array of IDs — if empty, marks all as read
  await NotificationService.markRead(req.user._id, ids || []);
  res.json(new ApiResponse(200, null, 'Notifications marked as read'));
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  const { Notification } = await import('../../models/Notification.js');
  const count = await Notification.countDocuments({
    $or: [{ user: req.user._id }, { isBroadcast: true }],
    isRead: false,
  });
  res.json(new ApiResponse(200, { count }));
}));

export default router;