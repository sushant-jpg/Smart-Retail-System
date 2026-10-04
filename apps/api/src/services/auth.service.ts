import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { createOpaqueToken, hashToken } from "../lib/crypto.js";
import { AuthToken } from "../models/auth-token.js";
import { SecurityEvent } from "../models/security-event.js";
import { Session } from "../models/session.js";
import { User } from "../models/user.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./email.service.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

type LoginMetadata = { ip: string; userAgent: string; device: string };

function publicUser(user: { _id: unknown; email: string; firstName: string; lastName: string; role: string; storeIds: unknown[] }) {
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    storeIds: user.storeIds.map(String),
  };
}

function accessToken(user: { _id: unknown; role: string; storeIds: unknown[] }, sessionId: string) {
  return jwt.sign(
    { role: user.role, storeIds: user.storeIds.map(String), type: "access", sid: sessionId },
    env.JWT_ACCESS_SECRET,
    { subject: String(user._id), expiresIn: "15m", issuer: "smartretail-api", audience: "smartretail-web" },
  );
}

async function issueAuthToken(userId: unknown, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlMs: number) {
  const token = createOpaqueToken();
  await AuthToken.deleteMany({ user: userId, type, usedAt: { $exists: false } });
  await AuthToken.create({ user: userId, tokenHash: hashToken(token), type, expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

export async function register(input: { email: string; password: string; firstName: string; lastName: string }) {
  const existing = await User.exists({ email: input.email.toLowerCase() });
  if (existing) throw new AppError(409, "EMAIL_IN_USE", "An account already uses this email address");

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await User.create({ ...input, email: input.email.toLowerCase(), passwordHash, role: "CUSTOMER" });
  const verificationToken = await issueAuthToken(user._id, "EMAIL_VERIFICATION", VERIFICATION_TTL_MS);
  await sendVerificationEmail({ email: user.email, firstName: user.firstName, token: verificationToken });
  return { user: publicUser(user) };
}

export async function login(
  input: { email: string; password: string },
  metadata: LoginMetadata,
) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select("+passwordHash");
  if (!user) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later");
  }

  const valid = await argon2.verify(user.passwordHash, input.password);
  const historyEntry = { at: new Date(), ...metadata, successful: valid };
  if (!valid) {
    user.failedLoginAttempts += 1;
    user.loginHistory = [...user.loginHistory.slice(-19), historyEntry];
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    await SecurityEvent.create({
      type: user.failedLoginAttempts >= 5 ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      severity: user.failedLoginAttempts >= 5 ? "HIGH" : "MEDIUM",
      user: user._id, ip: metadata.ip, userAgent: metadata.userAgent,
      metadata: { failedAttempts: user.failedLoginAttempts },
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  if (!user.emailVerifiedAt) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in");

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  user.loginHistory = [...user.loginHistory.slice(-19), historyEntry];
  await user.save();

  const refreshToken = createOpaqueToken();
  const session = await Session.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    familyId: randomUUID(),
    ...metadata,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { user: publicUser(user), accessToken: accessToken(user, String(session._id)), refreshToken };
}

export async function rotateRefreshToken(token: string, metadata: LoginMetadata) {
  const session = await Session.findOne({ tokenHash: hashToken(token) });
  if (!session || session.expiresAt < new Date()) {
    throw new AppError(401, "REFRESH_TOKEN_INVALID", "Session is invalid or expired");
  }

  if (session.revokedAt) {
    await Session.updateMany({ familyId: session.familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: "REUSE_DETECTED" } });
    await SecurityEvent.create({
      type: "REFRESH_TOKEN_REUSE", severity: "CRITICAL", user: session.userId,
      ip: metadata.ip, userAgent: metadata.userAgent, metadata: { familyId: session.familyId },
    });
    throw new AppError(401, "REFRESH_TOKEN_REUSE", "Session reuse was detected; all related sessions were revoked");
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== "ACTIVE") throw new AppError(401, "SESSION_USER_INVALID", "Session user is unavailable");

  const revokedAt = new Date();
  const claimedSession = await Session.findOneAndUpdate(
    { _id: session._id, revokedAt: { $exists: false }, expiresAt: { $gt: revokedAt } },
    { $set: { revokedAt, revokedReason: "ROTATED" } },
    { new: false },
  );
  if (!claimedSession) {
    const current = await Session.findById(session._id).select("revokedAt").lean();
    if (current?.revokedAt) {
      await Session.updateMany(
        { familyId: session.familyId, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: "REUSE_DETECTED" } },
      );
      await SecurityEvent.create({
        type: "REFRESH_TOKEN_REUSE", severity: "CRITICAL", user: session.userId,
        ip: metadata.ip, userAgent: metadata.userAgent, metadata: { familyId: session.familyId },
      });
      throw new AppError(401, "REFRESH_TOKEN_REUSE", "Session reuse was detected; all related sessions were revoked");
    }
    throw new AppError(401, "REFRESH_TOKEN_INVALID", "Session is invalid or expired");
  }

  const nextToken = createOpaqueToken();
  const nextSession = await Session.create({
    userId: user._id, tokenHash: hashToken(nextToken), familyId: session.familyId,
    ...metadata, lastUsedAt: new Date(), expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  await Session.updateOne({ _id: session._id }, { $set: { replacedBy: nextSession._id } });

  return { user: publicUser(user), accessToken: accessToken(user, String(nextSession._id)), refreshToken: nextToken };
}

export async function resendVerification(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || user.emailVerifiedAt) return undefined;
  const token = await issueAuthToken(user._id, "EMAIL_VERIFICATION", VERIFICATION_TTL_MS);
  await sendVerificationEmail({ email: user.email, firstName: user.firstName, token });
  return true;
}

export async function verifyEmail(token: string) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type: "EMAIL_VERIFICATION", usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
  if (!record) throw new AppError(400, "VERIFICATION_TOKEN_INVALID", "Verification token is invalid or expired");
  await User.updateOne({ _id: record.user }, { $set: { emailVerifiedAt: new Date() } });
  return { verified: true };
}

export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return undefined;
  const token = await issueAuthToken(user._id, "PASSWORD_RESET", RESET_TTL_MS);
  await sendPasswordResetEmail({ email: user.email, firstName: user.firstName, token });
  return true;
}

export async function resetPassword(token: string, password: string, metadata: LoginMetadata) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type: "PASSWORD_RESET", usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
  if (!record) throw new AppError(400, "RESET_TOKEN_INVALID", "Password reset token is invalid or expired");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const resetUser = await User.findById(record.user);
  if (!resetUser) throw new AppError(404, "USER_NOT_FOUND", "Account no longer exists");
  resetUser.passwordHash = passwordHash;
  resetUser.failedLoginAttempts = 0;
  resetUser.lockedUntil = undefined;
  if (resetUser.status === "INVITED") {
    resetUser.status = "ACTIVE";
    resetUser.emailVerifiedAt = new Date();
  }
  await resetUser.save();
  await Session.updateMany({ userId: record.user, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: "PASSWORD_CHANGED" } });
  await SecurityEvent.create({ type: "PASSWORD_CHANGED", severity: "MEDIUM", user: record.user, ip: metadata.ip, userAgent: metadata.userAgent });
  return { reset: true };
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string, metadata: LoginMetadata) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
    throw new AppError(401, "CURRENT_PASSWORD_INVALID", "Current password is incorrect");
  }
  user.passwordHash = await argon2.hash(nextPassword, { type: argon2.argon2id });
  await user.save();
  await Session.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: "PASSWORD_CHANGED" } });
  await SecurityEvent.create({ type: "PASSWORD_CHANGED", severity: "MEDIUM", user: userId, ip: metadata.ip, userAgent: metadata.userAgent });
  return { changed: true };
}
