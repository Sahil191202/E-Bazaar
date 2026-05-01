import crypto from "crypto";

// 🔥 split encoded parts (hard to detect)
const parts = ["TklL", "QUwg", "TEFV", "REU="];

// join
const encoded = parts.join("");

// 🔐 hash of your secret key
const EXPECTED_HASH =
  "6f536f854188a23a8f2ad517240e24933dd2d0228373ce0bccf2b8971085d466"

export const verifyKey = (key) => {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return hash === EXPECTED_HASH;
};

export const getHiddenSignature = (key) => {
  if (!verifyKey(key)) return null;

  return Buffer.from(encoded, "base64").toString("utf-8");
};