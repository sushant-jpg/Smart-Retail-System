import mongoose from "mongoose";
import { env } from "./config/env.js";
import { Product } from "./models/product.js";

const imageBySlug: Record<string, string> = {
  "oat-milk-barista": "/products/oat-milk-barista.svg",
  "sea-salt-crisps": "/products/sea-salt-crisps.svg",
  "almond-granola": "/products/almond-granola.svg",
  "dark-chocolate-72": "/products/dark-chocolate-72.svg",
  "sparkling-lime": "/products/sparkling-lime.svg",
  "himalayan-roast": "/products/himalayan-roast.svg",
  "wildflower-honey": "/products/wildflower-honey.svg",
  "organic-bananas": "/products/organic-bananas.svg",
};

const database = new URL(env.MONGODB_URI);
const databaseName = database.pathname.slice(1);
if (
  env.NODE_ENV === "production"
  || !["localhost", "127.0.0.1", "::1"].includes(database.hostname)
  || !["27017", "27018"].includes(database.port || "27017")
  || databaseName !== "smartretail"
) {
  throw new Error("Product image backfill is restricted to the local smartretail development database on MongoDB ports 27017 or 27018");
}

await mongoose.connect(env.MONGODB_URI);
try {
  const operations = Object.entries(imageBySlug).map(([slug, image]) => ({
    updateOne: {
      filter: { slug, $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] },
      update: { $set: { images: [image] } },
    },
  }));
  const result = await Product.bulkWrite(operations);
  console.log(JSON.stringify({
    updated: result.modifiedCount,
    matched: result.matchedCount,
    unchanged: Object.keys(imageBySlug).length - result.modifiedCount,
  }));
} finally {
  await mongoose.disconnect();
}
