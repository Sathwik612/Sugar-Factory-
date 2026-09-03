import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Check,
  ClipboardList,
  Download,
  FlaskConical,
  Gauge,
  MenuSquare,
  PackageOpen,
  Printer,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Target,
  Wrench,
} from "lucide-react";
import { useAuth, type AuthUser } from "@workspace/replit-auth-web";

type SuiteData = {
  factory: string;
  productionDate: string;
  settings: { season: string; shiftConfig: string[]; kpiThresholds: Record<string, unknown>; targetDefaults: Record<string, unknown> };
  targets: any[];
  handovers: any[];
  qualitySamples: any[];
  storeMovements: any[];
  maintenance: any[];
  alerts: any[];
  kpis: any[];
  lineage: any[];
  downtimePareto: Array<{ cause: string; hours: number; occurrences: number }>;
  dataQuality: { score: number; sourceFiles: number; failedSources: number; departments: Array<{ department: string; completeness: number }>; checks: Array<{ label: string; status: string }> };
};

const field = "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-semibold outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground";
const button = "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45";

function Panel({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-primary">{eyebrow}</div><h2 className="mt-1 text-lg font-bold tracking-tight">{title}</h2></div>{action}</div><div className="mt-5">{children}</div></section>;
}

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-bold text-foreground/75">{children}</label>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-8 text-center text-xs text-muted-foreground">{text}</div>;
}

