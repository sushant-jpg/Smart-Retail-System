"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { Button, Card, EmptyState } from "@/components/ui";

type NotificationItem = { _id: string; title: string; message: string; readAt?: string; createdAt: string };
type NotificationPage = { items: NotificationItem[]; total: number; unread: number; page: number; pages: number };

export default function NotificationsPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["notifications", page, unreadOnly], queryFn: () => apiRequest<NotificationPage>(`/notifications?page=${page}&limit=20&unreadOnly=${unreadOnly}`) });
  async function refresh() { await client.invalidateQueries({ queryKey: ["notifications"] }); }
  async function markRead(id: string) {
    setError("");
    try { await apiRequest(`/notifications/${id}/read`, { method: "PATCH" }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Notification could not be updated."); }
  }
  async function markAllRead() {
    setError("");
    try { await apiRequest("/notifications/read-all", { method: "PATCH" }); await refresh(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Notifications could not be updated."); }
  }
  return <><div className="page-header"><div><h2>Notifications</h2><p>Live operational alerts and account updates.</p></div><div className="page-actions"><Button variant="secondary" onClick={() => { setPage(1); setUnreadOnly((value) => !value); }}>{unreadOnly ? "Show all" : "Unread only"}</Button><Button onClick={markAllRead} disabled={!query.data?.unread}><CheckCheck size={15}/>Mark all read</Button></div></div>
    {error && <Card className="mb-4 p-4 text-sm text-red-700" role="alert">{error}</Card>}
    {query.isLoading ? <Card className="p-8 text-center text-sm text-muted">Loading notifications…</Card> : query.error ? <Card className="p-8 text-center text-sm text-red-700" role="alert">Notifications could not be loaded.</Card> : query.data?.items.length ? <Card className="overflow-hidden">{query.data.items.map((item) => <button key={item._id} className={`flex w-full items-start gap-3 border-b border-line p-4 text-left last:border-0 ${item.readAt ? "opacity-70" : "bg-emerald-50/40 dark:bg-emerald-950/20"}`} onClick={() => !item.readAt && markRead(item._id)} disabled={Boolean(item.readAt)}><span className="notification-icon"><Bell size={16}/></span><span className="flex-1"><strong className="block text-sm">{item.title}</strong><span className="mt-1 block text-xs text-muted">{item.message}</span><time className="mt-2 block text-[10px] text-muted">{new Date(item.createdAt).toLocaleString()}</time></span>{!item.readAt && <span className="mt-1 h-2 w-2 rounded-full bg-brand"/>}</button>)}</Card> : <Card><EmptyState icon={<Bell size={22}/>} title="No notifications" description={unreadOnly ? "You have no unread notifications." : "Operational alerts will appear here."}/></Card>}
    {Boolean(query.data?.pages && query.data.pages > 1) && <div className="mt-4 flex items-center justify-end gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-xs text-muted">Page {page} of {query.data?.pages}</span><Button variant="secondary" disabled={page >= (query.data?.pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
  </>;
}
