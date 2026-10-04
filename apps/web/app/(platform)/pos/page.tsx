"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Banknote, Barcode, Minus, Plus, Search, ShoppingBag, Trash2, UserPlus } from "lucide-react";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, Card, EmptyState, ProductVisual } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, useCatalog, useStores, type CatalogProduct } from "@/lib/retail";

type CustomerOption = { _id: string; firstName: string; lastName: string; email: string };

export default function PosPage() {
  const { user } = useAuth();
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const [search, setSearch] = useState("");
  const catalog = useCatalog(activeStoreId, search);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [extraProducts, setExtraProducts] = useState<Record<string, CatalogProduct>>({});
  const [scanCode, setScanCode] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const products = useMemo(() => {
    const map = new Map<string, CatalogProduct>();
    for (const product of catalog.data ?? []) map.set(product._id, product);
    for (const product of Object.values(extraProducts)) map.set(product._id, product);
    return [...map.values()];
  }, [catalog.data, extraProducts]);
  const categories = ["All", ...new Set((catalog.data ?? []).map((product) => product.category))];
  const [category, setCategory] = useState("All");
  const visible = (catalog.data ?? []).filter((product) => category === "All" || product.category === category);
  const lines = Object.entries(cart).map(([id, quantity]) => ({ product: products.find((product) => product._id === id), quantity })).filter((line): line is { product: CatalogProduct; quantity: number } => Boolean(line.product));
  const estimatedTotal = lines.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0);

  async function scan(event: FormEvent) {
    event.preventDefault();
    const code = scanCode.trim();
    if (!code || !activeStoreId) return;
    setLoading(true);
    setMessage("");
    try {
      const product = await apiRequest<CatalogProduct>(`/products/lookup/${encodeURIComponent(code)}?storeId=${encodeURIComponent(activeStoreId)}`);
      setExtraProducts((current) => ({ ...current, [product._id]: product }));
      setCart((current) => ({ ...current, [product._id]: Math.min(product.availableQuantity, (current[product._id] ?? 0) + 1) }));
      setMessage(`${product.name} added.`);
      setScanCode("");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Product lookup failed. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  function change(product: CatalogProduct, delta: number) {
    setCart((current) => {
      const quantity = Math.min(product.availableQuantity, Math.max(0, (current[product._id] ?? 0) + delta));
      const next = { ...current };
      if (quantity) next[product._id] = quantity;
      else delete next[product._id];
      return next;
    });
  }

  async function lookupCustomer(event: FormEvent) {
    event.preventDefault();
    if (customerQuery.trim().length < 2) return;
    setMessage("");
    try {
      const result = await apiRequest<CustomerOption[]>(`/customers/lookup?q=${encodeURIComponent(customerQuery.trim())}`);
      setCustomers(result);
      if (!result.length) setMessage("No matching customers were found.");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Customer lookup failed.");
    }
  }

  return <>
    <div className="pos-layout">
      <section className="pos-catalogue">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="toolbar-search !max-w-none flex-1"><Search size={17} /><input className="field !h-12" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product name, SKU or barcode…" aria-label="Search products" /></label>
          <label className="text-xs font-semibold">Store<select className="field mt-1" value={activeStoreId} onChange={(event) => { setStoreId(event.target.value); setCart({}); setExtraProducts({}); }} aria-label="Select store">{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>
        </div>
        <form className="mb-3 flex gap-2" onSubmit={scan}><label className="toolbar-search !max-w-none flex-1"><Barcode size={17} /><input className="field !h-10" value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder="Scan or enter barcode, SKU, or signed QR" aria-label="Barcode, SKU, or QR code" /></label><Button type="submit" variant="secondary" disabled={loading || !scanCode.trim()}>{loading ? "Looking up…" : "Look up"}</Button></form>
        {message && <p role="status" className="mb-3 rounded-xl bg-canvas px-3 py-2 text-xs">{message}</p>}
        <div className="category-tabs" aria-label="Product categories">{categories.map((item) => <button type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
        {catalog.isLoading || stores.isLoading ? <Card className="p-6 text-center text-sm text-muted">Loading store catalogue…</Card>
          : catalog.error || stores.error ? <Card className="p-6 text-center text-sm text-red-700" role="alert">The store catalogue could not be loaded. Refresh or try again.</Card>
            : <div className="pos-products">{visible.map((product) => <button type="button" disabled={!product.availableQuantity} onClick={() => change(product, 1)} className="pos-product card" key={product._id}>
              <ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} />{cart[product._id] && <span className="pos-count">{cart[product._id]}</span>}
              <h3>{product.name}</h3><p>{product.sku} · {product.availableQuantity ? `${product.availableQuantity} available` : "Out of stock"}</p><strong>{money(product.sellingPrice)}</strong>
            </button>)}{!visible.length && <Card className="p-5"><EmptyState icon={<Search size={21} />} title="No products found" description="Try a different name, SKU, or category." /></Card>}</div>}
      </section>
      <Card className="cart-panel">
        <div className="cart-head"><div><h3>Current order</h3><span className="text-[9px] text-muted">{lines.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>{lines.length > 0 && <button onClick={() => setCart({})} className="icon-button !h-8 !w-8" aria-label="Clear cart"><Trash2 size={15} /></button>}</div>
        <div className="customer-lookup"><div className="grid h-7 w-7 place-items-center rounded-lg bg-canvas"><UserPlus size={14} /></div><div className="min-w-0 flex-1"><strong className="block text-ink">{customer ? `${customer.firstName} ${customer.lastName}` : "Attach customer"}</strong><span>{customer?.email ?? "Optional: lookup for loyalty"}</span></div>{customer && <button type="button" onClick={() => setCustomer(null)}>Remove</button>}</div>
        {!customer && <form className="flex gap-2 px-3 pb-2" onSubmit={lookupCustomer}><input className="field !h-9" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Customer name or email" aria-label="Customer name or email" /><Button variant="secondary" type="submit">Find</Button></form>}
        {customers.length > 0 && <div className="px-3 pb-2">{customers.map((entry) => <button className="mr-1 mt-1 rounded-lg border border-line px-2 py-1 text-left text-[10px]" key={entry._id} onClick={() => { setCustomer(entry); setCustomers([]); }}>{entry.firstName} {entry.lastName} · {entry.email}</button>)}</div>}
        <div className="cart-items">
          {lines.length ? lines.map(({ product, quantity }) => <div className="cart-item" key={product._id}>
            <ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} className="h-9 w-9" />
            <div><h4>{product.name}</h4><p>{money(product.sellingPrice)} · {product.sku}</p><div className="qty-control"><button type="button" onClick={() => change(product, -1)} aria-label={`Remove one ${product.name}`}><Minus size={11} /></button><span>{quantity}</span><button type="button" onClick={() => change(product, 1)} aria-label={`Add one ${product.name}`} disabled={quantity >= product.availableQuantity}><Plus size={11} /></button></div></div>
            <div className="cart-item-price">{money(product.sellingPrice * quantity)}</div>
          </div>) : <EmptyState icon={<ShoppingBag size={21} />} title="Cart is empty" description="Search products or scan a barcode to add items." />}
        </div>
        <div className="cart-summary"><div className="summary-row"><span>Merchandise estimate</span><strong>{money(estimatedTotal)}</strong></div><p className="text-[9px] text-muted">Final discounts, tax and payable total are calculated and confirmed by the server.</p>
          {user && <CheckoutDialog storeId={activeStoreId} items={lines.map(({ product, quantity }) => ({ productId: product._id, quantity }))} customerId={customer?._id} disabled={!lines.length}>{<><Banknote size={15} /> Review payment and charge</>}</CheckoutDialog>}
          {!user && <Badge tone="warning">Sign in to check out</Badge>}
        </div>
      </Card>
    </div>
  </>;
}
