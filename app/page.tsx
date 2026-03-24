"use client";

import Link from "next/link";
import pLimit from "p-limit";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type JobRow = {
  id: string;
  job_eid: string;
  title: string | null;
  url: string;
  processing_status: "pending" | "completed" | "failed";
  created_at: string;
  latestLog: {
    final_destination_url: string | null;
    status_code: number | null;
    redirect_chain: unknown;
    timestamp: string;
    extra_tracking_data: Record<string, unknown>;
  } | null;
};

type StatusPayload = {
  batchId: string;
  summary: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };
  jobs: JobRow[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomClickDelayMs(): number {
  return 2000 + Math.floor(Math.random() * 3001);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max - 1)}…`;
}

function SafeExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  if (!href || !/^https?:\/\//i.test(href)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "break-all text-emerald-400/90 underline hover:text-emerald-300"}
    >
      {children}
    </a>
  );
}

function RedirectChainList({ chain }: { chain: unknown }) {
  const steps = Array.isArray(chain) ? chain : [];
  if (steps.length === 0) {
    return <p className="text-xs text-zinc-500">No redirect steps recorded.</p>;
  }
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-xs text-zinc-300">
      {steps.map((step, i) => {
        const s = step as { url?: string; status?: number; type?: string };
        return (
          <li key={i} className="break-all">
            <SafeExternalLink href={s.url ?? ""}>{s.url ?? "—"}</SafeExternalLink>
            {s.status != null ? <span className="text-zinc-500"> ({s.status})</span> : null}
            {s.type ? <span className="text-zinc-600"> · {String(s.type)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ProxyEgressBadge({ extra }: { extra: Record<string, unknown> | null | undefined }) {
  if (!extra) {
    return <span className="text-zinc-600">—</span>;
  }
  const check = extra.proxyEgressCheck as
    | {
        proxyIpDistinctFromDirect?: boolean;
        proxySameAsDirectSuspected?: boolean;
        directEgressIp?: string | null;
        proxyEgressIp?: string | null;
      }
    | undefined;
  const used = extra.proxyUsed === true;
  if (!used && !check) {
    return <span className="text-zinc-600">—</span>;
  }
  if (check?.proxyIpDistinctFromDirect) {
    return (
      <span
        className="text-xs text-emerald-300/90"
        title={`Server egress ${check.directEgressIp ?? "?"} vs proxy check ${check.proxyEgressIp ?? "?"}`}
      >
        Proxy egress ✓
      </span>
    );
  }
  if (check?.proxySameAsDirectSuspected) {
    return (
      <span
        className="text-xs text-amber-300/90"
        title="Direct and proxy IP resolution matched — verify LINK_VALIDATOR_PROXY_URL"
      >
        Same as direct IP
      </span>
    );
  }
  if (used) {
    return <span className="text-xs text-zinc-500">Proxy check incomplete</span>;
  }
  return <span className="text-zinc-600">—</span>;
}

export default function Home() {
  const [count, setCount] = useState(10);
  const [batchLookupInput, setBatchLookupInput] = useState("");
  const [loadingBatchLookup, setLoadingBatchLookup] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [phase, setPhase] = useState<"idle" | "harvesting" | "clicking" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didReadBatchQuery = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/batch/${id}/status`, { cache: "no-store" });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      throw new Error(j.error ?? res.statusText);
    }
    const data = (await res.json()) as StatusPayload;
    setStatus(data);
    return data;
  }, []);

  const syncBatchToUrl = useCallback((id: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.set("batch", id);
    window.history.replaceState({}, "", u.toString());
  }, []);

  useEffect(() => {
    if (didReadBatchQuery.current) {
      return;
    }
    didReadBatchQuery.current = true;
    if (typeof window === "undefined") {
      return;
    }
    const b = new URLSearchParams(window.location.search).get("batch")?.trim();
    if (b) {
      setBatchLookupInput(b);
      setBatchId(b);
      void fetchStatus(b).catch(() => {
        setLastError("Could not load batch from URL.");
      });
    }
  }, [fetchStatus]);

  useEffect(() => {
    if (!batchId) {
      return;
    }
    stopPolling();
    pollRef.current = setInterval(() => {
      void fetchStatus(batchId).catch(() => {
        // keep UI; errors surfaced on manual actions
      });
    }, 2500);
    void fetchStatus(batchId);
    return () => {
      stopPolling();
    };
  }, [batchId, fetchStatus, stopPolling]);

  const loadBatchById = async () => {
    const id = batchLookupInput.trim();
    if (!id) {
      return;
    }
    setLastError(null);
    setLoadingBatchLookup(true);
    try {
      await fetchStatus(id);
      setBatchId(id);
      setMessage(`Loaded batch ${id}.`);
      setPhase("done");
      syncBatchToUrl(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load failed";
      setLastError(msg);
      setStatus(null);
      setBatchId(null);
    } finally {
      setLoadingBatchLookup(false);
    }
  };

  const startProcess = async () => {
    setLastError(null);
    setMessage(null);
    setPhase("harvesting");
    setBatchId(null);
    setStatus(null);

    let startJson: {
      batchId: string;
      jobs: { id: string }[];
      harvestedCount: number;
      stoppedReason: string;
    };

    try {
      const res = await fetch("/api/batch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const json = (await res.json()) as typeof startJson & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to start batch");
      }
      startJson = json;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Start failed";
      setLastError(msg);
      setPhase("error");
      return;
    }

    setBatchLookupInput(startJson.batchId);
    setBatchId(startJson.batchId);
    syncBatchToUrl(startJson.batchId);
    setMessage(
      `Harvested ${startJson.harvestedCount} job(s). Reason: ${startJson.stoppedReason}. Running click traces…`,
    );
    setPhase("clicking");

    const jobIds = startJson.jobs.map((j) => j.id);
    if (jobIds.length === 0) {
      setPhase("done");
      return;
    }

    // One click at a time: concurrent Playwright + Sparticuz on Vercel causes ETXTBSY and
    // net::ERR_INSUFFICIENT_RESOURCES from overlapping /tmp chromium and memory pressure.
    const limit = pLimit(1);

    try {
      await Promise.all(
        jobIds.map((jobId) =>
          limit(async () => {
            await sleep(randomClickDelayMs());
            const res = await fetch(`/api/click/${jobId}`, { method: "POST" });
            if (!res.ok) {
              const j = (await res.json()) as { error?: string };
              throw new Error(j.error ?? res.statusText);
            }
            await fetchStatus(startJson.batchId);
          }),
        ),
      );
      await fetchStatus(startJson.batchId);
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Click run failed";
      setLastError(msg);
      setPhase("error");
      await fetchStatus(startJson.batchId).catch(() => undefined);
    }
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-10 border-b border-zinc-800 pb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-emerald-400/90">
                CollabWork · Partner verification
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Link Validator
              </h1>
            </div>
            <Link
              href="/analytics"
              className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-emerald-800/60 hover:text-emerald-300/90"
            >
              Analytics
            </Link>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Fetch jobs from the Collabwork API, trace redirects in a real desktop Chrome user agent, optionally
            through a residential proxy with per-click egress checks, and store results in Supabase.
          </p>
        </header>

        <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="text-sm font-semibold text-zinc-200">Load existing batch</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Paste a batch UUID from a previous run. You can also open{" "}
            <code className="text-zinc-400">?batch=YOUR_UUID</code> in the URL.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="text"
              value={batchLookupInput}
              onChange={(e) => setBatchLookupInput(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none ring-emerald-500/30 focus:border-emerald-500/50 focus:ring-2"
            />
            <button
              type="button"
              onClick={() => void loadBatchById()}
              disabled={loadingBatchLookup || !batchLookupInput.trim()}
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 px-5 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingBatchLookup ? "Loading…" : "Load batch"}
            </button>
          </div>
        </section>

        <section className="mb-10 flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label htmlFor="job-count" className="block text-sm font-medium text-zinc-300">
              How many jobs should be clicked/tested?
            </label>
            <input
              id="job-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-2 w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:border-emerald-500/50 focus:ring-2"
            />
          </div>
          <button
            type="button"
            onClick={() => void startProcess()}
            disabled={phase === "harvesting" || phase === "clicking"}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "harvesting" || phase === "clicking" ? "Running…" : "Start process"}
          </button>
        </section>

        {message ? (
          <p className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
            {message}
          </p>
        ) : null}
        {lastError ? (
          <p className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {lastError}
          </p>
        ) : null}

        {status ? (
          <section>
            <div className="mb-4 flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>
                Batch: <code className="text-zinc-200">{status.batchId}</code>
              </span>
              <span>Total: {status.summary.total}</span>
              <span className="text-amber-300/90">Pending: {status.summary.pending}</span>
              <span className="text-emerald-300/90" title="Finished Playwright run (including final HTTP 403 etc.)">
                Traced: {status.summary.completed}
              </span>
              <span className="text-red-300/90">Failed: {status.summary.failed}</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
                <thead className="bg-zinc-900/80">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-300">Job</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">job_eid</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Status</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Proxy check</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Redirects</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Final URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                  {status.jobs.map((row) => {
                    const chain = row.latestLog?.redirect_chain;
                    const chainLen = Array.isArray(chain) ? chain.length : 0;
                    const finalUrl = row.latestLog?.final_destination_url ?? "—";
                    const extra = row.latestLog?.extra_tracking_data;
                    const httpOk =
                      typeof extra?.httpOk === "boolean"
                        ? extra.httpOk
                        : row.latestLog?.status_code != null &&
                          row.latestLog.status_code >= 200 &&
                          row.latestLog.status_code < 400;
                    const traceDone = row.processing_status === "completed";
                    const traceFailed = row.processing_status === "failed";
                    return (
                      <Fragment key={row.id}>
                        <tr className="align-top">
                          <td className="px-4 py-3 text-zinc-200">
                            <div className="font-medium">{row.title ?? "—"}</div>
                            <div className="mt-1 max-w-md text-xs break-all text-zinc-400">
                              <SafeExternalLink href={row.url}>{truncate(row.url, 120)}</SafeExternalLink>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.job_eid}</td>
                          <td className="px-4 py-3">
                            {!traceDone && !traceFailed ? (
                              <span className="rounded-full bg-amber-950/60 px-2 py-0.5 text-xs text-amber-200 ring-1 ring-amber-800/60">
                                Pending
                              </span>
                            ) : traceFailed ? (
                              <span className="rounded-full bg-red-950/60 px-2 py-0.5 text-xs text-red-200 ring-1 ring-red-800/60">
                                Failed
                              </span>
                            ) : httpOk ? (
                              <span className="rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-200 ring-1 ring-emerald-800/60">
                                OK
                              </span>
                            ) : (
                              <span
                                className="rounded-full bg-amber-950/60 px-2 py-0.5 text-xs text-amber-100 ring-1 ring-amber-800/60"
                                title="Redirect chain stored; final HTTP status is not 2xx/3xx"
                              >
                                Traced · HTTP {row.latestLog?.status_code ?? "?"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <ProxyEgressBadge extra={extra} />
                          </td>
                          <td className="px-4 py-3 text-zinc-300">{chainLen}</td>
                          <td className="px-4 py-3 text-xs text-zinc-400">
                            {typeof finalUrl === "string" && finalUrl !== "—" ? (
                              <SafeExternalLink href={finalUrl}>{truncate(finalUrl, 72)}</SafeExternalLink>
                            ) : (
                              <span>—</span>
                            )}
                            {row.latestLog?.status_code != null ? (
                              <span className="ml-2 text-zinc-500">({row.latestLog.status_code})</span>
                            ) : null}
                          </td>
                        </tr>
                        <tr className="bg-zinc-900/25">
                          <td colSpan={6} className="border-t border-zinc-800/80 px-4 py-3">
                            <details className="group">
                              <summary className="cursor-pointer text-sm font-medium text-emerald-400/90">
                                Redirect chain ({chainLen} steps)
                              </summary>
                              <div className="mt-3 border-l-2 border-emerald-800/50 pl-3">
                                <RedirectChainList chain={chain} />
                              </div>
                            </details>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="text-sm text-zinc-500">
            Start a batch, load one by ID, or use <code className="text-zinc-400">?batch=…</code> in the URL.
            Results poll every ~2.5s while a batch is active.
          </p>
        )}
      </div>
    </div>
  );
}
