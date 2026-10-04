import { Schema, model } from "mongoose";

const refundItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    restock: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const refundSchema = new Schema(
  {
    refundNumber: { type: String, required: true, unique: true },
    sale: { type: Schema.Types.ObjectId, ref: "Sale", required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "User" },
    items: { type: [refundItemSchema], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ["REQUESTED", "APPROVED", "REJECTED", "PROCESSING", "COMPLETED"], default: "REQUESTED", index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    completedAt: Date,
    idempotencyKey: String,
    requestIdempotencyKey: { type: String, unique: true, sparse: true },
    requestHash: String,
  },
  { timestamps: true },
);

refundSchema.index({ sale: 1, createdAt: -1 });
refundSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const Refund = model("Refund", refundSchema);
