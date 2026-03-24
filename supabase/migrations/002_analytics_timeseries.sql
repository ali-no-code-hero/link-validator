-- Aggregates for /analytics (Supabase RPC from Next API).

create or replace function public.link_validator_analytics_timeseries(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rangeDays',
    p_days,
    'clickSeries',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date', c.day::text,
            'clicks', c.clicks,
            'ok2xx', c.ok_2xx,
            'redirect3xx', c.redirect_3xx,
            'client4xx', c.client_4xx,
            'server5xx', c.server_5xx,
            'noStatus', c.no_status,
            'navErrors', c.nav_errors
          )
          order by c.day
        )
        from (
          select
            (timestamp at time zone 'utc')::date as day,
            count(*)::bigint as clicks,
            count(*) filter (where status_code >= 200 and status_code < 300)::bigint as ok_2xx,
            count(*) filter (where status_code >= 300 and status_code < 400)::bigint as redirect_3xx,
            count(*) filter (where status_code >= 400 and status_code < 500)::bigint as client_4xx,
            count(*) filter (where status_code >= 500)::bigint as server_5xx,
            count(*) filter (where status_code is null)::bigint as no_status,
            count(*) filter (where coalesce(btrim(extra_tracking_data->>'error'), '') <> '')::bigint as nav_errors
          from public.click_logs
          where (timestamp at time zone 'utc')::date
            >= ((now() at time zone 'utc')::date - greatest(p_days, 1) + 1)
          group by 1
        ) c
      ),
      '[]'::jsonb
    ),
    'batchSeries',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date', b.day::text,
            'batches', b.batches,
            'jobsHarvested', b.jobs
          )
          order by b.day
        )
        from (
          select
            (created_at at time zone 'utc')::date as day,
            count(distinct batch_id)::bigint as batches,
            count(*)::bigint as jobs
          from public.jobs_fetched
          where (created_at at time zone 'utc')::date
            >= ((now() at time zone 'utc')::date - greatest(p_days, 1) + 1)
          group by 1
        ) b
      ),
      '[]'::jsonb
    ),
    'totals',
    jsonb_build_object(
      'clicks',
      (
        select count(*)::bigint
        from public.click_logs
        where (timestamp at time zone 'utc')::date
          >= ((now() at time zone 'utc')::date - greatest(p_days, 1) + 1)
      ),
      'jobsHarvested',
      (
        select count(*)::bigint
        from public.jobs_fetched
        where (created_at at time zone 'utc')::date
          >= ((now() at time zone 'utc')::date - greatest(p_days, 1) + 1)
      ),
      'distinctBatches',
      (
        select count(distinct batch_id)::bigint
        from public.jobs_fetched
        where (created_at at time zone 'utc')::date
          >= ((now() at time zone 'utc')::date - greatest(p_days, 1) + 1)
      )
    )
  );
$$;

comment on function public.link_validator_analytics_timeseries(integer) is
  'Daily click + batch aggregates for Link Validator analytics (UTC dates).';

grant execute on function public.link_validator_analytics_timeseries(integer) to service_role;
grant execute on function public.link_validator_analytics_timeseries(integer) to authenticated;
