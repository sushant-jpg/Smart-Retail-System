import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { assertStoreAccess, authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Sale } from "../models/sale.js";

const router = Router();
const codeSchema = z.object({ code: z.string().regex(/^SRV1-[A-Z0-9_-]{12,30}$/) });
const populatedStoreId = (store: unknown) =>
  String(typeof store === "object" && store !== null && "_id" in store ? store._id : store);

router.get("/verify/:code", validate(codeSchema, "params"), async (req, res, next) => {
  try {
    const sale = await Sale.findOne({ verificationCode: req.params.code, saleStatus: { $in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } }).populate("store", "name address").select("saleNumber store total saleStatus createdAt verificationCode").lean();
    if (!sale) throw new AppError(404, "RECEIPT_NOT_VERIFIED", "Receipt verification code was not found");
    res.json({ success: true, data: sale });
  } catch (error) { next(error); }
});

router.get("/:saleNumber", authenticate, async (req, res, next) => {
  try {
    const sale = await Sale.findOne({ saleNumber: req.params.saleNumber }).populate("store", "name address").populate("cashier", "firstName lastName").lean();
    if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale not found");
    const isOwner = sale.customer && String(sale.customer) === req.auth!.userId;
    const elevated = ["CASHIER", "STORE_MANAGER", "ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    if (!isOwner && !elevated) throw new AppError(403, "PERMISSION_DENIED", "You cannot view this receipt");
    if (elevated) assertStoreAccess(req.auth!, populatedStoreId(sale.store));
    res.json({ success: true, data: sale });
  } catch (error) { next(error); }
});

router.get("/:saleNumber/pdf", authenticate, async (req, res, next) => {
  try {
    const sale = await Sale.findOne({ saleNumber: req.params.saleNumber }).populate("store", "name address").populate("cashier", "firstName lastName").lean();
    if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale not found");
    const isOwner = sale.customer && String(sale.customer) === req.auth!.userId;
    const elevated = ["CASHIER", "STORE_MANAGER", "ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    if (!isOwner && !elevated) throw new AppError(403, "PERMISSION_DENIED", "You cannot download this receipt");
    if (elevated) assertStoreAccess(req.auth!, populatedStoreId(sale.store));
    const store = sale.store as unknown as { name?: string; address?: string };
    const cashier = sale.cashier as unknown as { firstName?: string; lastName?: string } | undefined;
    const document = new PDFDocument({ size: [300, 720], margin: 24 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${sale.saleNumber}.pdf"`);
    document.pipe(res);
    document.fontSize(17).font("Helvetica-Bold").text(store.name ?? "SmartRetail", { align: "center" });
    document.fontSize(8).font("Helvetica").text(store.address ?? "", { align: "center" }).moveDown();
    document.fontSize(9).text(`Receipt: ${sale.saleNumber}`).text(`Date: ${new Date(sale.createdAt).toLocaleString("en-NP")}`).text(`Cashier: ${cashier ? `${cashier.firstName ?? ""} ${cashier.lastName ?? ""}`.trim() : "Self-checkout"}`).moveDown();
    document.moveTo(24, document.y).lineTo(276, document.y).strokeColor("#cccccc").stroke().moveDown(0.5);
    for (const item of sale.items) {
      document.font("Helvetica-Bold").fontSize(9).text(item.name);
      document.font("Helvetica").fontSize(8).text(`${item.quantity} x Rs. ${(item.unitPrice / 100).toFixed(2)}`, { continued: true }).text(`Rs. ${(item.total / 100).toFixed(2)}`, { align: "right" });
    }
    document.moveDown().fontSize(9).text(`Subtotal: Rs. ${(sale.subtotal / 100).toFixed(2)}`, { align: "right" }).text(`Discount: Rs. ${(sale.discount / 100).toFixed(2)}`, { align: "right" }).text(`Tax: Rs. ${(sale.tax / 100).toFixed(2)}`, { align: "right" });
    document.font("Helvetica-Bold").fontSize(12).text(`Total: Rs. ${(sale.total / 100).toFixed(2)}`, { align: "right" }).moveDown();
    document.font("Helvetica").fontSize(8).text(`Payment: ${sale.paymentMethod}`).text(`Verification: ${sale.verificationCode}`).moveDown().text("Thank you for shopping with us.", { align: "center" });
    document.end();
  } catch (error) { next(error); }
});

export default router;
