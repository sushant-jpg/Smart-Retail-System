import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../lib/app-error.js";
import { realtime } from "../lib/realtime.js";
import { AuditLog } from "../models/audit-log.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { InventoryMovement } from "../models/inventory-movement.js";
import { Inventory } from "../models/inventory.js";
import { PurchaseOrder } from "../models/purchase-order.js";

type ReceiptInput = { items: Array<{ productId: string; quantity: number }> };

export async function receivePurchaseOrder(
  purchaseOrderId: string,
  input: ReceiptInput,
  key: string,
  actor: { userId: string; role: string },
  requestId: string,
) {
  const requestHash = createHash("sha256").update(JSON.stringify({ purchaseOrderId, input })).digest("hex");
  const existing = await IdempotencyKey.findOne({ key, actor: actor.userId }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for another operation");
    if (existing.status === "COMPLETED") return existing.response;
    throw new AppError(409, "RECEIPT_IN_PROGRESS", "This goods receipt is already being processed");
  }
  try {
    await IdempotencyKey.create({ key, actor: actor.userId, requestHash, status: "PROCESSING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const duplicate = await IdempotencyKey.findOne({ key, actor: actor.userId }).lean();
      if (duplicate?.requestHash === requestHash && duplicate.status === "COMPLETED") return duplicate.response;
      throw new AppError(409, "RECEIPT_IN_PROGRESS", "This goods receipt is already being processed");
    }
    throw error;
  }

  const session = await mongoose.startSession();
  try {
    let response: Record<string, unknown> = {};
    let storeId = "";
    await session.withTransaction(async () => {
      const current = await PurchaseOrder.findById(purchaseOrderId).session(session);
      if (!current) throw new AppError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
      const locked = await PurchaseOrder.findOneAndUpdate(
        { _id: current._id, __v: current.__v, status: { $in: ["ORDERED", "PARTIALLY_RECEIVED"] } },
        { $inc: { __v: 1 } },
        { new: true, session },
      );
      if (!locked) throw new AppError(409, "PURCHASE_ORDER_CHANGED", "Purchase order status changed while receiving goods");
      const order = locked;
      if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new AppError(409, "PURCHASE_ORDER_NOT_RECEIVABLE", "Purchase order is not ready to receive goods");

      const requested = new Map(input.items.map((item) => [item.productId, item.quantity]));
      if (requested.size !== input.items.length) throw new AppError(422, "DUPLICATE_RECEIPT_ITEM", "Each product may appear only once per receipt");

      for (const item of order.items) {
        const quantity = requested.get(String(item.product));
        if (!quantity) continue;
        const remaining = item.quantity - item.receivedQuantity;
        if (quantity > remaining) throw new AppError(422, "RECEIPT_QUANTITY_EXCEEDED", "Received quantity exceeds the unreceived order quantity");
        const inventory = await Inventory.findOneAndUpdate(
          { store: order.store, product: item.product },
          { $inc: { availableQuantity: quantity }, $setOnInsert: { reservedQuantity: 0, damagedQuantity: 0, reorderLevel: 10, reorderQuantity: 25 } },
          { new: true, upsert: true, session },
        );
        item.receivedQuantity += quantity;
        await InventoryMovement.create([{
          store: order.store, product: item.product, type: "PURCHASE", quantityDelta: quantity,
          balanceAfter: inventory.availableQuantity, referenceType: "PurchaseOrder", referenceId: order._id,
          actor: actor.userId, reason: `Goods receipt for ${order.orderNumber}`, requestId,
        }], { session });
      }

      for (const productId of requested.keys()) {
        if (!order.items.some((item) => String(item.product) === productId)) throw new AppError(422, "PRODUCT_NOT_IN_ORDER", "A received product is not on this purchase order");
      }

      const complete = order.items.every((item) => item.receivedQuantity === item.quantity);
      order.status = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
      if (complete) order.receivedAt = new Date();
      await order.save({ session });
      storeId = String(order.store);
      await AuditLog.create([{
        actor: actor.userId, actorRole: actor.role, action: "PURCHASE_ORDER_RECEIVED", resource: "PurchaseOrder",
        resourceId: String(order._id), newValue: { status: order.status, receivedItems: input.items }, requestId,
      }], { session });
      response = { id: String(order._id), orderNumber: order.orderNumber, status: order.status, items: order.items };
      await IdempotencyKey.updateOne(
        { key, actor: actor.userId, status: "PROCESSING" },
        { $set: { status: "COMPLETED", response } },
        { session },
      );
    });
    realtime.publish({ room: `store:${storeId}`, name: "inventory.updated", payload: { purchaseOrderId, received: true } });
    return response;
  } catch (error) {
    await IdempotencyKey.deleteOne({ key, actor: actor.userId, status: "PROCESSING" });
    throw error;
  } finally {
    await session.endSession();
  }
}
