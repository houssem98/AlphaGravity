-- 0005 — read-only size/row stats for the search probe's §6 R4 row.
--
-- docs/GRAVITY_SEARCH_ROADMAP.md §4 makes the 500 MB Supabase free tier a hard
-- ceiling and §3 rule 6 makes every writing task state its MB delta. Neither is
-- enforceable from a committed script: PostgREST cannot run pg_database_size,
-- the local DATABASE_URL points at localhost, and the Supabase DB password is
-- not in the repo. This function is the one read path that closes that gap.
--
-- SECURITY DEFINER because pg_database_size needs privileges the API roles do
-- not have. It takes no arguments, returns only sizes and row counts, and is
-- revoked from anon and authenticated — service_role only, so it is reachable
-- from the probe and not from the browser.
--
-- Applied to prod 2026-08-17.

create or replace function public.gravity_db_stats()
returns table (
  db_mb numeric,
  chunks_mb numeric,
  financials_mb numeric,
  chunks_rows bigint,
  financials_rows bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    round(pg_database_size(current_database())/1048576.0, 1),
    round(pg_total_relation_size('public.chunks')/1048576.0, 1),
    round(pg_total_relation_size('public.financials')/1048576.0, 1),
    (select count(*) from public.chunks),
    (select count(*) from public.financials)
$$;

revoke all on function public.gravity_db_stats() from public;
revoke all on function public.gravity_db_stats() from anon;
revoke all on function public.gravity_db_stats() from authenticated;
grant execute on function public.gravity_db_stats() to service_role;
