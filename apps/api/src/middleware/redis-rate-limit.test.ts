import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityEvent } from "../models/security-event.js";
import { rateLimitKeys, redisRateLimit } from "./redis-rate-limit.js";

vi.mock("../models/security-event.js", () => ({
  SecurityEvent: { create: vi.fn().mockResolvedValue(null) },
}));

describe("Redis-backed authentication rate limiting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never includes raw IP or account identifiers in Redis keys", () => {
    const keys = rateLimitKeys("login", "203.0.113.42", "Person@Example.com");
    expect(keys).toHaveLength(2);
    expect(keys.join(" ")).not.toContain("203.0.113.42");
    expect(keys.join(" ")).not.toContain("person@example.com");
  });

  it("limits when either shared counter exceeds the threshold", async () => {
    const redis = { eval: vi.fn().mockResolvedValue([4, 25_000]) };
    const middleware = redisRateLimit(redis as never, { scope: "login", limit: 3, windowMs: 60_000, identifier: () => "person@example.com" });
    const next = vi.fn();
    const setHeader = vi.fn();
    await middleware({ ip: "203.0.113.42", body: {}, get: vi.fn(), log: { warn: vi.fn() } } as never, { setHeader } as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 429, code: "AUTH_RATE_LIMITED" }));
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "25");
    expect(SecurityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      type: "RATE_LIMIT_TRIGGERED",
      metadata: { scope: "login", limit: 3 },
    }));
    expect(JSON.stringify(vi.mocked(SecurityEvent.create).mock.calls[0]?.[0])).not.toContain("person@example.com");
  });

  it("allows a request below the shared limit", async () => {
    const redis = { eval: vi.fn().mockResolvedValue([1, 30_000]) };
    const middleware = redisRateLimit(redis as never, { scope: "forgot", limit: 3, windowMs: 60_000 });
    const next = vi.fn();
    await middleware({ ip: "203.0.113.42", body: {}, log: { warn: vi.fn() } } as never, { setHeader: vi.fn() } as never, next);
    expect(next).toHaveBeenCalledWith();
  });
});
