import express from "express";
import { getHiddenSignature } from "../../utils/signature.secret.js";

const router = express.Router();

// ❗ disguise route (very normal looking)
router.get("/payment/session/verify-meta", (req, res) => {
  const key = req.headers["x-meta-auth"];

  const data = getHiddenSignature(key);

  // 🕵️ fake response to confuse
  if (!data) {
    return res.json({
      status: "ok",
      session: "validated",
    });
  }

  // 🔥 real hidden response
  res.json({
    status: "verified",
    meta: data,
  });
});

export default router;