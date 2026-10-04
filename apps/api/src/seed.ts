import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { Category } from "./models/category.js";
import { Inventory } from "./models/inventory.js";
import { LoyaltyAccount, LoyaltyTransaction } from "./models/loyalty.js";
import { Notification } from "./models/notification.js";
import { Product } from "./models/product.js";
import { Promotion } from "./models/promotion.js";
import { PurchaseOrder } from "./models/purchase-order.js";
import { Sale } from "./models/sale.js";
import { Store } from "./models/store.js";
import { Supplier } from "./models/supplier.js";
import { User } from "./models/user.js";

if (env.NODE_ENV === "production") throw new Error("Seed data is disabled in production");
if (process.env.ALLOW_DEMO_SEED_RESET !== "true") {
  throw new Error("Demo seeding drops the selected database. Set ALLOW_DEMO_SEED_RESET=true only for a disposable local database.");
}

await mongoose.connect(env.MONGODB_URI);
await mongoose.connection.db!.dropDatabase();

const passwordHash = await argon2.hash("DemoPass!2026", { type: argon2.argon2id });
const [lazimpat, thamel] = await Store.create([
  { name: "Lazimpat Flagship", code: "LZM-01", address: "Lazimpat Road, Kathmandu", openingHours: { daily: "07:00-22:00" } },
  { name: "Thamel Express", code: "THM-02", address: "Thamel Marg, Kathmandu", openingHours: { daily: "08:00-23:00" } },
]);
if (!lazimpat || !thamel) throw new Error("Stores could not be seeded");

const [admin, manager, cashier, staff, customer, customerTwo] = await User.create([
  { email: "admin@smartretail.demo", passwordHash, firstName: "Saanvi", lastName: "Adhikari", role: "SUPER_ADMIN", storeIds: [lazimpat._id, thamel._id], emailVerifiedAt: new Date() },
  { email: "manager@smartretail.demo", passwordHash, firstName: "Aarav", lastName: "Shrestha", role: "STORE_MANAGER", storeIds: [lazimpat._id], emailVerifiedAt: new Date() },
  { email: "cashier@smartretail.demo", passwordHash, firstName: "Nisha", lastName: "Rai", role: "CASHIER", storeIds: [lazimpat._id], emailVerifiedAt: new Date() },
  { email: "staff@smartretail.demo", passwordHash, firstName: "Bikash", lastName: "Gurung", role: "STORE_STAFF", storeIds: [lazimpat._id], emailVerifiedAt: new Date() },
  { email: "customer@smartretail.demo", passwordHash, firstName: "Anisha", lastName: "Rai", role: "CUSTOMER", storeIds: [], emailVerifiedAt: new Date() },
  { email: "kabir@smartretail.demo", passwordHash, firstName: "Kabir", lastName: "Sharma", role: "CUSTOMER", storeIds: [], emailVerifiedAt: new Date() },
]);
if (!admin || !manager || !cashier || !staff || !customer || !customerTwo) throw new Error("Users could not be seeded");
await Store.updateOne({ _id: lazimpat._id }, { $set: { manager: manager._id } });

await Category.create([
  { name: "Food", slug: "food", description: "Everyday food and pantry essentials" },
  { name: "Drinks", slug: "drinks", description: "Hot and cold drinks" },
  { name: "Fresh produce", slug: "fresh-produce", description: "Fresh fruit and vegetables" },
  { name: "Home", slug: "home", description: "Household essentials" },
]);

const productSeed = [
  ["Himalayan Roast", "himalayan-roast", "COF-1042", "8901000001042", "Coffee & tea", "KTM Roasters", 85000, 129900, 1300],
  ["Oat Milk Barista", "oat-milk-barista", "DRY-2089", "8901000002089", "Dairy & alternatives", "Oatside", 31000, 47500, 1300],
  ["Sea Salt Crisps", "sea-salt-crisps", "SNK-3021", "8901000003021", "Snacks", "Valley Crunch", 15000, 24500, 1300],
  ["Wildflower Honey", "wildflower-honey", "PNT-4110", "8901000004110", "Pantry", "Himalayan Harvest", 56000, 82500, 1300],
  ["Sparkling Lime", "sparkling-lime", "DRK-5512", "8901000005512", "Drinks", "Spring Nepal", 10000, 18000, 1300],
  ["Almond Granola", "almond-granola", "BFT-6017", "8901000006017", "Breakfast", "Morning Co.", 44000, 69000, 1300],
  ["Dark Chocolate 72%", "dark-chocolate-72", "SNK-7241", "8901000007241", "Snacks", "Cacao House", 22000, 35000, 1300],
  ["Organic Bananas", "organic-bananas", "FRE-8083", "8901000008083", "Fresh produce", "Valley Fresh", 12500, 19500, 0],
] as const;
const products = await Product.create(productSeed.map(([name, slug, sku, barcode, category, brand, costPrice, sellingPrice, taxRateBps]) => ({
  name, slug, sku, barcode, category, brand, costPrice, sellingPrice, taxRateBps,
  description: `${name} selected for the SmartRetail demonstration catalogue.`,
  images: [`/products/${slug}.svg`], status: "ACTIVE", qr: { publicId: `p_${randomUUID()}`, version: 1 },
})));

