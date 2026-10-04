import { createHash } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { InventoryMovement } from "../models/inventory-movement.js";
import { Inventory } from "../models/inventory.js";
import { publicProductImages } from "../lib/product-images.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { Product } from "../models/product.js";
import { realtime } from "../lib/realtime.js";
import { notifyLowStock } from "../services/notification.service.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const listQuery = z.object({ storeId: objectId, lowStock: z.enum(["true", "false"]).optional() });
const adjustment = z.object({
  storeId: objectId,
  productId: objectId,
  quantityDelta: z.number().int().refine((value) => value !== 0, "Quantity delta cannot be zero"),
  reason: z.string().trim().min(4).max(300),
});
const movementInput = z.object({
  storeId: objectId, productId: objectId, type: z.enum(["PURCHASE", "RETURN", "ADJUSTMENT", "DAMAGED", "EXPIRED"]),
  quantity: z.number().int().min(1).max(1_000_000), direction: z.enum(["IN", "OUT"]).default("IN"), reason: z.string().trim().min(4).max(300),
});
const transferInput = z.object({ fromStoreId: objectId, toStoreId: objectId, productId: objectId, quantity: z.number().int().min(1).max(1_000_000), reason: z.string().trim().min(4).max(300) })
  .refine((value) => value.fromStoreId !== value.toStoreId, { message: "Stores must be different", path: ["toStoreId"] });

router.get("/", authenticate, requirePermission("inventory.read"), validate(listQuery, "query"), async (req, res, next) => {
  try {
    const { storeId, lowStock } = req.query as unknown as z.infer<typeof listQuery>;
    assertStoreAccess(req.auth!, storeId);
    const items = await Inventory.aggregate([
      { $match: { store: new Types.ObjectId(storeId) } },
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "productDetails" } },
      { $unwind: "$productDetails" },
      { $match: lowStock === "true" ? { $expr: { $lte: ["$availableQuantity", "$reorderLevel"] } } : {} },
      { $sort: { availableQuantity: 1 } },
      { $project: {
        _id: 1, store: 1, product: 1, availableQuantity: 1, reservedQuantity: 1, damagedQuantity: 1,
        reorderLevel: 1, reorderQuantity: 1, updatedAt: 1, createdAt: 1,
        productDetails: { _id: "$productDetails._id", name: "$productDetails.name", sku: "$productDetails.sku", category: "$productDetails.category", sellingPrice: "$productDetails.sellingPrice", images: "$productDetails.images" },
      } },
    ]);
    res.json({ success: true, data: items.map((item) => ({ ...item, productDetails: { ...item.productDetails, images: publicProductImages(item.productDetails.images) } })) });
  } catch (error) { next(error); }
});

router.get("/movements", authenticate, requirePermission("inventory.read"), validate(z.object({ storeId: objectId, productId: objectId.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), "query"), async (req, res, next) => {
  try {
    const { storeId, productId, limit } = req.query as unknown as { storeId: string; productId?: string; limit: number };
    assertStoreAccess(req.auth!, storeId);
    const movements = await InventoryMovement.find({ store: storeId, ...(productId ? { product: productId } : {}) }).populate("product", "name sku").sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, data: movements });
  } catch (error) { next(error); }
});

router.post("/adjustments", authenticate, requirePermission("inventory.adjust"), validate(adjustment), async (req, res, next) => {
  const { storeId, productId, quantityDelta, reason } = req.body as z.infer<typeof adjustment>;
  const session = await mongoose.startSession();
  let inventoryResponse: unknown;
  let lowStock: { availableQuantity: number; reorderLevel: number } | undefined;
  try {
    assertStoreAccess(req.auth!, storeId);
    if (!(await Product.exists({ _id: productId }))) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    await session.withTransaction(async () => {
      const filter = {
        store: storeId,
        product: productId,
        ...(quantityDelta < 0 ? { availableQuantity: { $gte: Math.abs(quantityDelta) } } : {}),
      };
      const inventory = await Inventory.findOneAndUpdate(filter, { $inc: { availableQuantity: quantityDelta } }, { new: true, upsert: quantityDelta > 0, session });
      if (!inventory) throw new AppError(409, "INVENTORY_INSUFFICIENT", "Adjustment would make inventory negative");

      const movementId = new Types.ObjectId();
      await InventoryMovement.create([{
        store: storeId, product: productId, type: "ADJUSTMENT", quantityDelta,
        balanceAfter: inventory.availableQuantity, referenceType: "Adjustment", referenceId: movementId,
        actor: req.auth!.userId, reason, requestId: req.requestId,
      }], { session });
      await AuditLog.create([{
        actor: req.auth!.userId, actorRole: req.auth!.role, action: "INVENTORY_ADJUSTED",
        resource: "Inventory", resourceId: String(inventory._id),
        newValue: { quantityDelta, balanceAfter: inventory.availableQuantity, reason }, requestId: req.requestId,
      }], { session });
      inventoryResponse = inventory.toObject();
      lowStock = { availableQuantity: inventory.availableQuantity, reorderLevel: inventory.reorderLevel };
    });
    const product = await Product.findById(productId).select("name").lean();
    if (product && lowStock && lowStock.availableQuantity <= lowStock.reorderLevel) await notifyLowStock({ storeId, productId, productName: product.name, ...lowStock });
    realtime.publish({ room: `store:${storeId}`, name: "inventory.updated", payload: { productId, availableQuantity: lowStock?.availableQuantity } });
    res.json({ success: true, data: inventoryResponse });
  } catch (error) { next(error); } finally { await session.endSession(); }
});

