import { Router, type Request } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Session } from "../models/session.js";
import { User } from "../models/user.js";
import {
  changePassword, login, register, requestPasswordReset, resendVerification,
  resetPassword, rotateRefreshToken, verifyEmail,
} from "../services/auth.service.js";
import { hashToken } from "../lib/crypto.js";
import { redisRateLimit } from "../middleware/redis-rate-limit.js";

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(10).max(128) });
const registerSchema = credentials.extend({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60) });
const sessionIdParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid session ID") });
const emailSchema = z.object({ email: z.string().email().max(254) });
const tokenSchema = z.object({ token: z.string().min(32).max(256) });
const resetSchema = tokenSchema.extend({ password: z.string().min(10).max(128) });
const changeSchema = z.object({ currentPassword: z.string().min(10).max(128), newPassword: z.string().min(10).max(128) })
  .refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, { message: "New password must be different", path: ["newPassword"] });
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/v1/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
const metadata = (req: Request) => ({
  ip: req.ip || "unknown",
  userAgent: req.get("user-agent")?.slice(0, 500) || "unknown",
  device: req.get("sec-ch-ua-platform")?.replaceAll('"', "") || "Unknown device",
});

export function createAuthRouter(redis: Redis) {
const router = Router();
const emailIdentifier = (body: unknown) => typeof body === "object" && body && "email" in body && typeof body.email === "string" ? body.email : undefined;
const tokenIdentifier = (body: unknown) => typeof body === "object" && body && "token" in body && typeof body.token === "string" ? body.token : undefined;
const loginLimiter = redisRateLimit(redis, { scope: "login", limit: 10, windowMs: 15 * 60 * 1000, identifier: emailIdentifier });
const recoveryLimiter = redisRateLimit(redis, { scope: "account-recovery", limit: 5, windowMs: 60 * 60 * 1000, identifier: emailIdentifier });
const resetLimiter = redisRateLimit(redis, { scope: "password-reset", limit: 10, windowMs: 60 * 60 * 1000, identifier: tokenIdentifier });

router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    res.status(201).json({ success: true, data: { user: result.user, verificationRequired: true } });
  } catch (error) { next(error); }
});

router.post("/verify-email", validate(tokenSchema), async (req, res, next) => {
  try { res.json({ success: true, data: await verifyEmail(req.body.token) }); } catch (error) { next(error); }
});

router.post("/resend-verification", recoveryLimiter, validate(emailSchema), async (req, res, next) => {
  try {
    await resendVerification(req.body.email);
    res.json({ success: true, data: { accepted: true } });
  } catch (error) { next(error); }
});

router.post("/forgot-password", recoveryLimiter, validate(emailSchema), async (req, res, next) => {
  try {
    await requestPasswordReset(req.body.email);
    res.json({ success: true, data: { accepted: true } });
  } catch (error) { next(error); }
});

router.post("/reset-password", resetLimiter, validate(resetSchema), async (req, res, next) => {
  try { res.json({ success: true, data: await resetPassword(req.body.token, req.body.password, metadata(req)) }); } catch (error) { next(error); }
});

router.post("/change-password", authenticate, validate(changeSchema), async (req, res, next) => {
  try {
    const result = await changePassword(req.auth!.userId, req.body.currentPassword, req.body.newPassword, metadata(req));
    res.clearCookie("smartretail_refresh", cookieOptions);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post("/login", loginLimiter, validate(credentials), async (req, res, next) => {
  try {
    const result = await login(req.body, metadata(req));
    res.cookie("smartretail_refresh", result.refreshToken, cookieOptions);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  } catch (error) { next(error); }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies.smartretail_refresh as string | undefined;
    if (!token) throw new AppError(401, "REFRESH_TOKEN_MISSING", "Refresh token is missing");
    const result = await rotateRefreshToken(token, metadata(req));
    res.cookie("smartretail_refresh", result.refreshToken, cookieOptions);
    res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
  } catch (error) { next(error); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies.smartretail_refresh as string | undefined;
    if (token) await Session.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date(), revokedReason: "LOGOUT" } });
    res.clearCookie("smartretail_refresh", cookieOptions);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (error) { next(error); }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId)
      .select("email firstName lastName role storeIds emailVerifiedAt lastLoginAt status createdAt")
      .populate("storeIds", "name code status")
      .lean();
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account was not found");
    res.json({ success: true, data: user });
  } catch (error) { next(error); }
});

router.get("/sessions", authenticate, async (req, res, next) => {
  try {
    const refreshToken = req.cookies.smartretail_refresh as string | undefined;
    const currentSession = refreshToken
      ? await Session.findOne({ userId: req.auth!.userId, tokenHash: hashToken(refreshToken), revokedAt: { $exists: false } }).select("_id").lean()
      : null;
    const sessions = await Session.find({ userId: req.auth!.userId, revokedAt: { $exists: false } })
      .select("device ip userAgent lastUsedAt createdAt").sort({ lastUsedAt: -1 }).lean();
    res.json({ success: true, data: sessions.map((session) => ({ ...session, isCurrent: String(session._id) === String(currentSession?._id ?? "") })) });
  } catch (error) { next(error); }
});

router.delete("/sessions/others", authenticate, async (req, res, next) => {
  try {
    const refreshToken = req.cookies.smartretail_refresh as string | undefined;
    if (!refreshToken) throw new AppError(401, "CURRENT_SESSION_UNKNOWN", "The current session could not be identified");
    const currentSession = await Session.findOne({
      userId: req.auth!.userId,
      tokenHash: hashToken(refreshToken),
      revokedAt: { $exists: false },
    }).select("_id").lean();
    if (!currentSession) throw new AppError(401, "CURRENT_SESSION_UNKNOWN", "The current session is no longer active");
    const result = await Session.updateMany(
      { userId: req.auth!.userId, _id: { $ne: currentSession._id }, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: "LOGOUT" } },
    );
    res.json({ success: true, data: { revoked: true, count: result.modifiedCount } });
  } catch (error) { next(error); }
});

router.delete("/sessions/:id", authenticate, validate(sessionIdParams, "params"), async (req, res, next) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.auth!.userId, revokedAt: { $exists: false } }).select("tokenHash").lean();
    if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Active session was not found");
    await Session.updateOne({ _id: req.params.id, userId: req.auth!.userId }, { $set: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
    const refreshToken = req.cookies.smartretail_refresh as string | undefined;
    if (refreshToken && session.tokenHash === hashToken(refreshToken)) res.clearCookie("smartretail_refresh", cookieOptions);
    res.json({ success: true, data: { revoked: true } });
  } catch (error) { next(error); }
});

router.delete("/sessions", authenticate, async (req, res, next) => {
  try {
    await Session.updateMany({ userId: req.auth!.userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: "LOGOUT" } });
    res.clearCookie("smartretail_refresh", cookieOptions);
    res.json({ success: true, data: { revoked: true } });
  } catch (error) { next(error); }
});

return router;
}

export default createAuthRouter;
