import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../models/audit-log.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { InventoryMovement } from "../models/inventory-movement.js";
import { Inventory } from "../models/inventory.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/loyalty.js";
import { PaymentAttempt } from "../models/payment-attempt.js";
import { Product } from "../models/product.js";
import { PurchaseOrder } from "../models/purchase-order.js";
import { Refund } from "../models/refund.js";
import { Sale } from "../models/sale.js";
import { Store } from "../models/store.js";
import { Supplier } from "../models/supplier.js";
import { User } from "../models/user.js";
import { completeRefund } from "../services/refund.service.js";
import { confirmPaymentAttempt, createPaymentAttempt, findReceiptForCustomer } from "../services/payment.service.js";
import { receivePurchaseOrder } from "../services/purchase-order.service.js";
import { processExpiredLoyaltyPoints } from "../services/loyalty-expiry.service.js";

const mongoUri = process.env.MONGODB_TEST_URI
  ?? "mongodb://127.0.0.1:27018/smartretail_integration?replicaSet=rs0&directConnection=true";

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(stock = 10) {
  const store = await Store.create({ name: "Integration Store", code: `IT${randomUUID().slice(0, 6)}`, address: "Test address" });
  const [customer, secondCustomer, manager] = await User.create([
    { email: `${randomUUID()}@customer.test`, passwordHash: "unused", firstName: "Test", lastName: "Customer", role: "CUSTOMER", emailVerifiedAt: new Date() },
    { email: `${randomUUID()}@customer.test`, passwordHash: "unused", firstName: "Second", lastName: "Customer", role: "CUSTOMER", emailVerifiedAt: new Date() },
    { email: `${randomUUID()}@manager.test`, passwordHash: "unused", firstName: "Test", lastName: "Manager", role: "STORE_MANAGER", storeIds: [store._id], emailVerifiedAt: new Date() },
  ]);
  const product = await Product.create({
    name: "Integration Product", slug: `product-${randomUUID()}`, description: "", sku: `SKU-${randomUUID()}`,
    barcode: randomUUID(), qr: { publicId: `p_${randomUUID()}`, version: 1 }, category: "Test", brand: "Test",
    costPrice: 5_000, sellingPrice: 10_000, taxRateBps: 0, images: [], status: "ACTIVE",
  });
  await Inventory.create({ store: store._id, product: product._id, availableQuantity: stock, reorderLevel: 0, reorderQuantity: 10 });
  return { store, customer, secondCustomer, manager, product };
}

const checkoutInput = (data: Fixture, quantity = 1, loyaltyPoints = 0) => ({
  storeId: String(data.store._id),
  items: [{ productId: String(data.product._id), quantity }],
  loyaltyPoints,
  paymentMethod: "CASH" as const,
});

async function pay(data: Fixture, customer = data.customer, key = `checkout-${randomUUID()}`, quantity = 1, loyaltyPoints = 0) {
  const actor = { userId: String(customer._id), role: "CUSTOMER" };
  const attempt = await createPaymentAttempt(checkoutInput(data, quantity, loyaltyPoints), key, actor);
  const result = await confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID());
  if (!result.sale) throw new Error("Expected checkout to create a sale");
  return { attempt, result, sale: result.sale as { saleId: string; saleNumber: string; total: number } };
}

beforeAll(async () => { await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8_000 }); });
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.syncIndexes();
});
afterAll(async () => { await mongoose.disconnect(); });

