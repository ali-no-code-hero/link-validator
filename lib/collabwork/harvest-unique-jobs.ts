import { searchJobs, type CollabworkJob } from "@/lib/collabwork/client";
import { randomSearchQuery } from "@/lib/collabwork/query-generator";

const MAX_API_CALLS = 200;
const DEFAULT_PER_PAGE = 10;

export type HarvestResult = {
  jobs: CollabworkJob[];
  apiCalls: number;
  stoppedReason: "target_reached" | "max_api_calls";
};

export async function harvestUniqueJobs(targetCount: number): Promise<HarvestResult> {
  const seen = new Set<string>();
  const jobs: CollabworkJob[] = [];
  let apiCalls = 0;

  while (seen.size < targetCount && apiCalls < MAX_API_CALLS) {
    const query = randomSearchQuery();
    const page = Math.floor(Math.random() * 15) + 1;
    const batch = await searchJobs({
      query,
      page,
      per_page: DEFAULT_PER_PAGE,
    });
    apiCalls += 1;

    for (const job of batch) {
      if (!seen.has(job.job_eid)) {
        seen.add(job.job_eid);
        jobs.push(job);
        if (jobs.length >= targetCount) {
          return {
            jobs,
            apiCalls,
            stoppedReason: "target_reached",
          };
        }
      }
    }
  }

  return {
    jobs,
    apiCalls,
    stoppedReason: jobs.length >= targetCount ? "target_reached" : "max_api_calls",
  };
}
