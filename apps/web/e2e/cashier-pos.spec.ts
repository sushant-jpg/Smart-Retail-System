import { expect, test } from "@playwright/test";
import { completeCashCheckout, login } from "./helpers";

test("cashier scans a SKU, attaches a customer, and creates a real sale", async ({ page }) => {
  await login(page, "cashier@smartretail.demo");
  await page.goto("/pos");
  await page.getByLabel("Barcode, SKU, or QR code").fill("COF-1042");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("Himalayan Roast added.")).toBeVisible();
  await page.getByLabel("Customer name or email").fill("customer@smartretail.demo");
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: /Anisha Rai/ }).click();
  await completeCashCheckout(page, "Review payment and charge");
});
