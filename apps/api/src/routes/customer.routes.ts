import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Sale } from "../models/sale.js";
import { User } from "../models/user.js";

const router = Router();
const query = z.object({ q: z.string().trim().min(2).max(100) });
const listQuery = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const customerScope = async (req: Parameters<typeof authenticate>[0]) => {
  if (["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role)) return {};
  const customers = await Sale.distinct("customer", {
    store: { $in: req.auth!.storeIds },
    customer: { $ne: null },
  });
  return { _id: { $in: customers } };
};

router.get("/", authenticate, requirePermission("loyalty.manage"), validate(listQuery, "query"), async (req, res, next) => {
  try {
    const { q, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const term = q ? new RegExp(escapeRegex(q), "i") : undefined;
    const filter = { role: "CUSTOMER", ...(await customerScope(req)), ...(term ? { $or: [{ email: term }, { firstName: term }, { lastName: term }] } : {}) };
    const [items, total] = await Promise.all([
      User.find(filter).select("firstName lastName email status createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get("/lookup", authenticate, requirePermission("sale.create"), validate(query, "query"), async (req, res, next) => {
  try {
    if (!["CASHIER", "STORE_MANAGER", "ADMIN", "SUPER_ADMIN"].includes(req.auth!.role)) {
      throw new AppError(403, "PERMISSION_DENIED", "Customer lookup is available to checkout staff only");
    }
    const { q } = req.query as unknown as z.infer<typeof query>;
    const term = new RegExp(escapeRegex(q), "i");
    const customers = await User.find({
      role: "CUSTOMER", status: "ACTIVE", ...(await customerScope(req)),
      $or: [{ email: term }, { firstName: term }, { lastName: term }],
    }).select("firstName lastName email").sort({ lastName: 1, firstName: 1 }).limit(10).lean();
    res.json({ success: true, data: customers });
  } catch (error) { next(error); }
});

export default router;
