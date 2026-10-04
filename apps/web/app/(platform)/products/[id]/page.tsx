"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { useAuth } from "@/components/auth-provider";
import { ProductQrDialog } from "@/components/product-qr-dialog";
import { Badge, Button, Card, ProductVisual } from "@/components/ui";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, useCatalog, useStores } from "@/lib/retail";

export default function ProductDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const catalog = useCatalog(activeStoreId);
  const product = catalog.data?.find((entry) => entry._id === params.id);
  const [quantity, setQuantity] = useState(1);

  return <div className="mx-auto max-w-4xl">
    <Link href="/products" className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-muted no-underline"><ArrowLeft size={15} />Back to catalogue</Link>
    <div className="mb-4 flex justify-end"><label className="text-xs font-semibold">Store<select className="field mt-1" aria-label="Select product store" value={activeStoreId} onChange={(event) => setStoreId(event.target.value)}>{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label></div>
    {catalog.isLoading ? <Card className="p-8 text-center text-sm text-muted">Loading product…</Card> : product ? <Card className="grid gap-6 p-5 sm:grid-cols-2 sm:p-8">
      <ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} className="!h-72 !rounded-2xl" />
      <div className="flex flex-col justify-center">
        <span className="eyebrow">{product.category}{product.brand ? ` · ${product.brand}` : ""}</span>
        <h2 className="mt-2 text-2xl font-bold">{product.name}</h2>
        <p className="mt-2 text-xs text-muted">{product.description || "Product details are not available."}</p>
        <p className="mt-4 text-xs text-muted">SKU {product.sku} · Barcode {product.barcode}</p>
        <div className="mt-5 flex items-center justify-between"><strong className="text-2xl">{money(product.sellingPrice)}</strong><Badge tone={product.availableQuantity > 0 ? "success" : "danger"}>{product.availableQuantity > 0 ? `${product.availableQuantity} available` : "OUT OF STOCK"}</Badge></div>
        <label className="mt-5 block text-xs font-semibold">Quantity<input className="field mt-1.5 w-28" type="number" min={1} max={Math.max(product.availableQuantity, 1)} value={quantity} onChange={(event) => setQuantity(Math.min(Math.max(1, Number(event.target.value)), Math.max(product.availableQuantity, 1)))} /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <CheckoutDialog storeId={activeStoreId} items={[{ productId: product._id, quantity }]} disabled={product.availableQuantity < quantity}><span className="w-full">Checkout this product</span></CheckoutDialog>
          {user && user.role !== "CUSTOMER" && <ProductQrDialog product={product} />}
        </div>
        <p className="mt-2 text-[10px] text-muted">Final price, promotion eligibility, and stock are verified by the server during checkout.</p>
      </div>
    </Card> : <Card><div className="empty-state"><div className="empty-icon"><PackageOpen size={22} /></div><h3>Product unavailable</h3><p>This product is not in the active store catalogue.</p><Button variant="secondary" onClick={() => { void catalog.refetch(); }}>Retry</Button></div></Card>}
    {catalog.error && <p role="alert" className="mt-3 text-sm text-red-700">Product information could not be loaded.</p>}
  </div>;
}
