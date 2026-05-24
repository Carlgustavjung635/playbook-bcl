-- ============================================================================
-- Fondation Saison : table `seasons` + tables d'association `season_players` /
-- `season_plays`, et FK nullable `season_id` sur `matches`, `convocations`,
-- `challenges`.
--
-- Le filtrage par saison se fait CÔTÉ CLIENT (state.currentSeasonId + helpers
-- currentSeasonMatches/Convocations/Challenges + getSeasonPlayers/Plays). La
-- DB sert uniquement à persister la liaison.
--
-- Choix pour rollback safe :
--   - season_id reste NULLABLE sur matches/convocations/challenges (pas de
--     set not null tant qu'on n'a pas validé que tout l'historique est bien
--     rattaché). Backfill 'season_2025-2026' = saison par défaut.
--   - aucune policy modifiée sur matches/convocations/challenges (l'existant
--     `*_write_all` suffit, anon all true).
--   - les 3 nouvelles tables ont leur propre policy anon all (cohérent avec
--     le reste de l'app, sécurité par PIN coach côté front).
--
-- Unique partial index `seasons_one_active` : garantit max 1 saison `active`
-- en BD. La transition d'activation passe donc par : 1) update active→archived,
-- 2) update draft→active. Le front fait ces deux UPDATE séquentiels.
-- ============================================================================

-- 1) Table seasons
create table if not exists public.seasons (
  id            text primary key,
  name          text not null,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'draft' check (status in ('draft','active','archived')),
  created_at    timestamptz default now(),
  activated_at  timestamptz,
  archived_at   timestamptz
);

create unique index if not exists seasons_one_active
  on public.seasons(status) where status='active';

-- 2) Associations N-N
create table if not exists public.season_players (
  season_id   text references public.seasons(id) on delete cascade,
  player_id   text references public.players(id) on delete cascade,
  joined_at   date,
  left_at     date,
  role        text,
  primary key (season_id, player_id)
);

create table if not exists public.season_plays (
  season_id   text references public.seasons(id) on delete cascade,
  play_id     text references public.plays(id) on delete cascade,
  active      boolean default true,
  primary key (season_id, play_id)
);

-- 3) FK sur entités saisonnières (nullable)
alter table public.matches      add column if not exists season_id text references public.seasons(id);
alter table public.convocations add column if not exists season_id text references public.seasons(id);
alter table public.challenges   add column if not exists season_id text references public.seasons(id);

-- 4) Saison par défaut + backfill
insert into public.seasons (id, name, start_date, end_date, status, activated_at)
  values ('2025-2026', 'Saison 2025-2026', '2025-09-01', '2026-06-30', 'active', now())
on conflict (id) do nothing;

insert into public.season_players (season_id, player_id, joined_at)
  select '2025-2026', id, '2025-09-01' from public.players
on conflict (season_id, player_id) do nothing;

insert into public.season_plays (season_id, play_id, active)
  select '2025-2026', id, true from public.plays
on conflict (season_id, play_id) do nothing;

update public.matches      set season_id = '2025-2026' where season_id is null;
update public.convocations set season_id = '2025-2026' where season_id is null;
update public.challenges   set season_id = '2025-2026' where season_id is null;

-- 5) RLS anon all sur les 3 nouvelles tables (cohérent avec sync_all_entities)
alter table public.seasons         enable row level security;
alter table public.season_players  enable row level security;
alter table public.season_plays    enable row level security;

drop policy if exists "seasons_anon_all"         on public.seasons;
drop policy if exists "season_players_anon_all"  on public.season_players;
drop policy if exists "season_plays_anon_all"    on public.season_plays;

create policy "seasons_anon_all" on public.seasons
  for all to anon, authenticated using (true) with check (true);
create policy "season_players_anon_all" on public.season_players
  for all to anon, authenticated using (true) with check (true);
create policy "season_plays_anon_all" on public.season_plays
  for all to anon, authenticated using (true) with check (true);

-- 6) Ajout au realtime (synchronisation live multi-device)
do $$
declare
  t text;
  tbls text[] := array['seasons', 'season_players', 'season_plays'];
begin
  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- NB rollback safe :
-- - pas de NOT NULL ajouté sur les colonnes season_id.
-- - pas de policy supprimée/modifiée sur matches/convocations/challenges.
-- - les 3 nouvelles tables se droppent en cascade sans toucher l'historique.
-- Pour annuler : drop table season_players, season_plays, seasons cascade ;
-- alter table matches/convocations/challenges drop column season_id.
-- ============================================================================
