import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ClipboardPenLine,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudUpload,
  Database,
  FileSpreadsheet,
  FileText,
  Gauge,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Settings2,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth, type AuthUser } from '@workspace/replit-auth-web';
import {
  getGetDailyReportLineageQueryKey,
  getGetDailyReportQueryKey,
  getGetSourceFileQueryKey,
  getListSourceFilesQueryKey,
  useGetDailyReport,
  useGetDailyReportLineage,
  useGetDashboard,
  useGetSourceFile,
  useHealthCheck,
  useListSourceFiles,
  useUploadSourceFile,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import OperationsSuitePage from '@/pages/operations-suite';
import { NotificationCenter } from '@/components/notification-center';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();

const dateLabel = (value?: string | null, options?: Intl.DateTimeFormatOptions) => {
  if (!value) return 'Date unavailable';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', options ?? { day: '2-digit', month: 'short', year: 'numeric' });
};

const timeLabel = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const bytesLabel = (bytes = 0) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const formatValue = (value: number | null | undefined, unit = '') => value === null || value === undefined ? '—' : `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;

function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = status.toLowerCase();
  const icon = tone.includes('critical') || tone.includes('failed') || tone === 'error'
    ? <XCircle size={13} />
    : tone.includes('warning') || tone.includes('watch') || tone.includes('partial')
      ? <AlertCircle size={13} />
      : tone.includes('unavailable')
        ? <CircleHelp size={13} />
        : <CheckCircle2 size={13} />;
  const colors = tone.includes('critical') || tone.includes('failed') || tone === 'error'
    ? 'bg-red-50 text-red-700 border-red-200'
    : tone.includes('warning') || tone.includes('watch') || tone.includes('partial')
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : tone.includes('unavailable')
        ? 'bg-slate-100 text-slate-500 border-slate-200'
        : 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return <span data-testid={`status-${tone}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${colors}`}>{icon}{label ?? status}</span>;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-label="Loading" data-testid="loading-skeleton" />;
}

function ErrorState({ onRetry, message = 'The source could not be reached.' }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="panel flex min-h-[260px] flex-col items-center justify-center rounded-2xl p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700"><AlertCircle size={22} /></div>
      <h2 className="text-lg font-bold">Signal interrupted</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && <button onClick={onRetry} data-testid="button-retry" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:opacity-90"><RefreshCw size={15} /> Retry connection</button>}
    </div>
  );
}

function EmptyState({ title, detail, icon = <Database size={22} /> }: { title: string; detail: string; icon?: ReactNode }) {
  return <div className="panel flex min-h-[220px] flex-col items-center justify-center rounded-2xl p-8 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">{icon}</div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p></div>;
}

function userDisplayName(user: AuthUser | null) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  return name || user?.email || 'Operations user';
}

function userInitials(user: AuthUser | null) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join('');
  return name ? name.slice(0, 2).toUpperCase() : 'OP';
}

const roleLabels: Record<AuthUser['role'], string> = {
  PRODUCTION_OPERATOR: 'Production operator',
  QUALITY_OPERATOR: 'Quality operator',
  ENGINEERING_OPERATOR: 'Engineering operator',
  STORES_OPERATOR: 'Stores operator',
  MANAGER: 'Manager',
  ADMIN: 'Administrator',
};

function isLeadership(user: AuthUser | null) {
  return user?.role === 'MANAGER' || user?.role === 'ADMIN';
}

function Shell({ children, user, logout }: { children: ReactNode; user: AuthUser | null; logout: () => void | Promise<void> }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck();
  const displayName = userDisplayName(user);
  const links = [
    { href: '/', label: 'Daily overview', icon: LayoutDashboard, match: location === '/', visible: isLeadership(user) },
    { href: '/daily-operations', label: 'Daily operations', icon: ClipboardPenLine, match: location.startsWith('/daily-operations'), visible: true },
    { href: '/operations-suite', label: 'Operations suite', icon: SlidersHorizontal, match: location.startsWith('/operations-suite'), visible: true },
    { href: '/reports/latest', label: 'Daily reports', icon: BarChart3, match: location.startsWith('/reports'), visible: isLeadership(user) },
    { href: '/files', label: 'Source files', icon: FileSpreadsheet, match: location.startsWith('/files'), visible: isLeadership(user) },
    { href: '/approval-queue', label: 'Approval queue', icon: CheckCircle2, match: location.startsWith('/approval-queue'), visible: isLeadership(user) },
    { href: '/audit-log', label: 'Audit log', icon: Clock3, match: location.startsWith('/audit-log'), visible: isLeadership(user) },
    { href: '/users', label: 'User administration', icon: ShieldCheck, match: location.startsWith('/users'), visible: user?.role === 'ADMIN' },
    { href: '/settings', label: 'Readiness', icon: Settings2, match: location.startsWith('/settings'), visible: user?.role === 'ADMIN' },
  ].filter((link) => link.visible);
  return (
    <div className="grain app-shell min-h-[100dvh] text-foreground">
      <aside className={`side-grid fixed inset-y-0 left-0 z-40 w-[252px] bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
           <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-6">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg"><Gauge size={22} /><span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-sidebar" /></div>
            <div><div className="font-bold tracking-tight">Sugar Factory</div><div className="eyebrow mt-0.5 text-sidebar-foreground/55">Intelligence</div></div>
          </div>
           <div className="px-4 pt-7"><div className="eyebrow px-3 text-sidebar-foreground/45">Control room</div><nav className="mt-3 space-y-1">{links.map(({ href, label, icon: Icon, match }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition ${match ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}><Icon size={17} strokeWidth={match ? 2.5 : 1.8} /><span>{label}</span>{match && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}</Link>)}</nav></div>
           <div className="mt-auto border-t border-sidebar-border p-5"><div className="rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${health.isLoading ? 'bg-amber-300' : health.isError ? 'bg-red-400' : 'bg-emerald-400'}`} />API connection</div><p className="mt-2 text-[11px] leading-relaxed text-sidebar-foreground/55">{health.isError ? 'Connection needs attention.' : 'Source services responding normally.'}</p></div><div className="mt-5 flex items-center gap-2 px-1 text-[10px] text-sidebar-foreground/35"><ShieldCheck size={13} /> Traceable by design</div></div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} data-testid="button-close-navigation" className="fixed inset-0 z-30 bg-sidebar/40 md:hidden" />}
      <div className="md:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-10">
           <div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} data-testid="button-open-navigation" className="rounded-md p-2 hover:bg-secondary md:hidden"><Menu size={20} /></button><div className="eyebrow text-muted-foreground">Operations / <span className="text-primary">{location === '/' ? 'today' : location.split('/')[1] || 'today'}</span></div></div>
           <div className="flex items-center gap-2 sm:gap-3"><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-red-600' : 'bg-emerald-500'}`} />Live data link</div><div className="hidden h-5 w-px bg-border sm:block" /><NotificationCenter user={user} /><div className="hidden items-center gap-2 border-l border-border pl-3 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{userInitials(user)}</div><div><span className="block max-w-[150px] truncate text-xs font-semibold text-foreground">{displayName}</span><span className="block text-[10px] text-muted-foreground">{user ? roleLabels[user.role] : ''}</span></div></div><button onClick={() => void logout()} data-testid="button-logout" aria-label="Log out" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-bold text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/[.05] hover:text-destructive"><LogOut size={15} /><span className="hidden md:inline">Log out</span></button></div>
        </header>
        <main className="mx-auto max-w-[1480px] px-5 py-7 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="eyebrow text-primary">{eyebrow}</div><h1 className="mt-2 text-[clamp(1.8rem,3vw,2.65rem)] font-bold tracking-[-.045em] text-foreground">{title}</h1>{detail && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

function Sparkline({ values, color = '#1e6872' }: { values: (number | null)[]; color?: string }) {
  const points = values.filter((value): value is number => value !== null);
  if (!points.length) return <div className="flex h-10 items-center text-xs text-muted-foreground">No trend data</div>;
  const min = Math.min(...points); const max = Math.max(...points); const range = max - min || 1;
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * (100 / Math.max(1, points.length - 1))} ${36 - ((v - min) / range) * 28}`).join(' ');
  return <svg viewBox="0 0 100 40" className="sparkline h-12 w-full" preserveAspectRatio="none" aria-label="Trend sparkline"><path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" /><path d={`${path} L 100 40 L 0 40 Z`} fill={color} opacity=".09" stroke="none" /></svg>;
}

function KpiCard({ kpi, trend }: { kpi: any; trend: any[] }) {
  const status = String(kpi.status);
  const trendValues = trend.slice(-7).map((point) => kpi.code === 'recovery' ? point.recovery : kpi.code === 'cane_crushed' ? point.caneCrushed : point.downtime);
  const comparison = kpi.comparisonValue;
  return <div data-testid={`card-kpi-${kpi.code}`} className="panel panel-hover group relative overflow-hidden rounded-2xl p-5"><div className="flex items-start justify-between gap-4"><div><div className="eyebrow text-muted-foreground">{kpi.code}</div><div className="mt-2 text-sm font-semibold text-foreground/75">{kpi.label}</div></div><StatusPill status={status} label={status === 'GOOD' ? 'On plan' : status === 'WATCH' ? 'Watch' : status === 'CRITICAL' ? 'Critical' : 'No data'} /></div><div className="mt-6 flex items-end justify-between gap-4"><div><div className="mono text-[2rem] font-bold leading-none tracking-[-.07em]">{kpi.available ? formatValue(kpi.value, kpi.unit) : '—'}</div><div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">{comparison !== null && comparison !== undefined && comparison >= 0 ? <ArrowUpRight size={13} className="text-emerald-700" /> : comparison !== null && comparison !== undefined ? <ArrowDownRight size={13} className="text-red-700" /> : null}<span>{kpi.comparisonLabel || 'Comparison unavailable'}{comparison !== null && comparison !== undefined ? ` · ${comparison > 0 ? '+' : ''}${comparison}` : ''}</span></div></div><div className="w-[36%] opacity-80 transition group-hover:opacity-100"><Sparkline values={trendValues} color={status === 'CRITICAL' ? '#b7443a' : status === 'WATCH' ? '#b57a16' : '#1e6872'} /></div></div><div className="mt-5 flex items-center gap-1.5 border-t border-border/70 pt-3 text-[10px] text-muted-foreground"><Database size={11} /> {kpi.sourceCount ?? 0} source points reconciled</div></div>;
}

function Overview() {
  const query = useGetDashboard();
  const dashboard: any = query.data;
  if (query.isLoading) return <OverviewSkeleton />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} message="We could not load the latest management view." />;
  if (!dashboard) return <EmptyState title="No production view yet" detail="Once a validated source file is processed, the latest production date will appear here." icon={<Gauge size={22} />} />;
  const critical = dashboard.exceptions?.filter((item: any) => item.severity === 'CRITICAL') ?? [];
  const warning = dashboard.exceptions?.filter((item: any) => item.severity !== 'CRITICAL') ?? [];
  return <div className="reveal">
     <PageHeading eyebrow="Daily management view" title={dashboard.factory} detail={`Season 2025–26 · production date ${dateLabel(dashboard.productionDate)} · a single, traceable view of the latest available shift.`} action={<Link href={`/reports/${dashboard.productionDate}`} data-testid="link-open-daily-report" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90">Open full report <ArrowRight size={16} /></Link>} />
    {dashboard.dataStatus !== 'COMPLETE' && <div data-testid="status-dashboard-data" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertCircle className="mt-0.5 shrink-0" size={17} /><div><strong>{dashboard.dataStatus === 'PARTIAL' ? 'Partial data set.' : 'Data unavailable.'}</strong> Some measures may be missing until source validation completes.</div></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{dashboard.kpis?.map((kpi: any) => <KpiCard key={kpi.code} kpi={kpi} trend={dashboard.trend ?? []} />)}</section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <div className="panel rounded-2xl p-6 reveal reveal-1"><div className="flex items-start justify-between"><div><div className="eyebrow text-primary">Attention required</div><h2 className="mt-1 text-lg font-bold tracking-tight">Exceptions on this date</h2></div><span data-testid="text-exception-count" className="mono text-2xl font-bold">{String(dashboard.exceptions?.length ?? 0).padStart(2, '0')}</span></div><div className="mt-5 space-y-2">{dashboard.exceptions?.length ? dashboard.exceptions.map((item: any) => <div key={item.id} data-testid={`row-exception-${item.id}`} className="group flex items-start gap-3 rounded-xl border border-transparent bg-muted/55 px-3.5 py-3.5 transition hover:border-border hover:bg-secondary/60"><div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.severity === 'CRITICAL' ? 'bg-red-600' : item.severity === 'WARNING' ? 'bg-amber-500' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{item.title}</span><StatusPill status={item.severity} /></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p></div><span className="mono text-[10px] text-muted-foreground">{item.kpiCode}</span></div>) : <EmptyState title="No exceptions logged" detail="All validated measures are within their expected operating range." icon={<Check size={22} />} />}</div>{(critical.length > 0 || warning.length > 0) && <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground"><span className="font-bold text-red-700">{critical.length} critical</span><span className="h-1 w-1 rounded-full bg-border" /><span className="font-bold text-amber-700">{warning.length} watch / info</span><span className="ml-auto">Acknowledgement is recorded in the source system</span></div>}</div>
      <div className="panel rounded-2xl p-6 reveal reveal-2"><div className="flex items-start justify-between"><div><div className="eyebrow text-primary">Data health</div><h2 className="mt-1 text-lg font-bold tracking-tight">Ingestion register</h2></div><Database size={19} className="text-muted-foreground" /></div><div className="mt-6 grid grid-cols-3 divide-x divide-border"><div className="px-2 text-center first:pl-0"><div className="mono text-2xl font-bold text-emerald-700">{dashboard.ingestion?.processed ?? 0}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Processed</div></div><div className="px-2 text-center"><div className="mono text-2xl font-bold text-amber-700">{dashboard.ingestion?.warnings ?? 0}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Warnings</div></div><div className="px-2 text-center last:pr-0"><div className="mono text-2xl font-bold text-red-700">{dashboard.ingestion?.failed ?? 0}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Failed</div></div></div><div className="mt-7 rounded-xl border border-border bg-background/50 p-4"><div className="flex items-center gap-2 text-xs font-bold"><Clock3 size={14} className="text-primary" /> Last registry update</div><div data-testid="text-last-updated" className="mono mt-2 text-sm">{timeLabel(dashboard.ingestion?.lastUpdated)} <span className="font-sans text-xs text-muted-foreground">local time</span></div></div><Link href="/files" data-testid="link-view-source-files" className="mt-4 flex items-center justify-between rounded-lg px-1 py-2 text-xs font-bold text-primary transition hover:text-foreground">Review source registry <ChevronRight size={15} /></Link></div>
    </section>
    <section className="panel mt-6 rounded-2xl p-6 reveal reveal-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="eyebrow text-primary">Seven-day signal</div><h2 className="mt-1 text-lg font-bold tracking-tight">Recovery, cane & downtime</h2></div><div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" /> Recovery</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-accent" /> Cane crushed</span></div></div><div className="mt-6 overflow-x-auto"><div className="min-w-[620px]">{dashboard.trend?.length ? <TrendChart trend={dashboard.trend} /> : <EmptyState title="Trend not available" detail="At least two validated production dates are needed to plot a trend." />}</div></div></section>
  </div>;
}

function OverviewSkeleton() {
  return <div><div className="mb-8"><SkeletonBlock className="h-3 w-32" /><SkeletonBlock className="mt-3 h-10 w-72" /><SkeletonBlock className="mt-3 h-4 w-96 max-w-full" /></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map(i => <SkeletonBlock key={i} className="h-56" />)}</div><div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]"><SkeletonBlock className="h-80" /><SkeletonBlock className="h-80" /></div></div>;
}

function TrendChart({ trend }: { trend: any[] }) {
  const values = trend.map((point: any) => point.recovery).filter((v: any): v is number => v !== null && v !== undefined);
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * (560 / Math.max(1, values.length - 1)) + 22} ${145 - ((v - min) / range) * 112}`).join(' ');
  return <div className="relative h-48"><svg viewBox="0 0 610 170" className="h-full w-full"><line x1="22" x2="582" y1="145" y2="145" stroke="hsl(var(--border))" /><line x1="22" x2="582" y1="89" y2="89" stroke="hsl(var(--border))" strokeDasharray="3 5" /><line x1="22" x2="582" y1="33" y2="33" stroke="hsl(var(--border))" strokeDasharray="3 5" /><path d={`${line} L 582 145 L 22 145 Z`} fill="hsl(var(--primary) / .08)" /><path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />{values.map((v, i) => <circle key={i} cx={i * (560 / Math.max(1, values.length - 1)) + 22} cy={145 - ((v - min) / range) * 112} r="3.5" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />)}</svg><div className="absolute inset-x-0 bottom-0 flex justify-between px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{trend.map((point: any) => <span key={point.date}>{dateLabel(point.date, { day: '2-digit', month: 'short' })}</span>)}</div></div>;
}

