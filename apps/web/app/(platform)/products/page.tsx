"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, Minus, PackageOpen, Plus, Search, ShoppingCart } from "lucide-react";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { Badge, Button, Card, ProductVisual } from "@/components/ui";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, useCatalog, useStores } from "@/lib/retail";

export default function ProductsPage() {
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const catalog = useCatalog(activeStoreId);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [cart, setCart] = useState<Record<string, number>>({});
  const categories = useMemo(() => ["All categories", ...new Set((catalog.data ?? []).map((item) => item.category))], [catalog.data]);
  const filtered = useMemo(() => (catalog.data ?? []).filter((product) => {
    const searchMatches = `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(search.toLowerCase());
    return searchMatches && (category === "All categories" || product.category === category);
  }), [catalog.data, category, search]);
  const cartItems = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return <>
    <div className="page-header"><div><h2>Product catalogue</h2><p>Browse current products and store-specific availability.</p></div><div className="page-actions"><label className="text-xs font-semibold">Store<select className="field mt-1" aria-label="Select catalogue store" value={activeStoreId} onChange={(event) => { setStoreId(event.target.value); setCart({}); }}>{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label><CheckoutDialog storeId={activeStoreId} items={cartItems} disabled={!cartCount} onComplete={() => setCart({})}><ShoppingCart size={15} />Checkout ({cartCount})</CheckoutDialog></div></div>
    {(stores.error || catalog.error) && <Card className="mb-4 flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />Live product catalogue could not be loaded.</Card>}
    <div className="toolbar">
      <label className="toolbar-search"><Search size={16} /><input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, SKU or barcode…" /></label>
      <select className="field" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category filter">{categories.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    {catalog.isLoading ? <Card className="p-8 text-center text-sm text-muted">Loading catalogue…</Card> : filtered.length ? <section className="product-grid">{filtered.map((product) => <Card className="product-card" key={product._id}>
      <Link href={`/products/${product._id}`} className="block" aria-label={`View ${product.name} details`}><ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} /></Link>
      <div className="product-card-body">
        <span className="eyebrow">{product.category}</span>
        <Link href={`/products/${product._id}`} className="no-underline"><h3>{product.name}</h3></Link>
        <p>{product.sku} · {product.brand || "Retail item"}</p>
        <div className="product-card-foot"><div><div className="product-price">{money(product.sellingPrice)}</div><div className="product-stock">{product.availableQuantity} available</div></div><Badge tone={product.availableQuantity > 0 ? "success" : "danger"}>{product.availableQuantity > 0 ? "IN STOCK" : "OUT OF STOCK"}</Badge></div>
        <div className="mt-3 flex gap-2"><Button variant="secondary" className="flex-1" disabled={!product.availableQuantity} onClick={() => setCart((current) => ({ ...current, [product._id]: Math.min(product.availableQuantity, (current[product._id] ?? 0) + 1) }))}><Plus size={14} />Add to cart</Button>{cart[product._id] > 0 && <Button variant="secondary" aria-label={`Remove one ${product.name} from cart`} onClick={() => setCart((current) => { const next = { ...current, [product._id]: current[product._id] - 1 }; if (next[product._id] <= 0) delete next[product._id]; return next; })}><Minus size={14} /></Button>}<CheckoutDialog storeId={activeStoreId} items={[{ productId: product._id, quantity: 1 }]} disabled={!product.availableQuantity}>Buy now</CheckoutDialog></div>
      </div>
    </Card>)}</section> : <Card><div className="empty-state"><div className="empty-icon"><PackageOpen size={22} /></div><h3>{catalog.data?.length ? "No products match" : "No products available"}</h3><p>{catalog.data?.length ? "Try another search or category." : "The selected store has no active products in its catalogue."}</p></div></Card>}
  </>;
}
