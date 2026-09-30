-- Accountability Club — shared board schema
--
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Every statement is idempotent, so re-running it is safe and is how you apply
-- changes later.
--
-- The app keeps one row per record it syncs. Three key shapes exist:
--   entry:<person>:<YYYY-MM-DD>   a logged day, or null once the day is cleared
--   goals:<person>                that person's step / active / target-weight goals
--   club                          club-wide settings (kg or lb)

-- ---------------------------------------------------------------- table

create table if not exists public.club_data (
  key        text        primary key,
  value      jsonb,            -- NULL is a tombstone: a day that was cleared
  updated_ms bigint      not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.club_data is
  'One row per synced record. Merge rule: highest updated_ms wins.';
comment on column public.club_data.value is
  'The record body. NULL marks a cleared day — PostgREST sends JSON null as SQL '
  'NULL, so the column must stay nullable or every clear would be rejected.';
comment on column public.club_data.updated_ms is
  'Client clock in epoch ms, clamped to the server clock by a trigger below.';

-- ------------------------------------------------------------ guardrails

-- Only the key shapes the app actually writes. Without this, anyone holding the
-- anon key could use the table as free storage for arbitrary junk.
alter table public.club_data drop constraint if exists club_data_key_shape;
alter table public.club_data add constraint club_data_key_shape check (
  key = 'club'
  or key ~ '^goals:[a-z0-9_-]{1,32}$'
  or key ~ '^entry:[a-z0-9_-]{1,32}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
);

-- A logged day is a few hundred bytes. 4 KB is generous and caps the damage
-- anyone can do to your free-tier storage.
alter table public.club_data drop constraint if exists club_data_value_size;
alter table public.club_data add constraint club_data_value_size
  check (value is null or octet_length(value::text) <= 4096);

-- The merge rule is "highest updated_ms wins", so a phone with a wrong date set
-- to 2099 would win every merge forever and nobody could correct it. Trust the
-- server clock as the ceiling instead. One minute of slack absorbs ordinary
-- clock drift without letting a badly-set clock take over.
create or replace function public.club_data_clamp_clock()
returns trigger
language plpgsql
as $$
begin
  new.updated_ms := least(
    greatest(coalesce(new.updated_ms, 0), 0),
    (extract(epoch from now()) * 1000)::bigint + 60000
  );
  return new;
end;
$$;

drop trigger if exists club_data_clamp_clock on public.club_data;
create trigger club_data_clamp_clock
  before insert or update on public.club_data
  for each row execute function public.club_data_clamp_clock();

-- --------------------------------------------------- access (read this bit)

alter table public.club_data enable row level security;

-- These policies let anyone holding the anon key read and write this table.
-- That is the deliberate trade for a tracker with no login: the key lives in
-- each of your browsers, not in the repo. Keep it out of anything public.
--
-- There is no DELETE policy and no DELETE grant, on purpose. Clearing a day
-- writes a null tombstone rather than removing the row, so even a leaked key
-- cannot erase your history — the worst it can do is overwrite recent values,
-- which an export gives you a way back from.

drop policy if exists "club can read"   on public.club_data;
drop policy if exists "club can insert" on public.club_data;
drop policy if exists "club can update" on public.club_data;

create policy "club can read"   on public.club_data for select using (true);
create policy "club can insert" on public.club_data for insert with check (true);
create policy "club can update" on public.club_data for update using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update on table public.club_data to anon;

-- ------------------------------------------------------------- check it

-- After running the above, this should return one row. If it errors with
-- "permission denied", the grants did not apply; re-run this file.
insert into public.club_data (key, value, updated_ms)
values ('club', '{"units":"kg"}'::jsonb, 0)
on conflict (key) do nothing;

select key, value, updated_ms, created_at from public.club_data;
