-- ============================================================================
-- Images de plays : sortir le base64 du localStorage (cap 5 MB → corruption
-- silencieuse quota) et l'héberger dans un bucket Storage Supabase public.
--
-- Modèle :
--   plays.images jsonb = tableau de strings (URL publique du bucket)
--   bucket "play-images" = public read, anon write/delete (cohérent avec le
--   reste de l'app qui utilise le rôle anon pour toute l'équipe)
--
-- Backward compat : les anciennes images base64 (data:image/jpeg;base64,...)
-- restent renderable en <img src> côté client ; à la prochaine édition du play
-- les nouvelles images partiront direct dans Storage.
-- ============================================================================

alter table public.plays
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Bucket public pour les images de plays
insert into storage.buckets (id, name, public)
  values ('play-images', 'play-images', true)
on conflict (id) do nothing;

-- Politiques RLS du bucket. On garde la même posture anon que le reste
-- (l'app n'a pas d'auth utilisateur final, juste un PIN local + rôle anon
-- pour Supabase). Si plus tard on durcit, on resserrera.
drop policy if exists "play_images_anon_read"   on storage.objects;
drop policy if exists "play_images_anon_insert" on storage.objects;
drop policy if exists "play_images_anon_update" on storage.objects;
drop policy if exists "play_images_anon_delete" on storage.objects;

create policy "play_images_anon_read"
  on storage.objects for select to anon
  using (bucket_id = 'play-images');

create policy "play_images_anon_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'play-images');

create policy "play_images_anon_update"
  on storage.objects for update to anon
  using (bucket_id = 'play-images')
  with check (bucket_id = 'play-images');

create policy "play_images_anon_delete"
  on storage.objects for delete to anon
  using (bucket_id = 'play-images');
