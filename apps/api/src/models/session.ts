import { Schema, model } from "mongoose";

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    ip: { type: String, required: true },
    userAgent: { type: String, required: true },
    device: { type: String, required: true },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: Date,
    revokedReason: { type: String, enum: ["ROTATED", "LOGOUT", "REUSE_DETECTED", "PASSWORD_CHANGED", "ADMIN_REVOKED"] },
    replacedBy: { type: Schema.Types.ObjectId, ref: "Session" },
  },
  { timestamps: true },
);

export const Session = model("Session", sessionSchema);
