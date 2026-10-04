const localProductImage = /^\/products\/[a-z0-9][a-z0-9-]*\.(?:svg|png|jpe?g|webp)$/i;

export function isSafeProductImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (localProductImage.test(value)) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function publicProductImages(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isSafeProductImage) : [];
}
