import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { SecurityEvent } from "../models/security-event.js";

const incrementScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return { current, redis.call("PTTL", KEYS[1]) }
`;

const digest = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export function rateLimitKeys(scope: string, ip: string, identifier?: string) {
  return [
    `smartretail:rate:${scope}:ip:${digest(ip)}`,
    ...(identifier ? [`smartretail:rate:${scope}:id:${digest(identifier)}`] : []),
  ];
}

export function redisRateLimit(redis: Redis, options: {
  scope: string;
  limit: number;
  windowMs: number;
  identifier?: (body: unknown) => string | undefined;
}): RequestHandler {
  return async (req, res, next) => {
    const identifier = options.identifier?.(req.body);
    const keys = rateLimitKeys(options.scope, req.ip || "unknown", identifier);
    try {
      let longestRetryMs = 0;
      for (const key of keys) {
        const result = await redis.eval(incrementScript, 1, key, options.windowMs) as [number, number];
        const current = Number(result[0]);
        const retryMs = Math.max(0, Number(result[1]));
        if (current > options.limit) longestRetryMs = Math.max(longestRetryMs, retryMs);
      }
      res.setHeader("RateLimit-Limit", String(options.limit));
      if (longestRetryMs > 0) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(longestRetryMs / 1000))));
        try {
          await SecurityEvent.create({
            type: "RATE_LIMIT_TRIGGERED",
            severity: "HIGH",
            user: req.auth?.userId,
            ip: req.ip,
            userAgent: req.get("user-agent"),
            metadata: { scope: options.scope, limit: options.limit },
          });
        } catch (error) {
          req.log?.error({ error, scope: options.scope }, "Failed to record rate-limit security event");
          next(error);
          return;
        }
        next(new AppError(429, "AUTH_RATE_LIMITED", "Too many requests. Try again later"));
        return;
      }
      next();
    } catch (error) {
      if (env.NODE_ENV === "production") {
        next(new AppError(503, "AUTH_PROTECTION_UNAVAILABLE", "Authentication protection is temporarily unavailable"));
        return;
      }
      req.log?.warn({ error, scope: options.scope }, "Redis rate limiter unavailable; allowing request outside production");
      next();
    }
  };
}
