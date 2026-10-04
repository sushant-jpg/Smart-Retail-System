// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductQrDialog } from "./product-qr-dialog";
import type { CatalogProduct } from "@/lib/retail";

const { apiRequestBlob } = vi.hoisted(() => ({ apiRequestBlob: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  apiRequestBlob,
}));

const product: CatalogProduct = {
  _id: "507f1f77bcf86cd799439011",
  name: "Oat Milk Barista",
  slug: "oat-milk-barista",
  description: "Oat milk",
  sku: "DRY-2089",
  barcode: "8901000002089",
  category: "Dairy",
  brand: "Oatside",
  sellingPrice: 47500,
  taxRateBps: 1300,
  images: ["/products/oat-milk-barista.svg"],
  status: "ACTIVE",
  availableQuantity: 9,
};

describe("ProductQrDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests the protected signed label and displays the returned QR image", async () => {
    class TestURL extends URL {}
    vi.stubGlobal("URL", Object.assign(TestURL, {
      createObjectURL: vi.fn(() => "blob:product-qr"),
      revokeObjectURL: vi.fn(),
    }));
    apiRequestBlob.mockResolvedValue(new Blob(["<svg />"], { type: "image/svg+xml" }));

    render(<ProductQrDialog product={product} />);
    fireEvent.click(screen.getByRole("button", { name: /^Generate QR$/ }));
    expect(await screen.findByRole("dialog", { name: "Product QR code" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Signed QR code for Oat Milk Barista" })).toHaveAttribute("src", "blob:product-qr");
    expect(apiRequestBlob).toHaveBeenCalledWith(`/products/${product._id}/label`);
    expect(screen.getByText("Signed QR ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close QR dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a safe error and allows retry when signed QR generation fails", async () => {
    apiRequestBlob.mockRejectedValue(new Error("backend details must not leak"));
    render(<ProductQrDialog product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate QR" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not generate this product QR code.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/backend details/)).not.toBeInTheDocument();
  });
});
