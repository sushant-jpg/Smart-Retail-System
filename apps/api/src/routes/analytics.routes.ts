import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { assertStoreAccess } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Inventory } from "../models/inventory.js";
import { Sale } from "../models/sale.js";

const router = Router();
const rangeFields = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});
const validRange = ({ from, to }: { from: Date; to: Date }) => from <= to && to.getTime() - from.getTime() <= 366 * 24 * 60 * 60 * 1000;
const rangeQuery = rangeFields.refine(validRange, "Invalid date range");
const query = rangeFields.extend({ storeId: z.string().regex(/^[a-f\d]{24}$/i) }).refine(validRange, "Invalid date range");

router.get("/stores", authenticate, requirePermission("analytics.read"), validate(rangeQuery, "query"), async (req, res, next) => {
  try {
    const { from, to } = req.query as unknown as z.infer<typeof rangeQuery>;
    const allowed = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { store: { $in: req.auth!.storeIds.map((id) => new Types.ObjectId(id)) } };
    const stores = await Sale.aggregate([
      { $match: { ...allowed, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: "$store", revenue: { $sum: "$total" }, orders: { $sum: 1 }, itemsSold: { $sum: { $sum: "$items.quantity" } } } },
      { $lookup: { from: "stores", localField: "_id", foreignField: "_id", as: "store" } }, { $unwind: "$store" },
      { $project: { _id: 0, storeId: "$_id", name: "$store.name", code: "$store.code", revenue: 1, orders: 1, itemsSold: 1, averageOrderValue: { $round: [{ $divide: ["$revenue", "$orders"] }, 0] } } },
      { $sort: { revenue: -1 } },
    ]);
    res.json({ success: true, data: stores });
  } catch (error) { next(error); }
});

router.get("/overview", authenticate, requirePermission("analytics.read"), validate(query, "query"), async (req, res, next) => {
  try {
    const { storeId, from, to } = req.query as unknown as z.infer<typeof query>;
    assertStoreAccess(req.auth!, storeId);
    const store = new Types.ObjectId(storeId);
    const match = { store, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { $gte: from, $lte: to } };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [sales, todaySales, inventory, revenueSeries, categories, topProducts, slowProducts, paymentMethods] = await Promise.all([
      Sale.aggregate([
        { $match: match },
        { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 }, itemsSold: { $sum: { $sum: "$items.quantity" } }, customers: { $addToSet: "$customer" }, grossProfit: { $sum: { $subtract: [{ $subtract: ["$subtotal", "$discount"] }, { $sum: { $map: { input: "$items", as: "item", in: { $multiply: ["$$item.costPrice", "$$item.quantity"] } } } }] } } } },
      ]),
      Sale.aggregate([
        { $match: { store, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED"] } } },
        { $match: { $expr: { $eq: [{ $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kathmandu" } }, today] } } },
        { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 }, itemsSold: { $sum: { $sum: "$items.quantity" } }, customers: { $addToSet: "$customer" }, grossProfit: { $sum: { $subtract: [{ $subtract: ["$subtotal", "$discount"] }, { $sum: { $map: { input: "$items", as: "item", in: { $multiply: ["$$item.costPrice", "$$item.quantity"] } } } }] } } } },
      ]),
      Inventory.aggregate([
        { $match: { store } },
        { $group: { _id: null, lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$availableQuantity", 0] }, { $lte: ["$availableQuantity", "$reorderLevel"] }] }, 1, 0] } }, outOfStock: { $sum: { $cond: [{ $eq: ["$availableQuantity", 0] }, 1, 0] } } } },
      ]),
      Sale.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kathmandu" } }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $project: { _id: 0, day: "$_id", revenue: 1, orders: 1 } }]),
      Sale.aggregate([{ $match: match }, { $unwind: "$items" }, { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "product" } }, { $unwind: "$product" }, { $group: { _id: "$product.category", revenue: { $sum: "$items.total" }, quantity: { $sum: "$items.quantity" } } }, { $sort: { revenue: -1 } }, { $project: { _id: 0, category: "$_id", revenue: 1, quantity: 1 } }]),
      Sale.aggregate([{ $match: match }, { $unwind: "$items" }, { $group: { _id: "$items.product", name: { $first: "$items.name" }, sku: { $first: "$items.sku" }, revenue: { $sum: "$items.total" }, quantity: { $sum: "$items.quantity" } } }, { $sort: { quantity: -1 } }, { $limit: 10 }, { $project: { _id: 0, productId: "$_id", name: 1, sku: 1, revenue: 1, quantity: 1 } }]),
      Sale.aggregate([{ $match: match }, { $unwind: "$items" }, { $group: { _id: "$items.product", name: { $first: "$items.name" }, sku: { $first: "$items.sku" }, revenue: { $sum: "$items.total" }, quantity: { $sum: "$items.quantity" } } }, { $sort: { quantity: 1, revenue: 1 } }, { $limit: 10 }, { $project: { _id: 0, productId: "$_id", name: 1, sku: 1, revenue: 1, quantity: 1 } }]),
      Sale.aggregate([{ $match: match }, { $group: { _id: "$paymentMethod", revenue: { $sum: "$total" }, orders: { $sum: 1 } } }, { $project: { _id: 0, method: "$_id", revenue: 1, orders: 1 } }]),
    ]);
    const totals = sales[0] ?? { revenue: 0, orders: 0, itemsSold: 0, grossProfit: 0, customers: [] };
    const daily = todaySales[0] ?? { revenue: 0, orders: 0, itemsSold: 0, grossProfit: 0, customers: [] };
    res.json({ success: true, data: { revenue: totals.revenue, orders: totals.orders, itemsSold: totals.itemsSold, grossProfit: totals.grossProfit, activeCustomers: totals.customers.filter(Boolean).length, averageOrderValue: totals.orders ? Math.round(totals.revenue / totals.orders) : 0, today: { revenue: daily.revenue, orders: daily.orders, itemsSold: daily.itemsSold, grossProfit: daily.grossProfit, activeCustomers: daily.customers.filter(Boolean).length, averageOrderValue: daily.orders ? Math.round(daily.revenue / daily.orders) : 0 }, ...(inventory[0] ?? { lowStock: 0, outOfStock: 0 }), revenueSeries, categories, topProducts, slowProducts, paymentMethods } });
  } catch (error) { next(error); }
});

export default router;
