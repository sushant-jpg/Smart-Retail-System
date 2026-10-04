import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { Promotion, promotionTypes } from "../models/promotion.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const fields = z.object({
  title: z.string().trim().min(3).max(140), code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  type: z.enum(promotionTypes), discount: z.number().int().nonnegative(), buyQuantity: z.number().int().min(1).max(100).optional(), getQuantity: z.number().int().min(1).max(100).optional(),
  minimumSpend: z.number().int().nonnegative().default(0), applicableProducts: z.array(objectId).max(500).default([]), applicableCategories: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  startDate: z.coerce.date(), endDate: z.coerce.date(), usageLimit: z.number().int().min(1).optional(), perUserLimit: z.number().int().min(1).max(100).default(1),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]).default("DRAFT"),
});
const validatePromotion = (value: z.infer<typeof fields>, context: z.RefinementCtx) => {
  if (value.endDate <= value.startDate) context.addIssue({ code: "custom", message: "End date must be after start date", path: ["endDate"] });
  if (["PERCENTAGE_DISCOUNT", "CATEGORY_DISCOUNT", "LOYALTY_DISCOUNT"].includes(value.type) && value.discount > 10_000) context.addIssue({ code: "custom", message: "Percentage cannot exceed 100%", path: ["discount"] });
  if (value.type === "BUY_X_GET_Y" && (!value.buyQuantity || !value.getQuantity)) context.addIssue({ code: "custom", message: "Buy and get quantities are required", path: ["buyQuantity"] });
  if (value.type === "CATEGORY_DISCOUNT" && !value.applicableCategories.length) context.addIssue({ code: "custom", message: "Select at least one category", path: ["applicableCategories"] });
};
const input = fields.superRefine(validatePromotion);

router.get("/active", async (_req, res, next) => {
  try {
    const now = new Date();
    res.json({ success: true, data: await Promotion.find({ status: "ACTIVE", startDate: { $lte: now }, endDate: { $gte: now } }).select("title code type discount minimumSpend endDate").lean() });
  } catch (error) { next(error); }
});
router.use(authenticate, requirePermission("promotion.manage"));
router.get("/", async (_req, res, next) => {
  try { res.json({ success: true, data: await Promotion.find().sort({ createdAt: -1 }).lean() }); } catch (error) { next(error); }
});
router.post("/", validate(input), async (req, res, next) => {
  try {
    const promotion = await Promotion.create(req.body);
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "PROMOTION_CREATED", resource: "Promotion", resourceId: String(promotion._id), newValue: req.body, requestId: req.requestId });
    res.status(201).json({ success: true, data: promotion });
  } catch (error) { next(error); }
});
router.patch("/:id", validate(z.object({ id: objectId }), "params"), validate(fields.partial()), async (req, res, next) => {
  try {
    const previous = await Promotion.findById(req.params.id).lean();
    if (!previous) throw new AppError(404, "PROMOTION_NOT_FOUND", "Promotion not found");
    const promotion = await Promotion.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "PROMOTION_UPDATED", resource: "Promotion", resourceId: req.params.id, previousValue: previous, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: promotion });
  } catch (error) { next(error); }
});

export default router;
