import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: "./e2e/global-setup.cjs",
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "npm run dev -w @smartretail/api",
      cwd: resolve(process.cwd(), "../.."),
      url: "http://127.0.0.1:4001/health/ready",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "development",
        E2E_TEST_MODE: "true",
        API_PORT: "4001",
        MONGODB_URI: "mongodb://127.0.0.1:27018/smartretail_e2e?replicaSet=rs0&directConnection=true",
        REDIS_URL: "redis://127.0.0.1:6379/1",
        WEB_ORIGIN: "http://127.0.0.1:3001",
        QR_SIGNING_SECRET: "development-e2e-qr-signing-secret-change-now",
      },
    },
    {
      command: "npm run dev -w @smartretail/web -- --hostname 127.0.0.1 --port 3001",
      cwd: resolve(process.cwd(), "../.."),
      url: "http://127.0.0.1:3001/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_TEST_MODE: "true",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4001/api/v1",
      },
    },
  ],
});
