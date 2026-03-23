"use client";

import pLimit from "p-limit";
import { useCallback, useEffect, useRef, useState } from "react";

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

export default function Home() {
  const [count, setCount] = useState(10);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [phase, setPhase] = useState<"idle" | "harvesting" | "clicking" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    setBatchId(startJson.batchId);
    setMessage(
      `Harvested ${startJson.harvestedCount} job(s). Reason: ${startJson.stoppedReason}. Running click traces…`,
    );
    setPhase("clicking");

    const jobIds = startJson.jobs.map((j) => j.id);
    if (jobIds.length === 0) {
      setPhase("done");
      return;
    }

    const limit = pLimit(4);

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
          <p className="text-sm font-medium uppercase tracking-widest text-emerald-400/90">
            CollabWork · Partner verification
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Link Validator
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Fetch jobs from the Collabwork API, trace redirects with a labeled user agent, and store
            outbound IP and redirect chains in Supabase.
          </p>
        </header>

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
              <span className="text-emerald-300/90">OK: {status.summary.completed}</span>
              <span className="text-red-300/90">Failed: {status.summary.failed}</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
                <thead className="bg-zinc-900/80">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-300">Job</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">job_eid</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Status</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Redirects</th>
                    <th className="px-4 py-3 font-medium text-zinc-300">Final URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                  {status.jobs.map((row) => {
                    const chain = row.latestLog?.redirect_chain;
                    const chainLen = Array.isArray(chain) ? chain.length : 0;
                    const finalUrl = row.latestLog?.final_destination_url ?? "—";
                    const ok =
                      row.processing_status === "completed"
                        ? true
                        : row.processing_status === "failed"
                          ? false
                          : null;
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="px-4 py-3 text-zinc-200">
                          <div className="font-medium">{row.title ?? "—"}</div>
                          <div className="mt-1 max-w-xs truncate text-xs text-zinc-500">{row.url}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.job_eid}</td>
                        <td className="px-4 py-3">
                          {ok === null ? (
                            <span className="rounded-full bg-amber-950/60 px-2 py-0.5 text-xs text-amber-200 ring-1 ring-amber-800/60">
                              Pending
                            </span>
                          ) : ok ? (
                            <span className="rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-200 ring-1 ring-emerald-800/60">
                              Success
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-950/60 px-2 py-0.5 text-xs text-red-200 ring-1 ring-red-800/60">
                              Failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{chainLen}</td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          <span title={finalUrl === "—" ? undefined : finalUrl}>
                            {typeof finalUrl === "string" ? truncate(finalUrl, 72) : "—"}
                          </span>
                          {row.latestLog?.status_code != null ? (
                            <span className="ml-2 text-zinc-500">({row.latestLog.status_code})</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="text-sm text-zinc-500">Start a batch to see live results (polls every ~2.5s).</p>
        )}
      </div>
    </div>
  );
}
