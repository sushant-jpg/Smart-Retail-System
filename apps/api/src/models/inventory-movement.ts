import { Schema, model } from "mongoose";

export const movementTypes = [
  "PURCHASE", "SALE", "RETURN", "REFUND", "TRANSFER", "ADJUSTMENT", "DAMAGED", "EXPIRED",
] as const;

const movementSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    type: { type: String, enum: movementTypes, required: true },
    quantityDelta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceType: { type: String, required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: String,
    requestId: { type: String, required: true },
  },
  { timestamps: true, immutable: true },
);

movementSchema.index({ store: 1, product: 1, createdAt: -1 });

export const InventoryMovement = model("InventoryMovement", movementSchema);
