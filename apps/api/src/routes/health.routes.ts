import { Router } from "express";
import mongoose from "mongoose";
import type { Redis } from "ioredis";
import { env } from "../config/env.js";

export function healthRouter(redis: Redis) {
  const router = Router();
  router.get("/live", (_req, res) => res.json({ success: true, data: { status: "live", timestamp: new Date().toISOString() } }));
  router.get("/ready", async (_req, res) => {
    const dependencies = { mongodb: false, redis: false, ai: false };
    dependencies.mongodb = mongoose.connection.readyState === 1;
    try { dependencies.redis = (await redis.ping()) === "PONG"; } catch { /* reported below */ }
    try { dependencies.ai = (await fetch(`${env.AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2_000) })).ok; } catch { /* reported below */ }
    const ready = Object.values(dependencies).every(Boolean);
    res.status(ready ? 200 : 503).json({ success: ready, data: { status: ready ? "ready" : "degraded", dependencies } });
  });
  return router;
}
