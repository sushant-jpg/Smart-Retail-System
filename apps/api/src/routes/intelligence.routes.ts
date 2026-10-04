import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Inventory } from "../models/inventory.js";
import { Product } from "../models/product.js";
import { publicProductImages } from "../lib/product-images.js";
import { Sale } from "../models/sale.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const recommendationInput = z.object({ storeId: objectId, cartProductIds: z.array(objectId).max(100).default([]), limit: z.number().int().min(1).max(30).default(6) });
const forecastQuery = z.object({ storeId: objectId, productId: objectId, horizonDays: z.coerce.number().int().min(1).max(90).default(7), supplierLeadDays: z.coerce.number().int().min(0).max(180).default(3) });

async function callAi(path: string, body: unknown) {
  try {
    const response = await fetch(`${env.AI_SERVICE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    return await response.json();
  } catch {
    throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "Intelligence service is temporarily unavailable");
  }
}

router.post("/recommendations", authenticate, validate(recommendationInput), async (req, res, next) => {
  try {
    const { storeId, cartProductIds, limit } = req.body as z.infer<typeof recommendationInput>;
    assertStoreAccess(req.auth!, storeId);
    const customerId = req.auth!.role === "CUSTOMER" ? req.auth!.userId : undefined;
    const store = new Types.ObjectId(storeId);
    const cartIds = cartProductIds.map((id) => new Types.ObjectId(id));
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
    const [inventory, history, trending, boughtWithCart] = await Promise.all([
      Inventory.find({ store: storeId, availableQuantity: { $gt: 0 } }).populate("product").limit(500).lean(),
      customerId ? Sale.find({ customer: customerId, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] } }).select("items.product").sort({ createdAt: -1 }).limit(30).lean() : [],
      Sale.aggregate([{ $match: { store, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { $gte: windowStart } } }, { $unwind: "$items" }, { $group: { _id: "$items.product", count: { $sum: "$items.quantity" } } }, { $sort: { count: -1 } }, { $limit: 50 }]),
      cartIds.length ? Sale.aggregate([
        { $match: { store, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { $gte: windowStart }, "items.product": { $in: cartIds } } },
        { $unwind: "$items" },
        { $match: { "items.product": { $nin: cartIds } } },
        { $group: { _id: "$items.product", count: { $sum: "$items.quantity" } } },
        { $sort: { count: -1 } },
        { $limit: 500 },
      ]) : [],
    ]);
    const purchasedIds = history.flatMap((sale) => sale.items.map((item) => String(item.product)));
    const purchasedProducts = purchasedIds.length ? await Product.find({ _id: { $in: purchasedIds } }).select("category").lean() : [];
    const recentCategories = purchasedProducts.map((product) => product.category);
    const maxTrending = Math.max(1, ...trending.map((item) => item.count as number));
    const trendingMap = new Map(trending.map((item) => [String(item._id), (item.count as number) / maxTrending]));
    const basketMap = new Map(boughtWithCart.map((item) => [String(item._id), item.count as number]));
    const candidates = inventory.map((entry) => {
      const product = entry.product as unknown as { _id: Types.ObjectId; name: string; category: string };
      return { product_id: String(product._id), name: product.name, category: product.category, in_stock: entry.availableQuantity > 0, trending_score: trendingMap.get(String(product._id)) ?? 0, bought_with_cart_count: basketMap.get(String(product._id)) ?? 0 };
    });
    const result = await callAi("/recommendations", { recent_categories: recentCategories, cart_product_ids: cartProductIds, candidates, limit });
    const ids = (result as { recommendations: Array<{ product_id: string }> }).recommendations.map((item) => item.product_id);
    const products = await Product.find({ _id: { $in: ids } }).select("name slug sku category sellingPrice images").lean();
    const productMap = new Map(products.map((product) => [String(product._id), { ...product, images: publicProductImages(product.images) }]));
    res.json({ success: true, data: { ...(result as object), recommendations: (result as { recommendations: Array<Record<string, unknown> & { product_id: string }> }).recommendations.map((item) => ({ ...item, product: productMap.get(item.product_id) })) } });
  } catch (error) { next(error); }
});

router.get("/forecast", authenticate, requirePermission("inventory.read"), validate(forecastQuery, "query"), async (req, res, next) => {
  try {
    const { storeId, productId, horizonDays, supplierLeadDays } = req.query as unknown as z.infer<typeof forecastQuery>;
    assertStoreAccess(req.auth!, storeId);
    const inventory = await Inventory.findOne({ store: storeId, product: productId }).populate("product", "name sku").lean();
    if (!inventory) throw new AppError(404, "INVENTORY_NOT_FOUND", "Inventory item not found");
    const from = new Date(); from.setUTCDate(from.getUTCDate() - 29); from.setUTCHours(0, 0, 0, 0);
    const sales = await Sale.aggregate([{ $match: { store: new Types.ObjectId(storeId), createdAt: { $gte: from }, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] } } }, { $unwind: "$items" }, { $match: { "items.product": new Types.ObjectId(productId) } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, quantity: { $sum: "$items.quantity" } } }]);
    const quantities = new Map(sales.map((entry) => [entry._id as string, entry.quantity as number]));
    const history = Array.from({ length: 30 }, (_, index) => { const day = new Date(from); day.setUTCDate(day.getUTCDate() + index); const key = day.toISOString().slice(0, 10); return { day: key, quantity: quantities.get(key) ?? 0 }; });
    const forecast = await callAi("/forecast", { history, horizon_days: horizonDays, current_stock: inventory.availableQuantity, supplier_lead_days: supplierLeadDays, safety_stock_days: 2 });
    res.json({ success: true, data: { product: inventory.product, currentStock: inventory.availableQuantity, reorderLevel: inventory.reorderLevel, ...forecast as object } });
  } catch (error) { next(error); }
});

export default router;
