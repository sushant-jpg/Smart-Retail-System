import { describe, expect, it } from "vitest";
import { envSchema } from "./env.js";

const validProductionEnvironment = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "a".repeat(40),
  JWT_REFRESH_SECRET: "b".repeat(40),
  COOKIE_SECRET: "c".repeat(40),
  QR_SIGNING_SECRET: "d".repeat(40),
  EMAIL_PROVIDER: "smtp",
  SMTP_URL: "smtps://mailer:secret@smtp.example.com:465",
};

describe("production environment validation", () => {
  it("rejects the E2E-only proxy configuration in production", () => {
    const result = envSchema.safeParse({ ...validProductionEnvironment, E2E_TEST_MODE: "true" });
    expect(result.success).toBe(false);
  });

  it("keeps E2E mode disabled by default", () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.E2E_TEST_MODE).toBe(false);
  });

  it("rejects the example secrets even though they meet the minimum length", () => {
    const result = envSchema.safeParse({
      ...validProductionEnvironment,
      JWT_ACCESS_SECRET: "replace-with-at-least-32-random-characters",
    });

    expect(result.success).toBe(false);
  });

  it("accepts explicitly configured production secrets", () => {
    expect(envSchema.safeParse(validProductionEnvironment).success).toBe(true);
  });
});
