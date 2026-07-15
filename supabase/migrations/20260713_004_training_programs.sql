-- ============================================================================
-- Migration : PRÉPA « FULL PACKAGE » (training_programs + training_sessions
--             + training_completions)
-- ----------------------------------------------------------------------------
-- Programme d'entraînement individuel piloté par le coach : N sessions (une par
-- jour actif de la semaine), chaque session = N blocs (jsonb) déclinés en 3
-- niveaux de contrat (min / med / ultra). La joueuse choisit son niveau, exécute,
-- valide → 1 row training_completions = 1 séance faite, avec son scoring.
--
-- NOMMAGE — pourquoi `training_*` et pas `programs` :
-- la table `public.programs` EXISTE DÉJÀ (module prépa estivale / offseason, cf.
-- PR #52) avec un schéma DIFFÉRENT et incompatible (steps hebdo + schedule
-- journalier en jsonb, pas de sessions ni de scoring). Les deux modules
-- coexistent : ce chantier NE TOUCHE PAS `programs` — l'offseason est seulement
-- retiré de la NAV côté front, ses données restent en base pour audit.
-- Ne JAMAIS fusionner les deux tables sans reprise de données explicite.
--
-- POSTURE RLS : anon « sandbox équipe » (using(true)/with check(true)), IDENTIQUE
-- à gages/coaches/drills. L'app n'a pas d'auth utilisateur final (PIN L1 + rôle
-- anon Supabase) → les writes passent en anon ; une policy « authenticated »
-- casserait les writes. Le contrôle CRUD coach-only est appliqué CÔTÉ FRONT.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère
-- lui-même les ids via uid() (format 'x…'), et ce préfixe 'x' est l'heuristique
-- anti-wipe de tous les apply() de PbSync (pendingLocal = id.startsWith('x')).
-- Une PK uuid native casserait la sync.
--
-- Idempotente (if not exists / drop policy if exists / garde pg_publication_tables).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) PROGRAMMES
-- ----------------------------------------------------------------------------
create table if not exists public.training_programs (
  id             text primary key default gen_random_uuid()::text,
  name           text not null default '',
  description    text,
  start_date     date not null,
  end_date       date not null,
  -- Jours actifs, norme ISO-8601 : 1 = lundi … 7 = dimanche.
  days_active    integer[] not null default '{}',
  -- Barème. Ex : {"points":{"min":10,"med":20,"ultra":30},
  --               "squad_multiplier":2,"post_bonus":10,"remind_hour":9}
  -- Stocké par programme (et non global) pour que 2 programmes actifs puissent
  -- avoir des barèmes différents sans se contaminer.
  scoring_config jsonb not null default '{}'::jsonb,
  created_by     text references public.coaches(id) on delete set null,
  team_tag       text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists training_programs_deleted_at_idx on public.training_programs (deleted_at);
create index if not exists training_programs_active_idx on public.training_programs (is_active, start_date, end_date);

-- ----------------------------------------------------------------------------
-- 2) SESSIONS (1 par jour actif ; is_template = modèle réutilisable hors programme)
-- ----------------------------------------------------------------------------
create table if not exists public.training_sessions (
  id             text primary key default gen_random_uuid()::text,
  program_id     text references public.training_programs(id) on delete cascade,
  -- 1 = lundi … 7 = dimanche. Non contraint NOT NULL : un modèle (is_template)
  -- n'est rattaché à aucun jour ni à aucun programme.
  day_of_week    integer check (day_of_week is null or (day_of_week between 1 and 7)),
  name           text not null default '',
  format_label   text,
  intro_text     text,
  notes_recovery text,
  -- [{ id, type, name, instructions, levels:{min|med|ultra:{text,drill_id}},
  --    track_distance }] — cf. _dumpTrainingSessionRow côté front.
  blocks         jsonb not null default '[]'::jsonb,
  is_template    boolean not null default false,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists training_sessions_program_day_idx on public.training_sessions (program_id, day_of_week);
create index if not exists training_sessions_template_idx on public.training_sessions (is_template) where is_template;

-- ----------------------------------------------------------------------------
-- 3) VALIDATIONS (1 row = 1 séance faite par 1 joueuse à 1 date prévue)
-- ----------------------------------------------------------------------------
create table if not exists public.training_completions (
  id                text primary key default gen_random_uuid()::text,
  program_id        text not null references public.training_programs(id) on delete cascade,
  session_id        text not null references public.training_sessions(id) on delete cascade,
  player_id         text not null,
  -- Jour PRÉVU (pas celui de la validation) : porte le rattrapage 48 h et
  -- l'unicité. date_completed = instant réel de la validation.
  date_planned      date not null,
  date_completed    timestamptz not null default now(),
  contract_level    text not null check (contract_level in ('min','med','ultra')),
  -- base_points = barème du niveau AU MOMENT de la validation (figé : rejouer le
  -- barème courant réécrirait l'historique si le coach le change en cours de
  -- programme). points_total = base × squad_multiplier + post_bonus, 0 si hors
  -- délai de rattrapage. Cf. _trainingPointsFor (fonction pure, testée).
  base_points       integer not null default 0,
  squad_teammate_id text,
  squad_photo_url   text,
  post_photo_url    text,
  post_message      text,
  running_distance_km numeric,
  points_total      integer not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists training_completions_player_program_idx
  on public.training_completions (player_id, program_id, date_planned);
-- Une seule validation par (joueuse, session, jour prévu). Partiel sur les rows
-- vivantes : une validation soft-deleted ne doit pas bloquer une re-validation.
create unique index if not exists training_completions_unique_idx
  on public.training_completions (player_id, session_id, date_planned)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4) RLS (anon, cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.training_programs enable row level security;
drop policy if exists training_programs_all on public.training_programs;
create policy "training_programs_all" on public.training_programs for all using (true) with check (true);

alter table public.training_sessions enable row level security;
drop policy if exists training_sessions_all on public.training_sessions;
create policy "training_sessions_all" on public.training_sessions for all using (true) with check (true);

alter table public.training_completions enable row level security;
drop policy if exists training_completions_all on public.training_completions;
create policy "training_completions_all" on public.training_completions for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 5) REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'training_programs') then
    alter publication supabase_realtime add table public.training_programs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'training_sessions') then
    alter publication supabase_realtime add table public.training_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'training_completions') then
    alter publication supabase_realtime add table public.training_completions;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6) BUCKET STORAGE (photos squad + post ; public, comme drill-images)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('training-photos', 'training-photos', true)
on conflict (id) do nothing;

drop policy if exists "training_photos_read" on storage.objects;
create policy "training_photos_read" on storage.objects
  for select using (bucket_id = 'training-photos');
drop policy if exists "training_photos_insert" on storage.objects;
create policy "training_photos_insert" on storage.objects
  for insert with check (bucket_id = 'training-photos');
drop policy if exists "training_photos_update" on storage.objects;
create policy "training_photos_update" on storage.objects
  for update using (bucket_id = 'training-photos');
drop policy if exists "training_photos_delete" on storage.objects;
create policy "training_photos_delete" on storage.objects
  for delete using (bucket_id = 'training-photos');

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.training_completions;
--   drop table if exists public.training_sessions;
--   drop table if exists public.training_programs;
--   delete from storage.objects where bucket_id = 'training-photos';
--   delete from storage.buckets where id = 'training-photos';
--   -- (les policies storage tombent avec drop policy if exists ci-dessus)
-- NE PAS toucher public.programs (module offseason, indépendant).
-- ============================================================================
