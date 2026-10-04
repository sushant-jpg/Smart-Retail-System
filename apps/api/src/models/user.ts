import { Schema, Types, model } from "mongoose";
import { roles, type Role } from "../lib/permissions.js";

export interface UserDocument {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: Role;
  storeIds: Types.ObjectId[];
  emailVerifiedAt?: Date;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  loginHistory: Array<{ at: Date; ip: string; userAgent: string; device: string; successful: boolean }>;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
}

const loginHistorySchema = new Schema(
  { at: { type: Date, required: true }, ip: String, userAgent: String, device: String, successful: Boolean },
  { _id: false },
);

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    role: { type: String, enum: roles, default: "CUSTOMER", required: true },
    storeIds: [{ type: Schema.Types.ObjectId, ref: "Store" }],
    emailVerifiedAt: Date,
    lastLoginAt: Date,
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    loginHistory: { type: [loginHistorySchema], default: [] },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED", "INVITED"], default: "ACTIVE" },
  },
  { timestamps: true },
);

export const User = model<UserDocument>("User", userSchema);
