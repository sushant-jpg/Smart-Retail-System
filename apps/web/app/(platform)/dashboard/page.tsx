"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Boxes, CircleDollarSign, Download, PackageCheck, ReceiptText, Sparkles } from "lucide-react";
import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card } from "@/components/ui";
import { apiRequest } from "@/lib/api";
import { compactNumber, money } from "@/lib/format";
import { useStores } from "@/lib/retail";

type Analytics = {
  revenue: number; orders: number; itemsSold: number; grossProfit: number; activeCustomers: number;
  averageOrderValue: number; lowStock: number; outOfStock: number;
  revenueSeries: Array<{ day: string; revenue: number; orders: number }>;
  categories: Array<{ category: string; revenue: number; quantity: number }>;
  topProducts: Array<{ productId: string; name: string; sku: string; revenue: number; quantity: number }>;
  slowProducts: Array<{ productId: string; name: string; sku: string; revenue: number; quantity: number }>;
  paymentMethods: Array<{ method: string; revenue: number; orders: number }>;
};
type InventoryRow = { availableQuantity: number; reorderLevel: number; productDetails: { name: string; sku: string } };
type SaleRow = { saleNumber: string; customer?: string; total: number; paymentMethod: string; saleStatus: string; createdAt: string };
type StoreComparison = { storeId: string; name: string; revenue: number; orders: number; itemsSold: number; averageOrderValue: number };
type RangePreset = "today" | "7days" | "30days" | "3months" | "custom";

