import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../lib/app-error.js";
import { calculateLine } from "../lib/money.js";
import { calculatePromotionDiscounts } from "../lib/promotions.js";
import { Inventory } from "../models/inventory.js";
import { LoyaltyAccount } from "../models/loyalty.js";
import { PaymentAttempt } from "../models/payment-attempt.js";
import { Product, type ProductDocument } from "../models/product.js";
import { Promotion } from "../models/promotion.js";
import { Sale } from "../models/sale.js";
import { IdempotencyKey } from "../models/idempotency.js";
import { checkout, type CheckoutInput } from "./checkout.service.js";
import { expireCustomerLoyaltyPoints } from "./loyalty-expiry.service.js";

type Actor = { userId: string; role: string };
type QuoteInput = CheckoutInput & { customerId?: string };
type PricedProduct = ProductDocument & { _id: Types.ObjectId };

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizeInput = (input: CheckoutInput, actor: Actor): QuoteInput => {
  if (actor.role === "CUSTOMER" && input.customerId && input.customerId !== actor.userId) {
    throw new AppError(403, "CUSTOMER_ID_MISMATCH", "Customers can only check out for their own account");
  }
  return {
    ...input,
    ...(actor.role === "CUSTOMER" ? { customerId: actor.userId } : {}),
    loyaltyPoints: input.loyaltyPoints ?? 0,
  };
};

async function buildQuote(input: QuoteInput) {
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) {
    throw new AppError(422, "DUPLICATE_CART_ITEM", "Combine duplicate products into one cart line");
  }

  const productIds = input.items.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds }, status: "ACTIVE" }).lean() as PricedProduct[];
  const byId = new Map(products.map((product) => [String(product._id), product]));
  if (byId.size !== productIds.length) {
    const inactive = await Product.find({ _id: { $in: productIds } }).select("_id status").lean();
    if (inactive.length !== productIds.length) throw new AppError(422, "PRODUCT_UNAVAILABLE", "One or more products are unavailable");
    throw new AppError(422, "PRODUCT_INACTIVE", "One or more products are no longer active");
  }

  const inventory = await Inventory.find({ store: input.storeId, product: { $in: productIds } }).select("product availableQuantity").lean();
  const stockByProduct = new Map(inventory.map((item) => [String(item.product), item.availableQuantity]));
  for (const requested of input.items) {
    const available = stockByProduct.get(requested.productId) ?? 0;
    if (available < requested.quantity) {
      const product = byId.get(requested.productId)!;
      throw new AppError(409, "INVENTORY_INSUFFICIENT", `Only ${available} units of ${product.name} are currently available`, {
        productId: requested.productId, availableQuantity: available,
      });
    }
  }

  const now = new Date();
  const promotion = input.promotionCode ? await Promotion.findOne({
    code: input.promotionCode.toUpperCase(), status: "ACTIVE", startDate: { $lte: now }, endDate: { $gte: now },
  }).lean() : null;
  if (input.promotionCode && !promotion) throw new AppError(422, "PROMOTION_INVALID", "Promotion code is invalid or inactive");
  if (promotion && typeof promotion.usageLimit === "number" && promotion.usageCount >= promotion.usageLimit) {
    throw new AppError(422, "PROMOTION_LIMIT_REACHED", "Promotion usage limit has been reached");
  }
  if (promotion && input.customerId) {
    const used = promotion.usedBy.find((entry) => String(entry.user) === input.customerId)?.count ?? 0;
    if (used >= promotion.perUserLimit) throw new AppError(422, "PROMOTION_USER_LIMIT_REACHED", "You have already used this promotion the maximum number of times");
  }

  const lines = input.items.map((requested) => {
    const product = byId.get(requested.productId)!;
    return { productId: requested.productId, category: product.category, unitPrice: product.sellingPrice, quantity: requested.quantity };
  });
  const promotionDiscounts = promotion ? calculatePromotionDiscounts({
    type: promotion.type, discount: promotion.discount, minimumSpend: promotion.minimumSpend,
    applicableProducts: promotion.applicableProducts.map(String), applicableCategories: promotion.applicableCategories,
    buyQuantity: promotion.buyQuantity ?? undefined, getQuantity: promotion.getQuantity ?? undefined,
  }, lines) : new Map<string, number>();

  const loyaltyPoints = input.loyaltyPoints ?? 0;
  if (loyaltyPoints && !input.customerId) throw new AppError(422, "LOYALTY_CUSTOMER_REQUIRED", "A customer is required to redeem loyalty points");
  if (input.customerId) await expireCustomerLoyaltyPoints(input.customerId);
  const loyaltyAccount = input.customerId ? await LoyaltyAccount.findOne({ customer: input.customerId }).lean() : null;
  if (loyaltyPoints && (!loyaltyAccount || loyaltyAccount.pointsBalance < loyaltyPoints)) {
    throw new AppError(422, "LOYALTY_POINTS_INSUFFICIENT", "Insufficient loyalty points");
  }
  let loyaltyValueRemaining = loyaltyPoints * 100;
  const eligibleTotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity - (promotionDiscounts.get(line.productId) ?? 0), 0);
  if (loyaltyValueRemaining > eligibleTotal) throw new AppError(422, "LOYALTY_REDEMPTION_EXCEEDED", "Redeemed points exceed the payable merchandise value");

  const pricedLines = lines.map((line) => {
    const product = byId.get(line.productId)!;
    const base = line.unitPrice * line.quantity;
    const promotionDiscount = promotionDiscounts.get(line.productId) ?? 0;
    const loyaltyDiscount = Math.min(loyaltyValueRemaining, base - promotionDiscount);
    loyaltyValueRemaining -= loyaltyDiscount;
    return {
      productId: line.productId, name: product.name, sku: product.sku, quantity: line.quantity,
      unitPrice: product.sellingPrice,
      ...calculateLine({ unitPrice: product.sellingPrice, quantity: line.quantity, taxRateBps: product.taxRateBps, discount: promotionDiscount + loyaltyDiscount }),
    };
  });
  const totals = pricedLines.reduce(
    (sum, line) => ({ subtotal: sum.subtotal + line.subtotal, discount: sum.discount + line.discount, tax: sum.tax + line.tax, total: sum.total + line.total }),
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
  return {
    items: pricedLines,
    ...totals,
    paymentMethod: input.paymentMethod,
    promotionCode: promotion?.code,
    loyaltyPointsRedeemed: loyaltyPoints,
  };
}

