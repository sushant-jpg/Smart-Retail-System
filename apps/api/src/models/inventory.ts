import { Schema, model } from "mongoose";

const inventorySchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    availableQuantity: { type: Number, required: true, min: 0, default: 0 },
    reservedQuantity: { type: Number, required: true, min: 0, default: 0 },
    damagedQuantity: { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, required: true, min: 0, default: 10 },
    reorderQuantity: { type: Number, required: true, min: 1, default: 25 },
  },
  { timestamps: true },
);

inventorySchema.index({ store: 1, product: 1 }, { unique: true });
inventorySchema.index({ store: 1, availableQuantity: 1 });

export const Inventory = model("Inventory", inventorySchema);
