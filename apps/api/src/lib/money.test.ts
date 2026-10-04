import { describe, expect, it } from "vitest";
import { calculateCart, calculateLine, percentageDiscount } from "./money.js";

describe("money calculations", () => {
  it("calculates discount before tax using integer minor units", () => {
    expect(calculateLine({ unitPrice: 45_075, quantity: 2, discount: 9_015, taxRateBps: 1_300 }))
      .toEqual({ subtotal: 90_150, discount: 9_015, tax: 10_548, total: 91_683 });
  });

  it("rounds only at the tax boundary", () => {
    expect(calculateLine({ unitPrice: 99, quantity: 1, taxRateBps: 1_300 }).tax).toBe(13);
  });

  it("aggregates lines without floating point arithmetic", () => {
    expect(calculateCart([
      { unitPrice: 1_000, quantity: 2, taxRateBps: 1_300 },
      { unitPrice: 500, quantity: 1, taxRateBps: 0, discount: 100 },
    ])).toEqual({ subtotal: 2_500, discount: 100, tax: 260, total: 2_660 });
  });

  it("caps percentage discounts at the amount", () => {
    expect(percentageDiscount(1_000, 20_000)).toBe(1_000);
  });
});
