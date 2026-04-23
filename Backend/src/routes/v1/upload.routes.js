import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { FCMService }   from '../../services/fcm.service.js';
import { ApiResponse }  from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import Joi              from 'joi';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();
router.use(authenticate);

const fcmSchema = Joi.object({
  token:    Joi.string().min(10).required(),
  platform: Joi.string().valid('android', 'ios', 'web').required(),
});

// Register FCM token on app open / login
router.post('/fcm/register', validateBody(fcmSchema), asyncHandler(async (req, res) => {
  const { token, platform } = req.body;
  await FCMService.registerToken(req.user._id, token, platform);
  res.json(new ApiResponse(200, null, 'FCM token registered'));
}));

// Unregister on logout
router.delete('/fcm/unregister', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (token) await FCMService.unregisterToken(req.user._id, token);
  res.json(new ApiResponse(200, null, 'FCM token removed'));
}));

export default router;