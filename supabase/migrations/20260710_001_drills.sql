-- ============================================================================
-- Migration : DRILL RÉACTION (drills + drill_images + bucket Storage)
-- ----------------------------------------------------------------------------
-- Builder de drills de réaction (façon ReaXing/BlazePod) : le coach compose une
-- séquence de stimuli aléatoires (couleurs / flèches / chiffres / lettres /
-- formes / images) affichés plein écran, avec durée d'affichage, délai noir et
-- bip audio. Bibliothèque commune : tous les coachs (admin ou non) ont un CRUD
-- complet ; les joueuses sont en lecture seule (ajustements éphémères côté client
-- uniquement, jamais persistés).
--
-- POSTURE RLS : anon « sandbox équipe » (using(true)/with check(true)), IDENTIQUE
-- à gages/coaches. L'app n'a pas d'auth utilisateur final (PIN L1 + rôle anon
-- Supabase) → les writes passent en anon ; une policy « authenticated » casserait
-- les writes. Le contrôle CRUD coach-only est appliqué CÔTÉ FRONT (comme le chrono).
--
-- Idempotente (if not exists / drop policy if exists / on conflict do nothing).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) DRILLS
-- ----------------------------------------------------------------------------
create table if not exists public.drills (
  id             text primary key default gen_random_uuid()::text,
  name           text not null default '',
  created_by     text references public.coaches(id) on delete set null,
  stimuli_json   jsonb not null default '{}'::jsonb,
  length_ms      int not null default 7000,
  delay_ms       int not null default 500,
  audio_beep     boolean not null default true,
  duration_mode  text not null default 'rounds' check (duration_mode in ('rounds','countdown')),
  duration_value int not null default 10,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists drills_deleted_at_idx on public.drills (deleted_at);

alter table public.drills enable row level security;
drop policy if exists drills_all on public.drills;
create policy "drills_all" on public.drills for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2) DRILL_IMAGES (métadonnées ; le binaire vit dans le bucket Storage)
-- ----------------------------------------------------------------------------
create table if not exists public.drill_images (
  id            text primary key default gen_random_uuid()::text,
  uploaded_by   text references public.coaches(id) on delete set null,
  storage_path  text not null,
  label         text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists drill_images_deleted_at_idx on public.drill_images (deleted_at);

alter table public.drill_images enable row level security;
drop policy if exists drill_images_all on public.drill_images;
create policy "drill_images_all" on public.drill_images for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 3) REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'drills') then
    alter publication supabase_realtime add table public.drills;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'drill_images') then
    alter publication supabase_realtime add table public.drill_images;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4) BUCKET STORAGE `drill-images` (public read, anon write — comme play-images)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('drill-images', 'drill-images', true)
on conflict (id) do nothing;

drop policy if exists "drill_images_anon_read"   on storage.objects;
drop policy if exists "drill_images_anon_insert" on storage.objects;
drop policy if exists "drill_images_anon_update" on storage.objects;
drop policy if exists "drill_images_anon_delete" on storage.objects;

create policy "drill_images_anon_read"
  on storage.objects for select to anon using (bucket_id = 'drill-images');
create policy "drill_images_anon_insert"
  on storage.objects for insert to anon with check (bucket_id = 'drill-images');
create policy "drill_images_anon_update"
  on storage.objects for update to anon using (bucket_id = 'drill-images') with check (bucket_id = 'drill-images');
create policy "drill_images_anon_delete"
  on storage.objects for delete to anon using (bucket_id = 'drill-images');

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.drill_images cascade;
--   drop table if exists public.drills cascade;
--   delete from storage.buckets where id='drill-images';
-- ============================================================================
