import { createHash, randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { AppError } from "../lib/app-error.js";
import { calculateLine } from "../lib/money.js";
import { calculatePromotionDiscounts } from "../lib/promotions.js";
import { realtime } from "../lib/realtime.js";
import { AuditLog } from "../models/audit-log.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { InventoryMovement } from "../models/inventory-movement.js";
import { Inventory } from "../models/inventory.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/loyalty.js";
import { Product, type ProductDocument } from "../models/product.js";
import { Promotion } from "../models/promotion.js";
import { Sale } from "../models/sale.js";
import { notifyLowStock } from "./notification.service.js";
import { consumeEarnedLoyaltyPoints, expireCustomerLoyaltyPoints } from "./loyalty-expiry.service.js";

export type CheckoutInput = {
  storeId: string;
  customerId?: string;
  items: Array<{ productId: string; quantity: number }>;
  promotionCode?: string;
  loyaltyPoints?: number;
  paymentMethod: "CASH" | "CARD" | "QR" | "WALLET";
};

type Actor = { userId: string; role: string };

const hashRequest = (input: CheckoutInput) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

const saleNumber = () =>
  `SR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;

export async function checkout(input: CheckoutInput, idempotencyKey: string, actor: Actor, requestId: string) {
  const loyaltyPoints = input.loyaltyPoints ?? 0;
  if (actor.role === "CUSTOMER") {
    if (input.customerId && input.customerId !== actor.userId) throw new AppError(403, "CUSTOMER_ID_MISMATCH", "Customers can only check out for their own account");
    input.customerId = actor.userId;
  }
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
    throw new AppError(422, "DUPLICATE_CART_ITEM", "Combine duplicate products into one cart line");
  }
  const requestHash = hashRequest(input);
  const existing = await IdempotencyKey.findOne({ key: idempotencyKey, actor: actor.userId }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different request");
    }
    if (existing.status === "COMPLETED") return existing.response;
    throw new AppError(409, "CHECKOUT_IN_PROGRESS", "An identical checkout is already being processed");
  }

  try {
    await IdempotencyKey.create({
      key: idempotencyKey,
      actor: actor.userId,
      requestHash,
      status: "PROCESSING",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      throw new AppError(409, "CHECKOUT_IN_PROGRESS", "An identical checkout is already being processed");
    }
    throw error;
  }

  const dbSession = await mongoose.startSession();
  try {
    let response: unknown;
    const lowStockAlerts: Array<{ storeId: string; productId: string; productName: string; availableQuantity: number; reorderLevel: number }> = [];
    await dbSession.withTransaction(async () => {
      const uniqueIds = [...new Set(input.items.map((item) => item.productId))];
      const products = await Product.find({ _id: { $in: uniqueIds }, status: "ACTIVE" })
        .session(dbSession).lean() as Array<ProductDocument & { _id: Types.ObjectId }>;
      const byId = new Map(products.map((product) => [String(product._id), product]));
      if (byId.size !== uniqueIds.length) throw new AppError(422, "PRODUCT_UNAVAILABLE", "One or more products are unavailable");

      const saleId = new Types.ObjectId();
      const now = new Date();
      const promotion = input.promotionCode ? await Promotion.findOne({
        code: input.promotionCode.toUpperCase(), status: "ACTIVE", startDate: { $lte: now }, endDate: { $gte: now },
      }).session(dbSession) : null;
      if (input.promotionCode && !promotion) throw new AppError(422, "PROMOTION_INVALID", "Promotion code is invalid or inactive");
      if (promotion && typeof promotion.usageLimit === "number" && promotion.usageCount >= promotion.usageLimit) throw new AppError(422, "PROMOTION_LIMIT_REACHED", "Promotion usage limit has been reached");
      if (promotion && input.customerId) {
        const usage = promotion.usedBy.find((entry) => String(entry.user) === input.customerId)?.count ?? 0;
        if (usage >= promotion.perUserLimit) throw new AppError(422, "PROMOTION_USER_LIMIT_REACHED", "You have already used this promotion the maximum number of times");
      }

      const promotionDiscounts = promotion ? calculatePromotionDiscounts({
        type: promotion.type, discount: promotion.discount, minimumSpend: promotion.minimumSpend,
        applicableProducts: promotion.applicableProducts.map(String), applicableCategories: promotion.applicableCategories,
        buyQuantity: promotion.buyQuantity ?? undefined, getQuantity: promotion.getQuantity ?? undefined,
      }, input.items.map((requested) => {
        const product = byId.get(requested.productId)!;
        return { productId: requested.productId, category: product.category, unitPrice: product.sellingPrice, quantity: requested.quantity };
      })) : new Map<string, number>();

      if (input.customerId) await expireCustomerLoyaltyPoints(input.customerId, now, dbSession);
      let loyaltyAccount = input.customerId ? await LoyaltyAccount.findOne({ customer: input.customerId }).session(dbSession) : null;
      if (loyaltyPoints && !input.customerId) throw new AppError(422, "LOYALTY_CUSTOMER_REQUIRED", "A customer is required to redeem loyalty points");
      if (loyaltyPoints && (!loyaltyAccount || loyaltyAccount.pointsBalance < loyaltyPoints)) throw new AppError(422, "LOYALTY_POINTS_INSUFFICIENT", "Insufficient loyalty points");
      let loyaltyValueRemaining = loyaltyPoints * 100;
      const eligibleAfterPromotion = input.items.reduce((sum, requested) => {
        const product = byId.get(requested.productId)!;
        return sum + product.sellingPrice * requested.quantity - (promotionDiscounts.get(requested.productId) ?? 0);
      }, 0);
      if (loyaltyValueRemaining > eligibleAfterPromotion) throw new AppError(422, "LOYALTY_REDEMPTION_EXCEEDED", "Redeemed points exceed the payable merchandise value");
      const saleItems = [];

      for (const requested of input.items) {
        const product = byId.get(requested.productId)!;
        const base = product.sellingPrice * requested.quantity;
        const promotionDiscount = promotionDiscounts.get(requested.productId) ?? 0;
        const loyaltyDiscount = Math.min(loyaltyValueRemaining, base - promotionDiscount);
        loyaltyValueRemaining -= loyaltyDiscount;
        const discount = promotionDiscount + loyaltyDiscount;
        const amounts = calculateLine({
          unitPrice: product.sellingPrice,
          quantity: requested.quantity,
          taxRateBps: product.taxRateBps,
          discount,
        });

        const inventory = await Inventory.findOneAndUpdate(
          { store: input.storeId, product: product._id, availableQuantity: { $gte: requested.quantity } },
          { $inc: { availableQuantity: -requested.quantity } },
          { new: true, session: dbSession },
        );
        if (!inventory) throw new AppError(409, "INVENTORY_INSUFFICIENT", `Insufficient inventory for ${product.name}`);
        if (inventory.availableQuantity <= inventory.reorderLevel) lowStockAlerts.push({ storeId: input.storeId, productId: String(product._id), productName: product.name, availableQuantity: inventory.availableQuantity, reorderLevel: inventory.reorderLevel });

        await InventoryMovement.create([{
          store: input.storeId,
          product: product._id,
          type: "SALE",
          quantityDelta: -requested.quantity,
          balanceAfter: inventory.availableQuantity,
          referenceType: "Sale",
          referenceId: saleId,
          actor: actor.userId,
          requestId,
        }], { session: dbSession });

        saleItems.push({
          product: product._id,
          name: product.name,
          sku: product.sku,
          quantity: requested.quantity,
          unitPrice: product.sellingPrice,
          costPrice: product.costPrice,
          ...amounts,
        });
      }

      const totals = saleItems.reduce(
        (sum, item) => ({
          subtotal: sum.subtotal + item.subtotal,
          discount: sum.discount + item.discount,
          tax: sum.tax + item.tax,
          total: sum.total + item.total,
        }),
        { subtotal: 0, discount: 0, tax: 0, total: 0 },
      );

      const tierMultiplier = loyaltyAccount?.tier === "PLATINUM" ? 2 : loyaltyAccount?.tier === "GOLD" ? 1.5 : loyaltyAccount?.tier === "SILVER" ? 1.25 : 1;
      const earnedPoints = input.customerId ? Math.floor(totals.total / 10_000 * tierMultiplier) : 0;

      const [sale] = await Sale.create([{
        _id: saleId,
        saleNumber: saleNumber(),
        verificationCode: `SRV1-${randomBytes(9).toString("base64url").toUpperCase()}`,
        store: input.storeId,
        customer: input.customerId,
        cashier: actor.role === "CUSTOMER" ? undefined : actor.userId,
        items: saleItems,
        ...totals,
        paymentMethod: input.paymentMethod,
        paymentStatus: "PAID",
        saleStatus: "PAID",
        idempotencyKey,
        promotion: promotion?._id,
        promotionCode: promotion?.code,
        loyaltyPointsRedeemed: loyaltyPoints,
        loyaltyPointsEarned: earnedPoints,
      }], { session: dbSession });
      if (!sale) throw new AppError(500, "SALE_CREATE_FAILED", "Sale could not be created");

      if (promotion) {
        const usageFilter = { _id: promotion._id, ...(promotion.usageLimit ? { usageCount: { $lt: promotion.usageLimit } } : {}) };
        const hasExistingUsage = Boolean(input.customerId && promotion.usedBy.some((entry) => String(entry.user) === input.customerId));
        const usageUpdate = hasExistingUsage
          ? { $inc: { usageCount: 1, "usedBy.$[entry].count": 1 } }
          : { $inc: { usageCount: 1 }, ...(input.customerId ? { $push: { usedBy: { user: input.customerId, count: 1 } } } : {}) };
        const updated = await Promotion.findOneAndUpdate(usageFilter, usageUpdate, { session: dbSession, ...(hasExistingUsage ? { arrayFilters: [{ "entry.user": input.customerId }] } : {}) });
        if (!updated) throw new AppError(409, "PROMOTION_LIMIT_REACHED", "Promotion usage limit was reached during checkout");
      }

      if (input.customerId) {
        if (!loyaltyAccount) {
          const [created] = await LoyaltyAccount.create([{ customer: input.customerId, pointsBalance: 0, lifetimePoints: 0, tier: "BRONZE" }], { session: dbSession });
          if (!created) throw new AppError(500, "LOYALTY_ACCOUNT_CREATE_FAILED", "Loyalty account could not be created");
          loyaltyAccount = created;
        }
        const nextBalance = loyaltyAccount.pointsBalance - loyaltyPoints + earnedPoints;
        loyaltyAccount.pointsBalance = nextBalance;
        loyaltyAccount.lifetimePoints += earnedPoints;
        loyaltyAccount.tier = loyaltyAccount.lifetimePoints >= 10_000 ? "PLATINUM" : loyaltyAccount.lifetimePoints >= 5_000 ? "GOLD" : loyaltyAccount.lifetimePoints >= 1_500 ? "SILVER" : "BRONZE";
        await loyaltyAccount.save({ session: dbSession });
        if (loyaltyPoints) await consumeEarnedLoyaltyPoints(loyaltyAccount._id, loyaltyPoints, dbSession);
        const entries = [];
        if (loyaltyPoints) entries.push({ account: loyaltyAccount._id, customer: input.customerId, type: "REDEEM", points: -loyaltyPoints, balanceAfter: nextBalance - earnedPoints, referenceType: "Sale", referenceId: sale._id });
        if (earnedPoints) entries.push({ account: loyaltyAccount._id, customer: input.customerId, type: "EARN", points: earnedPoints, remainingPoints: earnedPoints, balanceAfter: nextBalance, referenceType: "Sale", referenceId: sale._id, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000) });
        if (entries.length) await LoyaltyTransaction.create(entries, { session: dbSession });
      }

      await AuditLog.create([{
        actor: actor.userId,
        actorRole: actor.role,
        action: "SALE_COMPLETED",
        resource: "Sale",
        resourceId: String(sale._id),
        newValue: { saleNumber: sale.saleNumber, total: sale.total, itemCount: saleItems.length },
        requestId,
      }], { session: dbSession });

      response = {
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        verificationCode: sale.verificationCode,
        items: saleItems,
        ...totals,
        paymentMethod: sale.paymentMethod,
        status: sale.saleStatus,
        promotionCode: promotion?.code ?? null,
        loyaltyPointsRedeemed: loyaltyPoints,
        loyaltyPointsEarned: earnedPoints,
      };
      await IdempotencyKey.updateOne(
        { key: idempotencyKey, actor: actor.userId, status: "PROCESSING" },
        { $set: { status: "COMPLETED", response } },
        { session: dbSession },
      );
    });
    realtime.publish({ room: `store:${input.storeId}`, name: "sale.completed", payload: response as Record<string, unknown> });
    realtime.publish({ room: `store:${input.storeId}`, name: "inventory.updated", payload: { saleCompleted: true } });
    await Promise.allSettled(lowStockAlerts.map(notifyLowStock));
    return response;
  } catch (error) {
    await IdempotencyKey.deleteOne({ key: idempotencyKey, actor: actor.userId, status: "PROCESSING" });
    throw error;
  } finally {
    await dbSession.endSession();
  }
}