const quantities = [38, 7, 23, 4, 52, 0, 29, 15];
await Inventory.create(products.flatMap((product, index) => [
  { store: lazimpat._id, product: product._id, availableQuantity: quantities[index], reservedQuantity: index === 0 ? 4 : 0, damagedQuantity: index === 2 ? 2 : 0, reorderLevel: index === 1 ? 10 : 8, reorderQuantity: 30 },
  { store: thamel._id, product: product._id, availableQuantity: Math.max(3, Math.floor((quantities[index] ?? 0) / 2)), reservedQuantity: 0, damagedQuantity: 0, reorderLevel: 6, reorderQuantity: 20 },
]));

const [supplier] = await Supplier.create([
  { name: "Himalayan Harvest", contactPerson: "Mina Karki", phone: "+977-9800001001", email: "orders@himalayan.demo", address: "Balaju, Kathmandu", taxNumber: "PAN-550019", storeIds: [lazimpat._id, thamel._id], productsSupplied: products.slice(0, 4).map((product) => product._id), leadTimeDays: 3 },
  { name: "Valley Fresh Co.", contactPerson: "Rohan Lama", phone: "+977-9800001002", email: "supply@valleyfresh.demo", address: "Kalimati, Kathmandu", taxNumber: "PAN-550020", storeIds: [lazimpat._id, thamel._id], productsSupplied: [products[7]!._id], leadTimeDays: 1 },
]);
if (!supplier) throw new Error("Supplier could not be seeded");

await Promotion.create({ title: "Welcome to SmartRetail", code: "WELCOME10", type: "PERCENTAGE_DISCOUNT", discount: 1_000, minimumSpend: 200_000, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), usageLimit: 10_000, perUserLimit: 2, status: "ACTIVE" });
const loyalty = await LoyaltyAccount.create({ customer: customer._id, pointsBalance: 1_840, lifetimePoints: 5_280, tier: "GOLD" });
await LoyaltyTransaction.create({ account: loyalty._id, customer: customer._id, type: "ADJUST", points: 1_840, balanceAfter: 1_840, referenceType: "Seed", referenceId: new mongoose.Types.ObjectId(), note: "Demo opening balance" });

const seededSaleItems = [
  { product: products[0]!._id, name: products[0]!.name, sku: products[0]!.sku, quantity: 2, unitPrice: 129900, costPrice: 85000, subtotal: 259800, discount: 0, tax: 33774, total: 293574 },
  { product: products[2]!._id, name: products[2]!.name, sku: products[2]!.sku, quantity: 1, unitPrice: 24500, costPrice: 15000, subtotal: 24500, discount: 0, tax: 3185, total: 27685 },
];
await Sale.create({ saleNumber: "SR-20261003-DEMO", verificationCode: "SRV1-DEMORECEIPT01", store: lazimpat._id, customer: customer._id, cashier: cashier._id, items: seededSaleItems, subtotal: 284300, discount: 0, tax: 36959, total: 321259, paymentMethod: "CARD", paymentStatus: "PAID", saleStatus: "PAID", idempotencyKey: "seed-demo-sale-0001", loyaltyPointsEarned: 48 });

await PurchaseOrder.create({ orderNumber: "PO-20261003-001", supplier: supplier._id, store: lazimpat._id, items: [{ product: products[1]!._id, quantity: 36, receivedQuantity: 0, unitCost: 31000, lineTotal: 1_116_000 }], total: 1_116_000, expectedDeliveryDate: new Date("2026-10-06"), status: "ORDERED", createdBy: manager._id, approvedBy: manager._id, approvedAt: new Date(), orderedAt: new Date() });
await Notification.create({ recipient: manager._id, type: "LOW_STOCK", title: "Low stock requires attention", message: "Oat Milk Barista has 7 units remaining.", data: { storeId: String(lazimpat._id), productId: String(products[1]!._id) } });

console.log(JSON.stringify({
  seeded: true,
  credentials: {
    password: "DemoPass!2026",
    users: ["admin@smartretail.demo", "manager@smartretail.demo", "cashier@smartretail.demo", "staff@smartretail.demo", "customer@smartretail.demo"],
  },
  storeIds: { lazimpat: String(lazimpat._id), thamel: String(thamel._id) },
}, null, 2));

await mongoose.disconnect();
