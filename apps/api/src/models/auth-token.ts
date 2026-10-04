import { Schema, model } from "mongoose";

const authTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    type: { type: String, enum: ["EMAIL_VERIFICATION", "PASSWORD_RESET"], required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    usedAt: Date,
  },
  { timestamps: true },
);

export const AuthToken = model("AuthToken", authTokenSchema);
