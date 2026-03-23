-- Link Validator: jobs from Collabwork API + click trace logs

create extension if not exists "pgcrypto";

create table if not exists public.jobs_fetched (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  job_eid text not null,
  title text,
  location text,
  company text,
  url text not null,
  is_remote boolean,
  industry text,
  date_posted timestamptz,
  salary_min numeric,
  salary_max numeric,
  salary_period text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'completed', 'failed')),
  unique (batch_id, job_eid)
);

create index if not exists jobs_fetched_batch_id_idx on public.jobs_fetched (batch_id);
create index if not exists jobs_fetched_job_eid_idx on public.jobs_fetched (job_eid);

create table if not exists public.click_logs (
  id uuid primary key default gen_random_uuid(),
  job_eid text not null,
  job_fetched_id uuid references public.jobs_fetched (id) on delete set null,
  batch_id uuid not null,
  initial_url text not null,
  final_destination_url text,
  redirect_chain jsonb not null default '[]'::jsonb,
  ip_address_used text,
  user_agent_device_id text,
  status_code integer,
  timestamp timestamptz not null default now(),
  extra_tracking_data jsonb not null default '{}'::jsonb
);

create index if not exists click_logs_batch_id_idx on public.click_logs (batch_id);
create index if not exists click_logs_job_eid_idx on public.click_logs (job_eid);
create index if not exists click_logs_timestamp_idx on public.click_logs (timestamp desc);
