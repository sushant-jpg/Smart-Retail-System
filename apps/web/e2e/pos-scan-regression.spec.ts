import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const qrSecret = "development-e2e-qr-signing-secret-change-now";
const signedQr = (version: number, publicId: string) => {
  const signature = createHmac("sha256", qrSecret).update(`${version}:${publicId}`).digest("base64url").slice(0, 22);
  return `sr:v${version}:${publicId}:${signature}`;
};

test("POS reports malformed and unknown scans and merges repeated scans into one cart line", async ({ page }) => {
  await login(page, "cashier@smartretail.demo");
  await page.goto("/pos");
  const scanInput = page.getByLabel("Barcode, SKU, or QR code");
  const status = page.getByRole("status");
  const submit = page.getByRole("button", { name: "Look up" });

  await scanInput.fill("sr:v1:malformed");
  await submit.click();
  await expect(status).toContainText(/malformed/i);

  await scanInput.fill("9999999999999");
  await submit.click();
  await expect(status).toContainText(/No product matches that code/i);

  for (const code of ["COF-1042", "8901000001042", signedQr(1, "p_e2e_himalayan")]) {
    await scanInput.fill(code);
    await submit.click();
    await expect(status).toContainText("Himalayan Roast added.");
  }

  const invalidQrCases = [
    { code: "sr:v1:p_e2e_himalayan", message: "QR code is malformed" },
    { code: "sr:v1:p_e2e_himalayan:AAAAAAAAAAAAAAAAAAAAAA", message: "QR code signature is invalid" },
    { code: signedQr(1, "p_e2e_himalayan").replace("p_e2e_himalayan", "p_e2e_tampered"), message: "QR code signature is invalid" },
    { code: signedQr(2, "p_e2e_himalayan"), message: "QR code version is not supported" },
    { code: signedQr(1, "p_e2e_unknown"), message: "No product matches that code" },
    { code: signedQr(1, "p_e2e_inactive"), message: "This product is not available for sale" },
    { code: signedQr(1, "p_e2e_soldout"), message: "This product is out of stock at this store" },
  ];
  for (const { code, message } of invalidQrCases) {
    await scanInput.fill(code);
    await submit.click();
    await expect(status).toHaveText(message);
    await expect(status).not.toContainText(/p_e2e_|ObjectId|stack/i);
  }

  await expect(page.locator(".cart-item")).toHaveCount(1);
  await expect(page.locator(".cart-item .qty-control span")).toHaveText("3");
});
