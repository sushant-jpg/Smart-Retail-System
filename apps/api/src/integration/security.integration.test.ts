import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { createProductQrPayload } from "../lib/product-qr.js";
import { hashToken } from "../lib/crypto.js";
import { AuthToken } from "../models/auth-token.js";
import { Inventory } from "../models/inventory.js";
import { Notification } from "../models/notification.js";
import { Product } from "../models/product.js";
import { PurchaseOrder } from "../models/purchase-order.js";
import { Sale } from "../models/sale.js";
import { SecurityEvent } from "../models/security-event.js";
import { Session } from "../models/session.js";
import { Store } from "../models/store.js";
import { Supplier } from "../models/supplier.js";
import { User } from "../models/user.js";
import { rateLimitKeys } from "../middleware/redis-rate-limit.js";

const mongoUri = process.env.MONGODB_TEST_URI
  ?? "mongodb://127.0.0.1:27018/smartretail_integration?replicaSet=rs0&directConnection=true";
const redis = new Redis(env.REDIS_URL);
const app = createApp(redis);
app.set("trust proxy", true);
const password = "CorrectHorseBattery!9";
const freshIp = () => `203.0.113.${Number.parseInt(randomUUID().slice(0, 2), 16) % 254 + 1}`;

async function user(email = `${randomUUID()}@security.test`, role = "STORE_MANAGER", storeIds: mongoose.Types.ObjectId[] = []) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return User.create({
    email, passwordHash, firstName: "Security", lastName: "Tester", role,
    storeIds, emailVerifiedAt: new Date(),
  });
}