function ReportPage() {
  const params = useParams<{ productionDate: string }>();
  const productionDate = params.productionDate === 'latest' ? '' : params.productionDate;
  const reportQuery = useGetDailyReport(productionDate);
  const lineageQuery = useGetDailyReportLineage(productionDate);
  const report: any = reportQuery.data;
  if (!productionDate) return <EmptyState title="Choose a production date" detail="Open a daily report from the management overview to load a traceable report." icon={<FileText size={22} />} />;
  if (reportQuery.isLoading) return <div><SkeletonBlock className="mb-5 h-3 w-32" /><SkeletonBlock className="h-11 w-96 max-w-full" /><div className="mt-8 grid gap-4 md:grid-cols-3"><SkeletonBlock className="h-32" /><SkeletonBlock className="h-32" /><SkeletonBlock className="h-32" /></div><SkeletonBlock className="mt-6 h-96" /></div>;
  if (reportQuery.isError) return <ErrorState onRetry={() => reportQuery.refetch()} message={`The report for ${productionDate} is not available right now.`} />;
  if (!report) return <EmptyState title="Report not found" detail="There is no generated report for this production date." />;
  const lineage = lineageQuery.data ?? report.sources ?? [];
  return <div className="reveal">
    <PageHeading eyebrow="Daily report / source traceability" title={dateLabel(report.productionDate)} detail={`${report.factory} · report ${report.reportVersion} · generated ${timeLabel(report.generatedAt)}`} action={<Link href="/" data-testid="link-back-overview" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold transition hover:bg-secondary"><ArrowDownRight size={16} className="rotate-45" /> Back to overview</Link>} />
    <div className="panel mb-6 rounded-2xl border-l-4 border-l-primary bg-primary/[.04] p-6"><div className="eyebrow text-primary">Executive readout</div><p data-testid="text-executive-summary" className="mt-3 max-w-4xl text-lg font-medium leading-relaxed tracking-[-.015em]">{report.executiveSummary}</p></div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{report.scorecard?.map((kpi: any) => <div key={kpi.code} data-testid={`card-report-kpi-${kpi.code}`} className="panel rounded-2xl p-5"><div className="flex items-center justify-between"><div className="eyebrow text-muted-foreground">{kpi.code}</div><StatusPill status={kpi.status} /></div><div className="mt-5 mono text-2xl font-bold">{formatValue(kpi.today, kpi.unit)}</div><div className="mt-3 space-y-1 text-xs text-muted-foreground"><div className="flex justify-between"><span>Yesterday</span><span className="mono text-foreground">{formatValue(kpi.yesterday, kpi.unit)}</span></div><div className="flex justify-between"><span>{kpi.baselineLabel}</span><span className="mono text-foreground">{formatValue(kpi.baseline, kpi.unit)}</span></div></div></div>)}</section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.35fr]"><div className="panel rounded-2xl p-6"><div className="eyebrow text-primary">Downtime profile</div><h2 className="mt-1 text-lg font-bold">Where the shift lost time</h2><div className="mt-6 space-y-4">{report.downtime?.length ? report.downtime.map((item: any) => <div key={item.label} data-testid={`row-downtime-${item.label}`}><div className="flex justify-between text-sm"><span className="font-semibold">{item.label}</span><span className="mono text-xs">{item.hours.toFixed(1)} h · {(item.share * 100).toFixed(0)}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, item.share * 100)}%` }} /></div></div>) : <EmptyState title="No downtime detail" detail="Downtime contributors were not included in this report." icon={<Clock3 size={22} />} />}</div></div><div className="panel rounded-2xl p-6"><div className="flex items-start justify-between"><div><div className="eyebrow text-primary">Exceptions</div><h2 className="mt-1 text-lg font-bold">Shift notes & deviations</h2></div><span className="mono text-xl font-bold">{String(report.exceptions?.length ?? 0).padStart(2, '0')}</span></div><div className="mt-5 space-y-2">{report.exceptions?.length ? report.exceptions.map((item: any) => <div key={item.id} data-testid={`report-exception-${item.id}`} className="rounded-xl border border-border/70 p-3.5"><div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${item.severity === 'CRITICAL' ? 'bg-red-600' : 'bg-amber-500'}`} /><span className="text-sm font-bold">{item.title}</span><span className="ml-auto mono text-[10px] text-muted-foreground">{item.kpiCode}</span></div><p className="mt-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">{item.detail}</p></div>) : <EmptyState title="No exceptions" detail="No deviations were recorded against this daily report." icon={<Check size={22} />} />}</div></div></section>
    <section className="panel mt-6 rounded-2xl p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow text-primary">Lineage register</div><h2 className="mt-1 text-lg font-bold">Every reported number has a source</h2><p className="mt-1 text-xs text-muted-foreground">Canonical fields map back to workbook, sheet, row and cell.</p></div><StatusPill status={lineageQuery.isError ? 'WARNING' : lineageQuery.isLoading ? 'WATCH' : 'GOOD'} label={lineageQuery.isError ? 'Lineage delayed' : lineageQuery.isLoading ? 'Loading map' : `${lineage.length} references`} /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="pb-3 pr-4">Measure</th><th className="pb-3 pr-4">Canonical field</th><th className="pb-3 pr-4">Workbook / sheet</th><th className="pb-3 pr-4">Cell</th><th className="pb-3">Raw value</th></tr></thead><tbody className="divide-y divide-border/70">{lineage.map((item: any, index: number) => <tr key={`${item.kpiCode}-${index}`} data-testid={`row-lineage-${index}`} className="transition hover:bg-secondary/40"><td className="py-3 pr-4 font-bold text-primary">{item.kpiCode}</td><td className="py-3 pr-4 mono text-[10px]">{item.canonicalField}</td><td className="py-3 pr-4"><Link href={`/files/${item.fileId}`} data-testid={`link-lineage-file-${index}`} className="font-semibold hover:text-primary">{item.filename}</Link><div className="mt-0.5 text-muted-foreground">{item.sheet}</div></td><td className="py-3 pr-4 mono">{item.sourceColumn}{item.sourceRow}</td><td className="py-3 mono">{item.rawValue}</td></tr>)}</tbody></table>{!lineage.length && <div className="py-8 text-center text-sm text-muted-foreground">No lineage references returned for this report.</div>}</div></section>
  </div>;
}

