import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { completeCashCheckout, login } from "./helpers";

test("customer scans a backend barcode and completes Scan & Pay", async ({ page }) => {
  await login(page, "customer@smartretail.demo");
  await page.goto("/scan-pay");
  await page.getByPlaceholder("Scan / enter barcode, SKU or QR payload").fill("8901000001042");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("Himalayan Roast added to your bag.")).toBeVisible();
  await completeCashCheckout(page, "Continue to payment");
});

test("customer manually enters a signed QR payload and sees the validated product image", async ({ page }) => {
  await login(page, "customer@smartretail.demo");
  await page.goto("/scan-pay");
  const payload = `sr:v1:p_e2e_himalayan:${createHmac("sha256", "development-e2e-qr-signing-secret-change-now").update("1:p_e2e_himalayan").digest("base64url").slice(0, 22)}`;
  await page.getByPlaceholder("Scan / enter barcode, SKU or QR payload").fill(payload);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("Himalayan Roast added to your bag.")).toBeVisible();
  const item = page.locator(".cart-item").filter({ hasText: "Himalayan Roast" });
  await expect(item.getByRole("img", { name: "Himalayan Roast" })).toBeVisible();
  await expect.poll(() => item.getByRole("img", { name: "Himalayan Roast" }).evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(item.getByText("COF-1042")).toBeVisible();
});