const chartColors = ["#2f6b4f", "#d49a35", "#e36d55", "#6f8fa8", "#c5c9c7"];
const localDateInput = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export default function DashboardPage() {
  const stores = useStores();
  const [storeId, setStoreId] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("7days");
  const [customFrom, setCustomFrom] = useState(() => localDateInput(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => localDateInput(new Date()));
  const activeStoreId = storeId || stores.data?.[0]?._id || "";
  const dateRange = useMemo<{ from: string; to: string } | null>(() => {
    const to = new Date();
    const from = new Date(to);
    if (rangePreset === "custom") {
      const customStart = new Date(`${customFrom}T00:00:00`);
      const customEnd = new Date(`${customTo}T23:59:59.999`);
      if (!customFrom || !customTo || Number.isNaN(customStart.getTime()) || Number.isNaN(customEnd.getTime()) || customStart > customEnd) return null;
      return { from: customStart.toISOString(), to: customEnd.toISOString() };
    }
    if (rangePreset === "today") from.setHours(0, 0, 0, 0);
    else if (rangePreset === "30days") from.setDate(from.getDate() - 29);
    else if (rangePreset === "3months") from.setMonth(from.getMonth() - 3);
    else from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [customFrom, customTo, rangePreset]);
  const rangeTitle = rangePreset === "today" ? "Today" : rangePreset === "7days" ? "7 days" : rangePreset === "30days" ? "30 days" : rangePreset === "3months" ? "3 months" : "Custom range";
  const analytics = useQuery({
    queryKey: ["analytics", activeStoreId, dateRange],
    queryFn: () => apiRequest<Analytics>(`/analytics/overview?storeId=${encodeURIComponent(activeStoreId)}&from=${encodeURIComponent(dateRange!.from)}&to=${encodeURIComponent(dateRange!.to)}`),
    enabled: Boolean(activeStoreId && dateRange),
  });
  const storeComparison = useQuery({
    queryKey: ["analytics", "stores", dateRange],
    queryFn: () => apiRequest<StoreComparison[]>(`/analytics/stores?from=${encodeURIComponent(dateRange!.from)}&to=${encodeURIComponent(dateRange!.to)}`),
    enabled: Boolean(activeStoreId && dateRange),
  });
  const inventory = useQuery({
    queryKey: ["inventory", activeStoreId, "low"],
    queryFn: () => apiRequest<InventoryRow[]>(`/inventory?storeId=${encodeURIComponent(activeStoreId)}&lowStock=true`),
    enabled: Boolean(activeStoreId),
  });
  const sales = useQuery({
    queryKey: ["sales", activeStoreId, "recent"],
    queryFn: () => apiRequest<{ items: SaleRow[] }>(`/sales?storeId=${encodeURIComponent(activeStoreId)}&page=1&limit=5`),
    enabled: Boolean(activeStoreId),
  });
  const data = analytics.data;
  const totalCategoryRevenue = data?.categories.reduce((sum, item) => sum + item.revenue, 0) ?? 0;
  const categorySales = data?.categories.map((item, index) => ({
    name: item.category,
    value: totalCategoryRevenue ? Math.round(item.revenue / totalCategoryRevenue * 100) : 0,
    color: chartColors[index % chartColors.length],
  })) ?? [];
  const paymentSales = data?.paymentMethods.map((item, index) => ({ name: item.method, value: item.orders, color: chartColors[index % chartColors.length] })) ?? [];
  const failed = stores.isError || analytics.isError || inventory.isError || sales.isError || storeComparison.isError;
  const loading = stores.isLoading || analytics.isLoading || inventory.isLoading || sales.isLoading || storeComparison.isLoading;

  return <>
    <div className="page-header"><div><h2>Store overview</h2><p>Performance and inventory from recent backend activity.</p></div><div className="page-actions flex-wrap">
      <label className="text-xs font-semibold">Store<select className="field mt-1" value={activeStoreId} onChange={(event) => setStoreId(event.target.value)} aria-label="Select analytics store">{(stores.data ?? []).map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>
      <label className="text-xs font-semibold">Period<select className="field mt-1" value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)} aria-label="Select analytics date range"><option value="today">Today</option><option value="7days">7 days</option><option value="30days">30 days</option><option value="3months">3 months</option><option value="custom">Custom</option></select></label>
      {rangePreset === "custom" && <div className="flex gap-2"><label className="text-xs font-semibold">From<input className="field mt-1" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label className="text-xs font-semibold">To<input className="field mt-1" type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      <Button variant="secondary" onClick={() => { void analytics.refetch(); void inventory.refetch(); void sales.refetch(); void storeComparison.refetch(); }} disabled={loading}><Download size={15} />Refresh</Button></div></div>
    {!dateRange && <Card className="mb-4 border-amber-300 p-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200" role="alert">Choose a valid custom date range to load analytics.</Card>}
    {failed && <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-red-300 p-4 text-sm text-red-700 dark:border-red-800 dark:text-red-200" role="alert"><span>Live dashboard data could not be loaded. No demo figures are shown.</span><Button variant="secondary" onClick={() => { void analytics.refetch(); void inventory.refetch(); void sales.refetch(); void storeComparison.refetch(); }}>Retry</Button></Card>}
    {!activeStoreId && !stores.isLoading && <Card className="mb-4 p-4 text-sm text-muted">No active stores are available to this workspace.</Card>}
    <section className="kpi-grid" aria-label="Recent store performance">
      {[
        { label: `Revenue · ${rangeTitle}`, value: data ? money(data.revenue) : "—", icon: CircleDollarSign },
        { label: "Orders", value: data ? compactNumber(data.orders) : "—", icon: ReceiptText },
        { label: "Average order value", value: data ? money(data.averageOrderValue) : "—", icon: CircleDollarSign },
        { label: "Items sold", value: data ? compactNumber(data.itemsSold) : "—", icon: PackageCheck },
        { label: "Gross profit", value: data ? money(data.grossProfit) : "—", icon: Sparkles },
        { label: "Active customers", value: data ? compactNumber(data.activeCustomers) : "—", icon: ReceiptText },
      ].map((item) => <Card className="kpi-card" key={item.label}><div className="kpi-top"><div className="kpi-icon"><item.icon size={17} /></div><span className="text-[10px] font-semibold text-muted">{loading ? "Loading" : "Live"}</span></div><div className="kpi-label">{item.label}</div><div className="kpi-value">{item.value}</div><div className="kpi-change"><ArrowUpRight size={12} /><span className="font-medium text-muted">{rangeTitle}</span></div></Card>)}
    </section>
    {data && <div className="mb-4 flex flex-wrap gap-2"><Badge tone="warning">{data.lowStock} low-stock items</Badge><Badge tone="danger">{data.outOfStock} out of stock</Badge><Badge tone="info">{data.activeCustomers} active customers</Badge></div>}
    <section className="content-grid">
      <Card className="panel"><div className="panel-head"><div><h3>Revenue & orders trend</h3><p>Daily revenue and order count · {rangeTitle.toLowerCase()}</p></div></div>
        {analytics.isLoading ? <div className="chart-wrap grid place-items-center text-xs text-muted" role="status">Loading sales data…</div> : analytics.error ? <div className="chart-wrap grid place-items-center text-xs text-red-700 dark:text-red-200">Sales trend unavailable. Retry above.</div> : data?.revenueSeries.length ? <div className="chart-wrap" aria-label="Revenue and orders trend"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.revenueSeries} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}><defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f6b4f" stopOpacity={0.25} /><stop offset="100%" stopColor="#2f6b4f" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgb(var(--line))" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 10 }} dy={8} /><YAxis yAxisId="revenue" axisLine={false} tickLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 9 }} tickFormatter={(value) => compactNumber(value)} /><YAxis yAxisId="orders" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 9 }} allowDecimals={false} /><Tooltip formatter={(value, name) => [name === "revenue" ? money(Number(value)) : compactNumber(Number(value)), name === "revenue" ? "Revenue" : "Orders"]} /><Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#2f6b4f" strokeWidth={2.5} fill="url(#revenueFill)" /><Line yAxisId="orders" type="monotone" dataKey="orders" stroke="#d49a35" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div> : <div className="chart-wrap grid place-items-center text-xs text-muted">No sales in this date range.</div>}
      </Card>
      <Card className="panel"><div className="panel-head"><div><h3>Sales by category</h3><p>Share of net sales for the selected period</p></div></div>
        {loading ? <div className="grid min-h-40 place-items-center text-xs text-muted">Loading category sales…</div> : categorySales.length ? <div className="flex items-center gap-3"><div className="relative h-[150px] w-[150px] flex-none"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categorySales} innerRadius={48} outerRadius={68} paddingAngle={3} dataKey="value" stroke="none">{categorySales.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="block text-xl">100%</strong><span className="text-[9px] text-muted">Sales mix</span></div></div></div><div className="flex flex-1 flex-col gap-2.5">{categorySales.map((entry) => <div key={entry.name} className="flex items-center text-[10px]"><i className="mr-2 h-2 w-2 rounded-full" style={{ background: entry.color }} /><span className="text-muted">{entry.name}</span><strong className="ml-auto">{entry.value}%</strong></div>)}</div></div> : <p className="py-8 text-center text-xs text-muted">No category sales for this period.</p>}
      </Card>
    </section>
    <section className="content-grid">
      <Card className="panel"><div className="panel-head"><div><h3>Store comparison</h3><p>Revenue and order totals by assigned store · {rangeTitle.toLowerCase()}</p></div></div>
        {storeComparison.isLoading ? <p className="py-6 text-center text-xs text-muted" role="status">Loading store comparison…</p> : storeComparison.error ? <p className="py-6 text-center text-xs text-red-700 dark:text-red-200">Store comparison is unavailable. Retry above.</p> : storeComparison.data?.length ? <div className="table-scroll -mx-[18px] -mb-[18px]"><table className="data-table"><thead><tr><th>Store</th><th>Orders</th><th>Items sold</th><th>Avg. order</th><th className="text-right">Revenue</th></tr></thead><tbody>{storeComparison.data.map((store) => <tr key={store.storeId}><td className="font-semibold">{store.name}</td><td>{compactNumber(store.orders)}</td><td>{compactNumber(store.itemsSold)}</td><td>{money(store.averageOrderValue)}</td><td className="text-right font-semibold">{money(store.revenue)}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-xs text-muted">No store sales for this period.</p>}
      </Card>
      <Card className="panel"><div className="panel-head"><div><h3>Recent sales</h3><p>Latest persisted transactions for this store</p></div></div>
        {sales.isLoading ? <p className="py-6 text-center text-xs text-muted">Loading recent sales…</p> : sales.data?.items.length ? <div className="table-scroll -mx-[18px] -mb-[18px]"><table className="data-table"><thead><tr><th>Sale</th><th>Customer</th><th>Time</th><th>Payment</th><th>Status</th><th className="text-right">Total</th></tr></thead><tbody>{sales.data.items.map((sale) => <tr key={sale.saleNumber}><td className="font-bold">{sale.saleNumber}</td><td>{sale.customer ? "Registered customer" : "Walk-in"}</td><td className="text-muted">{new Date(sale.createdAt).toLocaleTimeString()}</td><td>{sale.paymentMethod}</td><td><Badge tone={sale.saleStatus === "PAID" ? "success" : "warning"}>{sale.saleStatus}</Badge></td><td className="text-right font-bold">{money(sale.total)}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-xs text-muted">No persisted sales found.</p>}
      </Card>
      <Card className="panel"><div className="panel-head"><div><h3>Stock watch</h3><p>Backend-reported inventory at or below reorder level</p></div><Badge tone="warning">{inventory.data?.length ?? "—"} alerts</Badge></div>
        {inventory.isLoading ? <p className="py-6 text-center text-xs text-muted">Loading stock levels…</p> : inventory.data?.length ? <div className="stock-list">{inventory.data.slice(0, 5).map((row, index) => <div className="stock-row" key={`${row.productDetails.sku}-${index}`}><div className="product-visual" aria-hidden="true"><Boxes size={16} /></div><div><strong>{row.productDetails.name}</strong><small>{row.productDetails.sku} · Reorder at {row.reorderLevel}</small><div className="mini-progress"><i style={{ width: `${row.reorderLevel ? Math.min(100, row.availableQuantity / row.reorderLevel * 100) : 0}%` }} /></div></div><div className="stock-number"><strong>{row.availableQuantity}</strong><span>units left</span></div></div>)}</div> : <p className="py-6 text-center text-xs text-muted">No low-stock items for this store.</p>}
      </Card>
    </section>
    <section className="content-grid">
      <Card className="panel"><div className="panel-head"><div><h3>Product velocity</h3><p>Best and slowest sellers in the selected period</p></div></div>
        {loading ? <p className="py-6 text-center text-xs text-muted">Loading product performance…</p> : data?.topProducts.length ? <div className="grid gap-4 sm:grid-cols-2"><div><strong className="mb-2 block text-xs">Top products</strong>{data.topProducts.slice(0, 5).map((product) => <div className="mb-2 flex justify-between text-xs" key={product.productId}><span>{product.name}</span><strong>{product.quantity} sold</strong></div>)}</div><div><strong className="mb-2 block text-xs">Slow products</strong>{data.slowProducts.slice(0, 5).map((product) => <div className="mb-2 flex justify-between text-xs" key={product.productId}><span>{product.name}</span><strong>{product.quantity} sold</strong></div>)}</div></div> : <p className="py-6 text-center text-xs text-muted">No product sales for this period.</p>}
      </Card>
      <Card className="panel"><div className="panel-head"><div><h3>Payment methods</h3><p>Order count by simulated tender</p></div></div>
        {loading ? <div className="grid min-h-40 place-items-center text-xs text-muted">Loading payment mix…</div> : paymentSales.length ? <div className="flex items-center gap-3"><div className="h-[150px] w-[150px] flex-none"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={paymentSales} innerRadius={45} outerRadius={68} dataKey="value" stroke="none">{paymentSales.map((entry) => <Cell key={entry.name} fill={entry.color}/>)}</Pie></PieChart></ResponsiveContainer></div><div className="flex flex-1 flex-col gap-2">{paymentSales.map((entry) => <div className="flex items-center text-xs" key={entry.name}><i className="mr-2 h-2 w-2 rounded-full" style={{ background: entry.color }}/><span>{entry.name}</span><strong className="ml-auto">{entry.value} orders</strong></div>)}</div></div> : <p className="py-6 text-center text-xs text-muted">No payment activity for this period.</p>}
      </Card>
    </section>
  </>;
}