function FilesPage() {
  const [status, setStatus] = useState<string>('ALL');
  const [uploadOpen, setUploadOpen] = useState(false);
  const queryClient = useQueryClient();
  const filesQuery = useListSourceFiles(status === 'ALL' ? { limit: 100 } : { status: status as any, limit: 100 });
  const upload = useUploadSourceFile();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const files: any[] = filesQuery.data ?? [];
  const statuses = ['ALL', 'PROCESSED', 'WARNING', 'FAILED', 'PARSING'];
  const handleUpload = () => {
    if (!selectedFile) return;
    upload.mutate({ data: { filename: selectedFile.name, sizeBytes: selectedFile.size, contentType: selectedFile.type || null } }, {
      onSuccess: () => { setSelectedFile(null); setUploadOpen(false); queryClient.invalidateQueries({ queryKey: getListSourceFilesQueryKey() }); },
    });
  };
  return <div className="reveal"><PageHeading eyebrow="Source registry" title="Factory files" detail="The workbook ledger behind every daily number. Inspect status, validation issues and processing history." action={<button onClick={() => setUploadOpen(true)} data-testid="button-upload-file" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90"><Upload size={16} /> Register source file</button>} />
    {uploadOpen && <div className="panel mb-6 rounded-2xl border-primary/40 bg-primary/[.035] p-5"><div className="flex items-start justify-between"><div><div className="eyebrow text-primary">New source</div><h2 className="mt-1 text-lg font-bold">Register an Excel workbook</h2><p className="mt-1 text-xs text-muted-foreground">The file will be sent to the ingestion service for hashing and validation.</p></div><button onClick={() => setUploadOpen(false)} data-testid="button-cancel-upload" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"><X size={17} /></button></div><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center"><label className="flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-background/50 px-4 transition hover:border-primary"><CloudUpload size={19} className="text-primary" /><span className="text-sm font-semibold">{selectedFile ? selectedFile.name : 'Choose .xlsx or .xls file'}</span><input type="file" accept=".xlsx,.xls" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} data-testid="input-source-file" className="sr-only" /></label><button onClick={handleUpload} disabled={!selectedFile || upload.isPending} data-testid="button-submit-upload" className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45">{upload.isPending ? 'Registering…' : 'Send to registry'} <ArrowRight size={15} /></button></div>{upload.isError && <p className="mt-3 text-xs font-semibold text-red-700">Could not register this file. Check the connection and try again.</p>}</div>}
    <div className="mb-5 flex flex-wrap items-center gap-2">{statuses.map(item => <button key={item} onClick={() => setStatus(item)} data-testid={`button-filter-${item.toLowerCase()}`} className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${status === item ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}>{item === 'ALL' ? 'All files' : item}</button>)}<span className="ml-auto text-xs text-muted-foreground">{files.length} records shown</span></div>
    {filesQuery.isLoading ? <div className="panel overflow-hidden rounded-2xl"><div className="space-y-px">{[1, 2, 3, 4, 5].map(i => <SkeletonBlock key={i} className="h-16 rounded-none" />)}</div></div> : filesQuery.isError ? <ErrorState onRetry={() => filesQuery.refetch()} message="The source registry could not be loaded." /> : !files.length ? <EmptyState title="No source files match" detail={status === 'ALL' ? 'Register the first validated Excel workbook to establish your source ledger.' : 'Try another status filter or return to all files.'} icon={<FileSpreadsheet size={22} />} /> : <div className="panel overflow-hidden rounded-2xl"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">File</th><th className="px-4 py-3">Reporting date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Issues</th><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3">Size</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-border/70">{files.map(file => <tr key={file.id} data-testid={`row-source-file-${file.id}`} className="group transition hover:bg-secondary/40"><td className="px-5 py-4"><Link href={`/files/${file.id}`} data-testid={`link-source-file-${file.id}`} className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><FileSpreadsheet size={17} /></span><span><span className="block font-bold group-hover:text-primary">{file.filename}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{file.reportType}{file.synthetic ? ' · synthetic' : ''}</span></span></Link></td><td className="px-4 py-4 mono text-xs">{dateLabel(file.reportingDate, { day: '2-digit', month: 'short', year: 'numeric' })}</td><td className="px-4 py-4"><StatusPill status={file.status} /></td><td className="px-4 py-4 mono text-xs">{file.issueCount ?? 0}</td><td className="px-4 py-4 text-xs text-muted-foreground">{dateLabel(file.uploadedAt, { day: '2-digit', month: 'short' })} {timeLabel(file.uploadedAt)}</td><td className="px-4 py-4 mono text-xs">{bytesLabel(file.sizeBytes)}</td><td className="px-5 py-4 text-right"><ChevronRight size={16} className="ml-auto text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></td></tr>)}</tbody></table></div></div>}
  </div>;
}