describe("checkout transactions", () => {
  it("persists a sale, decrements inventory, records movement/audit, and retrieves its receipt", async () => {
    const data = await fixture(3);
    const { sale } = await pay(data);
    const [storedSale, inventory, movement, audit, receipt] = await Promise.all([
      Sale.findById(sale.saleId).lean(),
      Inventory.findOne({ store: data.store._id, product: data.product._id }).lean(),
      InventoryMovement.findOne({ referenceType: "Sale", referenceId: sale.saleId }).lean(),
      AuditLog.findOne({ action: "SALE_COMPLETED", resourceId: sale.saleId }).lean(),
      findReceiptForCustomer(sale.saleNumber, String(data.customer._id)),
    ]);
    expect(storedSale?.saleNumber).toBe(sale.saleNumber);
    expect(inventory?.availableQuantity).toBe(2);
    expect(movement?.quantityDelta).toBe(-1);
    expect(audit).toBeTruthy();
    expect(receipt.saleNumber).toBe(sale.saleNumber);
  });

  it("allows only one buyer to purchase the final item and never makes stock negative", async () => {
    const data = await fixture(1);
    const firstActor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const secondActor = { userId: String(data.secondCustomer._id), role: "CUSTOMER" };
    const [first, second] = await Promise.all([
      createPaymentAttempt(checkoutInput(data), `attempt-${randomUUID()}`, firstActor),
      createPaymentAttempt(checkoutInput(data), `attempt-${randomUUID()}`, secondActor),
    ]);
    const results = await Promise.allSettled([
      confirmPaymentAttempt(first.paymentAttemptId, firstActor, randomUUID()),
      confirmPaymentAttempt(second.paymentAttemptId, secondActor, randomUUID()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await Sale.countDocuments()).toBe(1);
    expect((await Inventory.findOne({ product: data.product._id }).lean())?.availableQuantity).toBe(0);
  });

  it("reuses a stable idempotency key and cannot create a duplicate sale", async () => {
    const data = await fixture(3);
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const key = `stable-${randomUUID()}`;
    const first = await createPaymentAttempt(checkoutInput(data), key, actor);
    const duplicate = await createPaymentAttempt(checkoutInput(data), key, actor);
    expect(duplicate.paymentAttemptId).toBe(first.paymentAttemptId);
    const paid = await confirmPaymentAttempt(first.paymentAttemptId, actor, randomUUID());
    const retried = await confirmPaymentAttempt(first.paymentAttemptId, actor, randomUUID());
    expect(retried.sale).toEqual(paid.sale);
    expect(await Sale.countDocuments()).toBe(1);
  });

  it("replays simultaneous confirmations deterministically with one sale and one stock deduction", async () => {
    const data = await fixture(3);
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const attempt = await createPaymentAttempt(checkoutInput(data), `parallel-${randomUUID()}`, actor);
    const results = await Promise.all([
      confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID()),
      confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID()),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.paymentStatus).toBe("APPROVED");
    expect(await Sale.countDocuments()).toBe(1);
    expect(await InventoryMovement.countDocuments({ referenceType: "Sale" })).toBe(1);
    expect((await Inventory.findOne({ product: data.product._id }).lean())?.availableQuantity).toBe(2);
  });

  it("rejects checkout when stock becomes unavailable after quote creation", async () => {
    const data = await fixture(1);
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const attempt = await createPaymentAttempt(checkoutInput(data), `stock-change-${randomUUID()}`, actor);
    await Inventory.updateOne({ store: data.store._id, product: data.product._id }, { $set: { availableQuantity: 0 } });
    await expect(confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID()))
      .rejects.toMatchObject({ code: "INVENTORY_INSUFFICIENT", status: 409 });
    expect(await Sale.countDocuments()).toBe(0);
    expect((await Inventory.findOne({ product: data.product._id }).lean())?.availableQuantity).toBe(0);
  });

  it("refreshes a stale checkout quote and requires confirmation at the current price", async () => {
    const data = await fixture(3);
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const key = `price-change-${randomUUID()}`;
    const attempt = await createPaymentAttempt(checkoutInput(data), key, actor);
    expect(attempt.quote.total).toBe(10_000);

    await Product.updateOne({ _id: data.product._id }, { $set: { sellingPrice: 12_500 } });
    await expect(confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID()))
      .rejects.toMatchObject({ code: "PRICE_CHANGED", status: 409 });

    const refreshed = await PaymentAttempt.findById(attempt.paymentAttemptId).lean();
    expect(refreshed?.quote.total).toBe(12_500);
    expect(await Sale.countDocuments()).toBe(0);

    const confirmed = await confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID());
    expect(confirmed.sale?.total).toBe(12_500);
    expect(await Sale.countDocuments()).toBe(1);
  });

  it("treats a distinct idempotency key as a distinct intentional purchase", async () => {
    const data = await fixture(3);
    const first = await pay(data, data.customer, `first-${randomUUID()}`);
    const second = await pay(data, data.customer, `second-${randomUUID()}`);
    expect(second.sale.saleNumber).not.toBe(first.sale.saleNumber);
    expect(await Sale.countDocuments()).toBe(2);
  });
});

