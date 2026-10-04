import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Product } from "../models/product.js";
import { Sale } from "../models/sale.js";
import { Supplier } from "../models/supplier.js";
import { User } from "../models/user.js";

const router = Router();
const query = z.object({ q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(25).default(8) });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", authenticate, validate(query, "query"), async (req, res, next) => {
  try {
    const { q, limit } = req.query as unknown as z.infer<typeof query>;
    const match = new RegExp(escapeRegex(q), "i");
    const storeScope = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role) ? {} : { store: { $in: req.auth!.storeIds } };
    const [products, sales, customers, suppliers] = await Promise.all([
      Product.find({ $or: [{ name: match }, { sku: match }, { barcode: match }] }).select("name sku barcode sellingPrice status").limit(limit).lean(),
      Sale.find({ ...storeScope, saleNumber: match }).select("saleNumber total saleStatus createdAt").limit(limit).lean(),
      User.find({ role: "CUSTOMER", $or: [{ email: match }, { firstName: match }, { lastName: match }] }).select("firstName lastName email status").limit(limit).lean(),
      Supplier.find({ $or: [{ name: match }, { email: match }, { phone: match }] }).select("name email phone status").limit(limit).lean(),
    ]);
    res.json({ success: true, data: { products, sales, customers, suppliers } });
  } catch (error) { next(error); }
});

export default router;
