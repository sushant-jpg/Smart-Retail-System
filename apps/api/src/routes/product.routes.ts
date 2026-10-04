import { randomUUID } from "node:crypto";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Product } from "../models/product.js";
import { createProductQrPayload, parseProductQrPayload } from "../lib/product-qr.js";
import { isSafeProductImage, publicProductImages } from "../lib/product-images.js";
import { AuditLog } from "../models/audit-log.js";
import { Inventory } from "../models/inventory.js";

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "OUT_OF_STOCK", "DISCONTINUED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const catalogQuery = z.object({ storeId: objectId, search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const productFields = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2_000).default(""),
  sku: z.string().trim().min(2).max(64),
  barcode: z.string().trim().min(6).max(64),
  category: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(80).default(""),
  costPrice: z.number().int().nonnegative(),
  sellingPrice: z.number().int().nonnegative(),
  taxRateBps: z.number().int().min(0).max(10_000),
  images: z.array(z.string().refine(isSafeProductImage, "Image must be a safe HTTPS URL or a public product asset path")).max(8).default([]),
  status: z.enum(["ACTIVE", "INACTIVE", "OUT_OF_STOCK", "DISCONTINUED"]).default("ACTIVE"),
});
const productInput = productFields.refine((value) => value.sellingPrice >= value.costPrice, {
  message: "Selling price must not be below cost price",
  path: ["sellingPrice"],
});

async function assertProductStoreScope(auth: { role: string; storeIds: string[] }, productId: string) {
  if (auth.role === "ADMIN" || auth.role === "SUPER_ADMIN") return;
  const inventory = await Inventory.find({ product: productId }).select("store").lean();
  if (!inventory.length || inventory.some((entry) => !auth.storeIds.includes(String(entry.store)))) {
    throw new AppError(403, "STORE_ACCESS_DENIED", "This product is not managed exclusively by your assigned stores");
  }
}

async function assertProductLabelStoreAccess(auth: { role: string; storeIds: string[] }, productId: string) {
  if (auth.role === "ADMIN" || auth.role === "SUPER_ADMIN") return;
  const assignedStoreInventory = await Inventory.exists({ product: productId, store: { $in: auth.storeIds } });
  if (!assignedStoreInventory) {
    throw new AppError(403, "STORE_ACCESS_DENIED", "This product is not available at your assigned stores");
  }
}

router.get("/catalog", validate(catalogQuery, "query"), async (req, res, next) => {
  try {
    const { storeId, search, limit } = req.query as unknown as z.infer<typeof catalogQuery>;
    const filter = {
      status: "ACTIVE",
      ...(search ? { $text: { $search: search } } : {}),
    };
    const products = await Product.find(filter)
      .select("name slug description sku barcode category brand sellingPrice taxRateBps images status")
      .sort({ createdAt: -1 }).limit(limit).lean();
    const inventory = await Inventory.find({ store: storeId, product: { $in: products.map((product) => product._id) } })
      .select("product availableQuantity").lean();
    const stock = new Map(inventory.map((entry) => [String(entry.product), entry.availableQuantity]));
    res.json({ success: true, data: products.map((product) => ({ ...product, images: publicProductImages(product.images), availableQuantity: stock.get(String(product._id)) ?? 0 })) });
  } catch (error) { next(error); }
});

