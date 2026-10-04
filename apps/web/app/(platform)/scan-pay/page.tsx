"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Barcode, Check, Minus, Plus, ScanLine, ShieldCheck, ShoppingBag, X } from "lucide-react";
import { CameraScanner } from "@/components/camera-scanner";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, Card, EmptyState, ProductVisual } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, useCatalog, useStores, type CatalogProduct } from "@/lib/retail";

export default function ScanPayPage() {
  const { user } = useAuth();
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const catalog = useCatalog(activeStoreId);
  const [code, setCode] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [scannedProducts, setScannedProducts] = useState<Record<string, CatalogProduct>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const products = useMemo(() => {
    const byId = new Map<string, CatalogProduct>();
    for (const product of catalog.data ?? []) byId.set(product._id, product);
    for (const product of Object.values(scannedProducts)) byId.set(product._id, product);
    return byId;
  }, [catalog.data, scannedProducts]);
  const lines = Object.entries(cart).map(([id, quantity]) => ({ product: products.get(id), quantity })).filter((line): line is { product: CatalogProduct; quantity: number } => Boolean(line.product));
  const subtotalEstimate = lines.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0);

  async function lookup(submittedCode: string) {
    if (!submittedCode || !activeStoreId) return;
    setScanning(true);
    setMessage(null);
    try {
      const product = await apiRequest<CatalogProduct>(`/products/lookup/${encodeURIComponent(submittedCode)}?storeId=${encodeURIComponent(activeStoreId)}`);
      setScannedProducts((current) => ({ ...current, [product._id]: product }));
      const currentQuantity = cart[product._id] ?? 0;
      if (currentQuantity >= product.availableQuantity) {
        setMessage({ text: `Only ${product.availableQuantity} units of ${product.name} are available.`, error: true });
      } else {
        setCart((current) => ({ ...current, [product._id]: (current[product._id] ?? 0) + 1 }));
        setMessage({ text: `${product.name} added to your bag.` });
        setCode("");
      }
    } catch (cause) {
      const text = cause instanceof ApiError ? cause.message : "Product lookup failed. Verify the barcode or signed QR payload.";
      setMessage({ text, error: true });
    } finally {
      setScanning(false);
    }
  }

  async function scan(event: FormEvent) {
    event.preventDefault();
    await lookup(code.trim());
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

  return <>
    <div className="page-header"><div><h2>Scan. Bag. Go.</h2><p>Use a connected barcode scanner or enter a product barcode, SKU, or signed QR payload.</p></div><Badge tone="success"><ShieldCheck size={12} className="mr-1" />Server-validated checkout</Badge></div>
    <div className="grid gap-4 xl:grid-cols-[1fr_410px]">
      <div className="space-y-4">
        <CameraScanner key={activeStoreId} onCode={lookup} />
        <Card className="p-4">
          <label className="mb-3 block text-xs font-semibold">Checkout store<select className="field mt-1.5" value={activeStoreId} onChange={(event) => { setStoreId(event.target.value); setCart({}); setScannedProducts({}); }} aria-label="Checkout store">{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>
          <form className="flex gap-2" onSubmit={scan}><label className="toolbar-search !max-w-none flex-1"><Barcode size={16} /><span className="sr-only">Product barcode, SKU, or signed QR code</span><input autoFocus value={code} onChange={(event) => setCode(event.target.value)} className="field" placeholder="Scan / enter barcode, SKU or QR payload" /></label><Button type="submit" disabled={scanning || !code.trim() || !activeStoreId}>{scanning ? "Looking up…" : "Add item"}</Button></form>
          {message && <div role={message.error ? "alert" : "status"} className={`mt-3 rounded-xl px-3 py-2 text-[10px] font-semibold ${message.error ? "bg-red-50 text-red-700 dark:bg-red-950" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950"}`}>{message.error ? <X size={13} className="mr-1 inline" /> : <Check size={13} className="mr-1 inline" />}{message.text}</div>}
        </Card>
      </div>
      <Card className="flex min-h-[600px] flex-col overflow-hidden">
        <div className="cart-head"><div><h3>My bag</h3><span className="text-[9px] text-muted">{lines.reduce((sum, line) => sum + line.quantity, 0)} scanned items</span></div><ShoppingBag size={18} className="text-muted" /></div>
        <div className="cart-items">{lines.length ? lines.map(({ product, quantity }) => <div className="cart-item" key={product._id}><ProductVisual initials={productInitials(product.name)} image={productImage(product)} alt={product.name} accent={productAccent} className="h-9 w-9" /><div><h4>{product.name}</h4><p>{product.sku} · {money(product.sellingPrice)}</p><div className="qty-control"><button type="button" onClick={() => change(product, -1)} aria-label={`Remove one ${product.name}`}><Minus size={11} /></button><span>{quantity}</span><button type="button" disabled={quantity >= product.availableQuantity} onClick={() => change(product, 1)} aria-label={`Add one ${product.name}`}><Plus size={11} /></button></div></div><div className="cart-item-price">{money(product.sellingPrice * quantity)}</div></div>) : <EmptyState icon={<ScanLine size={22} />} title="Your bag is empty" description="Scan or enter a real barcode, SKU, or signed QR payload." />}</div>
        <div className="cart-summary"><div className="summary-row"><span>Merchandise estimate</span><strong>{money(subtotalEstimate)}</strong></div><p className="text-[9px] text-muted">Server pricing, promotions, loyalty, tax, and stock are checked before payment.</p>
          {user && <CheckoutDialog storeId={activeStoreId} items={lines.map(({ product, quantity }) => ({ productId: product._id, quantity }))}>{<><ShieldCheck size={15} /> Continue to payment</>}</CheckoutDialog>}
          {!user && <Badge tone="warning">Sign in to check out</Badge>}
        </div>
      </Card>
    </div>
  </>;
}
