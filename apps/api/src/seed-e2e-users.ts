import argon2 from "argon2";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { Inventory } from "./models/inventory.js";
import { LoyaltyAccount } from "./models/loyalty.js";
import { Product } from "./models/product.js";
import { Store } from "./models/store.js";
import { User } from "./models/user.js";
import type { Role } from "./lib/permissions.js";

const databaseName = new URL(env.MONGODB_URI).pathname.slice(1);
if (env.NODE_ENV === "production" || !env.E2E_TEST_MODE || databaseName !== "smartretail_e2e") {
  throw new Error("E2E account seeding requires E2E_TEST_MODE and the isolated smartretail_e2e database");
}

const projectNames = ["chromium", "mobile"];
const personas: Array<{ slug: string; role: Role; firstName: string; storeIds: mongoose.Types.ObjectId[]; customer: boolean }> = [];

await mongoose.connect(env.MONGODB_URI);
try {
  const stores = await Store.find({ status: "ACTIVE" }).sort({ code: 1 }).select("_id code").lean();
  const primaryStore = stores.find((store) => store.code === "LZM-01");
  if (!primaryStore) throw new Error("The isolated E2E database must be seeded before E2E accounts are created");
  const storeIds = stores.map((store) => store._id);
  await Product.bulkWrite([
    { updateOne: { filter: { sku: "COF-1042" }, update: { $set: { "qr.publicId": "p_e2e_himalayan", "qr.version": 1 } } } },
    { updateOne: { filter: { sku: "BFT-6017" }, update: { $set: { "qr.publicId": "p_e2e_soldout", "qr.version": 1 } } } },
  ]);
  const inactive = await Product.create({
    name: "E2E Inactive Product",
    slug: "e2e-inactive-product",
    description: "Inactive product fixture for browser regression checks.",
    sku: "E2E-INACTIVE-01",
    barcode: "8901000099991",
    category: "Test",
    brand: "SmartRetail",
    costPrice: 100,
    sellingPrice: 200,
    taxRateBps: 0,
    images: ["/products/oat-milk-barista.svg"],
    status: "INACTIVE",
    qr: { publicId: "p_e2e_inactive", version: 1 },
  });
  await Inventory.create({ store: primaryStore._id, product: inactive._id, availableQuantity: 4, reorderLevel: 0, reorderQuantity: 4 });
  personas.push(
    { slug: "customer", role: "CUSTOMER", firstName: "E2E Customer", storeIds: [], customer: true },
    { slug: "cashier", role: "CASHIER", firstName: "E2E Cashier", storeIds: [primaryStore._id], customer: false },
    { slug: "manager", role: "STORE_MANAGER", firstName: "E2E Manager", storeIds: [primaryStore._id], customer: false },
    { slug: "admin", role: "SUPER_ADMIN", firstName: "E2E Admin", storeIds, customer: false },
  );

  const passwordHash = await argon2.hash("DemoPass!2026", { type: argon2.argon2id });
  const operations = [];
  const customerEmails: string[] = [];
  for (const project of projectNames) {
    for (let worker = 0; worker < 4; worker += 1) {
      for (const persona of personas) {
        for (let account = 0; account < 32; account += 1) {
          const email = `e2e-${persona.slug}-${project}-${worker}-${account}@smartretail.demo`;
          operations.push({
            updateOne: {
              filter: { email },
              update: {
                $set: {
                  email,
                  passwordHash,
                  firstName: persona.firstName,
                  lastName: `${worker + 1}-${account + 1}`,
                  role: persona.role,
                  storeIds: persona.storeIds,
                  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
                  failedLoginAttempts: 0,
                  loginHistory: [],
                  status: "ACTIVE" as const,
                },
                $unset: { lockedUntil: "" as const },
              },
              upsert: true,
            },
          });
          if (persona.customer) customerEmails.push(email);
        }
      }
    }
  }
  await User.bulkWrite(operations, { ordered: false });

  const customerUsers = await User.find({ email: { $in: customerEmails } }).select("_id email").lean();
  await LoyaltyAccount.bulkWrite(customerUsers.map((user) => ({
    updateOne: {
      filter: { customer: user._id },
      update: { $set: { pointsBalance: 1_840, lifetimePoints: 5_280, tier: "GOLD" } },
      upsert: true,
    },
  })), { ordered: false });
  console.log(JSON.stringify({ seededE2EAccounts: operations.length, customerAccounts: customerUsers.length }));
} finally {
  await mongoose.disconnect();
}
