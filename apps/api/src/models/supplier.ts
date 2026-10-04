import { Schema, model } from "mongoose";

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    address: { type: String, required: true, trim: true },
    taxNumber: { type: String, required: true, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "REVIEW"], default: "ACTIVE", index: true },
    storeIds: [{ type: Schema.Types.ObjectId, ref: "Store" }],
    productsSupplied: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    leadTimeDays: { type: Number, min: 0, default: 3 },
  },
  { timestamps: true },
);

supplierSchema.index({ name: 1 });
supplierSchema.index({ email: 1 }, { unique: true });

export const Supplier = model("Supplier", supplierSchema);