export async function createPaymentAttempt(input: CheckoutInput, idempotencyKey: string, actor: Actor) {
  const normalized = normalizeInput(input, actor);
  const quote = await buildQuote(normalized);
  const requestHash = digest(normalized);
  const existing = await PaymentAttempt.findOne({ actor: actor.userId, idempotencyKey }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different checkout");
    return { paymentAttemptId: String(existing._id), state: existing.state, quote: existing.quote, sale: existing.saleResponse };
  }

  try {
    const attempt = await PaymentAttempt.create({
      actor: actor.userId, idempotencyKey, requestHash, checkoutInput: normalized,
      quoteHash: digest(quote), quote, paymentMethod: normalized.paymentMethod, state: "CREATED",
    });
    return { paymentAttemptId: String(attempt._id), state: attempt.state, quote: attempt.quote };
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) {
      const duplicate = await PaymentAttempt.findOne({ actor: actor.userId, idempotencyKey }).lean();
      if (duplicate?.requestHash === requestHash) {
        return { paymentAttemptId: String(duplicate._id), state: duplicate.state, quote: duplicate.quote, sale: duplicate.saleResponse };
      }
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different checkout");
    }
    throw error;
  }
}

export function simulatedPaymentApproved(attemptId: string, method: CheckoutInput["paymentMethod"]) {
  if (method === "CASH") return true;
  return Number.parseInt(digest(attemptId).slice(0, 8), 16) % 10 !== 0;
}

