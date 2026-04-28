import { ApiError } from "../utils/ApiError.js";

export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    const userRole = req.user?.role;

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: required ${roles.join(" or ")}, you have ${userRole}`,
      });
    }

    next();
  };