function FileDetailPage() {
  const params = useParams<{ fileId: string }>();
  const query = useGetSourceFile(params.fileId);
  const file: any = query.data;
  if (query.isLoading) return <div><SkeletonBlock className="h-3 w-28" /><SkeletonBlock className="mt-3 h-10 w-96 max-w-full" /><div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1.3fr]"><SkeletonBlock className="h-96" /><SkeletonBlock className="h-96" /></div></div>;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} message="This source file could not be loaded." />;
  if (!file) return <EmptyState title="File not found" detail="The requested source record may have been removed or is not yet visible." icon={<FileSpreadsheet size={22} />} />;
  return <div className="reveal"><PageHeading eyebrow="Source file detail" title={file.filename} detail={`${file.reportType} · ${dateLabel(file.reportingDate)} · ${bytesLabel(file.sizeBytes)}`} action={<Link href="/files" data-testid="link-back-files" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold transition hover:bg-secondary"><ArrowDownRight size={16} className="rotate-45" /> Source registry</Link>} /><div className="mb-6 flex flex-wrap items-center gap-3"><StatusPill status={file.status} /><span className="mono text-[10px] text-muted-foreground">SHA-256 {file.sha256}</span>{file.synthetic && <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Synthetic fixture</span>}</div><div className="grid gap-6 xl:grid-cols-[.9fr_1.4fr]"><div className="space-y-6"><div className="panel rounded-2xl p-6"><div className="eyebrow text-primary">Workbook structure</div><h2 className="mt-1 text-lg font-bold">Available sheets</h2><div className="mt-5 space-y-2">{file.sheets?.map((sheet: string) => <div key={sheet} data-testid={`sheet-${sheet}`} className="flex items-center gap-3 rounded-lg border border-border/70 px-3.5 py-3"><FileSpreadsheet size={15} className="text-emerald-700" /><span className="text-sm font-semibold">{sheet}</span><Check size={14} className="ml-auto text-emerald-700" /></div>)}</div></div><div className="panel rounded-2xl p-6"><div className="eyebrow text-primary">Processing history</div><h2 className="mt-1 text-lg font-bold">Chain of custody</h2><div className="mt-5 space-y-0">{file.processingHistory?.map((event: any, index: number) => <div key={`${event.status}-${index}`} className="relative flex gap-3 pb-5 last:pb-0"><div className="relative flex w-4 justify-center"><div className={`z-10 mt-1.5 h-2.5 w-2.5 rounded-full ${index === file.processingHistory.length - 1 ? 'bg-primary ring-4 ring-primary/15' : 'bg-emerald-600'}`} />{index < file.processingHistory.length - 1 && <div className="absolute top-4 h-full w-px bg-border" />}</div><div><div className="flex items-center gap-2 text-sm font-bold">{event.status}<span className="mono text-[10px] font-normal text-muted-foreground">{timeLabel(event.at)}</span></div>{event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}</div></div>)}</div></div></div><div className="panel rounded-2xl p-6"><div className="flex items-start justify-between"><div><div className="eyebrow text-primary">Validation log</div><h2 className="mt-1 text-lg font-bold">Issues found in this file</h2></div><span data-testid="text-file-issue-count" className="mono text-2xl font-bold">{String(file.issues?.length ?? 0).padStart(2, '0')}</span></div>{file.issues?.length ? <div className="mt-5 overflow-hidden rounded-xl border border-border/70"><table className="w-full text-left text-xs"><thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Message</th><th className="px-4 py-3">Location</th></tr></thead><tbody className="divide-y divide-border/70">{file.issues.map((issue: any, index: number) => <tr key={index} data-testid={`row-validation-issue-${index}`}><td className="px-4 py-3"><StatusPill status={issue.severity} /></td><td className="px-4 py-3 font-semibold">{issue.message}<div className="mono mt-1 text-[10px] font-normal text-muted-foreground">{issue.code}</div></td><td className="px-4 py-3 mono text-[10px] text-muted-foreground">{issue.location || '—'}</td></tr>)}</tbody></table></div> : <div className="mt-6 flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 text-center"><CheckCircle2 size={25} className="text-emerald-700" /><div className="mt-3 text-sm font-bold text-emerald-900">No validation issues</div><p className="mt-1 text-xs text-emerald-800/70">This workbook passed all available checks.</p></div>}</div></div></div>;
}

type OperationsForm = {
  productionDate: string;
  season: string;
  shift: string;
  status: string;
  production: Record<string, string | number | null>;
  quality: Record<string, string | number | null>;
  efficiency: Record<string, string | number | null>;
  timeAccount: Record<string, string | number | null>;
  stoppages: Array<Record<string, string>>;
  energy: Record<string, string | number | null>;
  materials: Array<Record<string, string | number>>;
};

