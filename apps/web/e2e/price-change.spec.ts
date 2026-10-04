import { expect, test } from "@playwright/test";
import { apiBaseUrl, bearer, login } from "./helpers";
import { money } from "../lib/format";

test("checkout refreshes a stale product price and asks for confirmation before payment", async ({ page, browser }) => {
  const apiUrl = apiBaseUrl;
  const adminPage = await browser.newPage({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001" });
  let updateUrl: string | undefined;
  let originalPrice: number | undefined;
  let adminHeaders: Record<string, string> | undefined;
  let shouldRestorePrice = false;

  try {
    await login(adminPage, "admin@smartretail.demo");
    adminHeaders = await bearer(adminPage);
    const catalogResponse = await adminPage.request.get(`${apiUrl}/products?limit=100`);
    expect(catalogResponse.ok()).toBeTruthy();
    const catalog = await catalogResponse.json() as { data: { items: Array<{ _id: string; sku: string; sellingPrice: number; taxRateBps: number }> } };
    const product = catalog.data.items.find((item) => item.sku === "COF-1042");
    expect(product).toBeTruthy();
    originalPrice = product!.sellingPrice;
    const updatedPrice = originalPrice + 100;
    const updatedTotal = updatedPrice + Math.round((updatedPrice * product!.taxRateBps) / 10_000);
    updateUrl = `${apiUrl}/products/${product!._id}`;

    await login(page, "customer@smartretail.demo");

    await page.goto("/products");
    const productCard = page.locator(".product-card").filter({ hasText: "Himalayan Roast" });
    await productCard.getByRole("button", { name: /Add to cart/ }).click();
    await page.getByRole("button", { name: "Checkout (1)" }).click();
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await page.getByRole("button", { name: "Validate checkout" }).click();
    const checkoutDialog = page.getByRole("dialog");
    await expect(checkoutDialog.getByText("Server-confirmed order")).toBeVisible();
    await expect(checkoutDialog.getByText("Himalayan Roast", { exact: false })).toContainText(money(originalPrice));
    const originalConfirmLabel = await checkoutDialog.getByRole("button", { name: /^Confirm / }).innerText();

    shouldRestorePrice = true;
    const changed = await adminPage.request.patch(updateUrl, { headers: adminHeaders, data: { sellingPrice: updatedPrice } });
    expect(changed.ok()).toBeTruthy();
    await checkoutDialog.getByRole("button", { name: originalConfirmLabel, exact: true }).click();

    await expect(page.getByRole("status").filter({ hasText: "The price or checkout eligibility changed" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "The price or checkout eligibility changed" })).toContainText(money(updatedTotal));
    await expect(checkoutDialog.getByText("Himalayan Roast", { exact: false })).toContainText(money(updatedPrice));
    await checkoutDialog.getByRole("button", { name: /^Confirm updated / }).click();
    await expect(checkoutDialog.getByText("Payment approved")).toBeVisible();
    await expect(checkoutDialog.getByText(money(updatedTotal), { exact: true })).toBeVisible();
  } finally {
    if (shouldRestorePrice && updateUrl && originalPrice !== undefined && adminHeaders) {
      const restored = await adminPage.request.patch(updateUrl, { headers: adminHeaders, data: { sellingPrice: originalPrice } });
      expect(restored.ok()).toBeTruthy();
    }
    await adminPage.close();
  }
});
