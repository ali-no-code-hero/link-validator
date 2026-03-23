import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { traceJobUrl } from "@/lib/playwright/trace-job-url";
import { logError, logInfo, logWarn, truncateUrl } from "@/lib/server-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Playwright navigation finished without throwing (we captured hops / errors in extra). */
function isTraceCompleted(extra: Record<string, unknown>): boolean {
  return !extra.error;
}

function isHttpOk(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 200 && statusCode < 400;
}

function explainTraceFailure(extra: Record<string, unknown>): string {
  if (extra.error) {
    return `navigation_error:${String(extra.error)}`;
  }
  return "unknown";
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  logInfo("api.click", "request", { jobId });

  const supabase = createServiceRoleClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs_fetched")
    .select("id, batch_id, job_eid, url, processing_status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    logError("api.click", "job_query_failed", jobError, { jobId });
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!job) {
    logWarn("api.click", "job_not_found", { jobId });
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  logInfo("api.click", "job_loaded", {
    jobId: job.id,
    job_eid: job.job_eid,
    url: truncateUrl(job.url),
  });

  const deviceId = randomUUID();

  let trace;
  try {
    trace = await traceJobUrl(job.url, deviceId);
  } catch (e) {
    logError("api.click", "trace_threw", e, {
      jobId: job.id,
      job_eid: job.job_eid,
      url: truncateUrl(job.url),
    });
    const message = e instanceof Error ? e.message : String(e);
    const { error: logErrorDb } = await supabase.from("click_logs").insert({
      job_eid: job.job_eid,
      job_fetched_id: job.id,
      batch_id: job.batch_id,
      initial_url: job.url,
      final_destination_url: null,
      redirect_chain: [],
      ip_address_used: null,
      user_agent_device_id: deviceId,
      status_code: null,
      extra_tracking_data: {
        error: message,
        failureStage: "playwright_launch_or_trace",
        traceCompleted: false,
        httpOk: false,
        logHint: "Check Vercel function logs for link-validator:playwright.launch or trace",
      },
    });
    if (logErrorDb) {
      logError("api.click", "click_logs_insert_failed", logErrorDb, { jobId: job.id });
      return NextResponse.json({ error: logErrorDb.message }, { status: 500 });
    }
    await supabase
      .from("jobs_fetched")
      .update({ processing_status: "failed" })
      .eq("id", job.id);

    return NextResponse.json({
      ok: false,
      httpOk: false,
      traceCompleted: false,
      jobId: job.id,
      error: message,
    });
  }

  const traceCompleted = isTraceCompleted(trace.extra_tracking_data);
  const httpOk = isHttpOk(trace.status_code);
  const traceFailureReason = traceCompleted ? undefined : explainTraceFailure(trace.extra_tracking_data);

  logInfo("api.click", "trace_result", {
    jobId: job.id,
    job_eid: job.job_eid,
    traceCompleted,
    httpOk,
    status_code: trace.status_code,
    chainLength: trace.redirect_chain.length,
    hasExtraError: Boolean(trace.extra_tracking_data.error),
  });

  if (!traceCompleted) {
    logWarn("api.click", "marking_failed_trace", {
      jobId: job.id,
      traceFailureReason,
      status_code: trace.status_code,
    });
  } else if (!httpOk) {
    logInfo("api.click", "trace_ok_http_not_ok", {
      jobId: job.id,
      status_code: trace.status_code,
      note: "Partner returned non-2xx/3xx; chain still stored for verification.",
    });
  }

  const { error: insertError } = await supabase.from("click_logs").insert({
    job_eid: job.job_eid,
    job_fetched_id: job.id,
    batch_id: job.batch_id,
    initial_url: trace.initial_url,
    final_destination_url: trace.final_destination_url,
    redirect_chain: trace.redirect_chain,
    ip_address_used: trace.ip_address_used,
    user_agent_device_id: trace.user_agent_device_id,
    status_code: trace.status_code,
    extra_tracking_data: {
      ...trace.extra_tracking_data,
      traceCompleted,
      httpOk,
      ...(traceCompleted || !traceFailureReason ? {} : { failureReason: traceFailureReason }),
    },
  });

  if (insertError) {
    logError("api.click", "click_logs_insert_failed", insertError, { jobId: job.id });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("jobs_fetched")
    .update({ processing_status: traceCompleted ? "completed" : "failed" })
    .eq("id", job.id);

  if (updateError) {
    logError("api.click", "jobs_fetched_update_failed", updateError, { jobId: job.id });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  logInfo("api.click", "done", { jobId: job.id, traceCompleted, httpOk });

  return NextResponse.json({
    ok: traceCompleted,
    httpOk,
    traceCompleted,
    jobId: job.id,
    job_eid: job.job_eid,
    final_destination_url: trace.final_destination_url,
    redirect_chain: trace.redirect_chain,
    status_code: trace.status_code,
    ip_address_used: trace.ip_address_used,
    user_agent_device_id: trace.user_agent_device_id,
    failureReason: traceFailureReason,
  });
}
