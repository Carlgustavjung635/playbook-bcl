-- ============================================================
-- Migration 004 : Plans d'entraînement persistés par convocation
-- ============================================================
-- Attache un plan d'entraînement (liste d'exercices + notes coach) à une
-- convocation training SPÉCIFIQUE (couple convocation_id + instance_date,
-- pour gérer les convocations récurrentes qui ont un plan distinct par date).
-- Persisté en Supabase pour la sync cross-device.
--
-- Pas de système de template : chaque convoc a son propre plan from scratch
-- (confirmé côté produit). Le contenu du plan est stocké en JSONB libre pour
-- pouvoir évoluer (exercises[], notes, et workshop_rotations en phase 3) sans
-- nouvelle migration.
-- ============================================================

create table if not exists public.training_plans (
  id text primary key,                       -- PK applicative : convocId::instanceDate
  convocation_id text not null,
  instance_date date not null,
  season_id text references seasons(id) on delete set null,
  plan jsonb not null default '{}'::jsonb,   -- { exercises:[...], notes:'', workshop_rotations:{} }
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (convocation_id, instance_date)
);

-- Pas de FK stricte sur convocation_id : comme pour training_guests, les
-- convocations récurrentes ne sont pas toutes matérialisées en BD (certaines
-- instances sont générées à la volée côté front). La cohérence est assurée
-- applicativement. La FK sur season_id reste sûre (les saisons sont toujours
-- en BD) et passe à NULL si la saison est supprimée, sans détruire le plan.

-- Index pour retrouver rapidement le plan d'une convoc (le unique couvre déjà
-- (convocation_id, instance_date), cet index aide les lookups par convoc seule
-- et les purges éventuelles).
create index if not exists training_plans_convocation_idx
  on public.training_plans (convocation_id);

alter table public.training_plans enable row level security;

-- RLS : accès anon complet (l'app utilise la clé anon, pas d'auth user-level).
-- Cohérent avec les autres tables (training_guests, seasons, etc.).
create policy "training_plans_anon_all"
  on public.training_plans for all
  to anon
  using (true)
  with check (true);

-- Realtime : sync cross-device des plans d'entraînement.
alter publication supabase_realtime add table public.training_plans;
