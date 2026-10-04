"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";

export type StoreSummary = { _id: string; name: string; code: string };

export type CatalogProduct = {
  _id: string;
  name: string;
  slug: string;
  description: string;
  sku: string;
  barcode: string;
  category: string;
  brand: string;
  sellingPrice: number;
  taxRateBps: number;
  images: string[];
  status: "ACTIVE" | "INACTIVE" | "OUT_OF_STOCK" | "DISCONTINUED";
  availableQuantity: number;
};

export function productImage(product: Pick<CatalogProduct, "images">) {
  return product.images.find((image) => image.startsWith("/products/") || image.startsWith("https://"));
}

export function useStores() {
  return useQuery({
    queryKey: ["stores", "public"],
    queryFn: () => apiRequest<StoreSummary[]>("/stores/public"),
  });
}

export function useCatalog(storeId?: string, search = "") {
  return useQuery({
    queryKey: ["catalog", storeId, search],
    queryFn: () => {
      const params = new URLSearchParams({ storeId: storeId!, limit: "100" });
      if (search.trim()) params.set("search", search.trim());
      return apiRequest<CatalogProduct[]>(`/products/catalog?${params}`);
    },
    enabled: Boolean(storeId),
  });
}

export const productInitials = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

export const productAccent = "from-emerald-100 to-teal-200 dark:from-emerald-950 dark:to-teal-900";
