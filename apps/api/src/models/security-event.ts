import { Schema, model } from "mongoose";

export const securityEventTypes = [
  "LOGIN_FAILED", "ACCOUNT_LOCKED", "PASSWORD_CHANGED", "REFRESH_TOKEN_REUSE", "SUSPICIOUS_LOGIN", "PERMISSION_DENIED", "RATE_LIMIT_TRIGGERED",
] as const;

const securityEventSchema = new Schema(
  {
    type: { type: String, enum: securityEventTypes, required: true, index: true },
    severity: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    ip: String,
    userAgent: String,
    metadata: Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

securityEventSchema.index({ timestamp: -1, severity: 1 });

export const SecurityEvent = model("SecurityEvent", securityEventSchema);
