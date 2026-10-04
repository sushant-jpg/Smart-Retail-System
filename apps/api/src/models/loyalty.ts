import { Schema, model } from "mongoose";

export const loyaltyTiers = ["BRONZE", "SILVER", "GOLD", "PLATINUM"] as const;

const loyaltyAccountSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    pointsBalance: { type: Number, min: 0, default: 0 },
    lifetimePoints: { type: Number, min: 0, default: 0 },
    tier: { type: String, enum: loyaltyTiers, default: "BRONZE", index: true },
  },
  { timestamps: true },
);

const loyaltyTransactionSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["EARN", "REDEEM", "EXPIRE", "ADJUST"], required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceType: { type: String, required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true },
    expiresAt: Date,
    remainingPoints: { type: Number, min: 0 },
    expiredAt: Date,
    note: String,
  },
  { timestamps: true, immutable: true },
);

loyaltyTransactionSchema.index({ customer: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ type: 1, expiresAt: 1, expiredAt: 1, remainingPoints: 1 });

export const LoyaltyAccount = model("LoyaltyAccount", loyaltyAccountSchema);
export const LoyaltyTransaction = model("LoyaltyTransaction", loyaltyTransactionSchema);
