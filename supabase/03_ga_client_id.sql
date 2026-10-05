-- Bloom Bar booking — follow-up #3 (optional, safe to run any time)
-- Stores Google Analytics' anonymous visitor id on each booking, so that when
-- Izza confirms a booking the website can report it to GA4 and credit the
-- traffic source (Google search, Ads, Instagram…) that brought the client in.
-- The site works with or without this column.

alter table bookings add column if not exists ga_client_id text;

-- Should return 1
select count(*) as ga_column from information_schema.columns
 where table_schema = 'public' and table_name = 'bookings' and column_name = 'ga_client_id';
