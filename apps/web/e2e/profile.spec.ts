import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("customer sees live profile, loyalty, orders, and revocable session details", async ({ page }) => {
  const email = await login(page, "customer@smartretail.demo");
  const accessToken = await page.evaluate(() => sessionStorage.getItem("smartretail-access"));
  expect(accessToken).toBeTruthy();
  await page.goto("/profile");

  await expect(page.getByRole("heading", { name: "Profile & security", level: 2 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(accessToken!);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("CUSTOMER", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loyalty" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent orders", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No recent orders", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await expect(page.getByText("Current device")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out other sessions" })).toBeVisible();
});

test("a selected session can be revoked from profile and loses access immediately", async ({ browser, page }) => {
  await login(page, "customer@smartretail.demo");
  const otherDevice = await browser.newPage();
  try {
    await login(otherDevice, "customer@smartretail.demo");
    const revokedToken = await otherDevice.evaluate(() => sessionStorage.getItem("smartretail-access"));
    expect(revokedToken).toBeTruthy();
    await page.goto("/profile");
    const currentSession = page.getByRole("listitem").filter({ hasText: "Current device" });
    const otherSession = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Log out", exact: true }) });
    await expect(currentSession).toHaveCount(1);
    await expect(otherSession).toHaveCount(1);
    const revokeButton = otherSession.getByRole("button", { name: "Log out", exact: true });
    await expect(revokeButton).toBeVisible();
    await revokeButton.click();
    await expect(page.getByRole("button", { name: "Log out", exact: true })).toHaveCount(0);

    const status = await otherDevice.evaluate(async (token) => {
      const response = await fetch("http://127.0.0.1:4001/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.status;
    }, revokedToken);
    expect(status).toBe(401);
  } finally {
    await otherDevice.close();
  }
});
