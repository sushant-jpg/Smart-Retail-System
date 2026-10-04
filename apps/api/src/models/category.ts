import { Schema, model } from "mongoose";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "", maxlength: 1_000 },
    image: String,
    parent: { type: Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true },
);

categorySchema.index({ parent: 1, name: 1 }, { unique: true });

export const Category = model("Category", categorySchema);
