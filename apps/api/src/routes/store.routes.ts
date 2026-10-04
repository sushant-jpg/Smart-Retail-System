import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Store } from "../models/store.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const input = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()),
  address: z.string().trim().min(5).max(500),
  manager: objectId.optional(),
  openingHours: z.record(z.string().max(40)).default({}),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

router.get("/public", async (_req, res, next) => {
  try {
    const stores = await Store.find({ status: "ACTIVE" }).select("name code").sort({ name: 1 }).lean();
    res.json({ success: true, data: stores });
  } catch (error) { next(error); }
});

router.use(authenticate);
router.get("/", async (req, res, next) => {
  try {
    const filter = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { _id: { $in: req.auth!.storeIds } };
    res.json({ success: true, data: await Store.find(filter).sort({ name: 1 }).lean() });
  } catch (error) { next(error); }
});

router.post("/", requirePermission("store.manage"), validate(input), async (req, res, next) => {
  try {
    const store = await Store.create(req.body);
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "STORE_CREATED", resource: "Store", resourceId: String(store._id), newValue: req.body, requestId: req.requestId });
    res.status(201).json({ success: true, data: store });
  } catch (error) { next(error); }
});

router.patch("/:id", requirePermission("store.manage"), validate(z.object({ id: objectId }), "params"), validate(input.partial()), async (req, res, next) => {
  try {
    const previous = await Store.findById(req.params.id).lean();
    if (!previous) throw new AppError(404, "STORE_NOT_FOUND", "Store not found");
    const store = await Store.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "STORE_UPDATED", resource: "Store", resourceId: req.params.id, previousValue: previous, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: store });
  } catch (error) { next(error); }
});

export default router;
