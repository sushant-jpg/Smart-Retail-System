import { Schema, model } from "mongoose";

export const promotionTypes = [
  "PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT", "BUY_ONE_GET_ONE", "BUY_X_GET_Y", "CATEGORY_DISCOUNT", "LOYALTY_DISCOUNT",
] as const;

const promotionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: promotionTypes, required: true },
    discount: { type: Number, required: true, min: 0 },
    buyQuantity: { type: Number, min: 1 },
    getQuantity: { type: Number, min: 1 },
    minimumSpend: { type: Number, min: 0, default: 0 },
    applicableProducts: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    applicableCategories: [{ type: String, trim: true }],
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    usageLimit: { type: Number, min: 1 },
    usageCount: { type: Number, min: 0, default: 0 },
    perUserLimit: { type: Number, min: 1, default: 1 },
    usedBy: [{ user: { type: Schema.Types.ObjectId, ref: "User" }, count: { type: Number, min: 1 } }],
    status: { type: String, enum: ["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"], default: "DRAFT", index: true },
  },
  { timestamps: true },
);

promotionSchema.index({ status: 1, startDate: 1, endDate: 1 });

export const Promotion = model("Promotion", promotionSchema);
