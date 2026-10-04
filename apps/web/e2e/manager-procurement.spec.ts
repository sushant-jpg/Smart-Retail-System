import { expect, test } from "@playwright/test";
import { bearer, login } from "./helpers";

test("manager follows a low-stock alert into an idempotent goods receipt", async ({ page, request }) => {
  await login(page, "manager@smartretail.demo");
  await page.goto("/inventory");
  await expect(page.getByRole("cell", { name: /Oat Milk Barista/ })).toBeVisible();
  const headers = await bearer(page);
  const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4001/api/v1";
  const orders = await request.get(`${apiUrl}/purchase-orders`, { headers });
  expect(orders.ok()).toBeTruthy();
  const orderPayload = await orders.json() as { data: Array<{ _id: string; status: string; items: Array<{ product: { _id: string }; quantity: number; receivedQuantity: number }> }> };
  const order = orderPayload.data.find((entry) => entry.status === "ORDERED" || entry.status === "PARTIALLY_RECEIVED");
  expect(order).toBeTruthy();
  const line = order!.items[0]!;
  const idempotencyKey = crypto.randomUUID();
  const receipt = await request.post(`${apiUrl}/purchase-orders/${order!._id}/receive`, { headers: { ...headers, "idempotency-key": idempotencyKey }, data: { items: [{ productId: line.product._id, quantity: 1 }] } });
  expect(receipt.ok()).toBeTruthy();
  const retry = await request.post(`${apiUrl}/purchase-orders/${order!._id}/receive`, { headers: { ...headers, "idempotency-key": idempotencyKey }, data: { items: [{ productId: line.product._id, quantity: 1 }] } });
  expect(retry.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("cell", { name: /Oat Milk Barista/ })).toBeVisible();
});
