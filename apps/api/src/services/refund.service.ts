import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../lib/app-error.js";
import { realtime } from "../lib/realtime.js";
import { AuditLog } from "../models/audit-log.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { InventoryMovement } from "../models/inventory-movement.js";
import { Inventory } from "../models/inventory.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/loyalty.js";
import { Notification } from "../models/notification.js";
import { Refund } from "../models/refund.js";
import { Sale } from "../models/sale.js";

export async function completeRefund(refundId: string, key: string, actor: { userId: string; role: string }, requestId: string) {
  const requestHash = createHash("sha256").update(refundId).digest("hex");
  const existing = await IdempotencyKey.findOne({ key, actor: actor.userId }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for another operation");
    if (existing.status === "COMPLETED") return existing.response;
    throw new AppError(409, "REFUND_IN_PROGRESS", "Refund is already being processed");
  }
  try {
    await IdempotencyKey.create({ key, actor: actor.userId, requestHash, status: "PROCESSING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const duplicate = await IdempotencyKey.findOne({ key, actor: actor.userId }).lean();
      if (duplicate?.requestHash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for another operation");
      }
      if (duplicate.status === "COMPLETED") return duplicate.response;
      throw new AppError(409, "REFUND_IN_PROGRESS", "Refund is already being processed");
    }
    throw error;
  }

  const session = await mongoose.startSession();
  try {
    let response: Record<string, unknown> = {};
    let customerId: string | undefined;
    let storeId = "";
    await session.withTransaction(async () => {
      const refund = await Refund.findOneAndUpdate(
        { _id: refundId, status: "APPROVED" },
        { $set: { status: "PROCESSING" } },
        { new: true, session },
      );
      if (!refund) throw new AppError(409, "REFUND_NOT_APPROVED", "Only approved refunds can be completed");
      const sale = await Sale.findById(refund.sale).session(session);
      if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Original sale not found");

      // Every completion writes the original sale. MongoDB therefore creates a
      // write conflict between concurrent refunds, retries the loser, and makes
      // it validate against the newly committed quantities and value.
      await Sale.updateOne({ _id: sale._id }, { $inc: { __v: 1 } }, { session });
      const completedRefunds = await Refund.find({
        sale: sale._id, status: "COMPLETED", _id: { $ne: refund._id },
      }).session(session).lean();
      const alreadyRefundedAmount = completedRefunds.reduce((sum, entry) => sum + entry.amount, 0);
      if (alreadyRefundedAmount + refund.amount > sale.total) {
        throw new AppError(409, "REFUND_AMOUNT_EXCEEDED", "Refund exceeds the remaining refundable amount");
      }
      for (const item of refund.items) {
        const purchased = sale.items.find((line) => String(line.product) === String(item.product));
        if (!purchased) throw new AppError(422, "PRODUCT_NOT_IN_SALE", "A refund product is not in the original sale");
        const completedQuantity = completedRefunds.reduce(
          (sum, entry) => sum + (entry.items.find((line) => String(line.product) === String(item.product))?.quantity ?? 0), 0,
        );
        if (completedQuantity + item.quantity > purchased.quantity) {
          throw new AppError(409, "REFUND_QUANTITY_EXCEEDED", "Refund exceeds the remaining refundable quantity");
        }
      }

      for (const item of refund.items) {
        if (!item.restock) continue;
        const inventory = await Inventory.findOneAndUpdate(
          { store: refund.store, product: item.product },
          { $inc: { availableQuantity: item.quantity }, $setOnInsert: { reservedQuantity: 0, damagedQuantity: 0, reorderLevel: 10, reorderQuantity: 25 } },
          { new: true, upsert: true, session },
        );
        await InventoryMovement.create([{
          store: refund.store, product: item.product, type: "REFUND", quantityDelta: item.quantity,
          balanceAfter: inventory.availableQuantity, referenceType: "Refund", referenceId: refund._id,
          actor: actor.userId, reason: refund.reason, requestId,
        }], { session });
      }

      const refundedTotal = alreadyRefundedAmount + refund.amount;
      sale.saleStatus = refundedTotal >= sale.total ? "REFUNDED" : "PARTIALLY_REFUNDED";
      sale.paymentStatus = refundedTotal >= sale.total ? "REFUNDED" : "PAID";
      await sale.save({ session });

      if (sale.customer) {
        const account = await LoyaltyAccount.findOne({ customer: sale.customer }).session(session);
        if (account) {
          const ratio = sale.total ? refund.amount / sale.total : 0;
          const restore = Math.round(sale.loyaltyPointsRedeemed * ratio);
          const earnedReversal = Math.round(sale.loyaltyPointsEarned * ratio);
          const requestedDelta = restore - earnedReversal;
          const delta = requestedDelta < 0 ? -Math.min(account.pointsBalance, Math.abs(requestedDelta)) : requestedDelta;
          if (delta) {
            account.pointsBalance += delta;
            await account.save({ session });
            if (delta < 0) {
              const saleGrant = await LoyaltyTransaction.findOne({
                account: account._id, type: "EARN", referenceType: "Sale", referenceId: sale._id,
              }).session(session);
              if (saleGrant?.remainingPoints) {
                const grantReduction = Math.min(saleGrant.remainingPoints, Math.abs(delta));
                await LoyaltyTransaction.updateOne({ _id: saleGrant._id }, { $inc: { remainingPoints: -grantReduction } }, { session });
              }
            }
            await LoyaltyTransaction.create([{
              account: account._id, customer: sale.customer, type: "ADJUST", points: delta,
              balanceAfter: account.pointsBalance, referenceType: "Refund", referenceId: refund._id,
              note: "Loyalty adjustment for returned purchase",
            }], { session });
          }
        }
      }

      refund.status = "COMPLETED";
      refund.completedAt = new Date();
      refund.idempotencyKey = key;
      await refund.save({ session });
      await AuditLog.create([{
        actor: actor.userId, actorRole: actor.role, action: "REFUND_COMPLETED", resource: "Refund", resourceId: String(refund._id),
        newValue: { refundNumber: refund.refundNumber, amount: refund.amount, saleStatus: sale.saleStatus }, requestId,
      }], { session });
      if (refund.customer) await Notification.create([{
        recipient: refund.customer, type: "REFUND", title: "Refund completed",
        message: `${refund.refundNumber} has been completed.`, data: { refundId: refund._id, amount: refund.amount },
      }], { session });
      customerId = refund.customer ? String(refund.customer) : undefined;
      storeId = String(refund.store);
      response = { refundId: String(refund._id), refundNumber: refund.refundNumber, status: refund.status, amount: refund.amount, saleStatus: sale.saleStatus };
      await IdempotencyKey.updateOne(
        { key, actor: actor.userId, status: "PROCESSING" },
        { $set: { status: "COMPLETED", response } },
        { session },
      );
    });
    realtime.publish({ room: `store:${storeId}`, name: "refund.updated", payload: response });
    if (customerId) realtime.publish({ userId: customerId, name: "notification.created", payload: { type: "REFUND", ...response } });
    return response;
  } catch (error) {
    await IdempotencyKey.deleteOne({ key, actor: actor.userId, status: "PROCESSING" });
    throw error;
  } finally {
    await session.endSession();
  }
}
