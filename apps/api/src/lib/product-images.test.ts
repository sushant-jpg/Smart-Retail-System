import { describe, expect, it } from "vitest";
import { isSafeProductImage, publicProductImages } from "./product-images.js";

describe("public product images", () => {
  it("accepts public app assets and HTTPS URLs only", () => {
    expect(isSafeProductImage("/products/oat-milk-barista.svg")).toBe(true);
    expect(isSafeProductImage("https://images.example.test/products/oats.webp")).toBe(true);
    expect(isSafeProductImage("http://images.example.test/oats.png")).toBe(false);
    expect(isSafeProductImage("//images.example.test/oats.png")).toBe(false);
    expect(isSafeProductImage("C:\\Users\\internal\\oats.png")).toBe(false);
    expect(isSafeProductImage("/uploads/internal/oats.png")).toBe(false);
    expect(isSafeProductImage("/products/../private.svg")).toBe(false);
  });

  it("filters unsafe legacy image values from API responses", () => {
    expect(publicProductImages([
      "/products/sea-salt-crisps.svg",
      "C:\\Users\\retail\\private.png",
      "/uploads/internal/photo.jpg",
      "http://insecure.example.test/photo.jpg",
      "https://cdn.example.test/photo.jpg",
      null,
    ])).toEqual(["/products/sea-salt-crisps.svg", "https://cdn.example.test/photo.jpg"]);
  });
});
