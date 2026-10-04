import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

export const password = "DemoPass!2026";
export const apiBaseUrl = (process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4001/api/v1").replace(/\/$/, "");
const accountCounters = new Map<string, number>();
const testAccounts = new Map<string, { email: string; ip: string }>();
const pageIps = new WeakMap<Page, string>();

export async function login(page: Page, email: string) {
  const testInfo = test.info();
  const persona = email.startsWith("manager@") ? "manager"
    : email.startsWith("cashier@") ? "cashier"
      : email.startsWith("admin@") ? "admin"
        : "customer";
  const accountKey = `${testInfo.project.name}:${testInfo.parallelIndex}:${testInfo.testId}:${persona}`;
  let account = testAccounts.get(accountKey);
  if (!account) {
    const counterKey = `${testInfo.project.name}:${testInfo.parallelIndex}:${persona}`;
    const index = accountCounters.get(counterKey) ?? 0;
    if (index >= 32) throw new Error(`E2E ${persona} account pool exhausted for worker ${testInfo.parallelIndex}`);
    accountCounters.set(counterKey, index + 1);
    const emailAddress = `e2e-${persona}-${testInfo.project.name}-${testInfo.parallelIndex}-${index}@smartretail.demo`;
    const digest = createHash("sha256").update(`${testInfo.project.name}:${testInfo.parallelIndex}:${testInfo.testId}`).digest();
    const ipAddress = `10.${digest[0]}.${digest[1]}.${digest[2]}`;
    account = { email: emailAddress, ip: ipAddress };
    testAccounts.set(accountKey, account);
  }
  pageIps.set(page, account.ip);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": account.ip });
  await page.goto("/login");
  const emailInput = page.getByLabel("Work email");
  await emailInput.fill("");
  await emailInput.fill(account.email);
  await expect(emailInput).toHaveValue(account.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return account.email;
}

export async function completeCashCheckout(page: Page, trigger: RegExp | string) {
  await page.getByRole("button", { name: trigger }).click();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Validate checkout" }).click();
  await expect(page.getByText("Server-confirmed order")).toBeVisible();
  await page.getByRole("button", { name: /Confirm Rs\./ }).click();
  await expect(page.getByText("Payment approved")).toBeVisible();
  await expect(page.getByText(/Sale SR-/)).toBeVisible();
  await page.getByRole("button", { name: "Retrieve receipt" }).click();
  await expect(page.getByText("Retrieved receipt items")).toBeVisible();
}

export async function bearer(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("smartretail-access"));
  if (!token) throw new Error("Signed-in browser has no access token");
  const ip = pageIps.get(page);
  if (!ip) throw new Error("E2E login did not assign an isolated client IP");
  return { Authorization: `Bearer ${token}`, "x-forwarded-for": ip };
}
