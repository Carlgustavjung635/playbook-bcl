-- ============================================================================
-- Migration : TROIS TYPES DE GAGE COHABITENT (classique / sanction / défi)
-- ----------------------------------------------------------------------------
-- Jusqu'ici la boîte à gages n'avait qu'un seul cycle de vie : le coach assigne
-- le DEVOIR DE TIRER, la joueuse pioche au sort dans le pool `gages`, elle
-- accepte ou passe (dette), puis le coach confirme. On ajoute deux cycles de vie
-- à côté, qui ne passent PAS par le tirage :
--
--   • classique          → inchangé (tirage au sort dans le pool `gages`) ;
--   • sanction_physique  → le coach choisit un exo dans une base DÉDIÉE
--                          (`sanction_templates`, séparée de `exo_templates` de
--                          l'ardoise) et l'assigne. Les sanctions d'une même
--                          joueuse s'AGRÈGENT en un programme unique à faire au
--                          prochain entraînement ;
--   • defi               → le coach choisit un défi dans une base DÉDIÉE
--                          (`gage_defis_templates`, séparée de `challenges` qui
--                          reste la table des défis COLLECTIFS) et l'assigne
--                          avec une fenêtre de validation (deadline_at).
--
-- CHOIX DE MODÈLE (important) — le type est porté par l'ASSIGNATION, pas par le
-- gage. La colonne `gages.gage_type` existe déjà (migration 20260706_002) avec
-- un tout autre axe : standard | secret | sport | time_limited, c'est-à-dire la
-- SAVEUR d'un gage du pool classique. On n'y touche pas, sous peine de casser
-- le pool existant. Le nouvel axe (le coach choisit le type AU MOMENT DE
-- L'ASSIGNATION) vit donc sur `gage_draws.kind`. Il n'existe pas de table
-- `gage_assignments` dans ce schéma : `gage_draws` EST la table d'assignation.
--
-- PREUVE : validation coach uniquement, aucune photo, pour les trois types.
--   validated_at / validated_by / validation_note complètent confirmed_at.
--
-- DETTE : la mécanique de dette (skip = +1 tirage) reste RÉSERVÉE au classique.
-- Les lignes kind != 'classique' sont exclues du calcul côté front (gageDebt),
-- sinon un « accept » de sanction rembourserait une dette de tirage.
--
-- Posture RLS anon « sandbox équipe » (comme gages / gage_draws). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Base d'exos DÉDIÉE aux sanctions physiques (ne mange pas exo_templates)
-- ---------------------------------------------------------------------------
create table if not exists public.sanction_templates (
  id               text primary key,
  name             text not null,
  description      text,
  category         text,               -- 'abdos' | 'cardio' | 'jambes' | … (affichage)
  sets             integer,
  reps             integer,
  duration_seconds integer,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz         -- soft-delete : seul état terminal durable
);

alter table public.sanction_templates enable row level security;
drop policy if exists sanction_templates_all on public.sanction_templates;
create policy "sanction_templates_all"
  on public.sanction_templates for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sanction_templates'
  ) then
    alter publication supabase_realtime add table public.sanction_templates;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Base de DÉFIS-GAGES (individuels) — distincte de `challenges` (collectifs)
-- ---------------------------------------------------------------------------
create table if not exists public.gage_defis_templates (
  id          text primary key,
  name        text not null,
  description text,
  window_days integer default 7,       -- délai de validation, en jours
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

alter table public.gage_defis_templates enable row level security;
drop policy if exists gage_defis_templates_all on public.gage_defis_templates;
create policy "gage_defis_templates_all"
  on public.gage_defis_templates for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gage_defis_templates'
  ) then
    alter publication supabase_realtime add table public.gage_defis_templates;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) L'assignation (gage_draws) porte le type + la référence de l'item
-- ---------------------------------------------------------------------------
alter table public.gage_draws
  add column if not exists kind text not null default 'classique';

do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.gage_draws'::regclass
               and conname = 'gage_draws_kind_check') then
    alter table public.gage_draws drop constraint gage_draws_kind_check;
  end if;
  alter table public.gage_draws
    add constraint gage_draws_kind_check
    check (kind in ('classique','sanction_physique','defi'));
end $$;

alter table public.gage_draws
  add column if not exists sanction_template_id text references public.sanction_templates(id) on delete set null,
  add column if not exists defi_template_id     text references public.gage_defis_templates(id) on delete set null,
  add column if not exists deadline_at          timestamptz,
  add column if not exists validated_at         timestamptz,
  add column if not exists validated_by         text,
  add column if not exists validation_note      text;

create index if not exists gage_draws_kind_idx on public.gage_draws (kind);

-- Rollback (manuel) :
--   alter table public.gage_draws
--     drop column if exists kind, drop column if exists sanction_template_id,
--     drop column if exists defi_template_id, drop column if exists deadline_at,
--     drop column if exists validated_at, drop column if exists validated_by,
--     drop column if exists validation_note;
--   drop table if exists public.gage_defis_templates cascade;
--   drop table if exists public.sanction_templates cascade;
