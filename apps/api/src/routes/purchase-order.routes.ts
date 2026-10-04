import { randomBytes } from "node:crypto";
import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Product } from "../models/product.js";
import { PurchaseOrder } from "../models/purchase-order.js";
import { Supplier } from "../models/supplier.js";
import { receivePurchaseOrder } from "../services/purchase-order.service.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const item = z.object({ productId: objectId, quantity: z.number().int().min(1).max(100_000), unitCost: z.number().int().nonnegative() });
const createSchema = z.object({
  supplierId: objectId, storeId: objectId, items: z.array(item).min(1).max(500),
  expectedDeliveryDate: z.coerce.date().refine((value) => value.getTime() > Date.now() - 24 * 60 * 60 * 1_000, "Delivery date cannot be in the past"),
});
const statusSchema = z.object({ status: z.enum(["SUBMITTED", "APPROVED", "ORDERED", "CANCELLED"]) });
const receiptSchema = z.object({ items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(100_000) })).min(1).max(500) });

const transitions: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["APPROVED", "CANCELLED"], APPROVED: ["ORDERED", "CANCELLED"], ORDERED: ["CANCELLED"],
};

router.use(authenticate, requirePermission("purchase.manage"));
router.get("/", async (req, res, next) => {
  try {
    const filter = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { store: { $in: req.auth!.storeIds } };
    const orders = await PurchaseOrder.find(filter).populate("supplier", "name").populate("items.product", "name sku").sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: orders });
  } catch (error) { next(error); }
});

router.post("/", validate(createSchema), async (req, res, next) => {
  try {
    assertStoreAccess(req.auth!, req.body.storeId);
    const supplierScope = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { storeIds: req.body.storeId };
    if (!(await Supplier.exists({ _id: req.body.supplierId, status: "ACTIVE", ...supplierScope }))) throw new AppError(422, "SUPPLIER_INVALID", "Supplier is unavailable");
    const ids = req.body.items.map((entry: z.infer<typeof item>) => entry.productId);
    if (new Set(ids).size !== ids.length) throw new AppError(422, "DUPLICATE_ORDER_ITEM", "Each product may appear only once");
    if (await Product.countDocuments({ _id: { $in: ids } }) !== ids.length) throw new AppError(422, "PRODUCT_INVALID", "One or more products do not exist");
    const items = req.body.items.map((entry: z.infer<typeof item>) => ({ product: entry.productId, quantity: entry.quantity, receivedQuantity: 0, unitCost: entry.unitCost, lineTotal: entry.unitCost * entry.quantity }));
    const total = items.reduce((sum: number, entry: { lineTotal: number }) => sum + entry.lineTotal, 0);
    if (!Number.isSafeInteger(total)) throw new AppError(422, "INVALID_MONEY", "Purchase order total is outside the supported range");
    const order = await PurchaseOrder.create({ orderNumber: `PO-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`, supplier: req.body.supplierId, store: req.body.storeId, items, total, expectedDeliveryDate: req.body.expectedDeliveryDate, createdBy: req.auth!.userId });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "PURCHASE_ORDER_CREATED", resource: "PurchaseOrder", resourceId: String(order._id), newValue: { orderNumber: order.orderNumber, total }, requestId: req.requestId });
    res.status(201).json({ success: true, data: order });
  } catch (error) { next(error); }
});

router.patch("/:id/status", validate(z.object({ id: objectId }), "params"), validate(statusSchema), async (req, res, next) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) throw new AppError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
    assertStoreAccess(req.auth!, String(order.store));
    if (!transitions[order.status]?.includes(req.body.status)) throw new AppError(409, "INVALID_STATUS_TRANSITION", `Cannot move ${order.status} to ${req.body.status}`);
    const previous = order.status;
    order.status = req.body.status;
    if (order.status === "APPROVED") { order.approvedBy = new Types.ObjectId(req.auth!.userId); order.approvedAt = new Date(); }
    if (order.status === "ORDERED") order.orderedAt = new Date();
    await order.save();
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: `PURCHASE_ORDER_${order.status}`, resource: "PurchaseOrder", resourceId: String(order._id), previousValue: { status: previous }, newValue: { status: order.status }, requestId: req.requestId });
    res.json({ success: true, data: order });
  } catch (error) { next(error); }
});

router.post("/:id/receive", validate(z.object({ id: objectId }), "params"), validate(receiptSchema), async (req, res, next) => {
  try {
    const key = req.header("idempotency-key")?.trim();
    if (!key || key.length < 16 || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A 16-128 character Idempotency-Key header is required");
    const order = await PurchaseOrder.findById(req.params.id).select("store").lean();
    if (!order) throw new AppError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
    assertStoreAccess(req.auth!, String(order.store));
    const result = await receivePurchaseOrder(String(req.params.id), req.body, key, req.auth!, req.requestId);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;
