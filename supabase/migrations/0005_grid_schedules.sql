-- Migration 0005: Scheduled grid refresh + email digest (roadmap P2.2)
--
-- A saved grid (lib_grid_runs) re-runs on a cadence; the worker diffs the fresh
-- run against the last one and emails the owner what changed.
--
-- APPLY VIA the Supabase dashboard SQL editor — the DB password is not available
-- locally, so this file is the source of record, not an auto-applied migration.

create table if not exists public.lib_grid_schedules (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    grid_run_id uuid not null,               -- soft ref to lib_grid_runs.id (the grid to re-run)
    email       text not null,               -- digest recipient
    cadence     text not null default 'weekly',   -- 'daily' | 'weekly'
    enabled     boolean not null default true,
    next_run_at timestamptz not null default now(),
    last_run_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists lib_grid_schedules_due_idx
    on public.lib_grid_schedules (enabled, next_run_at);

alter table public.lib_grid_schedules enable row level security;

-- Owner can manage their own schedules from the frontend (anon/JWT key).
-- The backend worker uses the service-role key, which bypasses RLS.
create policy "grid_schedules: owner all"
    on public.lib_grid_schedules for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
