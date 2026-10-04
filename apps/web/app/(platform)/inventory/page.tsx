"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowRightLeft, Boxes, Download, Search, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { ApiError, apiRequest, newIdempotencyKey } from "@/lib/api";
import { Badge, Button, Card, ProductVisual } from "@/components/ui";
import { money } from "@/lib/format";
import { productAccent, productImage, productInitials, useCatalog, useStores } from "@/lib/retail";

type InventoryItem = {
  _id: string;
  availableQuantity: number;
  reservedQuantity: number;
  damagedQuantity: number;
  reorderLevel: number;
  reorderQuantity: number;
  productDetails: { _id: string; name: string; sku: string; category: string; sellingPrice: number; images: string[] };
};
type Movement = { _id: string; product: { name: string; sku: string } | string; type: string; quantityDelta: number; balanceAfter: number; reason?: string; createdAt: string };
type Operation = "PURCHASE" | "RETURN" | "ADJUSTMENT" | "DAMAGED" | "EXPIRED" | "TRANSFER";

export default function InventoryPage() {
  const client = useQueryClient();
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const inventory = useQuery({
    queryKey: ["inventory", activeStoreId],
    queryFn: () => apiRequest<InventoryItem[]>(`/inventory?storeId=${encodeURIComponent(activeStoreId)}`),
    enabled: Boolean(activeStoreId),
  });
  const movements = useQuery({
    queryKey: ["inventory", activeStoreId, "movements"],
    queryFn: () => apiRequest<Movement[]>(`/inventory/movements?storeId=${encodeURIComponent(activeStoreId)}&limit=10`),
    enabled: Boolean(activeStoreId),
  });
  const catalog = useCatalog(activeStoreId);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "low">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>("PURCHASE");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"IN" | "OUT">("IN");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [destinationStoreId, setDestinationStoreId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const rows = useMemo(() => inventory.data ?? [], [inventory.data]);
  const filtered = useMemo(() => rows.filter((row) => {
    const match = `${row.productDetails.name} ${row.productDetails.sku}`.toLowerCase().includes(search.toLowerCase());
    return match && (scope === "all" || row.availableQuantity <= row.reorderLevel);
  }), [rows, scope, search]);
  const units = rows.reduce((sum, row) => sum + row.availableQuantity, 0);
  const inventoryValue = rows.reduce((sum, row) => sum + row.productDetails.sellingPrice * row.availableQuantity, 0);
  const lowStock = rows.filter((row) => row.availableQuantity > 0 && row.availableQuantity <= row.reorderLevel).length;
  const outOfStock = rows.filter((row) => row.availableQuantity === 0).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (operation === "TRANSFER") {
        await apiRequest("/inventory/transfers", {
          method: "POST",
          headers: { "idempotency-key": newIdempotencyKey() },
          body: { fromStoreId: activeStoreId, toStoreId: destinationStoreId, productId, quantity, reason },
        });
      } else {
        await apiRequest("/inventory/movements", {
          method: "POST",
          body: {
            storeId: activeStoreId, productId, type: operation,
            quantity, direction: operation === "PURCHASE" || operation === "RETURN" || (operation === "ADJUSTMENT" && adjustmentDirection === "IN") ? "IN" : "OUT", reason,
          },
        });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["inventory", activeStoreId] }),
        client.invalidateQueries({ queryKey: ["inventory", activeStoreId, "movements"] }),
      ]);
      setModalOpen(false);
      setReason("");
      setQuantity(1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Inventory operation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const movementSign = (value: number) => value > 0 ? `+${value}` : String(value);

  return <>
    <div className="page-header"><div><h2>Inventory health</h2><p>Live stock quantities and persisted movement history.</p></div><div className="page-actions"><label className="text-xs font-semibold">Store<select className="field mt-1" value={activeStoreId} onChange={(event) => setStoreId(event.target.value)} aria-label="Select inventory store">{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label><Button variant="secondary" onClick={() => { void inventory.refetch(); void movements.refetch(); }} disabled={inventory.isFetching || movements.isFetching}><Download size={15} />Refresh</Button><Button onClick={() => { setError(""); setModalOpen(true); }} disabled={!activeStoreId}><ArrowDownToLine size={15} />Record movement</Button></div></div>
    {(inventory.error || stores.error) && <Card className="mb-4 p-4 text-sm text-red-700" role="alert">Inventory data could not be loaded. No local/demo quantities are displayed.</Card>}
    <section className="grid gap-3 md:grid-cols-4">
      {([
        { label: "Available units", value: inventory.isLoading ? "…" : String(units), note: "Across listed products", Icon: Boxes },
        { label: "Stock value", value: inventory.isLoading ? "…" : money(inventoryValue), note: "At current selling price", Icon: ArrowRightLeft },
        { label: "Low stock", value: inventory.isLoading ? "…" : String(lowStock), note: "At or below reorder level", Icon: AlertTriangle },
        { label: "Out of stock", value: inventory.isLoading ? "…" : String(outOfStock), note: "Requires restock", Icon: AlertTriangle },
      ] satisfies { label: string; value: string; note: string; Icon: LucideIcon }[]).map(({ label, value, note, Icon }) => <Card key={label} className="flex items-center gap-3 p-4"><div className="kpi-icon"><Icon size={17} /></div><div><p className="m-0 text-[10px] font-semibold text-muted">{label}</p><strong className="mt-0.5 block text-lg tracking-tight">{value}</strong><span className="text-[9px] text-muted">{note}</span></div></Card>)}
    </section>
    <Card className="table-card">
      <div className="table-header gap-4"><div><h3>Stock levels</h3><p className="mt-1 text-[10px] text-muted">Live quantity, reservations, damage and reorder points</p></div><div className="segmented"><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All items</button><button className={scope === "low" ? "active" : ""} onClick={() => setScope("low")}>Needs attention</button></div></div>
      <div className="flex flex-wrap gap-2 border-b border-line p-3.5"><label className="toolbar-search min-w-[250px]"><Search size={15} /><input className="field !h-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory…" /></label><Button variant="secondary" className="!h-9" onClick={() => { setScope("low"); }}><SlidersHorizontal size={14} />Low stock</Button></div>
      {inventory.isLoading ? <p className="p-6 text-center text-xs text-muted">Loading inventory…</p> : filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Product</th><th>Available</th><th>Reserved</th><th>Damaged</th><th>Reorder at</th><th>Status</th></tr></thead><tbody>{filtered.map((row) => <tr key={row._id}><td><div className="product-cell"><ProductVisual initials={productInitials(row.productDetails.name)} image={productImage(row.productDetails)} alt={row.productDetails.name} accent={productAccent} /><div><strong>{row.productDetails.name}</strong><small>{row.productDetails.sku} · {row.productDetails.category}</small></div></div></td><td className="font-bold">{row.availableQuantity}</td><td>{row.reservedQuantity}</td><td>{row.damagedQuantity}</td><td>{row.reorderLevel}</td><td><Badge tone={row.availableQuantity === 0 ? "danger" : row.availableQuantity <= row.reorderLevel ? "warning" : "success"}>{row.availableQuantity === 0 ? "OUT OF STOCK" : row.availableQuantity <= row.reorderLevel ? "LOW STOCK" : "HEALTHY"}</Badge></td></tr>)}</tbody></table></div> : <div className="p-5"><div className="empty-state"><div className="empty-icon"><Boxes size={22} /></div><h3>{rows.length ? "No matching stock" : "No inventory records"}</h3><p>{rows.length ? "Change the search or filter." : "This store has no stock records yet."}</p></div></div>}
    </Card>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card className="panel"><div className="panel-head"><div><h3>Latest movements</h3><p>Persisted inventory activity trail</p></div></div>
        {movements.isLoading ? <p className="py-5 text-center text-xs text-muted">Loading movement history…</p> : movements.data?.length ? movements.data.map((entry) => {
          const product = typeof entry.product === "object" ? entry.product : undefined;
          return <div className="flex items-center border-t border-line py-3 text-[11px] first:border-0" key={entry._id}><strong>{product?.name ?? "Product"}</strong><Badge className="ml-auto" tone={entry.quantityDelta > 0 ? "success" : entry.type === "DAMAGED" || entry.type === "EXPIRED" ? "danger" : "info"}>{entry.type}</Badge><span className="ml-4 w-8 text-right font-bold">{movementSign(entry.quantityDelta)}</span><span className="ml-4 w-28 text-right text-[9px] text-muted">{new Date(entry.createdAt).toLocaleString()}</span></div>;
        }) : <p className="py-5 text-center text-xs text-muted">No movements have been recorded.</p>}
      </Card>
      <Card className="panel"><div className="panel-head"><div><h3>Inventory actions</h3><p>Every quantity update is recorded through the API.</p></div></div><div className="grid grid-cols-2 gap-2">{["Purchase / stock-in", "Return", "Adjustment", "Damage", "Expired stock", "Store transfer"].map((action) => <Button key={action} variant="secondary" onClick={() => { setOperation(action === "Purchase / stock-in" ? "PURCHASE" : action === "Store transfer" ? "TRANSFER" : action.toUpperCase() as Operation); setModalOpen(true); }}>{action}</Button>)}</div></Card>
    </div>
    {modalOpen && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !submitting && setModalOpen(false)}><form className="modal" onSubmit={submit} aria-label="Inventory operation">
      <div className="modal-head"><div><h3>Record inventory operation</h3><p className="mt-1 text-[11px] text-muted">Stock changes are committed with an audit and movement record.</p></div><button type="button" className="icon-button -mr-2 -mt-2" aria-label="Close dialog" disabled={submitting} onClick={() => setModalOpen(false)}><X size={18} /></button></div>
      <div className="modal-body space-y-3">
        <label className="block text-xs font-semibold">Operation<select className="field mt-1.5" value={operation} onChange={(event) => setOperation(event.target.value as Operation)}>{[["PURCHASE","Stock in"],["RETURN","Customer return"],["ADJUSTMENT","Adjustment"],["DAMAGED","Damage"],["EXPIRED","Expired stock"],["TRANSFER","Transfer to another store"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs font-semibold">Product<select className="field mt-1.5" required value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Select a product</option>{(catalog.data ?? []).map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku}</option>)}</select></label>
        <label className="block text-xs font-semibold">Quantity<input className="field mt-1.5" type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} required /></label>
        {operation === "TRANSFER" && <label className="block text-xs font-semibold">Destination store<select className="field mt-1.5" required value={destinationStoreId} onChange={(event) => setDestinationStoreId(event.target.value)}><option value="">Select a destination</option>{(stores.data ?? []).filter((store) => store._id !== activeStoreId).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>}
        {operation === "ADJUSTMENT" && <label className="block text-xs font-semibold">Direction<select className="field mt-1.5" value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value as "IN" | "OUT")}><option value="IN">Add units</option><option value="OUT">Remove units</option></select></label>}
        <label className="block text-xs font-semibold">Reason<input className="field mt-1.5" minLength={4} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Explain why the stock is changing" /></label>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950">{error}</p>}
      </div>
      <div className="modal-foot"><Button type="button" variant="secondary" disabled={submitting} onClick={() => setModalOpen(false)}>Cancel</Button><Button type="submit" disabled={submitting || !productId || !reason.trim() || (operation === "TRANSFER" && !destinationStoreId)}>{submitting ? "Saving…" : "Save movement"}</Button></div>
    </form></div>}
  </>;
}
