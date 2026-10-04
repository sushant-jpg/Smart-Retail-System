export const money = (minorUnits: number) =>
  new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR", maximumFractionDigits: 2 })
    .format(minorUnits / 100)
    .replace("NPR", "Rs.");

export const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format;

export const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");
