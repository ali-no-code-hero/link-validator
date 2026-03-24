"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type ClickDay = {
  date: string;
  clicks: number;
  ok2xx: number;
  redirect3xx: number;
  client4xx: number;
  server5xx: number;
  noStatus: number;
  navErrors: number;
  /** app.collabwork.com URL containing job=closed (closed job landing). */
  collabworkJobClosed: number;
  /** Any other non-empty final_destination_url. */
  finalUrlOther: number;
  /** Null or empty final_destination_url. */
  finalUrlNull: number;
};

type BatchDay = {
  date: string;
  batches: number;
  jobsHarvested: number;
};

type AnalyticsPayload = {
  rangeDays: number;
  clickSeries: ClickDay[];
  batchSeries: BatchDay[];
  totals: {
    clicks: number;
    jobsHarvested: number;
    distinctBatches: number;
    collabworkJobClosed: number;
    finalUrlOther: number;
    finalUrlNull: number;
  };
};

type MergedRow = ClickDay & BatchDay;

function utcDateStringsInclusive(numDays: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = numDays - 1; i >= 0; i--) {
    const ms = endUtc - i * 86_400_000;
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

function mergeSeries(days: number, payload: AnalyticsPayload): MergedRow[] {
  const clickMap = new Map(payload.clickSeries.map((c) => [c.date, c]));
  const batchMap = new Map(payload.batchSeries.map((b) => [b.date, b]));
  return utcDateStringsInclusive(days).map((date) => {
    const c = clickMap.get(date);
    const b = batchMap.get(date);
    return {
      date,
      clicks: c?.clicks ?? 0,
      ok2xx: c?.ok2xx ?? 0,
      redirect3xx: c?.redirect3xx ?? 0,
      client4xx: c?.client4xx ?? 0,
      server5xx: c?.server5xx ?? 0,
      noStatus: c?.noStatus ?? 0,
      navErrors: c?.navErrors ?? 0,
      collabworkJobClosed: c?.collabworkJobClosed ?? 0,
      finalUrlOther: c?.finalUrlOther ?? 0,
      finalUrlNull: c?.finalUrlNull ?? 0,
      batches: b?.batches ?? 0,
      jobsHarvested: b?.jobsHarvested ?? 0,
    };
  });
}

const DEST_KEYS = [
  {
    key: "collabworkJobClosed" as const,
    label: "CollabWORK · job=closed",
    className: "bg-rose-500/85",
  },
  { key: "finalUrlOther" as const, label: "Other final URL", className: "bg-cyan-600/80" },
  { key: "finalUrlNull" as const, label: "No final URL", className: "bg-zinc-600/80" },
];

const STACK_KEYS = [
  { key: "ok2xx" as const, label: "2xx", className: "bg-emerald-500/80" },
  { key: "redirect3xx" as const, label: "3xx", className: "bg-sky-500/80" },
  { key: "client4xx" as const, label: "4xx", className: "bg-amber-500/80" },
  { key: "server5xx" as const, label: "5xx", className: "bg-red-500/80" },
  { key: "noStatus" as const, label: "No status", className: "bg-zinc-500/80" },
  { key: "navErrors" as const, label: "Nav error", className: "bg-fuchsia-600/80" },
];

function formatShortDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${m}/${d}`;
}

/** e.g. Mar 24 — easier to scan than 03/24 alone */
function formatAxisDate(isoDate: string): string {
  const [y, mo, day] = isoDate.split("-").map(Number);
  if (!y || !mo || !day) {
    return formatShortDate(isoDate);
  }
  return new Date(Date.UTC(y, mo - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Avoid crowding on 30/90 day views */
function showXAxisLabel(index: number, total: number): boolean {
  if (total <= 14) {
    return true;
  }
  if (total <= 31) {
    return index % 2 === 0 || index === total - 1;
  }
  const step = Math.ceil(total / 12);
  return index % step === 0 || index === total - 1;
}

const CHART_PLOT_H = 200;
const AXIS_H = 52;
/** Reserve space above bars for value labels so bar height uses a fixed pixel scale (avoids broken % inside flex). */
const CHART_VALUE_ROW_H = 22;

type ChartTooltipProps = {
  label: string;
  lines: string[];
  children: ReactNode;
  /** Stacked bars have no inner button; make the column focusable for keyboard tooltip. */
  keyboardColumn?: boolean;
};

/** Hover or keyboard focus (focus-within) shows tooltip. */
function ChartTooltip({ label, lines, children, keyboardColumn }: ChartTooltipProps) {
  return (
    <div
      tabIndex={keyboardColumn ? 0 : undefined}
      className="group/chartcol relative flex min-w-[12px] max-w-[3rem] flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
    >
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-zinc-600 bg-zinc-900 px-2.5 py-2 text-left text-[11px] leading-snug text-zinc-100 opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover/chartcol:opacity-100 group-focus-within/chartcol:opacity-100"
      >
        <p className="font-semibold text-emerald-200/95">{label}</p>
        <ul className="mt-1 space-y-0.5 text-zinc-300">
          {lines.map((line, i) => (
            <li key={`${i}-${line.slice(0, 24)}`} className="font-mono text-[10px] text-zinc-400">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Shared time-series column chart: Y ticks, grid, scroll on dense ranges, values on bars. */
function SimpleBarChart({
  rows,
  maxValue,
  getValue,
  barClassName,
  unit,
  formatTitle,
}: {
  rows: MergedRow[];
  maxValue: number;
  getValue: (r: MergedRow) => number;
  barClassName: string;
  unit: string;
  /** Override native tooltip text per column */
  formatTitle?: (r: MergedRow, value: number) => string;
}) {
  const max = Math.max(1, maxValue);
  const mid = Math.round(max / 2);
  const plotInnerH = CHART_PLOT_H - CHART_VALUE_ROW_H;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
      <div
        className="flex h-[calc(var(--plot)+var(--axis))] w-full shrink-0 flex-row justify-between gap-2 sm:h-auto sm:w-14 sm:flex-col sm:justify-between sm:py-1 sm:pr-1 sm:pb-[calc(var(--axis)+4px)]"
        style={
          {
            "--plot": `${CHART_PLOT_H}px`,
            "--axis": `${AXIS_H}px`,
          } as React.CSSProperties
        }
      >
        <span className="text-right text-[11px] font-semibold tabular-nums text-zinc-300 sm:pt-1">{max}</span>
        <span className="hidden text-right text-[11px] tabular-nums text-zinc-500 sm:block">{mid}</span>
        <span className="text-right text-[11px] tabular-nums text-zinc-500 sm:pb-[calc(var(--axis)+2px)]">
          0
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/70 shadow-inner shadow-black/20">
        <div className="inline-block min-w-full px-2 sm:px-3">
          <div
            className="relative border-b border-zinc-700/90"
            style={{ height: CHART_PLOT_H }}
          >
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-0 pt-2"
              aria-hidden
            >
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-t border-dashed border-zinc-800/90" />
              ))}
            </div>
            <div
              className="relative flex items-end justify-stretch gap-1.5"
              style={{ height: CHART_PLOT_H, paddingTop: 8 }}
            >
              {rows.map((r) => {
                const v = getValue(r);
                const barPx = Math.round((v / max) * plotInnerH);
                const h = Math.max(v > 0 ? 3 : 0, barPx);
                const tip = formatTitle ? formatTitle(r, v) : `${r.date} — ${v} ${unit}`;
                return (
                  <ChartTooltip key={r.date} label={formatAxisDate(r.date)} lines={[tip, `Scale: 0–${max} ${unit}`]}>
                    <div className="flex h-full min-h-0 min-w-[12px] max-w-[3rem] flex-1 flex-col items-center justify-end">
                      <div
                        className="flex w-full flex-col items-center justify-end"
                        style={{ height: CHART_VALUE_ROW_H }}
                      >
                        {v > 0 ? (
                          <span className="text-center text-[10px] font-semibold tabular-nums text-zinc-300 sm:text-[11px]">
                            {v}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="flex w-full flex-col justify-end"
                        style={{ height: plotInnerH }}
                      >
                        {v > 0 ? (
                          <button
                            type="button"
                            aria-label={tip}
                            className={`group w-full max-w-[2.75rem] self-center rounded-t-sm ${barClassName} cursor-pointer transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/80`}
                            style={{ height: h }}
                          />
                        ) : (
                          <div className="w-full max-w-[2.75rem] self-center" style={{ height: 0 }} aria-hidden />
                        )}
                      </div>
                    </div>
                  </ChartTooltip>
                );
              })}
            </div>
          </div>
          <div
            className="flex justify-stretch gap-1.5 border-t border-zinc-800/80 pt-2 pb-2"
            style={{ minHeight: AXIS_H }}
          >
            {rows.map((r, i) => (
              <div
                key={`x-${r.date}`}
                className="flex min-w-[12px] max-w-[3rem] flex-1 flex-col items-center justify-start"
              >
                {showXAxisLabel(i, rows.length) ? (
                  <span className="block max-h-[48px] w-[3.25rem] -rotate-45 text-center text-[10px] leading-tight text-zinc-500 sm:text-[11px]">
                    {formatAxisDate(r.date)}
                  </span>
                ) : (
                  <span className="block h-3 w-px" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type StackKey = { key: keyof MergedRow; label: string; className: string };

function StackedBarChart({
  rows,
  maxStack,
  keys,
}: {
  rows: MergedRow[];
  maxStack: number;
  keys: StackKey[];
}) {
  const max = Math.max(1, maxStack);
  const mid = Math.round(max / 2);
  const plotInnerH = CHART_PLOT_H - CHART_VALUE_ROW_H;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
      <div
        className="flex h-[calc(var(--plot)+var(--axis))] w-full shrink-0 flex-row justify-between gap-2 sm:h-auto sm:w-14 sm:flex-col sm:justify-between sm:py-1 sm:pr-1 sm:pb-[calc(var(--axis)+4px)]"
        style={
          {
            "--plot": `${CHART_PLOT_H}px`,
            "--axis": `${AXIS_H}px`,
          } as React.CSSProperties
        }
      >
        <span className="text-right text-[11px] font-semibold tabular-nums text-zinc-300 sm:pt-1">{max}</span>
        <span className="hidden text-right text-[11px] tabular-nums text-zinc-500 sm:block">{mid}</span>
        <span className="text-right text-[11px] tabular-nums text-zinc-500 sm:pb-[calc(var(--axis)+2px)]">
          0
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/70 shadow-inner shadow-black/20">
        <div className="inline-block min-w-full px-2 sm:px-3">
          <div className="relative border-b border-zinc-700/90" style={{ height: CHART_PLOT_H }}>
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-0 pt-2"
              aria-hidden
            >
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-t border-dashed border-zinc-800/90" />
              ))}
            </div>
            <div className="relative flex items-end gap-1.5" style={{ height: CHART_PLOT_H, paddingTop: 8 }}>
              {rows.map((r) => {
                const stackTotal = keys.reduce((s, k) => s + (Number(r[k.key]) || 0), 0);
                const totalBarPx = Math.round((stackTotal / max) * plotInnerH);
                const stackPx = Math.max(stackTotal > 0 ? 3 : 0, totalBarPx);
                const lines = [
                  `Total: ${stackTotal}`,
                  ...keys.map((k) => `${k.label}: ${Number(r[k.key]) || 0}`),
                  `Scale: 0–${max}`,
                ];
                return (
                  <ChartTooltip keyboardColumn key={r.date} label={formatAxisDate(r.date)} lines={lines}>
                    <div className="flex h-full min-h-0 min-w-[12px] max-w-[3rem] flex-1 flex-col items-center justify-end">
                      <div
                        className="flex w-full flex-col items-center justify-end"
                        style={{ height: CHART_VALUE_ROW_H }}
                      >
                        {stackTotal > 0 ? (
                          <span className="text-center text-[10px] font-semibold tabular-nums text-zinc-400 sm:text-[11px]">
                            {stackTotal}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="flex w-full flex-col justify-end"
                        style={{ height: plotInnerH }}
                      >
                        <div
                          className="flex w-full max-w-[2.75rem] flex-col-reverse overflow-hidden rounded-t-sm self-center"
                          style={{ height: stackPx }}
                        >
                          {keys.map(({ key, className }) => {
                            const v = Number(r[key]) || 0;
                            if (v <= 0 || stackTotal <= 0) {
                              return null;
                            }
                            return (
                              <div
                                key={String(key)}
                                className={`${className} w-full min-h-[2px] transition hover:brightness-110`}
                                style={{
                                  flexGrow: v,
                                  flexBasis: 0,
                                  flexShrink: 0,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </ChartTooltip>
                );
              })}
            </div>
          </div>
          <div
            className="flex justify-stretch gap-1.5 border-t border-zinc-800/80 pt-2 pb-2"
            style={{ minHeight: AXIS_H }}
          >
            {rows.map((r, i) => (
              <div
                key={`sx-${r.date}`}
                className="flex min-w-[12px] max-w-[3rem] flex-1 flex-col items-center justify-start"
              >
                {showXAxisLabel(i, rows.length) ? (
                  <span className="block max-h-[48px] w-[3.25rem] -rotate-45 text-center text-[10px] leading-tight text-zinc-500 sm:text-[11px]">
                    {formatAxisDate(r.date)}
                  </span>
                ) : (
                  <span className="block h-3 w-px" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
      {items.map(({ label, className }) => (
        <span key={label} className="inline-flex items-center gap-2 text-zinc-400">
          <span className={`h-3 w-3 shrink-0 rounded-sm ${className}`} />
          <span className="leading-tight">{label}</span>
        </span>
      ))}
    </div>
  );
}

function SectionIntro({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <h2 className="text-base font-semibold tracking-tight text-zinc-100">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-zinc-500">{children}</div>
    </>
  );
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizePayload(raw: AnalyticsPayload & Record<string, unknown>): AnalyticsPayload {
  const mapClick = (c: Record<string, unknown>): ClickDay => ({
    date: String(c.date),
    clicks: toNum(c.clicks),
    ok2xx: toNum(c.ok2xx),
    redirect3xx: toNum(c.redirect3xx),
    client4xx: toNum(c.client4xx),
    server5xx: toNum(c.server5xx),
    noStatus: toNum(c.noStatus),
    navErrors: toNum(c.navErrors),
    collabworkJobClosed: toNum(c.collabworkJobClosed),
    finalUrlOther: toNum(c.finalUrlOther),
    finalUrlNull: toNum(c.finalUrlNull),
  });
  const mapBatch = (b: Record<string, unknown>): BatchDay => ({
    date: String(b.date),
    batches: toNum(b.batches),
    jobsHarvested: toNum(b.jobsHarvested),
  });
  const totalsRaw = raw.totals as Record<string, unknown> | undefined;
  return {
    rangeDays: toNum(raw.rangeDays) || 30,
    clickSeries: Array.isArray(raw.clickSeries)
      ? raw.clickSeries.map((x) => mapClick(x as Record<string, unknown>))
      : [],
    batchSeries: Array.isArray(raw.batchSeries)
      ? raw.batchSeries.map((x) => mapBatch(x as Record<string, unknown>))
      : [],
    totals: {
      clicks: toNum(totalsRaw?.clicks),
      jobsHarvested: toNum(totalsRaw?.jobsHarvested),
      distinctBatches: toNum(totalsRaw?.distinctBatches),
      collabworkJobClosed: toNum(totalsRaw?.collabworkJobClosed),
      finalUrlOther: toNum(totalsRaw?.finalUrlOther),
      finalUrlNull: toNum(totalsRaw?.finalUrlNull),
    },
  };
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/timeseries?days=${d}`, { cache: "no-store" });
      const json = (await res.json()) as AnalyticsPayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? res.statusText);
      }
      setData(normalizePayload(json));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const rows = useMemo(() => (data ? mergeSeries(days, data) : []), [data, days]);

  const maxClicks = useMemo(() => Math.max(1, ...rows.map((r) => r.clicks)), [rows]);
  const maxJobs = useMemo(() => Math.max(1, ...rows.map((r) => r.jobsHarvested)), [rows]);

  const maxStack = useMemo(
    () =>
      Math.max(
        1,
        ...rows.map((r) =>
          STACK_KEYS.reduce((s, { key }) => s + r[key], 0),
        ),
      ),
    [rows],
  );

  const maxDestStack = useMemo(
    () =>
      Math.max(
        1,
        ...rows.map((r) => DEST_KEYS.reduce((s, { key }) => s + r[key], 0)),
      ),
    [rows],
  );

  const closedSharePct = useMemo(() => {
    const t = data?.totals;
    if (!t || t.clicks <= 0) {
      return null;
    }
    return Math.round((t.collabworkJobClosed / t.clicks) * 1000) / 10;
  }, [data?.totals]);

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <nav className="mb-8 flex flex-wrap items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-zinc-400 underline decoration-zinc-600 underline-offset-4 hover:text-emerald-400/90"
          >
            ← Dashboard
          </Link>
          <span className="text-zinc-600">|</span>
          <span className="font-medium text-zinc-300">Analytics</span>
        </nav>

        <header className="mb-10 border-b border-zinc-800 pb-8">
          <p className="text-sm font-medium uppercase tracking-widest text-emerald-400/90">
            CollabWork · Partner verification
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Analytics over time
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Daily aggregates from Supabase (<code className="text-zinc-500">click_logs</code>,{" "}
            <code className="text-zinc-500">jobs_fetched</code>), UTC dates. Final URL is split into:{" "}
            <span className="text-zinc-300">app.collabwork.com</span> with{" "}
            <code className="text-zinc-500">job=closed</code> (e.g. listings that resolve to a closed job
            page) vs other destinations vs missing URL. Re-run{" "}
            <code className="text-zinc-500">002_analytics_timeseries.sql</code> after pulling changes if the
            API errors.
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-500">Range</span>
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                days === d
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              Last {d} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(days)}
            disabled={loading}
            className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="mb-8 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-4 text-sm text-red-200">
            <p className="font-medium">Could not load analytics</p>
            <p className="mt-2 font-mono text-xs text-red-300/90">{error}</p>
            <p className="mt-3 text-xs text-red-200/80">
              Create the RPC in Supabase: SQL editor → run{" "}
              <code className="text-red-100/90">supabase/migrations/002_analytics_timeseries.sql</code>
            </p>
          </div>
        ) : null}

        {data?.totals ? (
          <div className="mb-10 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Clicks traced</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.totals.clicks}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Jobs harvested</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.totals.jobsHarvested}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Distinct batches</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.totals.distinctBatches}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-rose-200/80">
                  Ended on CollabWORK · job=closed
                </p>
                <p className="mt-1 text-2xl font-semibold text-rose-100">{data.totals.collabworkJobClosed}</p>
                {closedSharePct != null ? (
                  <p className="mt-1 text-xs text-rose-200/60">{closedSharePct}% of clicks in range</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Other final URL</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.totals.finalUrlOther}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">No final URL</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.totals.finalUrlNull}</p>
              </div>
            </div>
          </div>
        ) : null}

        {loading && !data ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : rows.length > 0 ? (
          <>
            <section className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
              <SectionIntro title="Clicks per day">
                <p>
                  Bar height is proportional to trace count (pixel scale, 0 → max on the axis). Dates are{" "}
                  <strong className="text-zinc-400">UTC</strong>. Hover or focus a bar for the exact value;
                  scroll horizontally on narrow screens when the range has many days.
                </p>
              </SectionIntro>
              <div className="mt-6">
                <SimpleBarChart
                  rows={rows}
                  maxValue={maxClicks}
                  getValue={(r) => r.clicks}
                  barClassName="bg-emerald-500/75 shadow-sm shadow-emerald-900/30"
                  unit="clicks"
                />
              </div>
            </section>

            <section className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
              <SectionIntro title="Final URL: CollabWORK job=closed vs other">
                <p>
                  From <code className="text-zinc-400">final_destination_url</code>.{" "}
                  <strong className="text-rose-200/90">Closed</strong> ={" "}
                  <code className="text-zinc-400">app.collabwork.com</code> and query contains{" "}
                  <code className="text-zinc-400">job=closed</code>. The three buckets partition every click.
                  Number above each bar is the daily total. Hover a column (or Tab to focus) for a per-bucket
                  breakdown.
                </p>
              </SectionIntro>
              <Legend items={DEST_KEYS} />
              <div className="mt-5">
                <StackedBarChart
                  rows={rows}
                  maxStack={maxDestStack}
                  keys={DEST_KEYS}
                />
              </div>
            </section>

            <section className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
              <SectionIntro title="HTTP outcome mix (per day)">
                <p>
                  Stacked counts from final <code className="text-zinc-400">status_code</code> and navigation
                  errors. Categories can overlap (e.g. recorded status plus a trace error in{" "}
                  <code className="text-zinc-400">extra_tracking_data</code>). Hover or Tab-focus a column for
                  counts per category.
                </p>
              </SectionIntro>
              <Legend items={STACK_KEYS} />
              <div className="mt-5">
                <StackedBarChart rows={rows} maxStack={maxStack} keys={STACK_KEYS} />
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-7">
              <SectionIntro title="Jobs harvested per day">
                <p>
                  Rows inserted into <code className="text-zinc-400">jobs_fetched</code> per UTC day. Hover a
                  column for batch + job counts.
                </p>
              </SectionIntro>
              <div className="mt-6">
                <SimpleBarChart
                  rows={rows}
                  maxValue={maxJobs}
                  getValue={(r) => r.jobsHarvested}
                  barClassName="bg-sky-500/70 shadow-sm shadow-sky-900/30"
                  unit="jobs"
                  formatTitle={(r, v) =>
                    `${r.date} — ${v} jobs harvested · ${r.batches} batch(es)`
                  }
                />
              </div>
            </section>
          </>
        ) : !loading ? (
          <p className="text-sm text-zinc-500">No rows in range.</p>
        ) : null}
      </div>
    </div>
  );
}
