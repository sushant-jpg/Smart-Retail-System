import { Types } from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/loyalty.js";
import { expireCustomerLoyaltyPoints } from "../services/loyalty-expiry.service.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");

router.use(authenticate);
router.get("/me", async (req, res, next) => {
  try {
    await expireCustomerLoyaltyPoints(req.auth!.userId);
    const account = await LoyaltyAccount.findOne({ customer: req.auth!.userId }).lean();
    const history = account ? await LoyaltyTransaction.find({ account: account._id }).sort({ createdAt: -1 }).limit(100).lean() : [];
    res.json({ success: true, data: { account: account ?? { customer: req.auth!.userId, pointsBalance: 0, lifetimePoints: 0, tier: "BRONZE" }, history, benefits: { BRONZE: "Standard points", SILVER: "1.25x points", GOLD: "1.5x points", PLATINUM: "2x points" } } });
  } catch (error) { next(error); }
});

router.get("/:customerId", requirePermission("loyalty.manage"), validate(z.object({ customerId: objectId }), "params"), async (req, res, next) => {
  try {
    await expireCustomerLoyaltyPoints(String(req.params.customerId));
    const account = await LoyaltyAccount.findOne({ customer: req.params.customerId }).lean();
    if (!account) throw new AppError(404, "LOYALTY_ACCOUNT_NOT_FOUND", "Loyalty account not found");
    const history = await LoyaltyTransaction.find({ account: account._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: { account, history } });
  } catch (error) { next(error); }
});

router.post("/:customerId/adjust", requirePermission("loyalty.manage"), validate(z.object({ customerId: objectId }), "params"), validate(z.object({ points: z.number().int().refine((value) => value !== 0), reason: z.string().trim().min(5).max(300) })), async (req, res, next) => {
  try {
    const account = await LoyaltyAccount.findOneAndUpdate(
      { customer: req.params.customerId, ...(req.body.points < 0 ? { pointsBalance: { $gte: Math.abs(req.body.points) } } : {}) },
      { $inc: { pointsBalance: req.body.points, ...(req.body.points > 0 ? { lifetimePoints: req.body.points } : {}) } },
      { new: true, upsert: req.body.points > 0, setDefaultsOnInsert: true },
    );
    if (!account) throw new AppError(409, "LOYALTY_POINTS_INSUFFICIENT", "Adjustment would make the points balance negative");
    const referenceId = new Types.ObjectId();
    await Promise.all([
      LoyaltyTransaction.create({ account: account._id, customer: req.params.customerId, type: req.body.points < 0 ? "EXPIRE" : "ADJUST", points: req.body.points, balanceAfter: account.pointsBalance, referenceType: "ManualAdjustment", referenceId, note: req.body.reason }),
      AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "LOYALTY_ADJUSTED", resource: "LoyaltyAccount", resourceId: String(account._id), newValue: { points: req.body.points, reason: req.body.reason }, requestId: req.requestId }),
    ]);
    res.json({ success: true, data: account });
  } catch (error) { next(error); }
});

export default router;