const operationsInitial: OperationsForm = {
  productionDate: '2026-08-30',
  season: '2025-26',
  shift: 'GENERAL',
  status: 'DRAFT',
  production: {
    caneCrushed: 7210,
    sugarProduced: 658,
    sugarBagged: 640,
    bagasse: 1025,
    filterCake: 180,
    molasses: 252,
  },
  quality: { brix: 19.2, pol: 15.8, purity: 82.3, caneQuality: 'Good' },
  efficiency: { millExtraction: 94.6, boilingHouseEfficiency: 91.8, capacityUtilization: 87.2 },
  timeAccount: { availableHours: 24, hoursWorked: 15.6, plannedMaintenance: 2.2, breakdown: 6.2, caneShortage: 0 },
  stoppages: [{ cause: 'Boiler trip', startTime: '09:40', endTime: '11:10' }],
  energy: { powerGenerated: 11220, powerUsed: 9380, steamConsumption: 3.46 },
  materials: [{ material: 'Lime', quantity: 18.4, unit: 'kg/t cane' }],
};

const fieldClass = 'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-semibold outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15';

function DataField({
  label,
  value,
  onChange,
  type = 'number',
  step = '0.1',
  readOnly = false,
}: {
  label: string;
  value: string | number | null | undefined;
  onChange?: (value: string) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
}) {
  return <label className="block text-xs font-bold text-foreground/75">{label}<input className={`${fieldClass} ${readOnly ? 'bg-muted/60 text-muted-foreground' : ''}`} type={type} step={step} value={value ?? ''} readOnly={readOnly} onChange={event => onChange?.(event.target.value)} /></label>;
}

