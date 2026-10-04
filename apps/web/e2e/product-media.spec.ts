import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bearer, login } from "./helpers";

test("all seeded product cards load their local product artwork, including out-of-stock items", async ({ page }) => {
  await login(page, "manager@smartretail.demo");
  await page.goto("/products");
  const images = page.locator(".product-card img");
  await expect(images).toHaveCount(8);
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  const outOfStockCard = page.locator(".product-card").filter({ hasText: "Almond Granola" });
  await expect(outOfStockCard.getByRole("img", { name: "Almond Granola" })).toBeVisible();
  await expect(outOfStockCard.getByText("OUT OF STOCK")).toBeVisible();

  await page.goto("/pos");
  const posProduct = page.locator(".pos-product").filter({ hasText: "Oat Milk Barista" });
  const posImage = posProduct.getByRole("img", { name: "Oat Milk Barista" });
  await expect(posImage).toBeVisible();
  await expect.poll(() => posImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await page.getByLabel("Barcode, SKU, or QR code").fill("8901000001042");
  await page.getByRole("button", { name: "Look up" }).click();
  const posCartImage = page.locator(".cart-item").getByRole("img", { name: "Himalayan Roast" });
  await expect(posCartImage).toBeVisible();
  await expect.poll(() => posCartImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await page.goto("/products");
  await page.getByRole("link", { name: "View Oat Milk Barista details" }).click();
  const detailImage = page.getByRole("img", { name: "Oat Milk Barista" });
  await expect(detailImage).toBeVisible();
  await expect.poll(() => detailImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test("manager generates, closes, and downloads a server-signed product QR label", async ({ page }) => {
  await login(page, "manager@smartretail.demo");
  await page.goto("/products");
  await page.getByRole("link", { name: "View Himalayan Roast details" }).click();
  const qrResponse = page.waitForResponse((response) => response.url().includes("/products/") && response.url().endsWith("/label"));
  await page.getByRole("button", { name: "Generate QR" }).click();
  const response = await qrResponse;
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const labelResponse = await page.request.get(response.url(), { headers: await bearer(page) });
  expect(labelResponse.ok()).toBeTruthy();
  const svg = await labelResponse.text();
  expect(svg).toContain("<svg");
  const productId = new URL(response.url()).pathname.split("/").at(-2);
  expect(productId).toBeTruthy();
  expect(svg).not.toContain(productId!);

  const dialog = page.getByRole("dialog", { name: "Product QR code" });
  const qrImage = dialog.getByRole("img", { name: "Signed QR code for Himalayan Roast" });
  await expect(qrImage).toBeVisible();
  await expect.poll(() => qrImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByText("Signed QR ready")).toBeVisible();
  await expect(dialog).not.toContainText(productId!);
  await page.emulateMedia({ media: "print" });
  await expect(dialog.locator(".qr-label-print")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download PNG" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("smartretail-himalayan-roast-qr.png");
  const file = await download.path();
  expect(file).toBeTruthy();
  const png = await readFile(file!);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await dialog.getByRole("button", { name: "Close QR dialog" }).click();
  await expect(dialog).toBeHidden();
});
