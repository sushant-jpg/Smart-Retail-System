import { expect, test } from "@playwright/test";
import { compactNumber, money } from "../lib/format";
import { login } from "./helpers";

const viewports = [1920, 1366, 1024, 768, 430, 390];

test("dashboard and profile remain usable at requested viewport widths and in dark mode", async ({ page }) => {
  await login(page, "admin@smartretail.demo");

  const overviewResponse = page.waitForResponse((response) => response.url().includes("/analytics/overview?"));
  await page.goto("/dashboard");
  const overviewPayload = await (await overviewResponse).json() as { data: {
    revenue: number; orders: number; averageOrderValue: number; itemsSold: number; grossProfit: number;
    activeCustomers: number; lowStock: number; outOfStock: number;
  } };
  const overview = overviewPayload.data;
  const metricCards = page.locator(".kpi-card");
  const expectedValues = [
    money(overview.revenue),
    compactNumber(overview.orders),
    money(overview.averageOrderValue),
    compactNumber(overview.itemsSold),
    money(overview.grossProfit),
    compactNumber(overview.activeCustomers),
  ];
  for (let index = 0; index < expectedValues.length; index += 1) {
    await expect(metricCards.nth(index).locator(".kpi-value")).toHaveText(expectedValues[index]!);
  }
  await expect(page.getByText(`${overview.lowStock} low-stock items`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${overview.outOfStock} out of stock`, { exact: true })).toBeVisible();

  const period = page.getByLabel("Select analytics date range");
  for (const value of ["today", "7days", "30days", "3months"]) {
    await period.selectOption(value);
    await expect(period).toHaveValue(value);
  }
  await period.selectOption("custom");
  await expect(page.getByLabel("From")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "To", exact: true })).toBeVisible();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Store overview" })).toBeVisible();
    expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile & security", level: 2 })).toBeVisible();
    expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width);
  }

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Profile & security", level: 2 })).toBeVisible();
});
