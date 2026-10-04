import { expect, test } from "@playwright/test";
import { completeCashCheckout, login } from "./helpers";

test("customer browses, carts, pays, and retrieves the real receipt", async ({ page }) => {
  await login(page, "customer@smartretail.demo");
  await page.goto("/products");
  const product = page.locator(".product-card").filter({ hasText: "Himalayan Roast" });
  const addToCart = product.getByRole("button", { name: /Add to cart/ });
  await expect(addToCart).toBeVisible();
  await addToCart.click();
  await completeCashCheckout(page, /Checkout \(1\)/);
});
