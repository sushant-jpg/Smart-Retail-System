import { AppError } from "./app-error.js";

export type MoneyLine = {
  unitPrice: number;
  quantity: number;
  taxRateBps: number;
  discount?: number;
};

const safeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(422, "INVALID_MONEY", `${name} must be a non-negative integer`);
  }
};

export function calculateLine(line: MoneyLine) {
  safeInteger(line.unitPrice, "unitPrice");
  safeInteger(line.quantity, "quantity");
  safeInteger(line.taxRateBps, "taxRateBps");
  safeInteger(line.discount ?? 0, "discount");

  const subtotal = line.unitPrice * line.quantity;
  const discount = Math.min(line.discount ?? 0, subtotal);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * line.taxRateBps) / 10_000);
  return { subtotal, discount, tax, total: taxable + tax };
}

export function calculateCart(lines: MoneyLine[]) {
  return lines.map(calculateLine).reduce(
    (total, line) => ({
      subtotal: total.subtotal + line.subtotal,
      discount: total.discount + line.discount,
      tax: total.tax + line.tax,
      total: total.total + line.total,
    }),
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
}

export function percentageDiscount(amount: number, percentageBps: number) {
  safeInteger(amount, "amount");
  safeInteger(percentageBps, "percentageBps");
  return Math.min(amount, Math.round((amount * percentageBps) / 10_000));
}
