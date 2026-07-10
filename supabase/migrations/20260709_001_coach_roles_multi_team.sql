-- ============================================================================
-- Migration : RÔLES MULTI-COACH & MULTI-ÉQUIPES
-- ----------------------------------------------------------------------------
-- Introduit plusieurs coachs (admin_coach / coach) scopés par équipe, sur l'axe
-- team_tag existant (e1 / e2 / both, cf. 20260607_001_multi_squad.sql).
--
-- 1) Table `coaches` : identités coach PIN-only, synchronisées comme `players`
--    (rôle anon, posture "sandbox équipe" = contrôle d'accès réel côté front L1).
--    Le coach historique devient `admin_coach` via un SEED côté client (au boot,
--    à partir de state.pins.coach) — PAS en SQL, car le PIN vit côté front.
--
-- 2) Métadonnées de modération sur `gages` : proposed_by / moderated_by (pour
--    tracer qui a proposé un gage — coach non-admin ou joueuse — et qui l'a
--    modéré). Le cycle pending→approved|rejected est déjà en place ; ces colonnes
--    sont additives et nullable (aucune donnée existante impactée).
--
-- 3) Métadonnées d'auteur sur `plays` / `programs` : created_by (l'édition reste
--    admin only, contrôlée côté front ; colonne purement informative).
--
-- IDEMPOTENTE : if not exists / drop policy if exists. SAFE data existante :
-- colonnes additives nullable ou avec default rétrocompatible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) COACHES
-- ----------------------------------------------------------------------------
create table if not exists public.coaches (
  id          text primary key,
  name        text not null default '',
  coach_role  text not null default 'coach'
              check (coach_role in ('admin_coach','coach')),
  teams       text[] not null default '{e1}',   -- sous-ensemble de {e1,e2}
  code        text,                              -- code de connexion (6 chiffres)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists coaches_coach_role_idx on public.coaches (coach_role);

alter table public.coaches enable row level security;
drop policy if exists coaches_all on public.coaches;
create policy "coaches_all"
  on public.coaches for all using (true) with check (true);

-- Realtime (l'admin crée un coach → dispo immédiatement sur l'appareil du coach).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'coaches'
  ) then
    alter publication supabase_realtime add table public.coaches;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) MODÉRATION GAGES : traçabilité proposition / modération
-- ----------------------------------------------------------------------------
alter table public.gages add column if not exists proposed_by text;   -- 'coach:<id>' | 'player:<id>'
alter table public.gages add column if not exists moderated_by text;  -- '<admin coach id>'

-- ----------------------------------------------------------------------------
-- 3) AUTEUR RESSOURCES COMMUNES (informatif, édition admin only côté front)
-- ----------------------------------------------------------------------------
alter table public.plays    add column if not exists created_by text;
alter table public.programs add column if not exists created_by text;

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.coaches cascade;
--   alter table public.gages    drop column if exists proposed_by;
--   alter table public.gages    drop column if exists moderated_by;
--   alter table public.plays    drop column if exists created_by;
--   alter table public.programs drop column if exists created_by;
-- ============================================================================
