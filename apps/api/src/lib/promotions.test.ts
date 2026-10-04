import { describe, expect, it } from "vitest";
import { calculatePromotionDiscounts } from "./promotions.js";

const lines = [
  { productId: "coffee", category: "Drinks", unitPrice: 50_000, quantity: 2 },
  { productId: "bread", category: "Bakery", unitPrice: 20_000, quantity: 1 },
];

describe("promotion calculations", () => {
  it("applies percentage discounts only to eligible categories", () => {
    const result = calculatePromotionDiscounts({ type: "CATEGORY_DISCOUNT", discount: 1_000, minimumSpend: 0, applicableProducts: [], applicableCategories: ["Drinks"] }, lines);
    expect(result.get("coffee")).toBe(10_000);
    expect(result.get("bread")).toBe(0);
  });

  it("never lets a fixed discount exceed eligible merchandise", () => {
    const result = calculatePromotionDiscounts({ type: "FIXED_DISCOUNT", discount: 200_000, minimumSpend: 0, applicableProducts: ["bread"], applicableCategories: [] }, lines);
    expect(result.get("bread")).toBe(20_000);
  });

  it("calculates buy-x-get-y from complete groups", () => {
    const result = calculatePromotionDiscounts({ type: "BUY_X_GET_Y", discount: 0, minimumSpend: 0, applicableProducts: ["coffee"], applicableCategories: [], buyQuantity: 2, getQuantity: 1 }, [{ ...lines[0]!, quantity: 7 }]);
    expect(result.get("coffee")).toBe(100_000);
  });
});
