"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ClickDay = {
  date: string;
  clicks: number;
  ok2xx: number;
  redirect3xx: number;
  client4xx: number;
  server5xx: number;
  noStatus: number;
  navErrors: number;
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
      batches: b?.batches ?? 0,
      jobsHarvested: b?.jobsHarvested ?? 0,
    };
  });
}

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
            <code className="text-zinc-500">jobs_fetched</code>), UTC dates. Run migration{" "}
            <code className="text-zinc-500">002_analytics_timeseries.sql</code> if the API errors.
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
          <div className="mb-10 grid gap-4 sm:grid-cols-3">
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
        ) : null}

        {loading && !data ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : rows.length > 0 ? (
          <>
            <section className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="text-sm font-semibold text-zinc-200">Clicks per day</h2>
              <p className="mt-1 text-xs text-zinc-500">Height = volume; labels are MM/DD (UTC).</p>
              <div className="mt-6 flex h-52 items-end gap-px sm:gap-1">
                {rows.map((r) => (
                  <div
                    key={r.date}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end"
                    title={`${r.date}: ${r.clicks} clicks`}
                  >
                    <div
                      className="w-full max-w-[28px] rounded-t bg-emerald-500/70 transition hover:bg-emerald-400/80"
                      style={{ height: `${(r.clicks / maxClicks) * 100}%`, minHeight: r.clicks > 0 ? 4 : 0 }}
                    />
                    <span className="mt-2 hidden text-[10px] text-zinc-600 sm:block">
                      {formatShortDate(r.date)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="text-sm font-semibold text-zinc-200">HTTP outcome mix (per day)</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Stacked counts from final <code className="text-zinc-600">status_code</code> and navigation errors.
                Categories are not mutually exclusive (e.g. error + status).
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs">
                {STACK_KEYS.map(({ label, className }) => (
                  <span key={label} className="flex items-center gap-1.5 text-zinc-400">
                    <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
                    {label}
                  </span>
                ))}
              </div>
              <div className="mt-6 flex h-56 items-end gap-px sm:gap-1">
                {rows.map((r) => {
                  const stackTotal = STACK_KEYS.reduce((s, { key }) => s + r[key], 0);
                  return (
                    <div
                      key={r.date}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${r.date}`}
                    >
                      <div
                        className="flex w-full max-w-[28px] flex-col-reverse overflow-hidden rounded-t"
                        style={{
                          height: `${stackTotal > 0 ? (stackTotal / maxStack) * 100 : 0}%`,
                          minHeight: stackTotal > 0 ? 4 : 0,
                        }}
                      >
                        {STACK_KEYS.map(({ key, className }) => {
                          const v = r[key];
                          if (v <= 0) {
                            return null;
                          }
                          const pct = (v / stackTotal) * 100;
                          return (
                            <div
                              key={key}
                              className={`${className} w-full`}
                              style={{ height: `${pct}%`, minHeight: 2 }}
                              title={`${key}: ${v}`}
                            />
                          );
                        })}
                      </div>
                      <span className="mt-2 hidden text-[10px] text-zinc-600 sm:block">
                        {formatShortDate(r.date)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <h2 className="text-sm font-semibold text-zinc-200">Jobs harvested per day</h2>
              <div className="mt-6 flex h-52 items-end gap-px sm:gap-1">
                {rows.map((r) => (
                  <div
                    key={`j-${r.date}`}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end"
                    title={`${r.date}: ${r.jobsHarvested} jobs, ${r.batches} batches`}
                  >
                    <div
                      className="w-full max-w-[28px] rounded-t bg-sky-500/60 transition hover:bg-sky-400/70"
                      style={{
                        height: `${(r.jobsHarvested / maxJobs) * 100}%`,
                        minHeight: r.jobsHarvested > 0 ? 4 : 0,
                      }}
                    />
                    <span className="mt-2 hidden text-[10px] text-zinc-600 sm:block">
                      {formatShortDate(r.date)}
                    </span>
                  </div>
                ))}
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
