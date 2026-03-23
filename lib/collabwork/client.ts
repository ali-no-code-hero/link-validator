import { getServerEnv } from "@/lib/env";

const JOB_SEARCH_URL = "https://api.collabwork.com/api:partners/JobSearch";

export type CollabworkJob = {
  job_eid: string;
  url: string;
  title?: string;
  location?: string;
  company?: string;
  is_remote?: boolean;
  industry?: string;
  date_posted?: string;
  salary_min?: number;
  salary_max?: number;
  salary_period?: string;
  [key: string]: unknown;
};

function extractJobsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.data)) {
      return o.data;
    }
    if (Array.isArray(o.jobs)) {
      return o.jobs;
    }
    if (Array.isArray(o.results)) {
      return o.results;
    }
  }
  return [];
}

function normalizeJob(raw: unknown): CollabworkJob | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const job_eid = r.job_eid ?? r.jobEid ?? r.id;
  const url = r.url ?? r.link;
  if (typeof job_eid !== "string" || typeof url !== "string") {
    return null;
  }
  return {
    ...r,
    job_eid,
    url,
    title: typeof r.title === "string" ? r.title : undefined,
    location: typeof r.location === "string" ? r.location : undefined,
    company: typeof r.company === "string" ? r.company : undefined,
    is_remote: typeof r.is_remote === "boolean" ? r.is_remote : undefined,
    industry: typeof r.industry === "string" ? r.industry : undefined,
    date_posted: typeof r.date_posted === "string" ? r.date_posted : undefined,
    salary_min: typeof r.salary_min === "number" ? r.salary_min : undefined,
    salary_max: typeof r.salary_max === "number" ? r.salary_max : undefined,
    salary_period: typeof r.salary_period === "string" ? r.salary_period : undefined,
  };
}

export type JobSearchParams = {
  query: string;
  page: number;
  per_page: number;
};

export async function searchJobs(params: JobSearchParams): Promise<CollabworkJob[]> {
  const env = getServerEnv();
  const url = new URL(JOB_SEARCH_URL);
  url.searchParams.set("query", params.query);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("per_page", String(params.per_page));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.COLLABWORK_API_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Collabwork JobSearch failed: ${res.status} ${text.slice(0, 500)}`);
  }

  const json: unknown = await res.json();
  const arr = extractJobsArray(json);
  const out: CollabworkJob[] = [];
  for (const item of arr) {
    const j = normalizeJob(item);
    if (j) {
      out.push(j);
    }
  }
  return out;
}
