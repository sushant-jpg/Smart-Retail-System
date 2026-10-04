"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Monitor, RefreshCw, ShieldCheck, ShieldX, Smartphone, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";
import { money } from "@/lib/format";

type Store = { _id: string; name: string; code: string; status: string };
type Profile = {
  _id: string; email: string; firstName: string; lastName: string; role: string;
  storeIds: Store[]; emailVerifiedAt?: string; lastLoginAt?: string; status: string; createdAt: string;
};
type Loyalty = { account: { pointsBalance: number; lifetimePoints: number; tier: string } };
type Order = { _id: string; saleNumber: string; total: number; saleStatus: string; createdAt: string };
type SessionRow = {
  _id: string; device: string; ip: string; userAgent: string; lastUsedAt: string;
  createdAt: string; isCurrent: boolean;
};

function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return "Microsoft Edge";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Unknown browser";
}

export default function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [actionError, setActionError] = useState("");
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiRequest<Profile>("/auth/me"), enabled: Boolean(user) });
  const loyalty = useQuery({ queryKey: ["loyalty", "me"], queryFn: () => apiRequest<Loyalty>("/loyalty/me"), enabled: Boolean(user) });
  const orders = useQuery({ queryKey: ["profile", "orders"], queryFn: () => apiRequest<{ items: Order[] }>("/sales?page=1&limit=5"), enabled: Boolean(user) });
  const sessions = useQuery({ queryKey: ["profile", "sessions"], queryFn: () => apiRequest<SessionRow[]>("/auth/sessions"), enabled: Boolean(user) });
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => apiRequest<{ revoked: boolean }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["profile", "sessions"] });
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not end that session. Please retry."),
  });
  const revokeOthers = useMutation({
    mutationFn: () => apiRequest<{ revoked: boolean; count: number }>("/auth/sessions/others", { method: "DELETE" }),
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["profile", "sessions"] });
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : "Could not end other sessions. Please retry."),
  });

  async function signOutCurrent() {
    await logout();
    router.replace("/login");
  }

  const anyError = profile.isError || loyalty.isError || orders.isError || sessions.isError;
  const retryAll = () => {
    void profile.refetch();
    void loyalty.refetch();
    void orders.refetch();
    void sessions.refetch();
  };

  return <>
    <div className="page-header">
      <div><h2>Profile & security</h2><p>Your account details and active sign-in sessions.</p></div>
      <Button variant="secondary" onClick={retryAll} disabled={profile.isFetching || loyalty.isFetching || orders.isFetching || sessions.isFetching}>
        <RefreshCw size={15} />Refresh
      </Button>
    </div>
    {anyError && <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-red-300 p-4 text-sm text-red-700 dark:border-red-800 dark:text-red-200" role="alert">
      <span>Some account information could not be loaded. Retry to fetch the latest data.</span>
      <Button variant="secondary" onClick={retryAll}>Retry</Button>
    </Card>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
      <Card className="panel">
        <div className="panel-head"><div><h3>Personal information</h3><p>Account information from the SmartRetail API</p></div><UserRound size={18} /></div>
        {profile.isLoading ? <p className="py-6 text-sm text-muted" role="status">Loading account details…</p> : profile.data ? <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div><span className="text-xs text-muted">Name</span><p className="mt-1 font-semibold">{profile.data.firstName} {profile.data.lastName}</p></div>
          <div><span className="text-xs text-muted">Email</span><p className="mt-1 break-all font-semibold">{profile.data.email}</p></div>
          <div><span className="text-xs text-muted">Verification</span><p className="mt-1"><Badge tone={profile.data.emailVerifiedAt ? "success" : "warning"}>{profile.data.emailVerifiedAt ? "Verified" : "Not verified"}</Badge></p></div>
          <div><span className="text-xs text-muted">Role</span><p className="mt-1 font-semibold">{profile.data.role.replaceAll("_", " ")}</p></div>
          <div><span className="text-xs text-muted">Account status</span><p className="mt-1"><Badge tone={profile.data.status === "ACTIVE" ? "success" : "warning"}>{profile.data.status}</Badge></p></div>
          <div><span className="text-xs text-muted">Account created</span><p className="mt-1 font-semibold">{dateTime(profile.data.createdAt)}</p></div>
          <div><span className="text-xs text-muted">Last login</span><p className="mt-1 font-semibold">{dateTime(profile.data.lastLoginAt)}</p></div>
          <div><span className="text-xs text-muted">Assigned stores</span>
            {profile.data.storeIds.length ? <ul className="mt-1 space-y-1">{profile.data.storeIds.map((store) => <li className="font-semibold" key={store._id}>{store.name} <span className="text-xs text-muted">({store.code})</span></li>)}</ul> : <p className="mt-1 text-sm text-muted">No stores assigned</p>}
          </div>
        </div> : <EmptyState icon={<UserRound size={22} />} title="Profile unavailable" description="The account could not be loaded from the API." />}
      </Card>

      <Card className="panel">
        <div className="panel-head"><div><h3>Loyalty</h3><p>Current rewards account</p></div><Badge tone="info">{loyalty.data?.account.tier ?? (loyalty.isLoading ? "Loading" : "—")}</Badge></div>
        {loyalty.isLoading ? <p className="py-6 text-sm text-muted" role="status">Loading loyalty account…</p> : loyalty.data ? <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-canvas p-4"><span className="text-xs text-muted">Available points</span><strong className="mt-1 block text-2xl">{loyalty.data.account.pointsBalance.toLocaleString()}</strong></div>
          <div className="rounded-xl bg-canvas p-4"><span className="text-xs text-muted">Lifetime points</span><strong className="mt-1 block text-2xl">{loyalty.data.account.lifetimePoints.toLocaleString()}</strong></div>
        </div> : <EmptyState icon={<ShieldX size={22} />} title="Loyalty unavailable" description="Rewards details could not be loaded." />}
      </Card>
    </div>

    <section className="mt-4 grid gap-4 xl:grid-cols-2">
      <Card className="panel">
        <div className="panel-head"><div><h3>Recent orders</h3><p>Your latest completed or pending purchases</p></div></div>
        {orders.isLoading ? <p className="py-6 text-center text-sm text-muted" role="status">Loading recent orders…</p>
          : orders.data?.items.length ? <div className="table-scroll -mx-[18px] -mb-[18px]"><table className="data-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead><tbody>{orders.data.items.map((order) => <tr key={order._id}><td className="font-semibold">{order.saleNumber}</td><td>{new Date(order.createdAt).toLocaleDateString()}</td><td><Badge tone={order.saleStatus === "PAID" ? "success" : "neutral"}>{order.saleStatus}</Badge></td><td className="text-right font-semibold">{money(order.total)}</td></tr>)}</tbody></table></div>
            : <EmptyState icon={<ShieldCheck size={22} />} title="No recent orders" description={orders.isError ? "Orders could not be loaded." : "Orders placed with your account will appear here."} />}
      </Card>

      <Card className="panel">
        <div className="panel-head"><div><h3>Security settings</h3><p>Manage signed-in devices and your account password</p></div><ShieldCheck size={18} /></div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-canvas p-3">
          <div className="flex items-center gap-2 text-sm"><KeyRound size={16} /><span>Password</span></div>
          <Button variant="secondary" onClick={() => router.push("/forgot-password")}>Reset password</Button>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Active sessions</h4>
          <Button variant="secondary" onClick={() => revokeOthers.mutate()} disabled={revokeOthers.isPending || sessions.isLoading || !sessions.data?.some((session) => !session.isCurrent)}>
            {revokeOthers.isPending ? "Ending sessions…" : "Log out other sessions"}
          </Button>
        </div>
        {actionError && <p className="mb-3 text-sm text-red-700 dark:text-red-200" role="alert">{actionError}</p>}
        {sessions.isLoading ? <p className="py-4 text-sm text-muted" role="status">Loading sessions…</p>
          : sessions.data?.length ? <ul className="space-y-3">{sessions.data.map((session) => <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3" key={session._id}>
            <div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 text-muted">{/Mobile|Android|iPhone/i.test(session.userAgent) ? <Smartphone size={17} /> : <Monitor size={17} />}</div>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{session.device || "Unknown device"}</strong>{session.isCurrent && <Badge tone="success">Current device</Badge>}</div>
                <p className="mt-1 text-xs text-muted">{browserName(session.userAgent)} · IP {session.ip || "Unavailable"}</p>
                <p className="mt-1 text-xs text-muted">Signed in {dateTime(session.createdAt)} · Last active {dateTime(session.lastUsedAt)}</p>
              </div>
            </div>
            {session.isCurrent ? <Button variant="ghost" onClick={() => void signOutCurrent()}>Sign out</Button> : <Button variant="danger" onClick={() => revokeSession.mutate(session._id)} disabled={revokeSession.isPending}>Log out</Button>}
          </li>)}</ul> : <EmptyState icon={<Monitor size={22} />} title="No active sessions" description={sessions.isError ? "Sessions could not be loaded." : "No active sessions were returned for this account."} />}
      </Card>
    </section>
  </>;
}
