import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { can, type Permission, type Role } from "../lib/permissions.js";
import { Session } from "../models/session.js";

type AccessPayload = jwt.JwtPayload & { sub: string; sid: string; role: Role; storeIds: string[]; type: "access" };

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const value = req.header("authorization");
  if (!value?.startsWith("Bearer ")) return next(new AppError(401, "AUTH_REQUIRED", "Authentication required"));

  let payload: AccessPayload;
  try {
    payload = jwt.verify(value.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    if (payload.type !== "access" || !payload.sub || !payload.sid) throw new Error("Invalid token type");
  } catch {
    return next(new AppError(401, "TOKEN_INVALID", "Access token is invalid or expired"));
  }

  try {
    const activeSession = await Session.exists({
      _id: payload.sid,
      userId: payload.sub,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (!activeSession) return next(new AppError(401, "TOKEN_INVALID", "Access token is invalid or expired"));
    req.auth = { userId: payload.sub, role: payload.role, storeIds: payload.storeIds ?? [] };
    next();
  } catch (error) {
    next(error);
  }
}

export const requirePermission = (permission: Permission) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !can(req.auth.role, permission)) {
      return next(new AppError(403, "PERMISSION_DENIED", `Permission '${permission}' is required`));
    }
    next();
  };

export const requireAnyPermission = (...required: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !required.some((permission) => can(req.auth!.role, permission))) {
      return next(new AppError(403, "PERMISSION_DENIED", `One of these permissions is required: ${required.join(", ")}`));
    }
    next();
  };

export function assertStoreAccess(auth: NonNullable<Request["auth"]>, storeId: string) {
  if (["CUSTOMER", "ADMIN", "SUPER_ADMIN"].includes(auth.role)) return;
  if (!auth.storeIds.includes(storeId)) {
    throw new AppError(403, "STORE_ACCESS_DENIED", "You do not have access to this store");
  }
}
