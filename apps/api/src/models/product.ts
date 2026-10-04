import { Schema, model } from "mongoose";

export interface ProductDocument {
  name: string;
  slug: string;
  description: string;
  sku: string;
  barcode: string;
  qr: { publicId: string; version: number };
  category: string;
  brand: string;
  costPrice: number;
  sellingPrice: number;
  taxRateBps: number;
  images: string[];
  status: "ACTIVE" | "INACTIVE" | "OUT_OF_STOCK" | "DISCONTINUED";
}

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, default: "" },
    sku: { type: String, required: true, unique: true, uppercase: true },
    barcode: { type: String, required: true, unique: true },
    qr: {
      publicId: { type: String, required: true, unique: true },
      version: { type: Number, required: true, default: 1 },
    },
    category: { type: String, required: true, index: true },
    brand: { type: String, default: "" },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10_000 },
    images: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "OUT_OF_STOCK", "DISCONTINUED"],
      default: "ACTIVE",
      index: true,
    },
  },
  { timestamps: true },
);

productSchema.index({ name: "text", sku: "text", barcode: "text", brand: "text" });

export const Product = model<ProductDocument>("Product", productSchema);