function Status({ value }: { value: string }) {
  const critical = value === "CRITICAL" || value === "HOLD" || value === "FAILED";
  const positive = value === "PASS" || value === "DONE" || value === "ACKNOWLEDGED";
  return <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${critical ? "border-red-200 bg-red-50 text-red-700" : positive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{value.replaceAll("_", " ")}</span>;
}

const tabs = [
  ["control", "Control room", Gauge],
  ["handover", "Handover", ClipboardList],
  ["quality", "Quality lab", FlaskConical],
  ["stores", "Stores", PackageOpen],
  ["maintenance", "Maintenance", Wrench],
  ["analysis", "Analysis & export", BarChart3],
  ["configuration", "Configuration", Settings2],
] as const;

function roleCan(user: AuthUser | null, role: AuthUser["role"]) {
  return user?.role === role || user?.role === "MANAGER" || user?.role === "ADMIN";
}

export default function OperationsSuitePage() {
  const { user } = useAuth();
  const [active, setActive] = useState<(typeof tabs)[number][0]>("control");
  const [date, setDate] = useState(() => new URLSearchParams(window.location.search).get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? "");
  const [data, setData] = useState<SuiteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedKpi, setSelectedKpi] = useState<string>("recovery");
  const [handover, setHandover] = useState({ shift: "GENERAL", title: "", detail: "", dueDate: "" });
  const [quality, setQuality] = useState({ shift: "GENERAL", sampleType: "Mixed juice", brix: "", pol: "", purity: "", status: "PENDING", notes: "" });
  const [stores, setStores] = useState({ material: "Lime", movementType: "ISSUE", quantity: "", unit: "kg", reorderLevel: "", notes: "" });
  const [maintenance, setMaintenance] = useState({ asset: "", issue: "", workType: "BREAKDOWN", priority: "MEDIUM", hoursLost: "", assignedTo: "" });
  const [target, setTarget] = useState({ code: "recovery", label: "Recovery", target: "9.7", unit: "%", shift: "ALL" });
  const [settings, setSettings] = useState({ season: "2025-26", shifts: "A, B, C, GENERAL" });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/operations-suite${date ? `?date=${encodeURIComponent(date)}` : ""}`, { credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load the operations suite.");
      if (!date && typeof body.productionDate === "string") setDate(body.productionDate);
      setData(body);
      setSettings({ season: body.settings?.season ?? "2025-26", shifts: (body.settings?.shiftConfig ?? ["A", "B", "C", "GENERAL"]).join(", ") });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the operations suite.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [date]);

  const send = async (path: string, method: "POST" | "PATCH", body: unknown, success: string) => {
    setError("");
    setNotice("");
    const response = await fetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "The operation could not be completed.");
      return false;
    }
    setNotice(success);
    await load();
    return true;
  };

  const actualByCode = useMemo(() => new Map(data?.kpis.map((kpi) => [kpi.code, Number(kpi.value)]) ?? []), [data]);
  const selected = data?.kpis.find((kpi) => kpi.code === selectedKpi);
  const selectedLineage = data?.lineage.filter((line) => line.kpiCode === selectedKpi) ?? [];
  const maxDowntime = Math.max(1, ...(data?.downtimePareto.map((item) => item.hours) ?? [1]));

  const exportCsv = () => {
    if (!data) return;
    const rows = [["KPI", "Actual", "Target", "Unit", "Status"], ...data.kpis.map((kpi) => {
      const targetValue = data.targets.find((item) => item.code === kpi.code)?.target ?? "";
      return [kpi.label, kpi.value ?? "", targetValue, kpi.unit, kpi.status];
    })];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bilagi-management-pack-${date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) return <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 animate-spin" size={17} />Loading operations suite…</div>;

  return <div className="reveal">
    <div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-primary">Integrated operations suite</div><h1 className="mt-2 text-[clamp(1.9rem,4vw,2.8rem)] font-bold tracking-[-.05em]">Run the factory from one signal</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Targets, shift handovers, laboratory checks, stores, maintenance, alerts, traceability and exports—built on the same canonical daily record.</p></div><div className="flex flex-wrap items-end gap-3"><div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-800"><Smartphone size={13} className="mr-1 inline" />Mobile operator ready</div><Label>Production date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={field} /></Label></div></div>
    {notice && <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><Check size={16} />{notice}</div>}
    {error && <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"><AlertTriangle size={16} />{error}</div>}

    <div className="mb-7 flex gap-2 overflow-x-auto pb-2">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setActive(id)} className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${active === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary"}`}><Icon size={14} />{label}</button>)}</div>

    {active === "control" && data && <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Data quality", `${data.dataQuality.score}%`, `${data.dataQuality.failedSources} failed sources`, ShieldCheck],
        ["Open alerts", String(data.alerts.filter((item) => item.status === "OPEN").length), "Threshold escalations", AlertTriangle],
        ["Shift actions", String(data.handovers.filter((item) => item.status !== "DONE").length), "Open handover actions", ClipboardList],
        ["Maintenance loss", `${data.maintenance.reduce((sum, item) => sum + Number(item.hoursLost || 0), 0).toFixed(1)} h`, "Logged work-order impact", Wrench],
      ].map(([label, value, detail, Icon]: any) => <div key={label} className="panel rounded-2xl p-5"><div className="flex items-start justify-between"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><Icon size={16} className="text-primary" /></div><div className="mt-4 text-3xl font-bold tracking-[-.05em]">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>)}</div>
      <div className="grid gap-6 xl:grid-cols-2"><Panel eyebrow="Target vs actual" title="Daily operating plan"><div className="space-y-3">{data.targets.map((item) => { const actual = actualByCode.get(item.code); const variance = actual === undefined ? null : actual - Number(item.target); return <div key={item.id} className="rounded-xl border border-border/70 bg-muted/20 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">{item.label}</div><div className="mt-1 text-xs text-muted-foreground">Target {item.target} {item.unit}</div></div><div className="text-right"><div className="font-mono text-lg font-bold">{actual ?? "—"} <span className="text-xs text-muted-foreground">{item.unit}</span></div><div className={`text-[10px] font-bold ${variance !== null && ((item.code === "downtime" && variance > 0) || (item.code !== "downtime" && variance < 0)) ? "text-red-700" : "text-emerald-700"}`}>{variance === null ? "No actual" : `${variance >= 0 ? "+" : ""}${variance.toFixed(2)} variance`}</div></div></div></div>; })}</div></Panel>
      <Panel eyebrow="Escalation rules" title="Active alerts"><div className="space-y-3">{data.alerts.length ? data.alerts.map((item) => <div key={item.id} className="rounded-xl border border-border/70 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold">{item.title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><Status value={item.severity} /></div>{item.status === "OPEN" && (user?.role === "MANAGER" || user?.role === "ADMIN") && <button onClick={() => void send(`/api/operations-suite/alerts/${item.id}/acknowledge`, "PATCH", {}, "Alert acknowledged and audit logged.")} className={`${secondaryButton} mt-3`}><Check size={13} />Acknowledge</button>}</div>) : <Empty text="No alerts for this production date." />}</div></Panel></div>
    </div>}

    {active === "handover" && data && <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><Panel eyebrow="New shift note" title="Create handover action"><form onSubmit={async (event) => { event.preventDefault(); if (await send("/api/operations-suite/handover", "POST", { ...handover, productionDate: date }, "Handover added for the next shift.")) setHandover({ shift: "GENERAL", title: "", detail: "", dueDate: "" }); }} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Label>Shift<select value={handover.shift} onChange={(event) => setHandover({ ...handover, shift: event.target.value })} className={field}>{(data.settings.shiftConfig || []).map((shift) => <option key={shift}>{shift}</option>)}</select></Label><Label>Due date<input type="date" value={handover.dueDate} onChange={(event) => setHandover({ ...handover, dueDate: event.target.value })} className={field} /></Label></div><Label>Action title<input required value={handover.title} onChange={(event) => setHandover({ ...handover, title: event.target.value })} className={field} placeholder="What needs attention next shift?" /></Label><Label>Handover detail<textarea required value={handover.detail} onChange={(event) => setHandover({ ...handover, detail: event.target.value })} className={`${field} min-h-28`} /></Label><button className={button}><ArrowDownToLine size={15} />Add to handover</button></form></Panel><Panel eyebrow="Shift continuity" title="Open actions"><div className="space-y-3">{data.handovers.length ? data.handovers.map((item) => <div key={item.id} className="rounded-xl border border-border/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-bold">{item.title}</div><Status value={item.status} /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p><div className="mt-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span>{item.department} · {item.shift}</span>{item.status !== "DONE" && <button onClick={() => void send(`/api/operations-suite/actions/${item.id}`, "PATCH", { status: "DONE" }, "Action marked complete.")} className={secondaryButton}><Check size={12} />Complete</button>}</div></div>) : <Empty text="No handover actions for this date." />}</div></Panel></div>}

    {active === "quality" && data && <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><Panel eyebrow="Laboratory register" title="Record quality sample"><form onSubmit={async (event) => { event.preventDefault(); if (await send("/api/operations-suite/quality", "POST", { ...quality, productionDate: date }, "Quality sample recorded.")) setQuality({ ...quality, brix: "", pol: "", purity: "", notes: "" }); }} className="space-y-4"><fieldset disabled={!roleCan(user, "QUALITY_OPERATOR")} className="space-y-4 disabled:opacity-60"><div className="grid gap-3 sm:grid-cols-2"><Label>Shift<select value={quality.shift} onChange={(event) => setQuality({ ...quality, shift: event.target.value })} className={field}>{(data.settings.shiftConfig || []).map((shift) => <option key={shift}>{shift}</option>)}</select></Label><Label>Sample type<input value={quality.sampleType} onChange={(event) => setQuality({ ...quality, sampleType: event.target.value })} className={field} /></Label></div><div className="grid grid-cols-3 gap-3"><Label>Brix<input type="number" step="0.01" value={quality.brix} onChange={(event) => setQuality({ ...quality, brix: event.target.value })} className={field} /></Label><Label>Pol<input type="number" step="0.01" value={quality.pol} onChange={(event) => setQuality({ ...quality, pol: event.target.value })} className={field} /></Label><Label>Purity<input type="number" step="0.01" value={quality.purity} onChange={(event) => setQuality({ ...quality, purity: event.target.value })} className={field} /></Label></div><Label>Disposition<select value={quality.status} onChange={(event) => setQuality({ ...quality, status: event.target.value })} className={field}><option>PASS</option><option>PENDING</option><option>HOLD</option></select></Label><Label>Notes<textarea value={quality.notes} onChange={(event) => setQuality({ ...quality, notes: event.target.value })} className={`${field} min-h-20`} /></Label><button className={button}><FlaskConical size={15} />Record sample</button></fieldset></form></Panel><Panel eyebrow="Sample history" title="Quality checks"><div className="space-y-3">{data.qualitySamples.map((item) => <div key={item.id} className="grid gap-3 rounded-xl border border-border/70 p-4 sm:grid-cols-[1fr_auto]"><div><div className="text-sm font-bold">{item.sampleType} · Shift {item.shift}</div><div className="mt-2 flex flex-wrap gap-4 font-mono text-xs"><span>Brix {item.brix ?? "—"}</span><span>Pol {item.pol ?? "—"}</span><span>Purity {item.purity ?? "—"}</span></div><p className="mt-2 text-xs text-muted-foreground">{item.notes || "No note"}</p></div><Status value={item.status} /></div>)}</div></Panel></div>}

    {active === "stores" && data && <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><Panel eyebrow="Materials control" title="Post stores movement"><form onSubmit={async (event) => { event.preventDefault(); if (await send("/api/operations-suite/stores", "POST", { ...stores, productionDate: date }, "Stores movement recorded.")) setStores({ ...stores, quantity: "", notes: "" }); }}><fieldset disabled={!roleCan(user, "STORES_OPERATOR")} className="space-y-4 disabled:opacity-60"><div className="grid gap-3 sm:grid-cols-2"><Label>Material<input required value={stores.material} onChange={(event) => setStores({ ...stores, material: event.target.value })} className={field} /></Label><Label>Movement<select value={stores.movementType} onChange={(event) => setStores({ ...stores, movementType: event.target.value })} className={field}><option>ISSUE</option><option>RECEIPT</option><option>ADJUSTMENT</option></select></Label></div><div className="grid grid-cols-3 gap-3"><Label>Quantity<input required type="number" step="0.01" value={stores.quantity} onChange={(event) => setStores({ ...stores, quantity: event.target.value })} className={field} /></Label><Label>Unit<input value={stores.unit} onChange={(event) => setStores({ ...stores, unit: event.target.value })} className={field} /></Label><Label>Reorder level<input type="number" value={stores.reorderLevel} onChange={(event) => setStores({ ...stores, reorderLevel: event.target.value })} className={field} /></Label></div><Label>Notes<input value={stores.notes} onChange={(event) => setStores({ ...stores, notes: event.target.value })} className={field} /></Label><button className={button}><PackageOpen size={15} />Post movement</button></fieldset></form></Panel><Panel eyebrow="Daily material ledger" title="Receipts and consumption"><div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="pb-3">Material</th><th className="pb-3">Movement</th><th className="pb-3 text-right">Quantity</th><th className="pb-3 text-right">Reorder</th></tr></thead><tbody className="divide-y divide-border/70">{data.storeMovements.map((item) => <tr key={item.id}><td className="py-3 font-bold">{item.material}</td><td className="py-3"><Status value={item.movementType} /></td><td className="py-3 text-right font-mono">{item.quantity} {item.unit}</td><td className="py-3 text-right font-mono">{item.reorderLevel ?? "—"}</td></tr>)}</tbody></table></div></Panel></div>}

    {active === "maintenance" && data && <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><Panel eyebrow="Asset reliability" title="Create work order"><form onSubmit={async (event) => { event.preventDefault(); if (await send("/api/operations-suite/maintenance", "POST", { ...maintenance, productionDate: date }, "Maintenance work order created.")) setMaintenance({ ...maintenance, asset: "", issue: "", hoursLost: "", assignedTo: "" }); }}><fieldset disabled={!roleCan(user, "ENGINEERING_OPERATOR")} className="space-y-4 disabled:opacity-60"><Label>Asset<input required value={maintenance.asset} onChange={(event) => setMaintenance({ ...maintenance, asset: event.target.value })} className={field} placeholder="e.g. Boiler feed pump P-02" /></Label><Label>Issue<textarea required value={maintenance.issue} onChange={(event) => setMaintenance({ ...maintenance, issue: event.target.value })} className={`${field} min-h-24`} /></Label><div className="grid gap-3 sm:grid-cols-2"><Label>Work type<select value={maintenance.workType} onChange={(event) => setMaintenance({ ...maintenance, workType: event.target.value })} className={field}><option>BREAKDOWN</option><option>PLANNED</option><option>INSPECTION</option></select></Label><Label>Priority<select value={maintenance.priority} onChange={(event) => setMaintenance({ ...maintenance, priority: event.target.value })} className={field}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></Label><Label>Hours lost<input type="number" step="0.1" value={maintenance.hoursLost} onChange={(event) => setMaintenance({ ...maintenance, hoursLost: event.target.value })} className={field} /></Label><Label>Assigned to<input value={maintenance.assignedTo} onChange={(event) => setMaintenance({ ...maintenance, assignedTo: event.target.value })} className={field} /></Label></div><button className={button}><Wrench size={15} />Create work order</button></fieldset></form></Panel><Panel eyebrow="Work-order register" title="Maintenance status"><div className="space-y-3">{data.maintenance.map((item) => <div key={item.id} className="rounded-xl border border-border/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-bold">{item.asset}</div><div className="flex gap-2"><Status value={item.priority} /><Status value={item.status} /></div></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.issue}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span>{item.workType} · {item.hoursLost ?? 0} h lost · {item.assignedTo || "Unassigned"}</span>{item.status !== "DONE" && roleCan(user, "ENGINEERING_OPERATOR") && <button onClick={() => void send(`/api/operations-suite/maintenance/${item.id}`, "PATCH", { status: item.status === "OPEN" ? "IN_PROGRESS" : "DONE" }, "Work-order status updated.")} className={secondaryButton}>{item.status === "OPEN" ? "Start work" : "Complete"}</button>}</div></div>)}</div></Panel></div>}

    {active === "analysis" && data && <div className="space-y-6"><div className="grid gap-6 xl:grid-cols-2"><Panel eyebrow="Loss analysis" title="Downtime Pareto"><div className="space-y-4">{data.downtimePareto.length ? data.downtimePareto.map((item, index) => <div key={item.cause}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-bold">{index + 1}. {item.cause}</span><span className="font-mono">{item.hours} h · {item.occurrences} events</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, (item.hours / maxDowntime) * 100)}%` }} /></div></div>) : <Empty text="No stoppage causes are available yet." />}</div></Panel><Panel eyebrow="Data-quality scorecard" title={`${data.dataQuality.score}% trusted-data readiness`}><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${data.dataQuality.score}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-3">{data.dataQuality.departments.map((item) => <div key={item.department} className="rounded-xl border border-border/70 p-3"><div className="text-xs font-bold">{item.department}</div><div className="mt-2 font-mono text-xl font-bold">{item.completeness}%</div><div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${item.completeness}%` }} /></div></div>)}</div><div className="mt-4 space-y-2">{data.dataQuality.checks.map((check) => <div key={check.label} className="flex items-center justify-between text-xs"><span>{check.label}</span><Status value={check.status} /></div>)}</div></Panel></div>
      <Panel eyebrow="KPI drilldown & lineage" title="Explain the number"><div className="grid gap-5 lg:grid-cols-[260px_1fr]"><div className="space-y-2">{data.kpis.map((kpi) => <button key={kpi.code} onClick={() => setSelectedKpi(kpi.code)} className={`w-full rounded-lg border px-3 py-2.5 text-left text-xs font-bold ${selectedKpi === kpi.code ? "border-primary bg-primary/[.06] text-primary" : "border-border hover:bg-secondary"}`}>{kpi.label}<span className="float-right font-mono">{kpi.value ?? "—"} {kpi.unit}</span></button>)}</div><div className="rounded-xl border border-border/70 bg-muted/20 p-5">{selected ? <><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{selected.code}</div><div className="mt-1 text-3xl font-bold">{selected.value ?? "—"} <span className="text-sm text-muted-foreground">{selected.unit}</span></div><div className="mt-1 text-xs text-muted-foreground">{selected.comparisonLabel}: {selected.comparisonValue ?? "—"}</div></div><Status value={selected.status} /></div><div className="mt-5 border-t border-border pt-4"><div className="text-xs font-bold">Calculation and source lineage</div>{selectedLineage.length ? <div className="mt-3 space-y-2">{selectedLineage.map((line) => <div key={line.id} className="rounded-lg bg-card p-3 text-xs"><div className="font-bold">{line.canonicalField}</div><div className="mt-1 text-muted-foreground">{line.formula}</div><div className="mt-2 font-mono text-[10px] text-primary">{line.sheet}!{line.sourceColumn}{line.sourceRow} = {line.rawValue}</div></div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">This KPI currently has canonical values but no cell-level workbook lineage for the selected date.</p>}</div></> : <Empty text="Select a KPI to inspect." />}</div></div></Panel>
      <Panel eyebrow="Management pack" title="Export approved operating context"><div className="flex flex-wrap gap-3"><button onClick={exportCsv} className={button}><Download size={15} />Download Excel-compatible CSV</button><button onClick={() => window.print()} className={secondaryButton}><Printer size={15} />Print / save as PDF</button></div><p className="mt-4 text-xs leading-5 text-muted-foreground">Exports include KPI actuals, targets, units and validation status for the selected production date. PDF output uses the browser’s audited print timestamp.</p></Panel>
    </div>}

    {active === "configuration" && data && <div className="grid gap-6 xl:grid-cols-2"><Panel eyebrow="Planning" title="Set target vs actual baseline"><form onSubmit={(event) => { event.preventDefault(); void send("/api/operations-suite/targets", "POST", { ...target, productionDate: date }, "KPI target saved."); }}><fieldset disabled={user?.role !== "MANAGER" && user?.role !== "ADMIN"} className="space-y-4 disabled:opacity-60"><div className="grid gap-3 sm:grid-cols-2"><Label>KPI code<select value={target.code} onChange={(event) => { const kpi = data.kpis.find((item) => item.code === event.target.value); setTarget({ ...target, code: event.target.value, label: kpi?.label ?? event.target.value, unit: kpi?.unit ?? "" }); }} className={field}>{data.kpis.map((kpi) => <option key={kpi.code} value={kpi.code}>{kpi.label}</option>)}</select></Label><Label>Shift<select value={target.shift} onChange={(event) => setTarget({ ...target, shift: event.target.value })} className={field}><option>ALL</option>{data.settings.shiftConfig.map((shift) => <option key={shift}>{shift}</option>)}</select></Label><Label>Target<input required type="number" step="0.01" value={target.target} onChange={(event) => setTarget({ ...target, target: event.target.value })} className={field} /></Label><Label>Unit<input value={target.unit} onChange={(event) => setTarget({ ...target, unit: event.target.value })} className={field} /></Label></div><button className={button}><Target size={15} />Save target</button></fieldset></form></Panel><Panel eyebrow="Factory & season" title="Operating configuration"><form onSubmit={(event) => { event.preventDefault(); void send("/api/operations-suite/settings", "PATCH", { season: settings.season, shiftConfig: settings.shifts.split(",").map((item) => item.trim()).filter(Boolean), kpiThresholds: data.settings.kpiThresholds, targetDefaults: data.settings.targetDefaults }, "Factory configuration updated."); }}><fieldset disabled={user?.role !== "ADMIN"} className="space-y-4 disabled:opacity-60"><Label>Season<input value={settings.season} onChange={(event) => setSettings({ ...settings, season: event.target.value })} className={field} /></Label><Label>Shift names<input value={settings.shifts} onChange={(event) => setSettings({ ...settings, shifts: event.target.value })} className={field} /><span className="mt-1 block text-[10px] font-normal text-muted-foreground">Comma-separated; applied to operator forms.</span></Label><div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Alert thresholds are active.</strong><br />Recovery, downtime and power-generation thresholds are retained with this factory configuration and drive the escalation register.</div><button className={button}><Settings2 size={15} />Save factory setup</button></fieldset>{user?.role !== "ADMIN" && <p className="mt-4 text-xs text-muted-foreground">Factory and season settings are administrator-controlled.</p>}</form></Panel></div>}
  </div>;
}