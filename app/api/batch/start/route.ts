import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { harvestUniqueJobs } from "@/lib/collabwork/harvest-unique-jobs";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  count: z.number().int().min(1).max(100),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { count } = parsed.data;
  const batchId = randomUUID();

  let harvest;
  try {
    harvest = await harvestUniqueJobs(count);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Harvest failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const supabase = createServiceRoleClient();
  const rows = harvest.jobs.map((job) => ({
    batch_id: batchId,
    job_eid: job.job_eid,
    title: job.title ?? null,
    location: job.location ?? null,
    company: job.company ?? null,
    url: job.url,
    is_remote: job.is_remote ?? null,
    industry: job.industry ?? null,
    date_posted: job.date_posted ?? null,
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_period: job.salary_period ?? null,
    raw_payload: job as Record<string, unknown>,
    processing_status: "pending" as const,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("jobs_fetched").insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: inserted, error: fetchError } = await supabase
    .from("jobs_fetched")
    .select("id, job_eid, title, url, processing_status")
    .eq("batch_id", batchId);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  return NextResponse.json({
    batchId,
    requestedCount: count,
    harvestedCount: harvest.jobs.length,
    apiCalls: harvest.apiCalls,
    stoppedReason: harvest.stoppedReason,
    jobs: inserted ?? [],
  });
}
