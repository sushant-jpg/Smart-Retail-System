import { Schema, model } from "mongoose";

export const purchaseOrderStatuses = [
  "DRAFT", "SUBMITTED", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED",
] as const;

const purchaseOrderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier", required: true, index: true },
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    items: { type: [purchaseOrderItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    expectedDeliveryDate: { type: Date, required: true },
    status: { type: String, enum: purchaseOrderStatuses, default: "DRAFT", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    orderedAt: Date,
    receivedAt: Date,
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ store: 1, createdAt: -1 });

export const PurchaseOrder = model("PurchaseOrder", purchaseOrderSchema);
