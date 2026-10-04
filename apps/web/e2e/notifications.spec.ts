import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("manager reads notifications and marks all operational alerts read", async ({ page }) => {
  await login(page, "manager@smartretail.demo");
  await page.getByRole("button", { name: "Notifications" }).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark all read" })).toBeVisible();
  await dialog.getByRole("button", { name: "Mark all read" }).click();
  await expect(dialog.getByText("Notifications (0)")).toBeVisible();
});
