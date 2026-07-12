-- ============================================================================
-- Migration : DÉFIS — modes single/series/timed + fix collectif + historique séries
-- ----------------------------------------------------------------------------
-- 1) `mode` sur challenges : 'single' (actuel, défaut) | 'series' (X essais/série,
--    N séries, agrégat) | 'timed' (chrono Start/Stop, agrégat best par défaut).
--    `series_size` (taille fixe de série, ex 25) + `aggregate` (average|best|sum|last).
-- 2) FIX bug collectif #1 : la contrainte scope n'autorisait pas 'collective' alors
--    que le front l'écrit → upsert rejeté → défis collectifs non synchronisés. On
--    élargit le CHECK.
-- 3) FIX bug collectif #2 : `target` + `team_score` n'étaient pas persistés (pas de
--    colonnes) → objectif/progression collectifs perdus au sync. On les ajoute.
-- 4) `challenge_series` : historique des tentatives (1 ligne/série ou /run timed),
--    soft-delete. L'agrégat (challenge_scores.score) est recalculé côté front → tout
--    le pipeline classement/podium/badges/story reste inchangé.
--
-- Additive + idempotente. Défis existants ('single' implicite) intacts.
-- ============================================================================

-- 1. Nouvelles colonnes sur challenges
alter table public.challenges add column if not exists mode text not null default 'single'
  check (mode in ('single','series','timed'));
alter table public.challenges add column if not exists series_size int;
alter table public.challenges add column if not exists aggregate text default 'average'
  check (aggregate in ('average','best','sum','last'));

-- 2. Fix bug collectif #1 : autoriser scope='collective'
alter table public.challenges drop constraint if exists challenges_scope_check;
alter table public.challenges add constraint challenges_scope_check
  check (scope in ('individual','season','team','collective'));

-- 3. Fix bug collectif #2 : persister target + team_score
alter table public.challenges add column if not exists target int;
alter table public.challenges add column if not exists team_score int;

-- 4. Nouvelle table challenge_series (historique des tentatives)
create table if not exists public.challenge_series (
  id           text primary key default gen_random_uuid()::text,
  challenge_id text not null references public.challenges(id) on delete cascade,
  player_id    text not null,
  made         int,           -- mode series : nb réussis
  attempts     int,           -- mode series : essais (souvent = series_size)
  duration_ms  int,           -- mode timed : durée du run
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists challenge_series_challenge_player_idx
  on public.challenge_series (challenge_id, player_id) where deleted_at is null;

-- 5. RLS anon (miroir du pattern existant "sandbox équipe")
alter table public.challenge_series enable row level security;
drop policy if exists challenge_series_all on public.challenge_series;
create policy "challenge_series_all" on public.challenge_series for all using (true) with check (true);

-- 6. Realtime
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenge_series') then
    alter publication supabase_realtime add table public.challenge_series;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.challenge_series cascade;
--   alter table public.challenges drop column if exists mode, drop column if exists series_size,
--     drop column if exists aggregate, drop column if exists target, drop column if exists team_score;
--   -- (le CHECK scope élargi peut rester ; pour revenir : drop + recreate avec l'ancien set)
-- ============================================================================
