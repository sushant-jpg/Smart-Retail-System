import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Refund } from "../models/refund.js";
import { Sale } from "../models/sale.js";
import { completeRefund } from "../services/refund.service.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const requestSchema = z.object({
  saleId: objectId, reason: z.string().trim().min(5).max(500),
  items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(999), restock: z.boolean().default(true) })).min(1).max(100),
}).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, { message: "Each product may appear only once", path: ["items"] });

router.use(authenticate);
router.get("/", requirePermission("sale.refund"), async (req, res, next) => {
  try {
    const filter = req.auth!.role === "CUSTOMER" ? { customer: req.auth!.userId } : ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { store: { $in: req.auth!.storeIds } };
    res.json({ success: true, data: await Refund.find(filter).select("-requestIdempotencyKey -requestHash").populate("sale", "saleNumber total").sort({ createdAt: -1 }).lean() });
  } catch (error) { next(error); }
});

router.post("/", requirePermission("sale.refund"), validate(requestSchema), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const requestKey = req.header("idempotency-key")?.trim();
    if (!requestKey || requestKey.length < 16 || requestKey.length > 128) {
      throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A 16-128 character Idempotency-Key header is required");
    }
    const requestHash = createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
    const existing = await Refund.findOne({ requestIdempotencyKey: requestKey }).lean();
    if (existing) {
      if (String(existing.requestedBy) !== req.auth!.userId || existing.requestHash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different refund request");
      }
      delete existing.requestIdempotencyKey;
      delete existing.requestHash;
      return res.json({ success: true, data: existing });
    }
    let refundId: string | undefined;
    await session.withTransaction(async () => {
      const sale = await Sale.findById(req.body.saleId).session(session);
      if (!sale || !["PAID", "PARTIALLY_REFUNDED"].includes(sale.saleStatus)) throw new AppError(404, "SALE_NOT_REFUNDABLE", "Original transaction was not found or cannot be refunded");
      if (req.auth!.role === "CUSTOMER" && String(sale.customer) !== req.auth!.userId) throw new AppError(403, "PERMISSION_DENIED", "You cannot refund this sale");
      assertStoreAccess(req.auth!, String(sale.store));

      const lock = await Sale.updateOne({ _id: sale._id }, { $inc: { __v: 1 } }, { session });
      if (!lock.matchedCount) throw new AppError(409, "SALE_CHANGED", "The sale changed while the refund was being requested");
      const prior = await Refund.find({ sale: sale._id, status: { $nin: ["REJECTED"] } }).session(session).lean();
      const items = req.body.items.map((requested: z.infer<typeof requestSchema>["items"][number]) => {
        const purchased = sale.items.find((line) => String(line.product) === requested.productId);
        if (!purchased) throw new AppError(422, "PRODUCT_NOT_IN_SALE", "A requested product is not in the original transaction");
        const alreadyRequested = prior.reduce((sum, existingRefund) => sum + (existingRefund.items.find((line) => String(line.product) === requested.productId)?.quantity ?? 0), 0);
        if (requested.quantity + alreadyRequested > purchased.quantity) throw new AppError(422, "REFUND_QUANTITY_EXCEEDED", "Refund quantity exceeds the remaining purchased quantity");
        const previouslyRefundedAmount = prior.reduce((sum, existingRefund) => sum + (existingRefund.items.find((line) => String(line.product) === requested.productId)?.amount ?? 0), 0);
        const amount = Math.min(
          purchased.total - previouslyRefundedAmount,
          Math.floor(purchased.total * (alreadyRequested + requested.quantity) / purchased.quantity)
            - Math.floor(purchased.total * alreadyRequested / purchased.quantity),
        );
        return { product: requested.productId, quantity: requested.quantity, amount, restock: requested.restock };
      });
      const amount = items.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);
      const previousAmount = prior.reduce((sum, existingRefund) => sum + existingRefund.amount, 0);
      if (amount + previousAmount > sale.total) throw new AppError(422, "REFUND_AMOUNT_EXCEEDED", "Refund amount exceeds the paid total");
      const [createdRefund] = await Refund.create([{
        refundNumber: `RF-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`,
        sale: sale._id, store: sale.store, customer: sale.customer, items, amount,
        reason: req.body.reason, requestedBy: req.auth!.userId,
        requestIdempotencyKey: requestKey, requestHash,
      }], { session });
      if (createdRefund) refundId = String(createdRefund._id);
    });
    if (!refundId) throw new AppError(500, "REFUND_CREATE_FAILED", "Refund request could not be created");
    const response = await Refund.findById(refundId).select("-requestIdempotencyKey -requestHash").lean();
    if (!response) throw new AppError(500, "REFUND_CREATE_FAILED", "Refund request could not be retrieved");
    res.status(201).json({ success: true, data: response });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const duplicate = await Refund.findOne({ requestIdempotencyKey: req.header("idempotency-key")?.trim() }).lean();
      if (duplicate && String(duplicate.requestedBy) === req.auth!.userId && duplicate.requestHash === createHash("sha256").update(JSON.stringify(req.body)).digest("hex")) {
        delete duplicate.requestIdempotencyKey;
        delete duplicate.requestHash;
        res.json({ success: true, data: duplicate });
        return;
      }
      next(new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different refund request"));
      return;
    }
    next(error);
  } finally { await session.endSession(); }
});

router.patch("/:id/review", requirePermission("refund.approve"), validate(z.object({ id: objectId }), "params"), validate(z.object({ decision: z.enum(["APPROVED", "REJECTED"]) })), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let reviewed: InstanceType<typeof Refund> | null = null;
    await session.withTransaction(async () => {
      const candidate = await Refund.findById(req.params.id).select("store").session(session);
      if (!candidate) throw new AppError(404, "REFUND_NOT_REVIEWABLE", "Refund was not found or has already been reviewed");
      assertStoreAccess(req.auth!, String(candidate.store));
      reviewed = await Refund.findOneAndUpdate(
        { _id: candidate._id, status: "REQUESTED" },
        { $set: { status: req.body.decision, reviewedBy: req.auth!.userId, reviewedAt: new Date() } },
        { new: true, session },
      );
      if (!reviewed) throw new AppError(409, "REFUND_NOT_REVIEWABLE", "Refund was already reviewed");
      await AuditLog.create([{
        actor: req.auth!.userId, actorRole: req.auth!.role, action: `REFUND_${reviewed.status}`,
        resource: "Refund", resourceId: String(reviewed._id),
        newValue: { status: reviewed.status }, requestId: req.requestId,
      }], { session });
    });
    res.json({ success: true, data: reviewed });
  } catch (error) { next(error); } finally { await session.endSession(); }
});

router.post("/:id/complete", requirePermission("refund.approve"), validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const key = req.header("idempotency-key")?.trim();
    if (!key || key.length < 16 || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A 16-128 character Idempotency-Key header is required");
    const refund = await Refund.findById(req.params.id).select("store").lean();
    if (!refund) throw new AppError(404, "REFUND_NOT_FOUND", "Refund not found");
    assertStoreAccess(req.auth!, String(refund.store));
    res.json({ success: true, data: await completeRefund(String(req.params.id), key, req.auth!, req.requestId) });
  } catch (error) { next(error); }
});

export default router;
