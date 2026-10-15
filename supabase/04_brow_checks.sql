-- ═══════════════════════════════════════════════════════════════════
-- Bloom Bar booking — follow-up #4: free brow checks
-- Run once in Supabase → bloombar → SQL Editor. Safe to run twice.
-- Adds one table; nothing existing is changed.
--
-- A brow check is the first step most clients take: they send a photo
-- of their bare brows, Izza messages them, and they book after talking.
-- Photos go in the existing private 'brow-photos' bucket.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists consult_requests (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null,               -- BC-XXXXX, quoted in chats
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  client_name   text not null,
  contact       text not null,                      -- mobile, used for Viber/WhatsApp
  chat_app      text not null check (chat_app in ('viber', 'whatsapp')),
  email         text,
  interest      text,                               -- treatment they're curious about, or 'Not sure'
  notes         text,
  source        text,                               -- "How did you find Bloom Bar?"
  photo_path    text,
  photo_url     text,                               -- signed link the studio app shows
  ga_client_id  text,
  status        text not null default 'new'
                check (status in ('new', 'replied', 'booked', 'not_a_fit')),
  status_note   text
);

create index if not exists consult_requests_created_idx on consult_requests (created_at desc);
create index if not exists consult_requests_status_idx  on consult_requests (status);

-- Keep updated_at current (function created in 01_booking_system.sql)
drop trigger if exists consult_requests_updated_at on consult_requests;
create trigger consult_requests_updated_at
  before update on consult_requests
  for each row execute function update_updated_at();

-- Same rules as bookings: the studio app (anon key) can read and update;
-- only the website's function (service key) can create rows.
alter table consult_requests enable row level security;
drop policy if exists read_consult_requests   on consult_requests;
drop policy if exists update_consult_requests on consult_requests;
create policy read_consult_requests   on consult_requests for select using (true);
create policy update_consult_requests on consult_requests for update using (true) with check (true);

-- ─── CHECK ───────────────────────────────────────────────────────────
-- Should return: table 1, policies 2
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'consult_requests') as "table",
  (select count(*) from pg_policies where tablename = 'consult_requests') as policies;