export async function confirmPaymentAttempt(attemptId: string, actor: Actor, requestId: string) {
  const attempt = await PaymentAttempt.findOne({ _id: attemptId, actor: actor.userId });
  if (!attempt) throw new AppError(404, "PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found");
  if (attempt.state === "APPROVED") return { paymentStatus: attempt.state, sale: attempt.saleResponse };
  if (attempt.state === "DECLINED") return { paymentStatus: attempt.state, message: attempt.declineReason };

  if (attempt.state === "PENDING") {
    for (let retry = 0; retry < 20; retry += 1) {
      const current = await PaymentAttempt.findById(attempt._id).select("state saleResponse declineReason").lean();
      if (current?.state === "APPROVED") return { paymentStatus: current.state, sale: current.saleResponse };
      if (current?.state === "DECLINED") return { paymentStatus: current.state, message: current.declineReason };
      if (current?.state !== "PENDING") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const current = await PaymentAttempt.findById(attempt._id).select("state saleResponse declineReason").lean();
    if (current?.state === "APPROVED") return { paymentStatus: current.state, sale: current.saleResponse };
    if (current?.state === "DECLINED") return { paymentStatus: current.state, message: current.declineReason };
    const prior = await IdempotencyKey.findOne({ actor: actor.userId, key: `payment:${attemptId}` }).lean();
    if (prior?.status === "COMPLETED") {
      attempt.state = "APPROVED";
      attempt.saleResponse = prior.response;
      await attempt.save();
      return { paymentStatus: attempt.state, sale: attempt.saleResponse };
    }
    throw new AppError(409, "PAYMENT_IN_PROGRESS", "This payment confirmation is already being processed");
  }

  const currentInput = attempt.checkoutInput as CheckoutInput;
  const currentQuote = await buildQuote(currentInput);
  const currentQuoteHash = digest(currentQuote);
  if (currentQuoteHash !== attempt.quoteHash) {
    attempt.quote = currentQuote;
    attempt.quoteHash = currentQuoteHash;
    await attempt.save();
    throw new AppError(409, "PRICE_CHANGED", "Prices, stock, or eligibility changed. Review the updated checkout before paying.", { quote: currentQuote });
  }

  const claimed = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, actor: actor.userId, state: "CREATED" },
    { $set: { state: "PENDING" } },
    { new: true },
  );
  if (!claimed) return confirmPaymentAttempt(attemptId, actor, requestId);

  if (!simulatedPaymentApproved(String(attempt._id), attempt.paymentMethod)) {
    await PaymentAttempt.updateOne({ _id: attempt._id, state: "PENDING" }, { $set: { state: "DECLINED", declineReason: "The simulated payment was declined. Start a new attempt to retry." } });
    return { paymentStatus: "DECLINED", message: "The simulated payment was declined. Start a new attempt to retry." };
  }

  try {
    const sale = await checkout(currentInput, `payment:${attemptId}`, actor, requestId);
    await PaymentAttempt.updateOne({ _id: attempt._id, state: "PENDING" }, { $set: { state: "APPROVED", saleResponse: sale } });
    return { paymentStatus: "APPROVED", sale };
  } catch (error) {
    await PaymentAttempt.updateOne({ _id: attempt._id, state: "PENDING" }, { $set: { state: "CREATED" } });
    throw error;
  }
}

export async function getPaymentAttempt(attemptId: string, actor: Actor) {
  const attempt = await PaymentAttempt.findOne({ _id: attemptId, actor: actor.userId }).lean();
  if (!attempt) throw new AppError(404, "PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found");
  return {
    paymentAttemptId: String(attempt._id), state: attempt.state, quote: attempt.quote,
    sale: attempt.saleResponse, message: attempt.declineReason,
  };
}

export async function findReceiptForCustomer(saleNumber: string, customerId: string) {
  const sale = await Sale.findOne({ saleNumber, customer: customerId }).select("saleNumber verificationCode total saleStatus items subtotal discount tax paymentMethod createdAt").lean();
  if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale not found");
  return sale;
}
