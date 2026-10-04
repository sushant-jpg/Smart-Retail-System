import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Category } from "../models/category.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const input = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(1_000).default(""),
  image: z.string().url().optional(),
  parent: objectId.nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

router.get("/", async (_req, res, next) => {
  try { res.json({ success: true, data: await Category.find().sort({ parent: 1, name: 1 }).lean() }); } catch (error) { next(error); }
});

router.post("/", authenticate, requirePermission("category.manage"), validate(input), async (req, res, next) => {
  try {
    if (req.body.parent && !(await Category.exists({ _id: req.body.parent }))) throw new AppError(422, "PARENT_CATEGORY_INVALID", "Parent category does not exist");
    const category = await Category.create(req.body);
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "CATEGORY_CREATED", resource: "Category", resourceId: String(category._id), newValue: req.body, requestId: req.requestId });
    res.status(201).json({ success: true, data: category });
  } catch (error) { next(error); }
});

router.patch("/:id", authenticate, requirePermission("category.manage"), validate(z.object({ id: objectId }), "params"), validate(input.partial()), async (req, res, next) => {
  try {
    if (req.body.parent === req.params.id) throw new AppError(422, "CATEGORY_CYCLE", "A category cannot be its own parent");
    const previous = await Category.findById(req.params.id).lean();
    if (!previous) throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
    const category = await Category.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "CATEGORY_UPDATED", resource: "Category", resourceId: req.params.id, previousValue: previous, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: category });
  } catch (error) { next(error); }
});

export default router;
