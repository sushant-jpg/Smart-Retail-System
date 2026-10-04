import { Schema, model } from "mongoose";

const paymentAttemptSchema = new Schema(
  {
    actor: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    checkoutInput: { type: Schema.Types.Mixed, required: true },
    quoteHash: { type: String, required: true },
    quote: { type: Schema.Types.Mixed, required: true },
    paymentMethod: { type: String, enum: ["CASH", "CARD", "QR", "WALLET"], required: true },
    state: { type: String, enum: ["CREATED", "PENDING", "APPROVED", "DECLINED"], required: true, default: "CREATED" },
    saleResponse: Schema.Types.Mixed,
    declineReason: String,
  },
  { timestamps: true },
);

paymentAttemptSchema.index({ actor: 1, idempotencyKey: 1 }, { unique: true });

export const PaymentAttempt = model("PaymentAttempt", paymentAttemptSchema);
