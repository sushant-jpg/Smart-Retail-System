"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { money } from "@/lib/format";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

type Row = { id: string; primary: string; detail: string; value: string; status: string };
type View = { title: string; description: string; rows: Row[]; stats: Array<{ label: string; value: string }> };

const descriptions: Record<string, [string, string]> = {
  orders: ["Orders", "Persisted sales and payment status across checkout channels."],
  promotions: ["Promotions", "Server-managed offers, eligibility windows, and usage."],
  suppliers: ["Suppliers", "Supplier records used by purchasing workflows."],
  analytics: ["Store comparison", "Real revenue, order, and item totals for the last 30 days."],
  customers: ["Customers", "Registered customer accounts available for loyalty and POS lookup."],
  settings: ["Workspace settings", "Stores assigned to your account."],
  help: ["Help & support", "Operational guidance for real SmartRetail workflows."],
};

function endpoint(section: string) {
  if (section === "orders") return "/sales?limit=100";
  if (section === "promotions") return "/promotions";
  if (section === "suppliers") return "/suppliers";
  if (section === "customers") return "/customers?limit=100";
  if (section === "settings") return "/stores";
  if (section === "analytics") {
    const to = new Date(); const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return `/analytics/stores?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }
  return "";
}

function viewFor(section: string, payload: unknown): View {
  const [title, description] = descriptions[section] ?? ["SmartRetail", "Live workspace data."];
  if (section === "help") return { title, description, stats: [], rows: [
    { id: "checkout", primary: "Checkout failures", detail: "Review the server error, refresh the quote after price changes, and retry with the same attempt.", value: "Commerce", status: "Guide" },
    { id: "inventory", primary: "Inventory corrections", detail: "Use a movement or transfer so every quantity change remains auditable.", value: "Operations", status: "Guide" },
    { id: "refund", primary: "Refund safety", detail: "Request, approve, then complete a refund. Remaining quantity and value are validated atomically.", value: "Returns", status: "Guide" },
  ] };
  const object = payload as Record<string, unknown> | undefined;
  const list = (Array.isArray(payload) ? payload : Array.isArray(object?.items) ? object.items : []) as Array<Record<string, unknown>>;
  let rows: Row[] = [];
  if (section === "orders") rows = list.map((item) => ({ id: String(item._id), primary: String(item.saleNumber), detail: `${Array.isArray(item.items) ? item.items.length : 0} lines · ${String(item.paymentMethod)}`, value: money(Number(item.total)), status: String(item.saleStatus) }));
  if (section === "promotions") rows = list.map((item) => ({ id: String(item._id), primary: String(item.code), detail: String(item.title), value: `${Number(item.usageCount ?? 0)} uses`, status: String(item.status) }));
  if (section === "suppliers") rows = list.map((item) => ({ id: String(item._id), primary: String(item.name), detail: `${String(item.contactPerson)} · ${String(item.email)}`, value: `${Number(item.leadTimeDays)} day lead`, status: String(item.status) }));
  if (section === "customers") rows = list.map((item) => ({ id: String(item._id), primary: `${String(item.firstName)} ${String(item.lastName)}`, detail: String(item.email), value: new Date(String(item.createdAt)).toLocaleDateString(), status: String(item.status) }));
  if (section === "settings") rows = list.map((item) => ({ id: String(item._id), primary: String(item.name), detail: String(item.address), value: String(item.code), status: String(item.status) }));
  if (section === "analytics") rows = list.map((item) => ({ id: String(item.storeId), primary: String(item.name), detail: `${Number(item.orders)} orders · ${Number(item.itemsSold)} items`, value: money(Number(item.revenue)), status: "Live" }));
  const active = rows.filter((row) => ["ACTIVE", "PAID", "Live"].includes(row.status)).length;
  return { title, description, rows, stats: [{ label: "Records", value: String(rows.length) }, { label: "Active / paid", value: String(active) }] };
}

export default function SectionPage() {
  const section = String(useParams<{ section: string }>().section);
  const [search, setSearch] = useState("");
  const url = endpoint(section);
  const query = useQuery({ queryKey: ["section", section], queryFn: () => apiRequest<unknown>(url), enabled: Boolean(url) });
  const view = useMemo(() => viewFor(section, query.data), [section, query.data]);
  const rows = view.rows.filter((row) => `${row.primary} ${row.detail} ${row.status}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="page-header"><div><h2>{view.title}</h2><p>{view.description}</p></div>{url && <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={15}/>{query.isFetching ? "Refreshing…" : "Refresh"}</Button>}</div>
    {query.error && <Card className="mb-4 p-4 text-sm text-red-700" role="alert">Live data could not be loaded. No demo records are shown.</Card>}
    {view.stats.length > 0 && <section className="mb-4 grid gap-3 sm:grid-cols-2">{view.stats.map((stat) => <Card className="p-5" key={stat.label}><span className="text-xs text-muted">{stat.label}</span><strong className="mt-2 block text-2xl">{query.isLoading ? "…" : stat.value}</strong></Card>)}</section>}
    <Card className="table-card"><div className="table-header"><div><h3>Live records</h3><p className="mt-1 text-[10px] text-muted">Loaded from SmartRetail APIs</p></div><label className="toolbar-search w-[260px]"><Search size={14}/><input className="field !h-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter records…"/></label></div>{query.isLoading ? <div className="p-8 text-center text-sm text-muted">Loading live data…</div> : rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name / ID</th><th>Details</th><th>Value</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="font-bold">{row.primary}</td><td>{row.detail}</td><td>{row.value}</td><td><Badge tone={["ACTIVE", "PAID", "Live", "Guide"].includes(row.status) ? "success" : "neutral"}>{row.status}</Badge></td></tr>)}</tbody></table></div> : <EmptyState icon={<Search size={22}/>} title="No records" description={query.error ? "The API request failed." : "No live records match this view."}/>}</Card>
  </>;
}
