import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  const supabase = createServiceRoleClient();

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs_fetched")
    .select("id, job_eid, title, url, processing_status, created_at")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const { data: logs, error: logsError } = await supabase
    .from("click_logs")
    .select(
      "id, job_fetched_id, job_eid, final_destination_url, status_code, timestamp, redirect_chain, extra_tracking_data",
    )
    .eq("batch_id", batchId)
    .order("timestamp", { ascending: false });

  if (logsError) {
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  const latestByJobFetched = new Map<string, (typeof logs)[0]>();
  for (const log of logs ?? []) {
    if (!log.job_fetched_id) {
      continue;
    }
    if (!latestByJobFetched.has(log.job_fetched_id)) {
      latestByJobFetched.set(log.job_fetched_id, log);
    }
  }

  const jobsWithLogs = (jobs ?? []).map((j) => ({
    ...j,
    latestLog: latestByJobFetched.get(j.id) ?? null,
  }));

  const pending = (jobs ?? []).filter((j) => j.processing_status === "pending").length;
  const completed = (jobs ?? []).filter((j) => j.processing_status === "completed").length;
  const failed = (jobs ?? []).filter((j) => j.processing_status === "failed").length;

  return NextResponse.json({
    batchId,
    summary: {
      total: jobs?.length ?? 0,
      pending,
      completed,
      failed,
    },
    jobs: jobsWithLogs,
  });
}
