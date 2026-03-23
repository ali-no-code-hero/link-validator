import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { traceJobUrl } from "@/lib/playwright/trace-job-url";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function isTraceSuccess(
  statusCode: number | null,
  extra: Record<string, unknown>,
): boolean {
  if (extra.error) {
    return false;
  }
  if (statusCode === null) {
    return false;
  }
  return statusCode >= 200 && statusCode < 400;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const supabase = createServiceRoleClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs_fetched")
    .select("id, batch_id, job_eid, url, processing_status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const deviceId = randomUUID();

  let trace;
  try {
    trace = await traceJobUrl(job.url, deviceId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { error: logError } = await supabase.from("click_logs").insert({
      job_eid: job.job_eid,
      job_fetched_id: job.id,
      batch_id: job.batch_id,
      initial_url: job.url,
      final_destination_url: null,
      redirect_chain: [],
      ip_address_used: null,
      user_agent_device_id: deviceId,
      status_code: null,
      extra_tracking_data: { error: message, failureStage: "playwright_launch_or_trace" },
    });
    if (logError) {
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }
    await supabase
      .from("jobs_fetched")
      .update({ processing_status: "failed" })
      .eq("id", job.id);

    return NextResponse.json({
      ok: false,
      jobId: job.id,
      error: message,
    });
  }

  const success = isTraceSuccess(trace.status_code, trace.extra_tracking_data);

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
    extra_tracking_data: trace.extra_tracking_data,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("jobs_fetched")
    .update({ processing_status: success ? "completed" : "failed" })
    .eq("id", job.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: success,
    jobId: job.id,
    job_eid: job.job_eid,
    final_destination_url: trace.final_destination_url,
    redirect_chain: trace.redirect_chain,
    status_code: trace.status_code,
    ip_address_used: trace.ip_address_used,
    user_agent_device_id: trace.user_agent_device_id,
  });
}