describe("refund and procurement concurrency", () => {
  it("replays a completed refund without duplicating its inventory or loyalty effects", async () => {
    const data = await fixture(2);
    const { sale } = await pay(data, data.customer, `sale-${randomUUID()}`);
    const saleDocument = await Sale.findById(sale.saleId).lean();
    if (!saleDocument) throw new Error("Sale missing");
    const refund = await Refund.create({
      refundNumber: `RF-${randomUUID()}`, sale: saleDocument._id, store: data.store._id, customer: data.customer._id,
      items: [{ product: data.product._id, quantity: 1, amount: saleDocument.total, restock: true }], amount: saleDocument.total,
      reason: "Duplicate completion test", status: "APPROVED", requestedBy: data.manager._id,
    });
    const actor = { userId: String(data.manager._id), role: "STORE_MANAGER" };
    const key = `refund-${randomUUID()}`;
    const first = await completeRefund(String(refund._id), key, actor, randomUUID());
    const replay = await completeRefund(String(refund._id), key, actor, randomUUID());

    expect(replay).toEqual(first);
    expect(await Refund.countDocuments({ _id: refund._id, status: "COMPLETED" })).toBe(1);
    expect(await InventoryMovement.countDocuments({ referenceType: "Refund", referenceId: refund._id })).toBe(1);
    expect((await Inventory.findOne({ product: data.product._id }).lean())?.availableQuantity).toBe(2);
    expect((await LoyaltyAccount.findOne({ customer: data.customer._id }).lean())?.pointsBalance).toBe(0);
  });

  it("atomically rejects concurrent refunds that exceed purchased quantity/value", async () => {
    const data = await fixture(2);
    const { sale } = await pay(data, data.customer, `sale-${randomUUID()}`, 2);
    const saleDocument = await Sale.findById(sale.saleId).lean();
    if (!saleDocument) throw new Error("Sale missing");
    const refunds = await Refund.create([
      { refundNumber: `RF-${randomUUID()}`, sale: saleDocument._id, store: data.store._id, customer: data.customer._id, items: [{ product: data.product._id, quantity: 2, amount: saleDocument.total, restock: true }], amount: saleDocument.total, reason: "Concurrency test", status: "APPROVED", requestedBy: data.manager._id },
      { refundNumber: `RF-${randomUUID()}`, sale: saleDocument._id, store: data.store._id, customer: data.customer._id, items: [{ product: data.product._id, quantity: 2, amount: saleDocument.total, restock: true }], amount: saleDocument.total, reason: "Concurrency test", status: "APPROVED", requestedBy: data.manager._id },
    ]);
    const actor = { userId: String(data.manager._id), role: "STORE_MANAGER" };
    const results = await Promise.allSettled(refunds.map((refund) => completeRefund(String(refund._id), `refund-${randomUUID()}`, actor, randomUUID())));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await Refund.countDocuments({ status: "COMPLETED" })).toBe(1);
    expect((await Inventory.findOne({ product: data.product._id }).lean())?.availableQuantity).toBe(2);
  });

  it("receives a purchase order only once under concurrent and duplicate delivery", async () => {
    const data = await fixture(0);
    const supplier = await Supplier.create({ name: "Integration Supplier", contactPerson: "Tester", phone: "123", email: `${randomUUID()}@supplier.test`, address: "Test", taxNumber: randomUUID(), productsSupplied: [data.product._id] });
    const order = await PurchaseOrder.create({ orderNumber: `PO-${randomUUID()}`, supplier: supplier._id, store: data.store._id, items: [{ product: data.product._id, quantity: 100, receivedQuantity: 0, unitCost: 5_000, lineTotal: 500_000 }], total: 500_000, expectedDeliveryDate: new Date(), status: "ORDERED", createdBy: data.manager._id });
    const actor = { userId: String(data.manager._id), role: "STORE_MANAGER" };
    const input = { items: [{ productId: String(data.product._id), quantity: 100 }] };
    const keys = [`receive-${randomUUID()}`, `receive-${randomUUID()}`];
    const results = await Promise.allSettled([
      receivePurchaseOrder(String(order._id), input, keys[0]!, actor, randomUUID()),
      receivePurchaseOrder(String(order._id), input, keys[1]!, actor, randomUUID()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const successfulIndex = results.findIndex((result) => result.status === "fulfilled");
    const duplicate = await receivePurchaseOrder(String(order._id), input, keys[successfulIndex]!, actor, randomUUID());
    expect(duplicate).toBeTruthy();
    const [storedOrder, inventory, movements] = await Promise.all([
      PurchaseOrder.findById(order._id).lean(), Inventory.findOne({ product: data.product._id }).lean(),
      InventoryMovement.countDocuments({ referenceType: "PurchaseOrder", referenceId: order._id }),
    ]);
    expect(storedOrder?.status).toBe("RECEIVED");
    expect(storedOrder?.items[0]?.receivedQuantity).toBe(100);
    expect(inventory?.availableQuantity).toBe(100);
    expect(movements).toBe(1);
  });
});

describe("loyalty expiry", () => {
  it("rejects point redemption beyond payable value even when the balance is sufficient", async () => {
    const data = await fixture(2);
    await LoyaltyAccount.create({ customer: data.customer._id, pointsBalance: 200, lifetimePoints: 200, tier: "BRONZE" });
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };

    await expect(createPaymentAttempt(checkoutInput(data, 1, 101), `over-redeem-${randomUUID()}`, actor))
      .rejects.toMatchObject({ code: "LOYALTY_REDEMPTION_EXCEEDED", status: 422 });

    expect(await Sale.countDocuments()).toBe(0);
    expect((await LoyaltyAccount.findOne({ customer: data.customer._id }).lean())?.pointsBalance).toBe(200);
  });

  it("allows only one concurrent checkout to redeem the same loyalty points", async () => {
    const data = await fixture(3);
    const account = await LoyaltyAccount.create({ customer: data.customer._id, pointsBalance: 4, lifetimePoints: 4, tier: "BRONZE" });
    const actor = { userId: String(data.customer._id), role: "CUSTOMER" };
    const attempts = await Promise.all([
      createPaymentAttempt(checkoutInput(data, 1, 4), `loyalty-a-${randomUUID()}`, actor),
      createPaymentAttempt(checkoutInput(data, 1, 4), `loyalty-b-${randomUUID()}`, actor),
    ]);
    const results = await Promise.allSettled(attempts.map((attempt) => confirmPaymentAttempt(attempt.paymentAttemptId, actor, randomUUID())));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await Sale.countDocuments()).toBe(1);
    expect((await LoyaltyAccount.findById(account._id).lean())?.pointsBalance).toBe(0);
    expect(await LoyaltyTransaction.countDocuments({ account: account._id, type: "REDEEM", points: -4 })).toBe(1);
  });

  it("earns, partially redeems, expires only the remainder, and is idempotent", async () => {
    const data = await fixture(20);
    await pay(data, data.customer, `earn-${randomUUID()}`, 10);
    const account = await LoyaltyAccount.findOne({ customer: data.customer._id });
    expect(account?.pointsBalance).toBe(10);
    await pay(data, data.customer, `redeem-${randomUUID()}`, 1, 4);
    expect((await LoyaltyAccount.findById(account?._id).lean())?.pointsBalance).toBe(6);
    await LoyaltyTransaction.updateMany({ account: account?._id, type: "EARN" }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    const first = await processExpiredLoyaltyPoints();
    const second = await processExpiredLoyaltyPoints();
    expect(first.expiredPoints).toBe(6);
    expect(second.expiredPoints).toBe(0);
    expect((await LoyaltyAccount.findById(account?._id).lean())?.pointsBalance).toBe(0);
    expect(await LoyaltyTransaction.countDocuments({ account: account?._id, type: "EXPIRE" })).toBe(1);
  });

  it("does not later expire points already reversed by a refund", async () => {
    const data = await fixture(10);
    const { sale } = await pay(data, data.customer, `earn-refund-${randomUUID()}`, 5);
    const saleDocument = await Sale.findById(sale.saleId).lean();
    if (!saleDocument) throw new Error("Sale missing");
    const refund = await Refund.create({
      refundNumber: `RF-${randomUUID()}`, sale: saleDocument._id, store: data.store._id, customer: data.customer._id,
      items: [{ product: data.product._id, quantity: 5, amount: saleDocument.total, restock: true }], amount: saleDocument.total,
      reason: "Full loyalty reversal", status: "APPROVED", requestedBy: data.manager._id,
    });
    await completeRefund(String(refund._id), `refund-${randomUUID()}`, { userId: String(data.manager._id), role: "STORE_MANAGER" }, randomUUID());
    const account = await LoyaltyAccount.findOne({ customer: data.customer._id }).lean();
    expect(account?.pointsBalance).toBe(0);
    await LoyaltyTransaction.updateMany({ account: account?._id, type: "EARN" }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await processExpiredLoyaltyPoints()).expiredPoints).toBe(0);
    expect(await LoyaltyTransaction.countDocuments({ account: account?._id, type: "EXPIRE" })).toBe(0);
  });
});

afterEach(async () => {
  await Promise.all([IdempotencyKey.deleteMany({}), PaymentAttempt.deleteMany({})]);
});
