import { expect, test } from "@playwright/test";
import { bearer, login } from "./helpers";

test("administrator reads users, updates a role, and reviews security and audit data", async ({ page, request }) => {
  await login(page, "admin@smartretail.demo");
  const headers = await bearer(page);
  const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4001/api/v1";
  const users = await request.get(`${apiUrl}/admin/users?search=staff%40smartretail.demo&limit=1`, { headers });
  expect(users.ok()).toBeTruthy();
  const usersPayload = await users.json() as { data: { items: Array<{ _id: string; email: string; role: string }> } };
  const staff = usersPayload.data.items.find((user) => user.email === "staff@smartretail.demo");
  expect(staff).toBeTruthy();
  const update = await request.patch(`${apiUrl}/admin/users/${staff!._id}`, { headers, data: { role: staff!.role === "STORE_STAFF" ? "CASHIER" : "STORE_STAFF" } });
  expect(update.ok()).toBeTruthy();
  const [security, audit] = await Promise.all([
    request.get(`${apiUrl}/admin/security?limit=20`, { headers }),
    request.get(`${apiUrl}/admin/audit?limit=20`, { headers }),
  ]);
  expect(security.ok()).toBeTruthy();
  expect(audit.ok()).toBeTruthy();
  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers", level: 2 })).toBeVisible();
});
