-- ============================================================================
-- Migration : DIFFUSIONS COACH (broadcasts) + accusés de réception
-- ----------------------------------------------------------------------------
-- Chantier D. Le coach crée un "broadcast" = message + média optionnel
-- (image/vidéo) + ciblage (toute l'équipe / E1 / E2 / sélection de joueuses).
-- À la prochaine ouverture de l'app, chaque joueuse ciblée voit une popup
-- modale avec le contenu + 2 boutons : "Skip" (vu, pas confirmé) /
-- "Compris 🫡" (réception confirmée).
--
-- Deux tables :
--   broadcasts          : 1 row par diffusion (créée par le coach)
--   broadcast_receipts  : 1 row par couple (broadcast × joueuse) = statut
--                         pending → seen / skipped / acknowledged
--
-- Posture RLS : "sandbox équipe" anon (cohérent avec programs, offseason_logs,
-- team_reviews, convocations… — l'app utilise le rôle anon pour toute l'équipe,
-- le contrôle d'accès réel se fait côté front via le PIN L1). Si plus tard on
-- durcit l'auth, on resserrera ici.
--
-- + bucket Storage "broadcast-media" (image/vidéo, public read, anon write).
--
-- Idempotente : rejouable (if not exists / drop policy if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table broadcasts (créés par le coach)
-- ----------------------------------------------------------------------------
create table if not exists public.broadcasts (
  id                text primary key,
  coach_id          text,
  message           text not null,
  media_url         text,
  media_type        text check (media_type in ('image','video') or media_type is null),
  target_type       text not null default 'team' check (target_type in ('team','players','e1','e2')),
  target_player_ids jsonb not null default '[]'::jsonb,
  season_id         text references public.seasons(id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  archived          boolean not null default false
);

-- ----------------------------------------------------------------------------
-- 2. Table broadcast_receipts (un par couple broadcast × joueuse)
-- ----------------------------------------------------------------------------
create table if not exists public.broadcast_receipts (
  broadcast_id text not null references public.broadcasts(id) on delete cascade,
  player_id    text not null,
  status       text not null default 'pending'
               check (status in ('pending','seen','skipped','acknowledged')),
  seen_at      timestamptz,
  acted_at     timestamptz,
  primary key (broadcast_id, player_id)
);

create index if not exists broadcast_receipts_player_idx
  on public.broadcast_receipts (player_id);

-- ----------------------------------------------------------------------------
-- 3. RLS (posture anon "sandbox équipe", comme le reste de l'app)
-- ----------------------------------------------------------------------------
alter table public.broadcasts enable row level security;
drop policy if exists broadcasts_all on public.broadcasts;
create policy "broadcasts_all"
  on public.broadcasts for all using (true) with check (true);

alter table public.broadcast_receipts enable row level security;
drop policy if exists broadcast_receipts_all on public.broadcast_receipts;
create policy "broadcast_receipts_all"
  on public.broadcast_receipts for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4. Realtime (suivi coach en direct + popup joueuse instantanée)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'broadcasts'
  ) then
    alter publication supabase_realtime add table public.broadcasts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'broadcast_receipts'
  ) then
    alter publication supabase_realtime add table public.broadcast_receipts;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Bucket Storage "broadcast-media" (image + vidéo). public read, anon write.
--    file_size_limit 52 Mo (vidéos courtes < 30 Mo + marge).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'broadcast-media', 'broadcast-media', true, 52428800,
    array['image/jpeg','image/png','image/webp','image/gif',
          'video/mp4','video/quicktime','video/webm']
  )
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "broadcast_media_anon_read"   on storage.objects;
drop policy if exists "broadcast_media_anon_insert" on storage.objects;
drop policy if exists "broadcast_media_anon_update" on storage.objects;
drop policy if exists "broadcast_media_anon_delete" on storage.objects;

create policy "broadcast_media_anon_read"
  on storage.objects for select to anon
  using (bucket_id = 'broadcast-media');

create policy "broadcast_media_anon_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'broadcast-media');

create policy "broadcast_media_anon_update"
  on storage.objects for update to anon
  using (bucket_id = 'broadcast-media')
  with check (bucket_id = 'broadcast-media');

create policy "broadcast_media_anon_delete"
  on storage.objects for delete to anon
  using (bucket_id = 'broadcast-media');

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   drop table if exists public.broadcast_receipts cascade;
--   drop table if exists public.broadcasts cascade;
--   delete from storage.buckets where id = 'broadcast-media';
-- ============================================================================
