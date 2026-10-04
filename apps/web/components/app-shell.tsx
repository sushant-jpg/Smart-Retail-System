"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Bell, Boxes, ChevronDown, CircleHelp, LayoutDashboard, LogOut, Menu, Moon,
  PackageSearch, ScanLine, Search, Settings, ShoppingBasket, ShoppingCart, Sun, Tag, UserRound,
  Truck, Users, WifiOff, X, Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, getAccessToken } from "@/lib/api";
import { cn } from "@/lib/format";

const navigation = [
  { group: "Workspace", items: [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/pos", label: "Point of sale", icon: ShoppingCart },
    { href: "/scan-pay", label: "Scan & Pay", icon: ScanLine },
  ] },
  { group: "Operations", items: [
    { href: "/products", label: "Products", icon: PackageSearch },
    { href: "/inventory", label: "Inventory", icon: Boxes },
    { href: "/orders", label: "Orders", icon: ShoppingBasket },
    { href: "/promotions", label: "Promotions", icon: Tag },
    { href: "/suppliers", label: "Suppliers", icon: Truck },
  ] },
  { group: "Insights", items: [
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/notifications", label: "Notifications", icon: Bell },
  ] },
];

const titles: Record<string, [string, string]> = {
  "/dashboard": ["Overview", "Live store performance"], "/pos": ["Point of sale", "Fast cashier checkout"],
  "/scan-pay": ["Scan & Pay", "Customer self-checkout"], "/products": ["Products", "Catalogue and pricing"],
  "/inventory": ["Inventory", "Stock and movements"], "/orders": ["Orders", "Sales and fulfilment"],
  "/promotions": ["Promotions", "Offers and campaigns"], "/suppliers": ["Suppliers", "Partners and procurement"],
  "/analytics": ["Analytics", "Performance intelligence"], "/customers": ["Customers", "Loyalty and relationships"],
  "/notifications": ["Notifications", "Operational alerts"], "/profile": ["Profile & security", "Account details and sessions"],
};

type NotificationData = { items: Array<{ _id: string; title: string; message: string; readAt?: string; createdAt: string }>; unread: number };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [connection, setConnection] = useState<"Connected" | "Reconnecting" | "Disconnected">("Disconnected");
  const title = titles[pathname] ?? ["SmartRetail", "Operations workspace"];
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => apiRequest<NotificationData>("/notifications?limit=5"), enabled: Boolean(user) });

  useEffect(() => {
    const saved = localStorage.getItem("smartretail-theme");
    const enabled = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", enabled);
    const frame = requestAnimationFrame(() => setDark(enabled));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socketUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(/\/api\/v1\/?$/, "");
    const socket = io(socketUrl, { auth: { token }, reconnection: true });
    socket.on("connect", () => setConnection("Connected"));
    socket.io.on("reconnect_attempt", () => setConnection("Reconnecting"));
    socket.on("disconnect", () => setConnection("Disconnected"));
    socket.on("notification.created", () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }));
    socket.on("inventory.updated", () => void queryClient.invalidateQueries({ queryKey: ["inventory"] }));
    socket.on("sale.completed", () => void queryClient.invalidateQueries({ queryKey: ["analytics"] }));
    return () => { socket.disconnect(); };
  }, [queryClient, user]);

  const initials = useMemo(() => `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`, [user]);
  function toggleTheme() { const next = !dark; setDark(next); document.documentElement.classList.toggle("dark", next); localStorage.setItem("smartretail-theme", next ? "dark" : "light"); }
  async function markAllRead() { await apiRequest("/notifications/read-all", { method: "PATCH" }); await queryClient.invalidateQueries({ queryKey: ["notifications"] }); }
  async function signOut() { await logout(); router.replace("/login"); }

  return <div className="app-frame">
    {menuOpen&&<button className="mobile-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>} 
    <aside className={cn("sidebar",menuOpen&&"open")} aria-label="Main navigation">
      <div className="brand-lockup"><div className="brand-mark"><Zap size={20} strokeWidth={2.6}/></div><div><strong>SmartRetail</strong><small>Operations</small></div><button className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/60 md:hidden" onClick={()=>setMenuOpen(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="store-picker"><label>Active store</label><button><span className="flex items-center gap-2"><i className="store-dot"/>Assigned workspace</span><ChevronDown size={14}/></button></div>
      <nav>{navigation.map((section)=><div key={section.group}><div className="nav-label">{section.group}</div>{section.items.map((item)=><Link key={item.href} href={item.href} className={cn("nav-link",pathname===item.href&&"active")} onClick={()=>setMenuOpen(false)}><item.icon size={17}/><span>{item.label}</span></Link>)}</div>)}</nav>
      <div className="sidebar-footer"><Link href="/profile" className="nav-link"><UserRound size={17}/>Profile & security</Link><Link href="/settings" className="nav-link"><Settings size={17}/>Settings</Link><Link href="/help" className="nav-link"><CircleHelp size={17}/>Help & support</Link><button className="nav-link w-full" onClick={signOut}><LogOut size={17}/>Sign out</button><div className="user-chip mt-3 px-2"><div className="avatar">{initials}</div><div><strong>{user?.firstName} {user?.lastName}</strong><span>{user?.role.replaceAll("_"," ").toLowerCase()}</span></div></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" onClick={()=>setMenuOpen(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="topbar-title"><p>{title[1]}</p><h1>{title[0]}</h1></div><label className="global-search"><Search size={16}/><input aria-label="Global search" placeholder="Search products, orders, customers…"/><span className="keycap">⌘ K</span></label><div className="top-actions"><div className={cn("connection",connection!=="Connected"&&"!text-amber-700")}>{connection==="Disconnected"?<WifiOff size={11}/>:<i/>}{connection}</div><button className="icon-button" onClick={toggleTheme} aria-label={dark?"Use light theme":"Use dark theme"}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="icon-button" onClick={()=>setNotificationsOpen((value)=>!value)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={18}/>{Boolean(notifications.data?.unread)&&<span className="notification-dot"/>}</button>{notificationsOpen&&<div className="popover" role="dialog" aria-label="Notifications"><div className="popover-head"><strong>Notifications ({notifications.data?.unread??0})</strong><button onClick={markAllRead}>Mark all read</button></div>{notifications.isLoading?<div className="p-4 text-xs text-muted">Loading notifications…</div>:notifications.data?.items.length?notifications.data.items.map((item)=><div className="notification-item" key={item._id}><div className="notification-icon"><Boxes size={16}/></div><div><p>{item.title}</p><span>{item.message}</span></div></div>):<div className="p-4 text-xs text-muted">You’re all caught up.</div>}</div>}</div></header><main className="page-content">{children}</main></div>
  </div>;
}
