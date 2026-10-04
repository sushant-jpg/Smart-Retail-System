import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Supplier } from "../models/supplier.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const input = z.object({
  name: z.string().trim().min(2).max(140), contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30), email: z.string().email().max(254),
  address: z.string().trim().min(5).max(500), taxNumber: z.string().trim().min(3).max(80),
  status: z.enum(["ACTIVE", "INACTIVE", "REVIEW"]).default("ACTIVE"),
  storeIds: z.array(objectId).max(50).optional(),
  productsSupplied: z.array(objectId).max(500).default([]), leadTimeDays: z.number().int().min(0).max(365).default(3),
});

router.use(authenticate, requirePermission("supplier.manage"));
const canManageEveryStore = (role: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const scopeFor = (auth: { role: string; storeIds: string[] }) =>
  canManageEveryStore(auth.role) ? {} : { storeIds: { $in: auth.storeIds } };

router.get("/", async (req, res, next) => {
  try { res.json({ success: true, data: await Supplier.find(scopeFor(req.auth!)).sort({ name: 1 }).lean() }); } catch (error) { next(error); }
});
router.get("/:id", validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.id, ...scopeFor(req.auth!) }).populate("productsSupplied", "name sku status").lean();
    if (!supplier) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    res.json({ success: true, data: supplier });
  } catch (error) { next(error); }
});
router.post("/", validate(input), async (req, res, next) => {
  try {
    const storeIds = canManageEveryStore(req.auth!.role) ? req.body.storeIds ?? [] : req.auth!.storeIds;
    if (req.body.storeIds && !canManageEveryStore(req.auth!.role) && req.body.storeIds.some((storeId: string) => !req.auth!.storeIds.includes(storeId))) {
      throw new AppError(403, "STORE_ACCESS_DENIED", "Suppliers can only be assigned to your stores");
    }
    const supplier = await Supplier.create({ ...req.body, storeIds });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "SUPPLIER_CREATED", resource: "Supplier", resourceId: String(supplier._id), newValue: req.body, requestId: req.requestId });
    res.status(201).json({ success: true, data: supplier });
  } catch (error) { next(error); }
});
router.patch("/:id", validate(z.object({ id: objectId }), "params"), validate(input.partial()), async (req, res, next) => {
  try {
    const previous = await Supplier.findOne({ _id: req.params.id, ...scopeFor(req.auth!) }).lean();
    if (!previous) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    if (req.body.storeIds && !canManageEveryStore(req.auth!.role) && req.body.storeIds.some((storeId: string) => !req.auth!.storeIds.includes(storeId))) {
      throw new AppError(403, "STORE_ACCESS_DENIED", "Suppliers can only be assigned to your stores");
    }
    const update = { ...req.body, ...(req.body.storeIds ? { storeIds: req.body.storeIds } : {}) };
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "SUPPLIER_UPDATED", resource: "Supplier", resourceId: req.params.id, previousValue: previous, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: supplier });
  } catch (error) { next(error); }
});

export default router;
