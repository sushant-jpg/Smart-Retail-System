import argon2 from "argon2";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { env } from "../config/env.js";
import { createOpaqueToken, hashToken } from "../lib/crypto.js";
import { canGrantRole, canManageUserRole, roles } from "../lib/permissions.js";
import { authenticate, requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AuditLog } from "../models/audit-log.js";
import { AuthToken } from "../models/auth-token.js";
import { SecurityEvent, securityEventTypes } from "../models/security-event.js";
import { Session } from "../models/session.js";
import { User } from "../models/user.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const pageQuery = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.use(authenticate);
router.get("/users", requireAnyPermission("user.manage", "employee.manage"), validate(pageQuery, "query"), async (req, res, next) => {
  try {
    const { search, page, limit } = req.query as unknown as z.infer<typeof pageQuery>;
    const scope = req.auth!.role === "STORE_MANAGER" ? { storeIds: { $in: req.auth!.storeIds }, role: { $in: ["CASHIER", "STORE_STAFF"] } } : {};
    const match = search ? new RegExp(escapeRegex(search), "i") : undefined;
    const filter = { ...scope, ...(match ? { $or: [{ email: match }, { firstName: match }, { lastName: match }] } : {}) };
    const [items, total] = await Promise.all([User.find(filter).select("-loginHistory").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});
router.post("/users/invite", requireAnyPermission("user.manage", "employee.manage"), validate(z.object({
  email: z.string().email().max(254), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
  role: z.enum(roles).refine((role) => !["CUSTOMER", "SUPER_ADMIN"].includes(role), "This role cannot be invited here"), storeIds: z.array(objectId).min(1).max(50),
})), async (req, res, next) => {
  try {
    if (!canGrantRole(req.auth!.role, req.body.role)) {
      return res.status(403).json({ success: false, error: { code: "PERMISSION_DENIED", message: "Only a super administrator may grant administrator access", requestId: req.requestId } });
    }
    if (req.auth!.role === "STORE_MANAGER" && (req.body.role === "ADMIN" || req.body.storeIds.some((id: string) => !req.auth!.storeIds.includes(id)))) {
      return res.status(403).json({ success: false, error: { code: "PERMISSION_DENIED", message: "Managers may invite store employees only to their own stores", requestId: req.requestId } });
    }
    const temporarySecret = createOpaqueToken();
    const user = await User.create({ ...req.body, email: req.body.email.toLowerCase(), passwordHash: await argon2.hash(temporarySecret), status: "INVITED" });
    const setupToken = createOpaqueToken();
    await AuthToken.create({ user: user._id, tokenHash: hashToken(setupToken), type: "PASSWORD_RESET", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "EMPLOYEE_CREATED", resource: "User", resourceId: String(user._id), newValue: { email: user.email, role: user.role, storeIds: user.storeIds }, requestId: req.requestId });
    res.status(201).json({ success: true, data: { id: user._id, email: user.email, status: user.status, ...(env.NODE_ENV === "development" ? { demoSetupToken: setupToken } : {}) } });
  } catch (error) { next(error); }
});
router.patch("/users/:id", requirePermission("user.manage"), validate(z.object({ id: objectId }), "params"), validate(z.object({ role: z.enum(roles).optional(), storeIds: z.array(objectId).max(50).optional(), status: z.enum(["ACTIVE", "SUSPENDED", "INVITED"]).optional() })), async (req, res, next) => {
  try {
    const previous = await User.findById(req.params.id).lean();
    if (!previous) return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found", requestId: req.requestId } });
    if (!canManageUserRole(req.auth!.role, previous.role, req.body.role)) {
      return res.status(403).json({ success: false, error: { code: "PERMISSION_DENIED", message: "Only a super administrator may grant or modify administrator access", requestId: req.requestId } });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    if (req.body.status === "SUSPENDED") await Session.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "USER_UPDATED", resource: "User", resourceId: String(user._id), previousValue: previous ? { role: previous.role, storeIds: previous.storeIds, status: previous.status } : undefined, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: user });
  } catch (error) { next(error); }
});
router.get("/audit", requirePermission("audit.read"), validate(pageQuery, "query"), async (req, res, next) => {
  try {
    const { search, page, limit } = req.query as unknown as z.infer<typeof pageQuery>;
    const match = search ? new RegExp(escapeRegex(search), "i") : undefined;
    const filter = match ? { $or: [{ action: match }, { resource: match }, { resourceId: search }] } : {};
    const [items, total] = await Promise.all([AuditLog.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});
router.get("/security", requirePermission("security.manage"), validate(pageQuery.extend({ type: z.enum(securityEventTypes).optional() }), "query"), async (req, res, next) => {
  try {
    const { page, limit, type } = req.query as unknown as z.infer<typeof pageQuery> & { type?: string };
    const filter = type ? { type } : {};
    const [items, total] = await Promise.all([SecurityEvent.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), SecurityEvent.countDocuments(filter)]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

export default router;
