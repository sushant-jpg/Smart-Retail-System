import { AppError } from "./app-error.js";

export type PromotionRule = {
  type: "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "BUY_ONE_GET_ONE" | "BUY_X_GET_Y" | "CATEGORY_DISCOUNT" | "LOYALTY_DISCOUNT";
  discount: number;
  minimumSpend: number;
  applicableProducts: string[];
  applicableCategories: string[];
  buyQuantity?: number;
  getQuantity?: number;
};

export type PromotionLine = { productId: string; category: string; unitPrice: number; quantity: number };

export function calculatePromotionDiscounts(rule: PromotionRule, lines: PromotionLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  if (subtotal < rule.minimumSpend) throw new AppError(422, "PROMOTION_MINIMUM_NOT_MET", "Cart does not meet the promotion minimum spend");
  const eligible = lines.filter((line) =>
    (!rule.applicableProducts.length && !rule.applicableCategories.length)
    || rule.applicableProducts.includes(line.productId)
    || rule.applicableCategories.some((category) => category.toLowerCase() === line.category.toLowerCase()),
  );
  if (!eligible.length) throw new AppError(422, "PROMOTION_NOT_APPLICABLE", "Promotion does not apply to this cart");

  const discounts = new Map(lines.map((line) => [line.productId, 0]));
  if (["PERCENTAGE_DISCOUNT", "CATEGORY_DISCOUNT", "LOYALTY_DISCOUNT"].includes(rule.type)) {
    for (const line of eligible) discounts.set(line.productId, Math.round(line.unitPrice * line.quantity * rule.discount / 10_000));
  } else if (rule.type === "FIXED_DISCOUNT") {
    let remaining = rule.discount;
    for (const line of eligible) {
      const amount = Math.min(remaining, line.unitPrice * line.quantity);
      discounts.set(line.productId, amount);
      remaining -= amount;
      if (!remaining) break;
    }
  } else {
    const buy = rule.type === "BUY_ONE_GET_ONE" ? 1 : (rule.buyQuantity ?? 1);
    const get = rule.type === "BUY_ONE_GET_ONE" ? 1 : (rule.getQuantity ?? 1);
    for (const line of eligible) {
      const freeUnits = Math.floor(line.quantity / (buy + get)) * get;
      discounts.set(line.productId, freeUnits * line.unitPrice);
    }
  }
  return discounts;
}
