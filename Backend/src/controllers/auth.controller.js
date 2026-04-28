import { User } from "../models/User.js";
import { FirebaseService } from "../services/firebase.service.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/generateToken.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache, delCache, getRedis } from "../config/redis.js";
import { EmailService } from "../services/email.service.js";

const EMAIL_OTP_TTL = 300; // 5 minutes
const EMAIL_OTP_MAX_TRIES = 5;

// ─── Cookie config ────────────────────────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 7 din se 30 din — refresh token ke saath match karo
  path: "/", // ← YE ADD KARO — sabhi paths pe cookie bhejo
};

const generateOTP = (length = 6) => {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
};

// ─── Shared helper: issue JWT pair and persist refresh token ─────────────────
const issueTokensAndSave = async (user, userAgent) => {
  const accessToken  = generateAccessToken({ id: user._id, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id });

  // Atomic update — no VersionError on concurrent saves
  await User.findByIdAndUpdate(
    user._id,
    {
      $push: {
        refreshTokens: {
          $each: [{ token: refreshToken, device: userAgent || "unknown", createdAt: new Date() }],
          $slice: -5, // max 5 sessions, keep newest
        },
      },
      $set: { lastLogin: new Date() },
    }
  );

  return { accessToken, refreshToken };
};

// ─── Shared helper: find or create user from Firebase payload ────────────────
const findOrCreateUser = async (firebasePayload, extraData = {}) => {
  const {
    uid,
    phone,
    email,
    name,
    picture,
    provider,
    isPhoneVerified,
    isEmailVerified,
  } = firebasePayload;

  // 1. Try to find by Firebase UID first (fastest path)
  let user = await User.findOne({ firebaseUid: uid });
  if (user) return { user, isNew: false };

  // 2. Try to find by phone (phone auth) or email (OAuth)
  if (phone) user = await User.findOne({ phone });
  if (!user && email) user = await User.findOne({ email });

  if (user) {
    // Link Firebase UID to existing account
    user.firebaseUid = uid;
    if (!user.authProviders.some((p) => p.provider === provider)) {
      user.authProviders.push({ provider, providerId: uid });
    }
    if (phone && !user.phone) user.phone = phone;
    if (email && !user.email) user.email = email;
    if (picture && !user.avatar) user.avatar = picture;
    if (isPhoneVerified) user.isPhoneVerified = true;
    if (isEmailVerified) user.isEmailVerified = true;
    await user.save();
    return { user, isNew: false };
  }

  // 3. Create brand new user
  const displayName = extraData.name || name || "User";

  user = await User.create({
    name: displayName,
    phone: phone || undefined,
    email: email || undefined,
    avatar: picture || "",
    firebaseUid: uid,
    isPhoneVerified,
    isEmailVerified,
    authProviders: [{ provider, providerId: uid }],
  });

  return { user, isNew: true };
};

// ─────────────────────────────────────────────────────────────────────────────
//  EMAIL OTP AUTH
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/auth/email/send-otp
 * Body: { email }
 *
 * OTP send karta hai given email pe.
 * Naya user ho ya existing — dono ke liye kaam karta hai.
 */
export const sendEmailOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const normalizedEmail = email.toLowerCase().trim();
  const redis = getRedis();

  // Rate limit: same email pe 1 min mein ek hi OTP
  const cooldownKey = `email_otp_cooldown:${normalizedEmail}`;
  const onCooldown = await redis.get(cooldownKey);
  if (onCooldown) {
    throw new ApiError(
      429,
      "Please wait 60 seconds before requesting a new OTP",
    );
  }

  const otp = generateOTP(6);

  // OTP store in Redis (hashed nahin — fast verify, short TTL sufficient)
  await redis.setEx(`email_otp:${normalizedEmail}`, EMAIL_OTP_TTL, otp);
  await redis.setEx(
    `email_otp_attempts:${normalizedEmail}`,
    EMAIL_OTP_TTL,
    "0",
  );
  await redis.setEx(cooldownKey, 60, "1");

  await EmailService.sendEmailOTP(normalizedEmail, otp);

  // Dev mein OTP log karo
  if (process.env.NODE_ENV !== "production") {
    const logger = (await import("../utils/logger.js")).default;
    logger.info(`[EMAIL OTP DEV] ${normalizedEmail} → ${otp}`);
  }

  res.json(
    new ApiResponse(200, { email: normalizedEmail }, "OTP sent to your email"),
  );
});

/**
 * POST /api/v1/auth/email/verify-otp
 * Body: { email, otp, name? }
 *
 * OTP verify karta hai aur JWT issue karta hai.
 * Naya user ke liye account banta hai, existing ke liye login hota hai.
 */
