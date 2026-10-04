import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  E2E_TEST_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/smartretail"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  AI_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(32).default("development-access-secret-change-me-now"),
  JWT_REFRESH_SECRET: z.string().min(32).default("development-refresh-secret-change-now"),
  COOKIE_SECRET: z.string().min(32).default("development-cookie-secret-change-me-now"),
  QR_SIGNING_SECRET: z.string().min(32).default("development-qr-signing-secret-change-now"),
  EMAIL_PROVIDER: z.enum(["development", "smtp"]).default("development"),
  EMAIL_FROM: z.string().email().default("no-reply@smartretail.local"),
  SMTP_URL: z.string().url().optional(),
  LOYALTY_EXPIRY_INTERVAL_MS: z.coerce.number().int().min(60_000).default(60 * 60 * 1000),
}).superRefine((value, context) => {
  if (value.E2E_TEST_MODE && value.NODE_ENV === "production") {
    context.addIssue({ code: "custom", message: "E2E_TEST_MODE cannot be enabled in production", path: ["E2E_TEST_MODE"] });
  }
  if (value.NODE_ENV !== "production") return;
  for (const field of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "COOKIE_SECRET", "QR_SIGNING_SECRET"] as const) {
    if (/^(development-|replace-with-)/i.test(value[field])) {
      context.addIssue({ code: "custom", message: `${field} must be explicitly configured in production`, path: [field] });
    }
  }
  if (value.EMAIL_PROVIDER !== "smtp" || !value.SMTP_URL) {
    context.addIssue({
      code: "custom",
      message: "Production requires EMAIL_PROVIDER=smtp and SMTP_URL",
      path: ["SMTP_URL"],
    });
  }
});

export const env = envSchema.parse(process.env);