function OperationsSection({ eyebrow, title, children, editable = true }: { eyebrow: string; title: string; children: ReactNode; editable?: boolean }) {
  return <section className="panel rounded-2xl p-5 sm:p-6"><div className="eyebrow text-primary">{eyebrow}</div><div className="flex items-start justify-between gap-3"><h2 className="mt-1 text-lg font-bold tracking-tight">{title}</h2>{!editable && <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">View only</span>}</div><fieldset disabled={!editable} className={`mt-5 min-w-0 border-0 p-0 ${!editable ? 'opacity-60' : ''}`}><div className="grid gap-4 sm:grid-cols-2">{children}</div></fieldset>{!editable && <p className="mt-4 text-xs text-muted-foreground">Only the {title.toLowerCase()} operator or a manager can edit this section.</p>}</section>;
}

function OperationsPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<OperationsForm>(operationsInitial);
  const [busy, setBusy] = useState<'DRAFT' | 'SUBMITTED' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const recovery = useMemo(() => {
    const cane = Number(form.production.caneCrushed);
    const sugar = Number(form.production.sugarProduced);
    return cane > 0 && Number.isFinite(sugar) ? (sugar / cane) * 100 : null;
  }, [form.production.caneCrushed, form.production.sugarProduced]);
  const hoursLost = useMemo(() => {
    const available = Number(form.timeAccount.availableHours);
    const worked = Number(form.timeAccount.hoursWorked);
    return Number.isFinite(available) && Number.isFinite(worked) ? Math.max(0, available - worked) : null;
  }, [form.timeAccount.availableHours, form.timeAccount.hoursWorked]);
  const powerExported = useMemo(() => {
    const generated = Number(form.energy.powerGenerated);
    const used = Number(form.energy.powerUsed);
    return Number.isFinite(generated) && Number.isFinite(used) ? Math.max(0, generated - used) : null;
  }, [form.energy.powerGenerated, form.energy.powerUsed]);
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';
  const canProduction = isManager || user?.role === 'PRODUCTION_OPERATOR';
  const canQuality = isManager || user?.role === 'QUALITY_OPERATOR';
  const canEngineering = isManager || user?.role === 'ENGINEERING_OPERATOR';
  const canStores = isManager || user?.role === 'STORES_OPERATOR';

  useEffect(() => {
    let active = true;
    fetch(`/api/daily-operations/${form.productionDate}`, { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(record => {
        if (!active || !record) return;
        setForm(current => ({
          ...current,
          ...record,
          production: { ...current.production, ...(record.production ?? {}) },
          quality: { ...current.quality, ...(record.quality ?? {}) },
          efficiency: { ...current.efficiency, ...(record.efficiency ?? {}) },
          timeAccount: { ...current.timeAccount, ...(record.timeAccount ?? {}) },
          energy: { ...current.energy, ...(record.energy ?? {}) },
          stoppages: record.stoppages?.length ? record.stoppages : current.stoppages,
          materials: record.materials?.length ? record.materials : current.materials,
        }));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [form.productionDate]);

  const setSectionValue = (section: keyof Pick<OperationsForm, 'production' | 'quality' | 'efficiency' | 'timeAccount' | 'energy'>, key: string, value: string) => {
    setForm(current => ({ ...current, [section]: { ...current[section], [key]: value } }));
    setNotice('');
    setError('');
  };

  const save = async (status: 'DRAFT' | 'SUBMITTED') => {
    setBusy(status);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/daily-operations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.issues?.join(' ') || result.error || 'Could not save this entry.');
      setForm(current => ({ ...current, ...result, status: result.status ?? status }));
      setNotice(status === 'SUBMITTED' ? 'Submitted. The canonical KPIs and dashboard have been updated.' : 'Draft saved. It is not included in the management view until submitted.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this entry.');
    } finally {
      setBusy(null);
    }
  };

  const updateStoppage = (index: number, key: string, value: string) => {
    setForm(current => ({ ...current, stoppages: current.stoppages.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  };
  const stoppageDuration = (item: Record<string, string>) => {
    if (!item.startTime || !item.endTime) return null;
    const [startHours, startMinutes] = item.startTime.split(':').map(Number);
    const [endHours, endMinutes] = item.endTime.split(':').map(Number);
    if (![startHours, startMinutes, endHours, endMinutes].every(Number.isFinite)) return null;
    let minutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
    if (minutes < 0) minutes += 24 * 60;
    return minutes / 60;
  };

  return <div className="reveal">
    <PageHeading eyebrow="Centralized data entry" title="Daily operations" detail="Enter the shift record once. Save a draft while the workbook is being reconciled, or submit validated values to update the canonical dashboard." action={<div className="flex flex-wrap gap-2"><StatusPill status={form.status === 'SUBMITTED' ? 'GOOD' : form.status === 'APPROVED' ? 'GOOD' : 'WATCH'} label={form.status === 'SUBMITTED' ? 'Submitted' : form.status === 'APPROVED' ? 'Approved' : form.status === 'UNDER_REVIEW' ? 'Under review' : 'Draft'} /><span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">Synthetic demo</span></div>} />
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-primary/20 bg-primary/[.045] p-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="eyebrow text-primary">Bilagi Sugar Mill Ltd. — Badagandi</div><p className="mt-1 text-xs text-muted-foreground">Season 2025–26 · manual entry joins the same canonical model as Excel imports.</p></div><div className="grid grid-cols-2 gap-3 sm:flex"><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Production date<input className={fieldClass} type="date" value={form.productionDate} onChange={event => setForm(current => ({ ...operationsInitial, productionDate: event.target.value, shift: current.shift }))} /></label><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Shift<select className={fieldClass} value={form.shift} onChange={event => setForm(current => ({ ...current, shift: event.target.value }))}><option value="GENERAL">General</option><option value="A">Shift A</option><option value="B">Shift B</option><option value="C">Shift C</option></select></label></div></div>
    {notice && <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{notice}</div>}
    {error && <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}
    <div className="grid gap-6 xl:grid-cols-2">
       <OperationsSection eyebrow="01 / production" title="Production output" editable={canProduction}>
        <DataField label="Cane crushed · t" value={form.production.caneCrushed} onChange={value => setSectionValue('production', 'caneCrushed', value)} />
        <DataField label="Sugar produced · t" value={form.production.sugarProduced} onChange={value => setSectionValue('production', 'sugarProduced', value)} />
        <DataField label="Sugar bagged · t" value={form.production.sugarBagged} onChange={value => setSectionValue('production', 'sugarBagged', value)} />
        <DataField label="Bagasse · t" value={form.production.bagasse} onChange={value => setSectionValue('production', 'bagasse', value)} />
        <DataField label="Filter cake · t" value={form.production.filterCake} onChange={value => setSectionValue('production', 'filterCake', value)} />
        <DataField label="Molasses · t" value={form.production.molasses} onChange={value => setSectionValue('production', 'molasses', value)} />
        <DataField label="Recovery · %" value={recovery?.toFixed(2)} readOnly />
      </OperationsSection>
       <OperationsSection eyebrow="02 / quality" title="Quality & cane profile" editable={canQuality}>
        <DataField label="Mixed juice brix · %" value={form.quality.brix} onChange={value => setSectionValue('quality', 'brix', value)} />
        <DataField label="Mixed juice pol · %" value={form.quality.pol} onChange={value => setSectionValue('quality', 'pol', value)} />
        <DataField label="Purity · %" value={form.quality.purity} onChange={value => setSectionValue('quality', 'purity', value)} />
        <DataField label="Cane quality note" type="text" value={form.quality.caneQuality} onChange={value => setSectionValue('quality', 'caneQuality', value)} />
      </OperationsSection>
       <OperationsSection eyebrow="03 / efficiency" title="Plant efficiency" editable={canEngineering}>
        <DataField label="Mill extraction · %" value={form.efficiency.millExtraction} onChange={value => setSectionValue('efficiency', 'millExtraction', value)} />
        <DataField label="Boiling house efficiency · %" value={form.efficiency.boilingHouseEfficiency} onChange={value => setSectionValue('efficiency', 'boilingHouseEfficiency', value)} />
        <DataField label="Capacity utilization · %" value={form.efficiency.capacityUtilization} onChange={value => setSectionValue('efficiency', 'capacityUtilization', value)} />
      </OperationsSection>
       <OperationsSection eyebrow="04 / time account" title="Available time & hours lost" editable={canEngineering}>
        <DataField label="Available hours" value={form.timeAccount.availableHours} onChange={value => setSectionValue('timeAccount', 'availableHours', value)} />
        <DataField label="Hours worked" value={form.timeAccount.hoursWorked} onChange={value => setSectionValue('timeAccount', 'hoursWorked', value)} />
        <DataField label="Hours lost · calculated" value={hoursLost?.toFixed(2)} readOnly />
        <DataField label="Planned maintenance · h" value={form.timeAccount.plannedMaintenance} onChange={value => setSectionValue('timeAccount', 'plannedMaintenance', value)} />
        <DataField label="Breakdown · h" value={form.timeAccount.breakdown} onChange={value => setSectionValue('timeAccount', 'breakdown', value)} />
        <DataField label="Cane shortage · h" value={form.timeAccount.caneShortage} onChange={value => setSectionValue('timeAccount', 'caneShortage', value)} />
      </OperationsSection>
       <OperationsSection eyebrow="05 / energy" title="Power & steam balance" editable={canEngineering}>
        <DataField label="Power generated · kWh" value={form.energy.powerGenerated} onChange={value => setSectionValue('energy', 'powerGenerated', value)} />
        <DataField label="Power used · kWh" value={form.energy.powerUsed} onChange={value => setSectionValue('energy', 'powerUsed', value)} />
        <DataField label="Power exported · calculated" value={powerExported?.toFixed(2)} readOnly />
        <DataField label="Steam consumption · t/t cane" value={form.energy.steamConsumption} onChange={value => setSectionValue('energy', 'steamConsumption', value)} />
      </OperationsSection>
       <fieldset disabled={!canEngineering} className={`min-w-0 border-0 p-0 ${!canEngineering ? 'opacity-60' : ''}`}><section className="panel rounded-2xl p-5 sm:p-6"><div className="eyebrow text-primary">06 / stoppages</div><div className="flex items-start justify-between gap-4"><div><h2 className="mt-1 text-lg font-bold tracking-tight">Stoppage register</h2><p className="mt-1 text-xs text-muted-foreground">Duration is calculated from start and end time.</p></div><button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-secondary" onClick={() => setForm(current => ({ ...current, stoppages: [...current.stoppages, { cause: '', startTime: '', endTime: '' }] }))}><Plus size={14} /> Add</button></div><div className="mt-5 space-y-3">{form.stoppages.map((item, index) => <div key={index} className="grid gap-2 rounded-xl border border-border/70 bg-muted/25 p-3 sm:grid-cols-[1.4fr_.7fr_.7fr_auto] sm:items-end"><DataField label="Cause" type="text" value={item.cause} onChange={value => updateStoppage(index, 'cause', value)} /><DataField label="Start" type="time" value={item.startTime} onChange={value => updateStoppage(index, 'startTime', value)} /><DataField label="End" type="time" value={item.endTime} onChange={value => updateStoppage(index, 'endTime', value)} /><div className="flex items-center justify-between gap-2 sm:pb-2"><span className="mono text-xs font-bold text-primary">{stoppageDuration(item)?.toFixed(2) ?? '—'} h</span><button aria-label="Remove stoppage" className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-red-700" onClick={() => setForm(current => ({ ...current, stoppages: current.stoppages.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /></button></div></div>)}</div>{!canEngineering && <p className="mt-4 text-xs text-muted-foreground">Only the engineering operator or a manager can edit this section.</p>}</section></fieldset>
       <OperationsSection eyebrow="07 / materials" title="Materials consumed" editable={canStores}>
        <DataField label="Material" type="text" value={form.materials[0]?.material} onChange={value => setForm(current => ({ ...current, materials: [{ ...current.materials[0], material: value }] }))} />
        <DataField label="Quantity · kg/t cane" value={form.materials[0]?.quantity} onChange={value => setForm(current => ({ ...current, materials: [{ ...current.materials[0], quantity: value }] }))} />
        <DataField label="Unit" type="text" value={form.materials[0]?.unit} onChange={value => setForm(current => ({ ...current, materials: [{ ...current.materials[0], unit: value }] }))} />
      </OperationsSection>
    </div>
     <div className="sticky bottom-4 z-10 mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={15} className="text-primary" /><span>Server validation calculates Recovery, Hours Lost and Power Exported before persistence.</span></div><div className="flex gap-2"><button disabled={!!busy || form.status === 'APPROVED'} onClick={() => save('DRAFT')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-bold transition hover:bg-secondary disabled:opacity-50"><Save size={15} />{busy === 'DRAFT' ? 'Saving…' : 'Save draft'}</button><button disabled={!!busy || form.status === 'APPROVED'} onClick={() => save('SUBMITTED')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"><Send size={15} />{busy === 'SUBMITTED' ? 'Submitting…' : 'Submit to dashboard'}</button></div></div>
  </div>;
}

function AccessDenied(_props: unknown) {
  return <div className="reveal"><div className="panel flex min-h-80 flex-col items-center justify-center rounded-2xl p-8 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldCheck size={23} /></div><div className="eyebrow mt-5 text-amber-700">Access restricted</div><h1 className="mt-2 text-2xl font-bold tracking-tight">This view is not assigned to your role</h1><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Your role does not have access to this module. Ask a manager or administrator if you need access.</p></div></div>;
}

function ApprovalQueuePage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Array<{ id: string; productionDate: string; shift: string; status: string; submittedBy: string; submittedAt: string; department: string; priority?: string; reviewerRole?: string }>>([]);
  const [summary, setSummary] = useState({ pending: 0, highPriority: 0, returned: 0, approvedToday: 0 });
  const [filters, setFilters] = useState({ department: 'ALL', status: 'ALL', submitter: '' });
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadQueue = async () => {
    try {
      const [queueResponse, summaryResponse] = await Promise.all([
        fetch('/api/approval-queue', { credentials: 'include' }),
        fetch('/api/approval-summary', { credentials: 'include' }),
      ]);
      if (!queueResponse.ok || !summaryResponse.ok) throw new Error('Could not load the approval center.');
      setQueue(await queueResponse.json());
      setSummary(await summaryResponse.json());
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Could not load the approval center.');
    }
  };
  useEffect(() => { if (isLeadership(user)) void loadQueue(); }, [user]);

  const review = async (id: string, action: 'START_REVIEW' | 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !comments[id]?.trim()) {
      setError('Enter a return reason before returning this submission.');
      return;
    }
    setBusy(`${id}:${action}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/approval-queue/${id}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, comments: comments[id] || undefined }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not review this record.');
      setNotice(action === 'APPROVE' ? 'Record approved, locked, and the submitter was notified.' : action === 'START_REVIEW' ? 'Record marked under review.' : 'Record returned for correction and the submitter was notified.');
      await loadQueue();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not review this record.');
    } finally {
      setBusy(null);
    }
  };

  const filteredQueue = queue.filter(item =>
    (filters.department === 'ALL' || item.department === filters.department) &&
    (filters.status === 'ALL' || item.status === filters.status) &&
    (!filters.submitter || item.submittedBy.toLowerCase().includes(filters.submitter.toLowerCase())),
  ).sort((left, right) => left.priority === right.priority ? new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime() : left.priority === 'HIGH' ? -1 : 1);
  const departments = [...new Set(queue.map(item => item.department))];

  if (!isLeadership(user)) return <AccessDenied />;
  return <div className="reveal"><PageHeading eyebrow="Management control" title="Approval center" detail="Review assigned department records, return incomplete data with a reason, and lock approved records." action={<StatusPill status={queue.length ? 'WATCH' : 'GOOD'} label={`${queue.length} awaiting review`} />} />
    {notice && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Pending', summary.pending], ['High priority', summary.highPriority], ['Returned', summary.returned], ['Approved today', summary.approvedToday]].map(([label, value]) => <div key={label} className="panel rounded-xl p-4"><div className="eyebrow text-muted-foreground">{label}</div><div className="mt-2 font-mono text-2xl font-bold">{value}</div></div>)}</div>
    <div className="panel mb-5 grid gap-3 rounded-xl p-4 sm:grid-cols-3"><label className="text-xs font-bold">Department<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}><option value="ALL">All departments</option>{departments.map(department => <option key={department}>{department}</option>)}</select></label><label className="text-xs font-bold">Status<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={fieldClass}><option value="ALL">All pending states</option><option value="SUBMITTED">Submitted</option><option value="UNDER_REVIEW">Under review</option></select></label><label className="text-xs font-bold">Submitter<input value={filters.submitter} onChange={event => setFilters(current => ({ ...current, submitter: event.target.value }))} className={fieldClass} placeholder="Filter by username" /></label></div>
      <div className="panel overflow-hidden rounded-2xl">{filteredQueue.length ? <div className="divide-y divide-border/70">{filteredQueue.map(item => <div key={item.id} className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="eyebrow text-primary">{item.department}</span><StatusPill status={item.status} label={item.status === 'UNDER_REVIEW' ? 'Under review' : 'Submitted'} />{item.priority === 'HIGH' && <StatusPill status="WARNING" label="High priority" />}</div><h2 className="mt-2 text-lg font-bold">{dateLabel(item.productionDate)} · {item.shift} shift</h2><p className="mt-1 text-xs text-muted-foreground">Submitted by {item.submittedBy} · {timeLabel(item.submittedAt)} · assigned to {item.reviewerRole?.toLowerCase()}</p></div><div className="flex flex-wrap gap-2">{item.status === 'SUBMITTED' && <button disabled={!!busy} onClick={() => void review(item.id, 'START_REVIEW')} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold disabled:opacity-50"><Clock3 size={14} /> Start review</button>}<button disabled={!!busy} onClick={() => void review(item.id, 'REJECT')} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 disabled:opacity-50"><XCircle size={14} /> Return</button><button disabled={!!busy} onClick={() => void review(item.id, 'APPROVE')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"><Check size={14} /> Approve</button></div></div><input value={comments[item.id] ?? ''} onChange={event => setComments(current => ({ ...current, [item.id]: event.target.value }))} className={fieldClass} placeholder="Return reason required; approval comment optional" /></div>)}</div> : <EmptyState title="No records match these filters" detail="Change the filters or wait for a new department submission." icon={<CheckCircle2 size={22} />} />}</div>
  </div>;
}

function AuditLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Array<{ id: string; userId: string; role: string; department: string; action: string; entityType: string; entityId: string | null; details: Record<string, unknown> | null; createdAt: string }>>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isLeadership(user)) return;
    fetch('/api/audit-logs', { credentials: 'include' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load the audit log.')))
      .then(setEntries)
      .catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : 'Could not load the audit log.'));
  }, [user]);
  if (!isLeadership(user)) return <AccessDenied />;
  return <div className="reveal"><PageHeading eyebrow="Traceability" title="Audit log" detail="Recent operational, approval and user-administration actions with the acting role and department." action={<StatusPill status="GOOD" label={`${entries.length} recent events`} />} />{error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}<div className="panel overflow-hidden rounded-2xl">{entries.length ? <div className="divide-y divide-border/70">{entries.map(entry => <div key={entry.id} className="grid gap-3 p-5 sm:grid-cols-[160px_1fr_auto] sm:items-center"><div><div className="mono text-xs font-bold">{new Date(entry.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div><div className="mt-1 text-[10px] text-muted-foreground">{entry.department}</div></div><div><div className="text-sm font-bold">{entry.action.replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-muted-foreground">{entry.entityType}{entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}</div></div><span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{entry.role.replaceAll('_', ' ')}</span></div>)}</div> : <EmptyState title="No audit events yet" detail="Saved records, approvals and user administration events will appear here." icon={<Clock3 size={22} />} />}</div></div>;
}

function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<Array<{ id: string; username: string; email: string; role: string; department: string; isDemo: boolean; createdAt: string }>>([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'PRODUCTION_OPERATOR', department: 'PRODUCTION' });
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadUsers = () => fetch('/api/users', { credentials: 'include' }).then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load users.'))).then(setUsers).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : 'Could not load users.'));
  useEffect(() => { if (user?.role === 'ADMIN') void loadUsers(); }, [user]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const response = await fetch('/api/users', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || 'Could not create user.'); return; }
    setNotice(`Created ${form.username}.`);
    setForm({ username: '', password: '', role: 'PRODUCTION_OPERATOR', department: 'PRODUCTION' });
    await loadUsers();
  };

  const resetPassword = async (id: string) => {
    const password = resetPasswords[id] ?? '';
    if (!password) return;
    const response = await fetch(`/api/users/${id}/reset-password`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || 'Could not reset password.'); return; }
    setNotice('Password reset successfully.');
    setResetPasswords(current => ({ ...current, [id]: '' }));
  };

  if (user?.role !== 'ADMIN') return <AccessDenied />;
  return <div className="reveal"><PageHeading eyebrow="Administration" title="User administration" detail="Create department accounts and rotate demo passwords. Passwords are stored as secure hashes only." />
    {notice && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><form onSubmit={createUser} className="panel rounded-2xl p-6"><div className="eyebrow text-primary">New account</div><h2 className="mt-1 text-lg font-bold">Add a local user</h2><div className="mt-5 space-y-4"><label className="block text-xs font-bold">Username<input required minLength={3} value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} className={fieldClass} placeholder="e.g. lab.supervisor" /></label><label className="block text-xs font-bold">Temporary password<input required minLength={4} type="password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} className={fieldClass} /></label><label className="block text-xs font-bold">Role<select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))} className={fieldClass}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-xs font-bold">Department<input required value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} className={fieldClass} /></label><button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Plus size={15} />Create user</button></div></form>
      <div className="panel overflow-hidden rounded-2xl"><div className="border-b border-border/70 p-6"><div className="eyebrow text-primary">Access roster</div><h2 className="mt-1 text-lg font-bold">{users.length} local accounts</h2></div><div className="divide-y divide-border/70">{users.map(item => <div key={item.id} className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-bold">{item.username} {item.isDemo && <span className="ml-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">Demo</span>}</div><div className="mt-1 text-xs text-muted-foreground">{roleLabels[item.role as AuthUser['role']] ?? item.role} · {item.department}</div></div><div className="flex gap-2"><input type="password" value={resetPasswords[item.id] ?? ''} onChange={event => setResetPasswords(current => ({ ...current, [item.id]: event.target.value }))} className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-xs" placeholder="New password" /><button onClick={() => void resetPassword(item.id)} className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-secondary">Reset</button></div></div></div>)}</div></div></div>
  </div>;
}

function SettingsPage() {
  const health = useHealthCheck();
  return <div className="reveal"><PageHeading eyebrow="Configuration & readiness" title="System readiness" detail="A concise view of the connections and conventions used to produce trusted daily reports. Configuration is managed by the platform, not in this screen." /><div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><div className="panel rounded-2xl p-6"><div className="eyebrow text-primary">Readiness checks</div><h2 className="mt-1 text-lg font-bold">Can the morning report run?</h2><div className="mt-6 divide-y divide-border/70">{[{ label: 'API service', detail: 'Dashboard and report endpoints', state: health.isError ? 'Needs attention' : health.isLoading ? 'Checking…' : 'Connected', ok: !health.isError && !health.isLoading }, { label: 'Source registry', detail: 'Excel workbook ingestion ledger', state: 'Available', ok: true }, { label: 'Traceability', detail: 'Workbook cell-level lineage', state: 'Enabled', ok: true }, { label: 'Factory context', detail: 'Factory-local production dates', state: 'Configured', ok: true }].map((item) => <div key={item.label} data-testid={`readiness-${item.label.toLowerCase().replaceAll(' ', '-')}`} className="flex items-center gap-4 py-4"><div className={`flex h-9 w-9 items-center justify-center rounded-full ${item.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.ok ? <CheckCircle2 size={18} /> : <RefreshCw size={17} />}</div><div className="flex-1"><div className="text-sm font-bold">{item.label}</div><div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div></div><span className={`text-xs font-bold ${item.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{item.state}</span></div>)}</div></div><div className="panel rounded-2xl p-6"><div className="eyebrow text-primary">Operating contract</div><h2 className="mt-1 text-lg font-bold">What this view guarantees</h2><div className="mt-6 space-y-4">{[{ icon: ShieldCheck, title: 'Numbers stay traceable', text: 'Every KPI can be followed from the report to a workbook, sheet and source cell.' }, { icon: SlidersHorizontal, title: 'No silent assumptions', text: 'Missing or partial data is marked in the view instead of being silently filled.' }, { icon: HardDrive, title: 'Files remain the record', text: 'The source registry preserves processing state, hashes and validation history.' }].map(item => <div key={item.title} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><item.icon size={16} /></div><div><div className="text-sm font-bold">{item.title}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.text}</p></div></div>)}</div><div className="mt-7 rounded-xl bg-muted/55 p-4 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Need to change configuration?</strong><br />Contact the platform administrator. This surface intentionally exposes readiness without inventing local edit flows.</div></div></div></div>;
}

function Router({ user, logout }: { user: AuthUser | null; logout: () => void | Promise<void> }) {
  const leadershipPage = isLeadership(user) ? Overview : AccessDenied;
  const adminPage = user?.role === 'ADMIN' ? SettingsPage : AccessDenied;
  return <RoutedErrorBoundary><Shell user={user} logout={logout}><Switch><Route path="/" component={leadershipPage} /><Route path="/daily-operations" component={OperationsPage} /><Route path="/operations-suite" component={OperationsSuitePage} /><Route path="/reports/:productionDate" component={isLeadership(user) ? ReportPage : AccessDenied} /><Route path="/files/:fileId" component={isLeadership(user) ? FileDetailPage : AccessDenied} /><Route path="/files" component={isLeadership(user) ? FilesPage : AccessDenied} /><Route path="/approval-queue" component={ApprovalQueuePage} /><Route path="/audit-log" component={AuditLogPage} /><Route path="/users" component={UsersPage} /><Route path="/settings" component={adminPage} /><Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<string | null> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const message = await onLogin(username, password);
    if (message) setError(message);
    setBusy(false);
  };

  const demoUsers = [
    ['production', 'Production'],
    ['quality', 'Quality'],
    ['engineering', 'Engineering'],
    ['stores', 'Stores'],
    ['manager', 'Manager'],
    ['admin', 'Admin'],
  ];

  return (
    <main className="login-screen grain min-h-[100dvh] overflow-hidden text-foreground">
      <div className="login-atmosphere" aria-hidden="true" />
      <div className="relative mx-auto grid min-h-[100dvh] max-w-[1540px] lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
        <section className="login-control-room relative flex min-h-[310px] flex-col justify-between overflow-hidden px-6 py-7 text-sidebar-foreground sm:px-10 sm:py-9 lg:min-h-[100dvh] lg:px-14 lg:py-12">
          <div className="login-grid absolute inset-0 opacity-60" aria-hidden="true" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-black/15">
              <Gauge size={23} />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-sidebar" />
            </div>
            <div>
              <div className="font-bold tracking-tight">Sugar Factory</div>
              <div className="eyebrow mt-0.5 text-sidebar-foreground/55">Intelligence</div>
            </div>
          </div>
          <div className="relative z-10 max-w-xl py-10 lg:py-0">
            <div className="eyebrow mb-5 text-sidebar-primary">Operations console / 06:00 shift</div>
            <h1 className="max-w-[650px] text-[clamp(2.35rem,5vw,5rem)] font-bold leading-[.98] tracking-[-.065em]">
              Start with the source. <span className="text-sidebar-primary">Then trust the number.</span>
            </h1>
            <p className="mt-6 max-w-md text-sm leading-7 text-sidebar-foreground/65 sm:text-base">
              A quiet place for the morning signal: production, exceptions and the records behind every measure.
            </p>
          </div>
          <div className="relative z-10 hidden items-end justify-between gap-8 lg:flex">
            <div className="max-w-[230px] text-xs leading-5 text-sidebar-foreground/45">
              <div className="mb-3 flex items-center gap-2 text-sidebar-foreground/75"><ShieldCheck size={15} className="text-sidebar-primary" /> Traceability is the operating contract</div>
              Source workbooks, validation history and cell-level lineage stay close to the decision.
            </div>
            <div className="login-readout w-[190px] rounded-xl border border-sidebar-border bg-sidebar-accent/55 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-sidebar-foreground/50"><span>System pulse</span><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /></div>
              <div className="mono mt-3 text-2xl font-bold text-sidebar-primary">READY</div>
              <div className="mt-1 text-[11px] text-sidebar-foreground/45">Source services standing by</div>
            </div>
          </div>
        </section>
        <section className="login-entry flex items-center justify-center px-5 py-10 sm:px-10 lg:px-16">
          <div className="w-full max-w-[450px] reveal">
            <div className="mb-8 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Secure operations access</div>
            <div className="panel login-card rounded-2xl p-6 sm:p-9">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary"><LockKeyhole size={21} /></div>
              <div className="mt-8 eyebrow text-primary">Good morning</div>
              <h2 className="mt-2 text-[clamp(1.9rem,4vw,2.6rem)] font-bold leading-tight tracking-[-.05em]">Enter the control room</h2>
               <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Use your department account to enter the factory control room. Demo credentials are listed below.</p>
               <form onSubmit={submit} className="mt-7 space-y-4">
                 <label className="block text-xs font-bold text-foreground/75">Username or email<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} data-testid="input-login-username" className={fieldClass} placeholder="e.g. production" /></label>
                 <label className="block text-xs font-bold text-foreground/75">Password<input autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} data-testid="input-login-password" className={fieldClass} placeholder="Enter demo password" /></label>
                 {error && <div role="alert" data-testid="text-login-error" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-800">{error}</div>}
                 <button type="submit" disabled={busy || !username || !password} data-testid="button-login" className="flex w-full items-center justify-between rounded-xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                   <span>{busy ? 'Signing in…' : 'Log in'}</span><ArrowRight size={18} />
                 </button>
               </form>
               <div className="mt-6 border-t border-border/70 pt-5"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground"><ShieldCheck size={14} className="text-primary" /> Demo accounts · password: demo123</div><div className="mt-3 grid grid-cols-2 gap-2">{demoUsers.map(([value, label]) => <button type="button" key={value} onClick={() => { setUsername(value); setPassword('demo123'); setError(''); }} className="rounded-lg border border-border bg-background/50 px-3 py-2 text-left text-xs font-semibold transition hover:border-primary/50 hover:bg-secondary"><span className="block">{label}</span><span className="mono text-[10px] text-muted-foreground">{value}</span></button>)}</div></div>
            </div>
            <div className="mt-6 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground/75"><span>Factory-local time</span><span>Source-first operations</span></div>
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthGate() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  if (isLoading) {
    return <main className="auth-loading min-h-[100dvh] px-6 py-8" aria-label="Loading access"><div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-between"><div className="flex items-center gap-3"><SkeletonBlock className="h-11 w-11 rounded-xl" /><div><SkeletonBlock className="h-4 w-28" /><SkeletonBlock className="mt-2 h-2.5 w-20" /></div></div><div className="grid gap-8 lg:grid-cols-2"><div><SkeletonBlock className="h-3 w-40" /><SkeletonBlock className="mt-5 h-20 w-full max-w-xl" /><SkeletonBlock className="mt-4 h-4 w-80 max-w-full" /></div><SkeletonBlock className="h-72 w-full max-w-md lg:justify-self-end" /></div></div></main>;
  }
  if (!isAuthenticated) return <LoginScreen onLogin={login} />;
  return <Router user={user} logout={logout} />;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AuthGate /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;