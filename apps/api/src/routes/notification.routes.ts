import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Notification } from "../models/notification.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const query = z.object({ unreadOnly: z.enum(["true", "false"]).default("false"), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });

router.use(authenticate, requirePermission("notification.read"));
router.get("/", validate(query, "query"), async (req, res, next) => {
  try {
    const { unreadOnly, page, limit } = req.query as unknown as z.infer<typeof query>;
    const filter = { recipient: req.auth!.userId, ...(unreadOnly === "true" ? { readAt: { $exists: false } } : {}) };
    const [items, total, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter), Notification.countDocuments({ recipient: req.auth!.userId, readAt: { $exists: false } }),
    ]);
    res.json({ success: true, data: { items, total, unread, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});
router.patch("/read-all", async (req, res, next) => {
  try {
    const result = await Notification.updateMany({ recipient: req.auth!.userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (error) { next(error); }
});
router.patch("/:id/read", validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.auth!.userId }, { $set: { readAt: new Date() } }, { new: true });
    if (!notification) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    res.json({ success: true, data: notification });
  } catch (error) { next(error); }
});

export default router;
