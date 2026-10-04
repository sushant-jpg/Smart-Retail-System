import { Schema, model } from "mongoose";

const idempotencySchema = new Schema(
  {
    key: { type: String, required: true },
    actor: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ["PROCESSING", "COMPLETED"], required: true },
    response: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

idempotencySchema.index({ key: 1, actor: 1 }, { unique: true });

export const IdempotencyKey = model("IdempotencyKey", idempotencySchema);
