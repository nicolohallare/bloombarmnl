-- ═══════════════════════════════════════════════════════════════════
-- Bloom Bar — follow-up #5: website → bookings dashboard
-- Run once in Supabase → bloombar → SQL Editor. Safe to run twice.
-- Adds a visit counter table, a "where the visit came from" column on
-- bookings and brow checks, and one read-only summary function for the
-- studio app's Report. Nothing existing is changed or removed.
-- ═══════════════════════════════════════════════════════════════════

-- One row per page view. Random visitor id, page, and where the visit
-- started (Google, Google Ads, Instagram, AI assistant…). No names, no IPs.
create table if not exists site_visits (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  day       date not null default ((now() at time zone 'Asia/Manila')::date),
  visitor   text not null,
  page      text not null,
  source    text not null,
  landing   boolean not null default false
);
create index if not exists site_visits_day_idx on site_visits (day);

-- Only the website's function (service key) writes here; the app reads
-- totals through site_funnel() below, never the raw rows.
alter table site_visits enable row level security;

alter table bookings         add column if not exists visit_source text;
alter table consult_requests add column if not exists visit_source text;

-- Monthly totals for the Report screen.
create or replace function site_funnel(p_from date, p_to date)
returns json
language sql stable security definer set search_path = public
as $$
  with v as (select * from site_visits where day between p_from and p_to)
  select json_build_object(
    'first_day', (select min(day) from site_visits),
    'visitors',  (select count(distinct visitor) from v),
    'views',     (select count(*) from v),
    'started',   (select count(distinct visitor) from v where page in ('/consult', '/book')),
    'sources',   (select coalesce(json_agg(s order by s.visitors desc), '[]'::json) from (
                    select source,
                           count(distinct visitor) as visitors,
                           count(distinct visitor) filter (where page in ('/consult', '/book')) as started
                    from v group by source) s),
    'pages',     (select coalesce(json_agg(p order by p.visitors desc), '[]'::json) from (
                    select page, count(distinct visitor) as visitors
                    from v group by page order by 2 desc limit 8) p)
  );
$$;
revoke all on function site_funnel(date, date) from public;
grant execute on function site_funnel(date, date) to anon, authenticated;

-- ─── CHECK ───────────────────────────────────────────────────────────
-- Should return: visits_table 1, new_columns 2, funnel_function 1
select
  (select count(*) from information_schema.tables  where table_schema = 'public' and table_name = 'site_visits') as visits_table,
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'visit_source'
     and table_name in ('bookings', 'consult_requests')) as new_columns,
  (select count(*) from pg_proc where proname = 'site_funnel') as funnel_function;
