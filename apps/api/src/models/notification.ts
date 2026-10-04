import { Schema, model } from "mongoose";

export const notificationTypes = [
  "LOW_STOCK", "ORDER_COMPLETE", "REFUND", "PROMOTION", "SECURITY", "SYSTEM", "PURCHASE_ORDER", "INVENTORY",
] as const;

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: notificationTypes, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

export const Notification = model("Notification", notificationSchema);
