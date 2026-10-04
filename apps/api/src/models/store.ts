import { Schema, model } from "mongoose";

const storeSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    address: { type: String, required: true },
    manager: { type: Schema.Types.ObjectId, ref: "User" },
    openingHours: { type: Map, of: String },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  },
  { timestamps: true },
);

export const Store = model("Store", storeSchema);
