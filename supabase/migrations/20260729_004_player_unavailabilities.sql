-- ============================================================================
-- Migration : INDISPONIBILITÉS DE JOUEUSE (player_unavailabilities)
-- ----------------------------------------------------------------------------
-- Une période pendant laquelle une joueuse n'est pas disponible (vacances,
-- blessure, exams…). Saisie PAR LE COACH — la joueuse le prévient par un autre
-- canal, il enregistre. Pendant la période :
--   • elle est comptée absente par défaut sur toute convocation couverte ;
--   • elle ne reçoit plus les rappels push (match / entraînement / prépa).
--
-- PAS DE season_id : une période porte ses propres dates, le rattachement à une
-- saison se déduit. Ajouter une colonne saison créerait deux vérités à tenir
-- synchrones pour rien (et le chevauchement de saisons est réel : une blessure
-- de juin à septembre traverse la bascule).
--
-- ends_at NULLABLE : une blessure sans date de retour connue est le cas le plus
-- fréquent. Forcer une date obligerait à inventer une valeur, qu'il faudrait
-- ensuite corriger — et une date inventée est pire qu'une date absente, parce
-- qu'elle a l'air vraie. NULL = « jusqu'à nouvel ordre ».
--
-- POSTURE RLS : anon « sandbox équipe », identique au reste du projet. La
-- demande prévoyait « coach écrit / joueuse lit sa ligne » : ce n'est pas
-- exprimable, l'app n'a pas d'auth par joueuse (PIN L1 + rôle anon Supabase),
-- auth.uid() est NULL pour tout le monde et une telle policy bloquerait TOUS
-- les writes. Le coach-only est appliqué CÔTÉ FRONT, comme partout ailleurs.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère ses
-- ids via uid() (préfixe 'x'), heuristique anti-wipe de tous les apply PbSync.
--
-- Idempotente.
-- ============================================================================

create table if not exists public.player_unavailabilities (
  id         text primary key default gen_random_uuid()::text,
  player_id  text not null references public.players(id) on delete cascade,
  starts_at  date not null,
  -- NULL = sans date de fin connue (cf. en-tête).
  ends_at    date,
  reason     text not null default 'autre'
             check (reason in ('vacances', 'blessure', 'perso', 'exams', 'autre')),
  notes      text,
  -- Audit : quel coach a saisi. Pas de FK — un coach supprimé ne doit pas
  -- emporter l'historique des indisponibilités avec lui.
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint player_unavailabilities_dates_check
    check (ends_at is null or ends_at >= starts_at)
);

create index if not exists player_unavailabilities_active_idx
  on public.player_unavailabilities (player_id, starts_at, ends_at)
  where deleted_at is null;
create index if not exists player_unavailabilities_deleted_at_idx
  on public.player_unavailabilities (deleted_at);

-- ----------------------------------------------------------------------------
-- RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.player_unavailabilities enable row level security;
drop policy if exists player_unavailabilities_all on public.player_unavailabilities;
create policy "player_unavailabilities_all" on public.player_unavailabilities
  for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'player_unavailabilities') then
    alter publication supabase_realtime add table public.player_unavailabilities;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.player_unavailabilities;
-- ============================================================================