router.post("/movements", authenticate, requirePermission("inventory.adjust"), validate(movementInput), async (req, res, next) => {
  try {
    const { storeId, productId, type, quantity, direction, reason } = req.body as z.infer<typeof movementInput>;
    assertStoreAccess(req.auth!, storeId);
    if (!(await Product.exists({ _id: productId }))) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    const decreases = type === "DAMAGED" || type === "EXPIRED" || direction === "OUT";
    const delta = decreases ? -quantity : quantity;
    const update = type === "DAMAGED" ? { $inc: { availableQuantity: -quantity, damagedQuantity: quantity } } : { $inc: { availableQuantity: delta } };
    const session = await mongoose.startSession();
    let inventoryResponse: unknown;
    let lowStock: { availableQuantity: number; reorderLevel: number } | undefined;
    try {
      await session.withTransaction(async () => {
        const inventory = await Inventory.findOneAndUpdate(
          { store: storeId, product: productId, ...(decreases ? { availableQuantity: { $gte: quantity } } : {}) }, update,
          { new: true, upsert: !decreases, session },
        );
        if (!inventory) throw new AppError(409, "INVENTORY_INSUFFICIENT", "Movement would make inventory negative");
        const referenceId = new Types.ObjectId();
        await InventoryMovement.create([{
          store: storeId, product: productId, type, quantityDelta: delta, balanceAfter: inventory.availableQuantity,
          referenceType: "ManualMovement", referenceId, actor: req.auth!.userId, reason, requestId: req.requestId,
        }], { session });
        await AuditLog.create([{
          actor: req.auth!.userId, actorRole: req.auth!.role, action: "INVENTORY_MOVED",
          resource: "Inventory", resourceId: String(inventory._id),
          newValue: { type, quantityDelta: delta, balanceAfter: inventory.availableQuantity, reason }, requestId: req.requestId,
        }], { session });
        inventoryResponse = inventory.toObject();
        lowStock = { availableQuantity: inventory.availableQuantity, reorderLevel: inventory.reorderLevel };
      });
    } finally { await session.endSession(); }
    const product = await Product.findById(productId).select("name").lean();
    if (product && lowStock && lowStock.availableQuantity <= lowStock.reorderLevel) await notifyLowStock({ storeId, productId, productName: product.name, ...lowStock });
    realtime.publish({ room: `store:${storeId}`, name: "inventory.updated", payload: { productId, availableQuantity: lowStock?.availableQuantity, type } });
    res.status(201).json({ success: true, data: inventoryResponse });
  } catch (error) { next(error); }
});

router.post("/transfers", authenticate, requirePermission("inventory.adjust"), validate(transferInput), async (req, res, next) => {
  const { fromStoreId, toStoreId, productId, quantity, reason } = req.body as z.infer<typeof transferInput>;
  try {
    assertStoreAccess(req.auth!, fromStoreId); assertStoreAccess(req.auth!, toStoreId);
    const key = req.header("idempotency-key")?.trim();
    if (!key || key.length < 16 || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A 16-128 character Idempotency-Key header is required");
    const requestHash = createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
    const existing = await IdempotencyKey.findOne({ key, actor: req.auth!.userId }).lean();
    if (existing) {
      if (existing.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for another request");
      if (existing.status === "COMPLETED") return res.json({ success: true, data: existing.response });
      throw new AppError(409, "TRANSFER_IN_PROGRESS", "Transfer is already in progress");
    }
    await IdempotencyKey.create({ key, actor: req.auth!.userId, requestHash, status: "PROCESSING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) });
    const session = await mongoose.startSession();
    let response: Record<string, unknown> = {};
    try {
      await session.withTransaction(async () => {
        const source = await Inventory.findOneAndUpdate({ store: fromStoreId, product: productId, availableQuantity: { $gte: quantity } }, { $inc: { availableQuantity: -quantity } }, { new: true, session });
        if (!source) throw new AppError(409, "INVENTORY_INSUFFICIENT", "Source store has insufficient inventory");
        const destination = await Inventory.findOneAndUpdate({ store: toStoreId, product: productId }, { $inc: { availableQuantity: quantity }, $setOnInsert: { reservedQuantity: 0, damagedQuantity: 0, reorderLevel: 10, reorderQuantity: 25 } }, { new: true, upsert: true, session });
        const referenceId = new Types.ObjectId();
        await InventoryMovement.create([
          { store: fromStoreId, product: productId, type: "TRANSFER", quantityDelta: -quantity, balanceAfter: source.availableQuantity, referenceType: "StockTransfer", referenceId, actor: req.auth!.userId, reason, requestId: req.requestId },
          { store: toStoreId, product: productId, type: "TRANSFER", quantityDelta: quantity, balanceAfter: destination.availableQuantity, referenceType: "StockTransfer", referenceId, actor: req.auth!.userId, reason, requestId: req.requestId },
        ], { session });
        response = { transferId: String(referenceId), productId, quantity, fromStoreId, toStoreId, sourceBalance: source.availableQuantity, destinationBalance: destination.availableQuantity };
      });
      await IdempotencyKey.updateOne({ key, actor: req.auth!.userId }, { $set: { status: "COMPLETED", response } });
    } catch (error) {
      await IdempotencyKey.deleteOne({ key, actor: req.auth!.userId, status: "PROCESSING" });
      throw error;
    } finally { await session.endSession(); }
    realtime.publish({ room: `store:${fromStoreId}`, name: "inventory.updated", payload: response });
    realtime.publish({ room: `store:${toStoreId}`, name: "inventory.updated", payload: response });
    res.status(201).json({ success: true, data: response });
  } catch (error) { next(error); }
});

export default router;