async function signIn(email: string, suppliedPassword = password, ip = freshIp()) {
  return request(app).post("/api/v1/auth/login").set("X-Forwarded-For", ip).send({ email, password: suppliedPassword });
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const cookie = (response: { headers: { "set-cookie"?: string | string[] } }) => {
  const value = response.headers["set-cookie"];
  if (!value) throw new Error("Login response did not set a refresh cookie");
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error("Login refresh cookie header was empty");
  return header.split(";")[0]!;
};

async function commerceFixture(store: mongoose.Types.ObjectId, productStatus = "ACTIVE", stock = 4) {
  const product = await Product.create({
    name: "Security Fixture Product", slug: `security-${randomUUID()}`, description: "",
    sku: `SEC-${randomUUID()}`, barcode: `90${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    qr: { publicId: `p_${randomUUID()}`, version: 1 }, category: "Security", brand: "Test",
    costPrice: 5_000, sellingPrice: 10_000, taxRateBps: 0, images: [], status: productStatus,
  });
  await Inventory.create({ store, product: product._id, availableQuantity: stock, reorderLevel: 0, reorderQuantity: 4 });
  return product;
}

beforeAll(async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8_000 });
  await redis.ping();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await redis.quit();
});

describe("authentication failures and token lifecycle", () => {
  it("returns enumeration-safe wrong-password and unknown-account errors and records only the known failure", async () => {
    const account = await user();
    const [wrong, unknown] = await Promise.all([
      signIn(account.email, "WrongPassword!2026"),
      signIn(`${randomUUID()}@security.test`, "WrongPassword!2026"),
    ]);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(JSON.stringify(wrong.body)).not.toContain(password);
    expect(JSON.stringify(wrong.body)).not.toContain("accessToken");
    expect(await SecurityEvent.countDocuments({ type: "LOGIN_FAILED", user: account._id })).toBe(1);
    const loggedEvent = await SecurityEvent.findOne({ user: account._id }).lean();
    expect(JSON.stringify(loggedEvent?.metadata)).not.toContain(password);
    expect(JSON.stringify(loggedEvent?.metadata)).not.toContain(account.email);
  });

  it("locks after repeated wrong passwords, permits login after lock expiry, and logs the lock event", async () => {
    const account = await user();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn(account.email, "IncorrectPassword!")).status).toBe(401);
    }
    const locked = await signIn(account.email, password);
    expect(locked.status).toBe(423);
    expect(await SecurityEvent.countDocuments({ type: "ACCOUNT_LOCKED", user: account._id })).toBeGreaterThan(0);

    await User.updateOne({ _id: account._id }, { $set: { lockedUntil: new Date(Date.now() - 1), failedLoginAttempts: 5 } });
    const unlocked = await signIn(account.email);
    expect(unlocked.status).toBe(200);
    const persisted = await User.findById(account._id).lean();
    expect(persisted?.failedLoginAttempts).toBe(0);
    expect(persisted?.lockedUntil).toBeUndefined();
  });

  it("rejects missing, malformed, expired, and revoked access tokens without disclosing credentials", async () => {
    const account = await user();
    const login = await signIn(account.email);
    const token = login.body.data.accessToken as string;
    const session = await Session.findOne({ userId: account._id }).lean();
    if (!session) throw new Error("Login did not persist its session");
    const expired = jwt.sign(
      { role: account.role, storeIds: [], type: "access", sid: String(session._id) },
      env.JWT_ACCESS_SECRET,
      { subject: String(account._id), issuer: "smartretail-api", audience: "smartretail-web", expiresIn: -1 },
    );
    const [missing, malformed, expiredResponse] = await Promise.all([
      request(app).get("/api/v1/auth/me"),
      request(app).get("/api/v1/auth/me").set(auth("not-a-jwt")),
      request(app).get("/api/v1/auth/me").set(auth(expired)),
    ]);
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
    expect(JSON.stringify(expiredResponse.body)).not.toContain(password);
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
    expect((await request(app).get("/api/v1/auth/me").set(auth(token))).status).toBe(401);
  });

  it("invalidates access and refresh tokens for revoked sessions and logout-all actions", async () => {
    const account = await user();
    const first = await signIn(account.email);
    const second = await signIn(account.email);
    const firstCookie = cookie(first);
    const secondCookie = cookie(second);
    const sessionsResponse = await request(app).get("/api/v1/auth/sessions")
      .set(auth(second.body.data.accessToken)).set("Cookie", secondCookie);
    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body.data.filter((entry: { isCurrent: boolean }) => entry.isCurrent)).toHaveLength(1);
    const other = sessionsResponse.body.data.find((entry: { isCurrent: boolean }) => !entry.isCurrent);
    expect(other).toBeTruthy();

    const revoke = await request(app).delete(`/api/v1/auth/sessions/${other._id}`)
      .set(auth(second.body.data.accessToken)).set("Cookie", secondCookie);
    expect(revoke.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set(auth(first.body.data.accessToken))).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie)).status).toBe(401);

    const third = await signIn(account.email);
    const afterThirdLogin = await request(app).delete("/api/v1/auth/sessions/others")
      .set(auth(second.body.data.accessToken)).set("Cookie", secondCookie);
    expect(afterThirdLogin.status).toBe(200);
    expect(afterThirdLogin.body.data.count).toBe(1);
    expect((await request(app).get("/api/v1/auth/me").set(auth(third.body.data.accessToken))).status).toBe(401);

    expect((await request(app).delete("/api/v1/auth/sessions").set(auth(second.body.data.accessToken)).set("Cookie", secondCookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set(auth(second.body.data.accessToken))).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", secondCookie)).status).toBe(401);
  });

  it("detects refresh-token reuse, revokes its family, and emits a secret-free security event", async () => {
    const account = await user();
    const login = await signIn(account.email);
    const originalCookie = cookie(login);
    const rotated = await request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie);
    expect(rotated.status).toBe(200);
    const rotatedCookie = cookie(rotated);
    const reuse = await request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("REFRESH_TOKEN_REUSE");
    expect(JSON.stringify(reuse.body)).not.toContain(originalCookie);
    expect((await request(app).get("/api/v1/auth/me").set(auth(rotated.body.data.accessToken))).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", rotatedCookie)).status).toBe(401);
    expect(await SecurityEvent.countDocuments({ type: "REFRESH_TOKEN_REUSE", user: account._id })).toBeGreaterThanOrEqual(1);
  });

  it("detects simultaneous refresh-token reuse and revokes the winning rotation", async () => {
    const account = await user();
    const login = await signIn(account.email);
    const originalCookie = cookie(login);
    const [first, replay] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie),
      request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie),
    ]);
    expect([first.status, replay.status].sort()).toEqual([200, 401]);
    const successful = first.status === 200 ? first : replay;
    expect((await request(app).get("/api/v1/auth/me").set(auth(successful.body.data.accessToken))).status).toBe(401);
    expect(await Session.countDocuments({ userId: account._id, revokedAt: { $exists: false } })).toBe(0);
    expect(await SecurityEvent.countDocuments({ type: "REFRESH_TOKEN_REUSE", user: account._id })).toBe(1);
  });

  it("allows each verification and password-reset token to be used once", async () => {
    const account = await user();
    const verification = randomUUID() + randomUUID();
    await AuthToken.create({
      user: account._id, tokenHash: hashToken(verification), type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await request(app).post("/api/v1/auth/verify-email").send({ token: verification })).status).toBe(200);
    const repeatedVerification = await request(app).post("/api/v1/auth/verify-email").send({ token: verification });
    expect(repeatedVerification.status).toBe(400);
    expect(JSON.stringify(repeatedVerification.body)).not.toContain(verification);

    const reset = randomUUID() + randomUUID();
    await AuthToken.create({
      user: account._id, tokenHash: hashToken(reset), type: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await request(app).post("/api/v1/auth/reset-password").send({ token: reset, password: "ReplacementPassword!2026" })).status).toBe(200);
    const repeatedReset = await request(app).post("/api/v1/auth/reset-password").send({ token: reset, password: "AnotherPassword!2026" });
    expect(repeatedReset.status).toBe(400);
    expect(JSON.stringify(repeatedReset.body)).not.toContain(reset);
    expect(await SecurityEvent.countDocuments({ type: "PASSWORD_CHANGED", user: account._id })).toBe(1);
  });

  it("enforces the login rate limit and records the limit event without storing identifiers", async () => {
    const email = `${randomUUID()}@missing.test`;
    const limiterIp = "198.51.100.10";
    const keys = rateLimitKeys("login", limiterIp, email);
    await redis.del(...keys);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await signIn(email, "IncorrectPassword!", limiterIp)).status).toBe(401);
    }
    const limited = await signIn(email, "IncorrectPassword!", limiterIp);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("AUTH_RATE_LIMITED");
    const event = await SecurityEvent.findOne({ type: "RATE_LIMIT_TRIGGERED" }).sort({ timestamp: -1 }).lean();
    expect(event?.metadata).toMatchObject({ scope: "login", limit: 10 });
    expect(JSON.stringify(event?.metadata)).not.toContain(email);
    await redis.del(...keys);
  });
});

describe("store isolation and signed product lookup", () => {
  it("matches dashboard KPIs and chart groups to persisted sales and inventory fixtures", async () => {
    const store = await Store.create({ name: "Analytics Store", code: `AN-${randomUUID().slice(0, 6)}`, address: "Analytics test address" });
    const manager = await user(`${randomUUID()}@manager.test`, "STORE_MANAGER", [store._id]);
    const customer = await user(`${randomUUID()}@customer.test`, "CUSTOMER");
    const product = await commerceFixture(store._id, "ACTIVE", 4);
    await Inventory.updateOne({ store: store._id, product: product._id }, { $set: { reorderLevel: 5 } });
    await commerceFixture(store._id, "ACTIVE", 0);
    const sale = await Sale.create({
      saleNumber: `SALE-${randomUUID()}`, verificationCode: `SRV1-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      store: store._id, customer: customer._id,
      items: [{ product: product._id, name: product.name, sku: product.sku, quantity: 1, unitPrice: 10_000, costPrice: 5_000, subtotal: 10_000, discount: 0, tax: 0, total: 10_000 }],
      subtotal: 10_000, discount: 0, tax: 0, total: 10_000, paymentMethod: "CASH",
      paymentStatus: "PAID", saleStatus: "PAID", idempotencyKey: `analytics-${randomUUID()}`,
    });
    const login = await signIn(manager.email);
    const headers = auth(login.body.data.accessToken as string);
    const from = new Date(sale.createdAt.getTime() - 60_000).toISOString();
    const to = new Date(sale.createdAt.getTime() + 60_000).toISOString();
    const [overview, stores] = await Promise.all([
      request(app).get(`/api/v1/analytics/overview?storeId=${store._id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set(headers),
      request(app).get(`/api/v1/analytics/stores?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set(headers),
    ]);
    expect(overview.status).toBe(200);
    expect(overview.body.data).toMatchObject({
      revenue: 10_000, orders: 1, averageOrderValue: 10_000, itemsSold: 1,
      grossProfit: 5_000, activeCustomers: 1, lowStock: 1, outOfStock: 1,
      categories: [{ category: product.category, revenue: 10_000, quantity: 1 }],
      topProducts: [{ name: product.name, sku: product.sku, revenue: 10_000, quantity: 1 }],
      slowProducts: [{ name: product.name, sku: product.sku, revenue: 10_000, quantity: 1 }],
      paymentMethods: [{ method: "CASH", revenue: 10_000, orders: 1 }],
    });
    expect(overview.body.data.revenueSeries).toHaveLength(1);
    expect(stores.status).toBe(200);
    expect(stores.body.data).toMatchObject([{
      storeId: String(store._id), name: store.name, revenue: 10_000, orders: 1,
      itemsSold: 1, averageOrderValue: 10_000,
    }]);
  });

  it("blocks Store A staff from Store B operational data and scopes customer queries", async () => {
    const storeA = await Store.create({ name: "Security A", code: `SA-${randomUUID().slice(0, 6)}`, address: "Store A address" });
    const storeB = await Store.create({ name: "Security B", code: `SB-${randomUUID().slice(0, 6)}`, address: "Store B address" });
    const staffA = await user(`${randomUUID()}@staff.test`, "STORE_MANAGER", [storeA._id]);
    const staffB = await user(`${randomUUID()}@staff.test`, "STORE_MANAGER", [storeB._id]);
    const customer = await user(`${randomUUID()}@customer.test`, "CUSTOMER");
    const product = await commerceFixture(storeB._id);
    const supplier = await Supplier.create({
      name: "Security Supplier", contactPerson: "Test Person", phone: "123456789",
      email: `${randomUUID()}@supplier.test`, address: "Supplier test address", taxNumber: randomUUID(),
      storeIds: [storeB._id], productsSupplied: [product._id],
    });
    const order = await PurchaseOrder.create({
      orderNumber: `PO-${randomUUID()}`, supplier: supplier._id, store: storeB._id,
      items: [{ product: product._id, quantity: 2, receivedQuantity: 0, unitCost: 5_000, lineTotal: 10_000 }],
      total: 10_000, expectedDeliveryDate: new Date(), status: "ORDERED", createdBy: staffB._id,
    });
    const sale = await Sale.create({
      saleNumber: `SALE-${randomUUID()}`, verificationCode: `SRV1-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      store: storeB._id, customer: customer._id, items: [{ product: product._id, name: product.name, sku: product.sku, quantity: 1, unitPrice: 10_000, costPrice: 5_000, subtotal: 10_000, discount: 0, tax: 0, total: 10_000 }],
      subtotal: 10_000, discount: 0, tax: 0, total: 10_000, paymentMethod: "CASH",
      paymentStatus: "PAID", saleStatus: "PAID", idempotencyKey: `sale-${randomUUID()}`,
    });
    const loginA = await signIn(staffA.email);
    const headers = auth(loginA.body.data.accessToken as string);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const results = await Promise.all([
      request(app).get(`/api/v1/inventory?storeId=${storeB._id}`).set(headers),
      request(app).get(`/api/v1/sales?storeId=${storeB._id}`).set(headers),
      request(app).get(`/api/v1/analytics/overview?storeId=${storeB._id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set(headers),
      request(app).get(`/api/v1/receipts/${sale.saleNumber}`).set(headers),
      request(app).post(`/api/v1/purchase-orders/${order._id}/receive`).set(headers)
        .set("Idempotency-Key", `cross-store-${randomUUID()}`).send({ items: [{ productId: String(product._id), quantity: 1 }] }),
      request(app).patch(`/api/v1/products/${product._id}`).set(headers).send({ sellingPrice: 11_000 }),
      request(app).get("/api/v1/suppliers").set(headers),
      request(app).get(`/api/v1/suppliers/${supplier._id}`).set(headers),
      request(app).post("/api/v1/purchase-orders").set(headers).send({
        supplierId: String(supplier._id), storeId: String(storeA._id),
        items: [{ productId: String(product._id), quantity: 1, unitCost: 5_000 }],
        expectedDeliveryDate: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      request(app).get(`/api/v1/customers?q=${encodeURIComponent(customer.email)}`).set(headers),
      request(app).get(`/api/v1/customers/lookup?q=${encodeURIComponent(customer.email)}`).set(headers),
    ]);
    expect(results.slice(0, 9).map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403, 200, 404, 422]);
    expect(results[6]?.body.data).toHaveLength(0);
    expect(results[8]?.body.error.code).toBe("SUPPLIER_INVALID");
    expect(results[9]?.status).toBe(200);
    expect(results[9]?.body.data.items).toHaveLength(0);
    expect(results[10]?.status).toBe(200);
    expect(results[10]?.body.data).toHaveLength(0);
    expect(await SecurityEvent.countDocuments({ type: "PERMISSION_DENIED", user: staffA._id })).toBeGreaterThanOrEqual(4);
  });

  it("validates minimal QR payloads, signatures, versions, catalog status, stock, and unknown public IDs", async () => {
    const store = await Store.create({ name: "QR Store", code: `QR-${randomUUID().slice(0, 6)}`, address: "QR test address" });
    const active = await commerceFixture(store._id);
    const otherStore = await Store.create({ name: "QR Other Store", code: `QRO-${randomUUID().slice(0, 6)}`, address: "Other QR test address" });
    await Inventory.create({ store: otherStore._id, product: active._id, availableQuantity: 3, reorderLevel: 0, reorderQuantity: 4 });
    await Product.updateOne({ _id: active._id }, { $set: { images: [
      "/products/himalayan-roast.svg",
      "C:\\Users\\internal\\himalayan.png",
      "/uploads/internal/himalayan.png",
      "http://unsafe.example.test/himalayan.png",
      "https://cdn.example.test/himalayan.png",
    ] } });
    const manager = await user(`${randomUUID()}@qr.test`, "STORE_MANAGER", [store._id]);
    const managerLogin = await signIn(manager.email);
    const managerHeaders = auth(managerLogin.body.data.accessToken as string);
    const label = await request(app).get(`/api/v1/products/${active._id}/label`).set(managerHeaders);
    expect(label.status).toBe(200);
    expect(label.type).toContain("image/svg+xml");
    const labelSvg = label.body.toString("utf8");
    expect(labelSvg).toContain("<svg");
    expect(labelSvg).not.toContain(String(active._id));
    expect(labelSvg).not.toContain(env.QR_SIGNING_SECRET);
    expect((await request(app).get(`/api/v1/products/${active._id}/label`)).status).toBe(401);
    expect((await request(app).get("/api/v1/products/not-a-product-id/label").set(managerHeaders)).status).toBe(422);
    expect((await request(app).get(`/api/v1/products/${new mongoose.Types.ObjectId()}/label`).set(managerHeaders)).status).toBe(404);

    const valid = createProductQrPayload(active.qr.version, active.qr.publicId);
    expect(valid).toMatch(/^sr:v1:p_[a-zA-Z0-9-]+:[a-zA-Z0-9_-]{22}$/);
    expect(valid).not.toContain(String(active._id));
    const lookup = (payload: string) => request(app)
      .get(`/api/v1/products/lookup/${encodeURIComponent(payload)}`)
      .query({ storeId: String(store._id) });

    const validLookup = await lookup(valid);
    expect(validLookup.status).toBe(200);
    expect(validLookup.body.data.images).toEqual(["/products/himalayan-roast.svg", "https://cdn.example.test/himalayan.png"]);
    expect((await lookup("sr:v1:malformed")).body.error.code).toBe("QR_INVALID");
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
    expect((await lookup(tampered)).body.error.code).toBe("QR_SIGNATURE_INVALID");
    const unsupported = createProductQrPayload(2, active.qr.publicId);
    expect((await lookup(unsupported)).body.error.code).toBe("QR_VERSION_UNSUPPORTED");
    const unknown = createProductQrPayload(1, `p_${randomUUID()}`);
    expect((await lookup(unknown)).status).toBe(404);

    const inactive = await commerceFixture(store._id, "INACTIVE");
    expect((await lookup(createProductQrPayload(1, inactive.qr.publicId))).status).toBe(409);
    const inactiveLabel = await request(app).get(`/api/v1/products/${inactive._id}/label`).set(managerHeaders);
    expect(inactiveLabel.status).toBe(409);
    expect(inactiveLabel.body.error.code).toBe("PRODUCT_INACTIVE");
    const soldOut = await commerceFixture(store._id, "ACTIVE", 0);
    expect((await lookup(createProductQrPayload(1, soldOut.qr.publicId))).body.error.code).toBe("OUT_OF_STOCK");

    const barcode = await request(app).get(`/api/v1/products/lookup/${active.barcode}`).query({ storeId: String(store._id) });
    expect(barcode.status).toBe(200);
    expect((await request(app).get(`/api/v1/products/lookup/${encodeURIComponent("unknown-barcode-000")}`).query({ storeId: String(store._id) })).status).toBe(404);
  });
});

describe("notification state changes", () => {
  it("returns truthful unread counts, marks one notification read, and marks all remaining read", async () => {
    const account = await user(`${randomUUID()}@customer.test`, "CUSTOMER");
    const login = await signIn(account.email);
    const headers = auth(login.body.data.accessToken as string);
    const notifications = await Notification.create([
      { recipient: account._id, type: "SYSTEM", title: "Unread 1", message: "First" },
      { recipient: account._id, type: "SYSTEM", title: "Unread 2", message: "Second" },
      { recipient: account._id, type: "SYSTEM", title: "Already read", message: "Third", readAt: new Date() },
    ]);
    const firstPage = await request(app).get("/api/v1/notifications?page=1&limit=1").set(headers);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toMatchObject({ total: 3, unread: 2, page: 1, pages: 3 });
    expect((await request(app).patch(`/api/v1/notifications/${notifications[0]?._id}/read`).set(headers)).status).toBe(200);
    const afterOneRead = await request(app).get("/api/v1/notifications?unreadOnly=true").set(headers);
    expect(afterOneRead.body.data.unread).toBe(1);
    expect((await request(app).patch("/api/v1/notifications/read-all").set(headers)).body.data.updated).toBe(1);
    expect((await request(app).get("/api/v1/notifications?unreadOnly=true").set(headers)).body.data.unread).toBe(0);
  });
});
