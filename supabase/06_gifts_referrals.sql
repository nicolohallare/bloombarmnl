-- ═══════════════════════════════════════════════════════════════════
-- Bloom Bar — follow-up #6: gift certificates, Brow Circle referral
-- links, and the holiday follow-up list. Safe to run twice; nothing
-- existing is removed.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Brow Circle: a personal link code per client ──────────────────
-- bloombarmnl.com/consult?ref=ana-3f9c2 → the brow check or booking
-- request arrives tagged with who sent the friend.
alter table clients add column if not exists ref_code text;
create unique index if not exists clients_ref_code_idx on clients (ref_code);

create or replace function make_ref_code(p_name text, p_id uuid) returns text
language sql immutable as $$
  select coalesce(nullif(lower(regexp_replace(split_part(trim(coalesce(p_name, '')), ' ', 1), '[^A-Za-z]', '', 'g')), ''), 'friend')
         || '-' || substr(md5(p_id::text), 1, 5)
$$;

update clients set ref_code = make_ref_code(name, id) where ref_code is null;

create or replace function set_ref_code() returns trigger language plpgsql as $$
begin
  if new.ref_code is null then new.ref_code := make_ref_code(new.name, new.id); end if;
  return new;
end $$;
drop trigger if exists clients_ref_code on clients;
create trigger clients_ref_code before insert on clients for each row execute function set_ref_code();

alter table consult_requests add column if not exists referred_by text;
alter table consult_requests add column if not exists ref_code    text;
alter table bookings         add column if not exists referred_by text;
alter table bookings         add column if not exists ref_code    text;

-- ─── Gift certificates ─────────────────────────────────────────────
-- Requested on bloombarmnl.com/gift; Izza arranges payment by chat,
-- then issues the certificate from her app.
create table if not exists gift_requests (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique not null,          -- GR-XXXXX, the request
  code            text unique,                   -- BBG-XXXXX, printed on the certificate
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  buyer_name      text not null,
  contact         text not null,
  chat_app        text not null check (chat_app in ('viber', 'whatsapp')),
  email           text,
  recipient_name  text not null,
  gift            text not null check (gift in ('treatment', 'retouch')),
  amount          numeric not null,
  message         text,
  status          text not null default 'new'
                  check (status in ('new', 'paid', 'issued', 'redeemed', 'cancelled')),
  issued_at       timestamptz,
  valid_until     date,
  redeemed_at     timestamptz,
  visit_source    text
);
create index if not exists gift_requests_created_idx on gift_requests (created_at desc);

drop trigger if exists gift_requests_updated_at on gift_requests;
create trigger gift_requests_updated_at before update on gift_requests
  for each row execute function update_updated_at();

alter table gift_requests enable row level security;
drop policy if exists read_gift_requests   on gift_requests;
drop policy if exists update_gift_requests on gift_requests;
create policy read_gift_requests   on gift_requests for select using (true);
create policy update_gift_requests on gift_requests for update using (true) with check (true);

-- ─── Seasonal follow-ups (who already got the holiday message) ─────
create table if not exists campaign_messages (
  id         uuid primary key default gen_random_uuid(),
  campaign   text not null,
  contact    text not null,
  sent_at    timestamptz not null default now(),
  unique (campaign, contact)
);
alter table campaign_messages enable row level security;
drop policy if exists read_campaign_messages   on campaign_messages;
drop policy if exists insert_campaign_messages on campaign_messages;
drop policy if exists delete_campaign_messages on campaign_messages;
create policy read_campaign_messages   on campaign_messages for select using (true);
create policy insert_campaign_messages on campaign_messages for insert with check (true);
create policy delete_campaign_messages on campaign_messages for delete using (true);

-- ─── CHECK ───────────────────────────────────────────────────────────
-- Should return: clients_without_code 0, new_tables 2, new_columns 4
select
  (select count(*) from clients where ref_code is null) as clients_without_code,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('gift_requests', 'campaign_messages')) as new_tables,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and column_name in ('referred_by', 'ref_code') and table_name in ('consult_requests', 'bookings')) as new_columns;