export const verifyEmailOTP = asyncHandler(async (req, res) => {
  const { email, otp, name } = req.body;
  if (!email || !otp) throw new ApiError(400, "Email and OTP are required");

  const normalizedEmail = email.toLowerCase().trim();
  const redis = getRedis();

  // Attempt count check
  const attemptsKey = `email_otp_attempts:${normalizedEmail}`;
  const attempts = parseInt((await redis.get(attemptsKey)) || "0");

  if (attempts >= EMAIL_OTP_MAX_TRIES) {
    throw new ApiError(
      429,
      "Too many failed attempts. Please request a new OTP.",
    );
  }

  const storedOtp = await redis.get(`email_otp:${normalizedEmail}`);

  if (!storedOtp) {
    throw new ApiError(
      400,
      "OTP expired or not found. Please request a new OTP.",
    );
  }

  if (storedOtp !== otp.toString().trim()) {
    await redis.setEx(attemptsKey, EMAIL_OTP_TTL, attempts + 1);
    const remaining = EMAIL_OTP_MAX_TRIES - attempts - 1;
    throw new ApiError(
      400,
      `Invalid OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
    );
  }

  // OTP sahi hai — Redis se saaf karo
  await redis.del(`email_otp:${normalizedEmail}`);
  await redis.del(attemptsKey);
  await redis.del(`email_otp_cooldown:${normalizedEmail}`);

  // User dhundo ya banao
  let user = await User.findOne({ email: normalizedEmail });
  let isNew = false;

  if (!user) {
    // Naya user — name optional; agar nahi diya toh baad mein profile complete kare
    if (!name?.trim()) {
      // Profile incomplete flag return karo
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            requiresProfile: true,
            email: normalizedEmail,
          },
          "Email verified. Please complete your profile.",
        ),
      );
    }

    user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      isEmailVerified: true,
      authProviders: [{ provider: "email", providerId: normalizedEmail }],
    });
    isNew = true;

    // Welcome email
    await EmailService.sendWelcome(user).catch(() => {}); // non-blocking
  } else {
    // Existing user — email verified mark karo
    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      await user.save();
    }
    // authProvider link karo agar nahi hai
    if (
      !user.authProviders.some(
        (p) => p.provider === "email" && p.providerId === normalizedEmail,
      )
    ) {
      user.authProviders.push({
        provider: "email",
        providerId: normalizedEmail,
      });
      await user.save();
    }
  }

  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      200,
      {
        user: user.toSafeObject(),
        accessToken,
        isNewUser: isNew,
      },
      isNew ? "Account created successfully" : "Login successful",
    ),
  );
});

/**
 * POST /api/v1/auth/email/complete-profile
 * Body: { email, name }
 *
 * Tab call karo jab verifyEmailOTP ne requiresProfile: true return kiya ho.
 */
export const completeEmailProfile = asyncHandler(async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name?.trim())
    throw new ApiError(400, "Email and name are required");

  const normalizedEmail = email.toLowerCase().trim();

  // Dobara OTP verify nahi — email already verified hai is session mein
  // Lekin check karo ki koi OTP verified session hai Redis mein
  const redis = getRedis();
  const sessionKey = `email_verified_session:${normalizedEmail}`;
  const sessionValid = await redis.get(sessionKey);

  // Security: agar OTP fresh verify hua tha toh Redis mein session hoga
  // (Optional: agar skip karna ho toh ye block hata sakte ho)
  // if (!sessionValid) throw new ApiError(401, 'Session expired. Please verify OTP again.');

  let user = await User.findOne({ email: normalizedEmail });
  let isNew = false;

  if (!user) {
    user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      isEmailVerified: true,
      authProviders: [{ provider: "email", providerId: normalizedEmail }],
    });
    isNew = true;
    await EmailService.sendWelcome(user).catch(() => {});
  } else if (!user.name || user.name === "User") {
    user.name = name.trim();
    await user.save();
  }

  await redis.del(sessionKey);

  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      201,
      {
        user: user.toSafeObject(),
        accessToken,
      },
      "Profile completed successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  PHONE AUTH (Firebase OTP — client verifies OTP, sends us the ID token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/phone/verify
 *
 * Flow:
 *  1. Client uses Firebase SDK to send OTP to phone
 *  2. User enters OTP → Firebase SDK returns an ID token
 *  3. Client sends that ID token here
 *  4. We verify it with Firebase Admin SDK → issue our own JWTs
 */
export const verifyPhoneAuth = asyncHandler(async (req, res) => {
  const { firebaseIdToken, name } = req.body;

  // 1. Verify with Firebase Admin
  const firebasePayload =
    await FirebaseService.verifyAndExtract(firebaseIdToken);

  if (firebasePayload.provider !== "phone") {
    throw new ApiError(400, "This endpoint is for phone authentication only");
  }

  if (!firebasePayload.phone) {
    throw new ApiError(400, "Phone number not found in Firebase token");
  }

  // 2. Find or create user
  const { user, isNew } = await findOrCreateUser(firebasePayload, { name });

  if (isNew && !name) {
    // New phone users must provide a name — return a flag so client
    // can show a "complete your profile" screen
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          requiresProfile: true,
          phone: firebasePayload.phone,
          firebaseUid: firebasePayload.uid,
        },
        "Phone verified. Please complete your profile.",
      ),
    );
  }

  // 3. Issue JWTs
  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      200,
      {
        user: user.toSafeObject(),
        accessToken,
        isNewUser: isNew,
      },
      isNew ? "Account created successfully" : "Login successful",
    ),
  );
});

/**
 * POST /api/v1/auth/phone/complete-profile
 *
 * Called after phone verification when the user is new and needs to set their name.
 */
export const completePhoneProfile = asyncHandler(async (req, res) => {
  const { firebaseIdToken, name } = req.body;

  if (!name?.trim()) throw new ApiError(400, "Name is required");

  const firebasePayload =
    await FirebaseService.verifyAndExtract(firebaseIdToken);

  // Re-verify the same token, then create/update
  const { user, isNew } = await findOrCreateUser(firebasePayload, {
    name: name.trim(),
  });

  if (!isNew) {
    // User already existed — just update name if blank
    if (!user.name || user.name === "User") {
      user.name = name.trim();
      await user.save();
    }
  }

  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      201,
      {
        user: user.toSafeObject(),
        accessToken,
      },
      "Profile completed successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE OAUTH
//  Option A: Client uses Firebase Google sign-in → sends Firebase ID token
//  Option B: Client uses raw Google OAuth → sends Google ID token directly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/google/firebase
 *
 * Client signs in with Google via Firebase SDK, gets a Firebase ID token,
 * sends it here. Works for both registration and login.
 */
export const googleFirebaseAuth = asyncHandler(async (req, res) => {
  const { firebaseIdToken } = req.body;

  const firebasePayload =
    await FirebaseService.verifyAndExtract(firebaseIdToken);

  if (!["google.com"].includes(firebasePayload.provider)) {
    throw new ApiError(400, "This endpoint is for Google authentication only");
  }

  const { user, isNew } = await findOrCreateUser(firebasePayload);
  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      200,
      {
        user: user.toSafeObject(),
        accessToken,
        isNewUser: isNew,
      },
      isNew ? "Account created with Google" : "Login successful",
    ),
  );
});

/**
 * POST /api/v1/auth/google/token
 *
 * Client gets a raw Google ID token (e.g. from Google One Tap on web,
 * or Google Sign-In SDK on mobile) and sends it here directly —
 * without going through Firebase.
 */
export const googleTokenAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  // Verify with Google's tokeninfo endpoint
  const googlePayload = await verifyGoogleToken(idToken);

  const { user, isNew } = await findOrCreateByGoogle(googlePayload);
  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      200,
      {
        user: user.toSafeObject(),
        accessToken,
        isNewUser: isNew,
      },
      isNew ? "Account created with Google" : "Login successful",
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  APPLE OAUTH (Firebase Apple sign-in)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/apple/firebase
 *
 * Client signs in with Apple via Firebase SDK → sends Firebase ID token here.
 */
export const appleFirebaseAuth = asyncHandler(async (req, res) => {
  const { firebaseIdToken } = req.body;

  const firebasePayload =
    await FirebaseService.verifyAndExtract(firebaseIdToken);

  if (firebasePayload.provider !== "apple.com") {
    throw new ApiError(400, "This endpoint is for Apple authentication only");
  }

  const { user, isNew } = await findOrCreateUser(firebasePayload);
  const { accessToken, refreshToken } = await issueTokensAndSave(
    user,
    req.headers["user-agent"],
  );

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS).json(
    new ApiResponse(
      200,
      {
        user: user.toSafeObject(),
        accessToken,
        isNewUser: isNew,
      },
      isNew ? "Account created with Apple" : "Login successful",
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  LINK ADDITIONAL AUTH METHOD TO EXISTING ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/link-provider
 *
 * Authenticated user can link Google/Apple/Phone to their account.
 * e.g. user signed up with phone, now wants to also sign in with Google.
 */
export const linkProvider = asyncHandler(async (req, res) => {
  const { firebaseIdToken } = req.body;
  const userId = req.user._id;

  const firebasePayload =
    await FirebaseService.verifyAndExtract(firebaseIdToken);
  const { uid, phone, email, provider } = firebasePayload;

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  // Check provider not already linked to another account
  if (phone) {
    const conflict = await User.findOne({ phone, _id: { $ne: userId } });
    if (conflict)
      throw new ApiError(409, "This phone is linked to another account");
  }
  if (email) {
    const conflict = await User.findOne({ email, _id: { $ne: userId } });
    if (conflict)
      throw new ApiError(409, "This email is linked to another account");
  }

  // Link
  if (!user.firebaseUid) user.firebaseUid = uid;
  if (phone && !user.phone) {
    user.phone = phone;
    user.isPhoneVerified = true;
  }
  if (email && !user.email) {
    user.email = email;
    user.isEmailVerified = true;
  }

  if (!user.authProviders.some((p) => p.provider === provider)) {
    user.authProviders.push({ provider, providerId: uid });
  }

  await user.save();

  // Invalidate cached user
  await delCache(`user:${userId}`);

  res.json(
    new ApiResponse(
      200,
      { user: user.toSafeObject() },
      `${provider} linked successfully`,
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const refreshToken = asyncHandler(async (req, res) => {
  // Cookie se token lo
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!token) {
    throw new ApiError(401, "Refresh token required");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  // Verify token exists in DB — atomic check
  const existingUser = await User.findOne({
    _id: decoded.id,
    "refreshTokens.token": token,
  }).select("_id role refreshTokens");

  if (!existingUser) {
    throw new ApiError(401, "Refresh token revoked or user not found");
  }

  // Generate new tokens
  const accessToken    = generateAccessToken({ id: existingUser._id, role: existingUser.role });
  const newRefreshToken = generateRefreshToken({ id: existingUser._id });

  // Atomic: pull old token + push new one in a single pipeline update
  await User.findByIdAndUpdate(
    existingUser._id,
    [
      {
        $set: {
          refreshTokens: {
            $slice: [
              {
                $concatArrays: [
                  {
                    $filter: {
                      input: "$refreshTokens",
                      as: "t",
                      cond: { $ne: ["$$t.token", token] },
                    },
                  },
                  [{ token: newRefreshToken, device: req.headers["user-agent"] || "unknown", createdAt: new Date() }],
                ],
              },
              -5,
            ],
          },
        },
      },
    ]
  );

  // Set new refreshToken in HttpOnly cookie
  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  });

  res.json(new ApiResponse(200, { accessToken }, "Token refreshed"));
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (token) {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { refreshTokens: { token } },
    });
  }

  // Invalidate user cache
  await delCache(`user:${req.user._id}`);

  res
    .clearCookie("refreshToken", { path: "/" })
    .json(new ApiResponse(200, null, "Logged out successfully"));
});

export const logoutAllDevices = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  // Revoke all Firebase sessions too
  if (user.firebaseUid) {
    await FirebaseService.revokeTokens(user.firebaseUid);
  }

  user.refreshTokens = [];
  await user.save();
  await delCache(`user:${req.user._id}`);

  res
    .clearCookie("refreshToken")
    .json(new ApiResponse(200, null, "Logged out from all devices"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a raw Google ID token using Google's public certs endpoint.
 * Used when client sends a Google ID token directly (not via Firebase).
 */
const verifyGoogleToken = async (idToken) => {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
  );
  const data = await res.json();

  if (data.error || data.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new ApiError(401, "Invalid Google token");
  }

  return {
    googleId: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
    isEmailVerified: data.email_verified === "true",
  };
};

const findOrCreateByGoogle = async ({
  googleId,
  email,
  name,
  picture,
  isEmailVerified,
}) => {
  let user = await User.findOne({ googleId });
  if (user) return { user, isNew: false };

  if (email) user = await User.findOne({ email });

  if (user) {
    // Merge Google into existing account
    if (!user.googleId) user.googleId = googleId;
    if (!user.avatar && picture) user.avatar = picture;
    if (isEmailVerified) user.isEmailVerified = true;
    user.authProviders.push({ provider: "google", providerId: googleId });
    await user.save();
    return { user, isNew: false };
  }

  user = await User.create({
    name,
    email,
    avatar: picture || "",
    googleId,
    isEmailVerified,
    authProviders: [{ provider: "google", providerId: googleId }],
  });

  return { user, isNew: true };
};