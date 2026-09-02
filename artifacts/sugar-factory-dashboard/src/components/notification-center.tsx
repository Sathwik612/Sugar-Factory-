import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Check, ChevronRight, Settings2, X } from "lucide-react";
import { useLocation } from "wouter";
import type { AuthUser } from "@workspace/replit-auth-web";

type NotificationItem = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  actionUrl: string | null;
  isDemo: boolean;
  isRead: boolean;
  createdAt: string;
};

type NotificationResponse = {
  items: NotificationItem[];
  unreadCount: number;
  categories: {
    approvals: number;
    operationalAlerts: number;
    dataChanges: number;
    actions: number;
    system: number;
  };
};

type Preferences = {
  inAppEnabled: boolean;
  approvalsEnabled: boolean;
  operationalAlertsEnabled: boolean;
  criticalAlertsEnabled: boolean;
  dataReturnsEnabled: boolean;
  dataApprovalsEnabled: boolean;
  maintenanceAlertsEnabled: boolean;
  storesAlertsEnabled: boolean;
  qualityAlertsEnabled: boolean;
};

const preferenceLabels: Array<[keyof Preferences, string]> = [
  ["approvalsEnabled", "Approvals"],
  ["operationalAlertsEnabled", "Operational alerts"],
  ["criticalAlertsEnabled", "Critical alerts"],
  ["dataReturnsEnabled", "Returned data"],
  ["dataApprovalsEnabled", "Approved data"],
  ["maintenanceAlertsEnabled", "Maintenance"],
  ["storesAlertsEnabled", "Stores"],
  ["qualityAlertsEnabled", "Quality"],
];

const initialData: NotificationResponse = {
  items: [],
  unreadCount: 0,
  categories: { approvals: 0, operationalAlerts: 0, dataChanges: 0, actions: 0, system: 0 },
};

function timeAgo(value: string) {
  const milliseconds = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function NotificationCenter({ user }: { user: AuthUser | null }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [data, setData] = useState<NotificationResponse>(initialData);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/notifications", { credentials: "include" });
      if (!response.ok) throw new Error("Notifications are temporarily unavailable.");
      setData(await response.json());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notifications are temporarily unavailable.");
    }
  }, [user]);

  useEffect(() => {
    setData(initialData);
    if (!user) return;
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [load, user]);

  const markRead = async (item: NotificationItem) => {
    if (!item.isRead) {
      await fetch(`/api/notifications/${item.id}/read`, { method: "PATCH", credentials: "include" });
      await load();
    }
    setOpen(false);
    if (item.actionUrl) navigate(item.actionUrl);
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", credentials: "include" });
    await load();
  };

  const loadPreferences = async () => {
    const response = await fetch("/api/notification-preferences", { credentials: "include" });
    if (response.ok) setPreferences(await response.json());
    setShowSettings(true);
  };

  const updatePreference = async (key: keyof Preferences, value: boolean) => {
    if (!preferences) return;
    const optimistic = { ...preferences, [key]: value };
    setPreferences(optimistic);
    const response = await fetch("/api/notification-preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!response.ok) {
      setPreferences(preferences);
      setError("Could not save notification preferences.");
    }
  };

  return <div className="relative">
    <button
      data-testid="button-notifications"
      aria-label={`Notifications${data.unreadCount ? `, ${data.unreadCount} unread` : ""}`}
      onClick={() => setOpen((value) => !value)}
      className="relative rounded-md p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
    >
      <Bell size={17} />
      {data.unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-background">{Math.min(data.unreadCount, 99)}</span>}
    </button>
    {open && <>
      <button aria-label="Close notifications" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/10" />
      <section className="fixed inset-x-3 top-[68px] z-50 max-h-[calc(100dvh-84px)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[420px]">
        <div className="flex items-start justify-between border-b border-border p-4">
          <div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-primary">What needs my attention?</div><h2 className="mt-1 text-lg font-bold">Notifications</h2></div>
          <div className="flex gap-1"><button onClick={() => void loadPreferences()} aria-label="Notification settings" className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><Settings2 size={16} /></button><button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><X size={17} /></button></div>
        </div>
        {showSettings ? <div className="max-h-[65dvh] overflow-y-auto p-4">
          <button onClick={() => setShowSettings(false)} className="mb-4 text-xs font-bold text-primary">← Back to notifications</button>
          <h3 className="text-sm font-bold">In-app notification preferences</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Email, SMS and WhatsApp delivery remain disabled until a provider is configured.</p>
          <div className="mt-4 space-y-2">{preferences ? preferenceLabels.map(([key, label]) => <label key={key} className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-3 text-xs font-bold"><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => void updatePreference(key, event.target.checked)} className="h-4 w-4 accent-primary" /></label>) : <div className="py-8 text-center text-xs text-muted-foreground">Loading preferences…</div>}</div>
        </div> : <>
          <div className="grid grid-cols-4 gap-1 border-b border-border bg-muted/30 p-3 text-center"><div><div className="font-mono text-sm font-bold">{data.categories.approvals}</div><div className="text-[8px] uppercase tracking-wider text-muted-foreground">Approvals</div></div><div><div className="font-mono text-sm font-bold text-red-700">{data.categories.operationalAlerts}</div><div className="text-[8px] uppercase tracking-wider text-muted-foreground">Alerts</div></div><div><div className="font-mono text-sm font-bold">{data.categories.dataChanges}</div><div className="text-[8px] uppercase tracking-wider text-muted-foreground">Data</div></div><div><div className="font-mono text-sm font-bold">{data.categories.actions}</div><div className="text-[8px] uppercase tracking-wider text-muted-foreground">Actions</div></div></div>
          <div className="flex items-center justify-between border-b border-border px-4 py-2"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{data.unreadCount} unread</span>{data.unreadCount > 0 && <button onClick={() => void markAllRead()} className="inline-flex items-center gap-1 text-[10px] font-bold text-primary"><Check size={12} />Mark all read</button>}</div>
          <div className="max-h-[55dvh] overflow-y-auto">{error && <div className="m-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</div>}{data.items.length ? data.items.map((item) => <button key={item.id} onClick={() => void markRead(item)} className={`flex w-full items-start gap-3 border-b border-border/60 p-4 text-left transition hover:bg-secondary/60 ${item.isRead ? "opacity-65" : "bg-primary/[.035]"}`}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.severity === "CRITICAL" ? "bg-red-600" : item.severity === "WARNING" ? "bg-amber-500" : "bg-primary"}`} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold">{item.title}</span>{item.isDemo && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">Demo</span>}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{item.message}</span><span className="mt-2 block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.type.replaceAll("_", " ")} · {timeAgo(item.createdAt)}</span></span>{item.actionUrl && <ChevronRight size={15} className="mt-1 shrink-0 text-muted-foreground" />}</button>) : <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><AlertTriangle size={20} className="text-muted-foreground" /><div className="mt-3 text-sm font-bold">Nothing needs your attention</div><p className="mt-1 text-xs text-muted-foreground">New approvals, operational alerts and data decisions will appear here.</p></div>}</div>
        </>}
      </section>
    </>}
  </div>;
}