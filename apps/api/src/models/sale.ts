import { Schema, model } from "mongoose";

const saleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    saleNumber: { type: String, required: true, unique: true },
    verificationCode: { type: String, required: true, unique: true },
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "User" },
    cashier: { type: Schema.Types.ObjectId, ref: "User" },
    items: { type: [saleItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    paymentMethod: { type: String, enum: ["CASH", "CARD", "QR", "WALLET"], required: true },
    paymentStatus: { type: String, enum: ["PENDING", "PAID", "FAILED", "REFUNDED"], required: true },
    saleStatus: {
      type: String,
      enum: ["PENDING", "PAID", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"],
      required: true,
    },
    idempotencyKey: { type: String, required: true },
    promotion: { type: Schema.Types.ObjectId, ref: "Promotion" },
    promotionCode: String,
    loyaltyPointsRedeemed: { type: Number, min: 0, default: 0 },
    loyaltyPointsEarned: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

saleSchema.index({ store: 1, createdAt: -1 });
saleSchema.index({ idempotencyKey: 1, customer: 1 }, { unique: true });

export const Sale = model("Sale", saleSchema);