router.get("/", validate(listQuery, "query"), async (req, res, next) => {
  try {
    const { search, category, status, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const filter = {
      ...(search ? { $text: { $search: search } } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      Product.find(filter).select("name slug description sku barcode category brand sellingPrice taxRateBps images status").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items: items.map((product) => ({ ...product, images: publicProductImages(product.images) })), page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get("/lookup/:code", async (req, res, next) => {
  try {
    const code = req.params.code;
    const { storeId } = catalogQuery.pick({ storeId: true }).parse(req.query);
    const qr = code.startsWith("sr:") ? parseProductQrPayload(code) : undefined;
    const product = await Product.findOne({
      $or: [{ barcode: code }, { sku: code.toUpperCase() }, { "qr.publicId": qr?.publicId ?? code }],
    }).select("name slug description sku barcode category brand sellingPrice taxRateBps images status").lean();
    if (!product) return res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "No product matches that code", requestId: req.requestId } });
    if (product.status !== "ACTIVE") return res.status(409).json({ success: false, error: { code: "PRODUCT_INACTIVE", message: "This product is not available for sale", requestId: req.requestId } });
    const stock = await Inventory.findOne({ store: storeId, product: product._id }).select("availableQuantity").lean();
    const availableQuantity = stock?.availableQuantity ?? 0;
    if (!availableQuantity) return res.status(409).json({ success: false, error: { code: "OUT_OF_STOCK", message: "This product is out of stock at this store", requestId: req.requestId } });
    res.json({ success: true, data: { ...product, images: publicProductImages(product.images), availableQuantity } });
  } catch (error) { next(error); }
});

router.get("/:id", validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .select("name slug description sku barcode category brand sellingPrice taxRateBps images status").lean();
    if (!product) return res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found", requestId: req.requestId } });
    res.json({ success: true, data: { ...product, images: publicProductImages(product.images) } });
  } catch (error) { next(error); }
});

router.get("/:id/label", authenticate, requirePermission("product.read"), validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found", requestId: req.requestId } });
    if (product.status !== "ACTIVE") throw new AppError(409, "PRODUCT_INACTIVE", "QR labels are only available for active products");
    await assertProductLabelStoreAccess(req.auth!, String(product._id));
    const payload = createProductQrPayload(product.qr.version, product.qr.publicId);
    const svg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
    res.type("image/svg+xml").send(svg);
  } catch (error) { next(error); }
});

router.post("/", authenticate, requirePermission("product.create"), validate(productInput), async (req, res, next) => {
  try {
    const product = await Product.create({ ...req.body, qr: { publicId: `p_${randomUUID()}`, version: 1 } });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "PRODUCT_CREATED", resource: "Product", resourceId: String(product._id), newValue: { name: product.name, sku: product.sku, sellingPrice: product.sellingPrice }, requestId: req.requestId });
    res.status(201).json({ success: true, data: product });
  } catch (error) { next(error); }
});

router.patch("/:id", authenticate, requirePermission("product.update"), validate(z.object({ id: objectId }), "params"), validate(productFields.partial().refine((value) => value.sellingPrice === undefined || value.costPrice === undefined || value.sellingPrice >= value.costPrice, { message: "Selling price must not be below cost price", path: ["sellingPrice"] })), async (req, res, next) => {
  try {
    const previous = await Product.findById(req.params.id).lean();
    if (previous) await assertProductStoreScope(req.auth!, String(previous._id));
    const product = await Product.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found", requestId: req.requestId } });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: previous?.sellingPrice !== product.sellingPrice ? "PRICE_CHANGED" : "PRODUCT_UPDATED", resource: "Product", resourceId: String(product._id), previousValue: previous ? { name: previous.name, sellingPrice: previous.sellingPrice, status: previous.status } : undefined, newValue: req.body, requestId: req.requestId });
    res.json({ success: true, data: product });
  } catch (error) { next(error); }
});

router.delete("/:id", authenticate, requirePermission("product.delete"), validate(z.object({ id: objectId }), "params"), async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, { $set: { status: "DISCONTINUED" } }, { new: true });
    if (!product) return res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found", requestId: req.requestId } });
    await AuditLog.create({ actor: req.auth!.userId, actorRole: req.auth!.role, action: "PRODUCT_DISCONTINUED", resource: "Product", resourceId: String(product._id), newValue: { status: product.status }, requestId: req.requestId });
    res.json({ success: true, data: product });
  } catch (error) { next(error); }
});

export default router;
