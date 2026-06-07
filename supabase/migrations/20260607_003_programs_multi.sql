-- ============================================================================
-- Migration : programmes sportifs MULTIPLES (casse le singleton offseason)
-- ----------------------------------------------------------------------------
-- Chantier C. Avant : un seul programme intersaison vivait dans la table
-- `offseason_program` (singleton hardcodé id=1, check id=1). Le coach ne
-- pouvait gérer qu'UN programme à la fois.
--
-- Après : nouvelle table `programs` (1-N, id text déterministe), même schéma
-- enrichi (mode weekly/daily, daily_schedule), + dimension `program_id` sur
-- `offseason_logs` pour rattacher chaque complétion au bon programme.
--
-- Rétrocompat / backfill : le programme estival existant (offseason_program
-- id=1) est recopié dans `programs` avec l'id texte '1'. Les logs existants
-- prennent program_id='1' (DEFAULT). Aucune donnée détruite : la table
-- `offseason_program` est CONSERVÉE (lecture seule, plus écrite par le front).
--
-- Idempotente : rejouable sans casser (if not exists / drop policy if exists /
-- guards information_schema).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Sûreté : s'assurer que offseason_program possède bien mode/daily_schedule
--    (migration 20260529_002 committée mais possiblement non appliquée en prod).
--    Sans ça, le SELECT de backfill ci-dessous échouerait sur colonne absente.
-- ----------------------------------------------------------------------------
alter table public.offseason_program
  add column if not exists mode text not null default 'weekly';
alter table public.offseason_program
  add column if not exists daily_schedule jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 1. Nouvelle table programs (1-N)
-- ----------------------------------------------------------------------------
create table if not exists public.programs (
  id             text primary key,
  name           text not null default 'Programme',
  start_date     date,
  end_date       date,
  mode           text not null default 'weekly' check (mode in ('weekly', 'daily')),
  exercises      jsonb not null default '[]'::jsonb,
  daily_schedule jsonb not null default '{}'::jsonb,
  season_id      text references public.seasons(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- trigger updated_at (réutilise la fonction set_updated_at déjà définie)
drop trigger if exists programs_set_updated_at on public.programs;
create trigger programs_set_updated_at before update on public.programs
  for each row execute function public.set_updated_at();

-- RLS : posture "sandbox équipe" anon (cohérent avec offseason_logs,
-- team_reviews, player_wellness_log — accès contrôlé côté front via PIN local).
alter table public.programs enable row level security;
drop policy if exists programs_write_all on public.programs;
create policy "programs_write_all"
  on public.programs for all using (true) with check (true);

-- realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'programs'
  ) then
    alter publication supabase_realtime add table public.programs;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Backfill : migrer le singleton offseason_program id=1 → programs '1'
-- ----------------------------------------------------------------------------
insert into public.programs (id, name, start_date, end_date, mode, exercises, daily_schedule, created_at)
select '1',
       coalesce(nullif(trim(title), ''), 'Programme estival'),
       start_date, end_date,
       coalesce(mode, 'weekly'),
       coalesce(exercises, '[]'::jsonb),
       coalesce(daily_schedule, '{}'::jsonb),
       now()
from public.offseason_program
where id = 1
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. offseason_logs : dimension program_id (DEFAULT '1' pour le backfill)
-- ----------------------------------------------------------------------------
alter table public.offseason_logs
  add column if not exists program_id text not null default '1';

-- FK vers programs (cascade : supprimer un programme purge ses logs).
-- Ajoutée seulement si absente, et seulement si toutes les valeurs pointent
-- vers un programme existant (sinon la contrainte échouerait).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'offseason_logs' and constraint_name = 'offseason_logs_program_id_fkey'
  ) and not exists (
    -- garde-fou : aucune ligne orpheline (program_id sans programme correspondant)
    select 1 from public.offseason_logs l
    where not exists (select 1 from public.programs p where p.id = l.program_id)
  ) then
    alter table public.offseason_logs
      add constraint offseason_logs_program_id_fkey
      foreign key (program_id) references public.programs(id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. PK composite étendue : (player_id, iso_week, exercise_id) → + program_id
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'offseason_logs' and constraint_type = 'PRIMARY KEY'
  ) then
    alter table public.offseason_logs drop constraint offseason_logs_pkey;
  end if;
end $$;

alter table public.offseason_logs
  add constraint offseason_logs_pkey
  primary key (player_id, program_id, iso_week, exercise_id);

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   alter table public.offseason_logs drop constraint offseason_logs_pkey;
--   alter table public.offseason_logs add constraint offseason_logs_pkey
--     primary key (player_id, iso_week, exercise_id);
--   alter table public.offseason_logs drop constraint if exists offseason_logs_program_id_fkey;
--   alter table public.offseason_logs drop column if exists program_id;
--   drop table if exists public.programs cascade;
-- ============================================================================
