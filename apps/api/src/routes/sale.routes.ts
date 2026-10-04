import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { PaymentAttempt } from "../models/payment-attempt.js";
import { Sale } from "../models/sale.js";
import { confirmPaymentAttempt, createPaymentAttempt, getPaymentAttempt } from "../services/payment.service.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const checkoutSchema = z.object({
  storeId: objectId,
  customerId: objectId.optional(),
  items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(999) })).min(1).max(100),
  promotionCode: z.string().trim().max(40).optional(),
  loyaltyPoints: z.number().int().min(0).default(0),
  paymentMethod: z.enum(["CASH", "CARD", "QR", "WALLET"]),
}).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, { message: "Combine duplicate products into one cart line", path: ["items"] });
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), storeId: objectId.optional(), status: z.enum(["PENDING", "PAID", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"]).optional() });

router.post("/checkout", authenticate, requirePermission("sale.create"), validate(checkoutSchema), async (req, res, next) => {
  try {
    assertStoreAccess(req.auth!, req.body.storeId);
    const key = req.header("idempotency-key")?.trim();
    if (!key || key.length < 16 || key.length > 128) {
      throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A 16–128 character Idempotency-Key header is required");
    }
    const result = await createPaymentAttempt(req.body, key, req.auth!);
    res.status(202).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/checkout/:attemptId", authenticate, requirePermission("sale.create"), validate(z.object({ attemptId: objectId }), "params"), async (req, res, next) => {
  try {
    res.json({ success: true, data: await getPaymentAttempt(String(req.params.attemptId), req.auth!) });
  } catch (error) { next(error); }
});

router.post("/checkout/:attemptId/confirm", authenticate, requirePermission("sale.create"), validate(z.object({ attemptId: objectId }), "params"), async (req, res, next) => {
  try {
    const attemptId = String(req.params.attemptId);
    const paymentAttempt = await PaymentAttempt.findOne({ _id: attemptId, actor: req.auth!.userId }).select("checkoutInput").lean();
    if (!paymentAttempt) throw new AppError(404, "PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found");
    const checkoutInput = paymentAttempt.checkoutInput as z.infer<typeof checkoutSchema>;
    assertStoreAccess(req.auth!, checkoutInput.storeId);
    const result = await confirmPaymentAttempt(attemptId, req.auth!, req.requestId);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/", authenticate, validate(listQuery, "query"), async (req, res, next) => {
  try {
    const { page, limit, storeId, status } = req.query as unknown as z.infer<typeof listQuery>;
    if (storeId) assertStoreAccess(req.auth!, storeId);
    const scope = req.auth!.role === "CUSTOMER"
      ? { customer: req.auth!.userId }
      : ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role)
        ? (storeId ? { store: storeId } : {})
        : { store: { $in: storeId ? [storeId] : req.auth!.storeIds } };
    const filter = { ...scope, ...(status ? { saleStatus: status } : {}) };
    const [items, total] = await Promise.all([Sale.find(filter).populate("store", "name code").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Sale.countDocuments(filter)]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get("/:saleNumber", authenticate, async (req, res, next) => {
  try {
    const sale = await Sale.findOne({ saleNumber: req.params.saleNumber }).lean();
    if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale not found");
    const isOwner = sale.customer && String(sale.customer) === req.auth!.userId;
    const elevated = ["CASHIER", "STORE_MANAGER", "ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    if (!isOwner && !elevated) throw new AppError(403, "PERMISSION_DENIED", "You cannot view this sale");
    if (elevated) assertStoreAccess(req.auth!, String(sale.store));
    res.json({ success: true, data: sale });
  } catch (error) { next(error); }
});

export default router;
