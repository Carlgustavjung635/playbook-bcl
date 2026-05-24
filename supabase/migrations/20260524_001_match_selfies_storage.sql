-- ============================================================================
-- Selfie victoire : sortir le base64 du localStorage (quota silencieux + jamais
-- synchronisé entre devices) et l'héberger dans un bucket Storage Supabase
-- public, exactement comme PR #22 a fait pour les images de plays.
--
-- Modèle :
--   matches.win_selfie_url text = URL publique du bucket (nullable)
--   bucket "match-selfies" = public read, anon write/delete (cohérent avec
--   "play-images" et le reste de l'app, qui utilise le rôle anon pour toute
--   l'équipe + PIN local côté front).
--
-- Backward compat : les anciens selfies base64 (data:image/jpeg;base64,...)
-- restent affichables en <img src> côté client tant qu'ils vivent encore en
-- localStorage. Le helper JS migrateLocalSelfiesToStorage() les uploade puis
-- remplace le base64 par l'URL Storage dans state.matches + DB.
-- ============================================================================

-- 1. Colonne sur public.matches (nullable, defaut null)
alter table public.matches
  add column if not exists win_selfie_url text;

-- 2. Bucket public pour les selfies de victoire
insert into storage.buckets (id, name, public)
  values ('match-selfies', 'match-selfies', true)
on conflict (id) do nothing;

-- 3. Politiques RLS du bucket. Même posture anon que le reste, identique au
--    bucket play-images créé dans 20260519_001. Si plus tard on durcit l'auth
--    coach, on resserrera ici aussi.
drop policy if exists "match_selfies_anon_read"   on storage.objects;
drop policy if exists "match_selfies_anon_insert" on storage.objects;
drop policy if exists "match_selfies_anon_update" on storage.objects;
drop policy if exists "match_selfies_anon_delete" on storage.objects;

create policy "match_selfies_anon_read"
  on storage.objects for select to anon
  using (bucket_id = 'match-selfies');

create policy "match_selfies_anon_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'match-selfies');

create policy "match_selfies_anon_update"
  on storage.objects for update to anon
  using (bucket_id = 'match-selfies')
  with check (bucket_id = 'match-selfies');

create policy "match_selfies_anon_delete"
  on storage.objects for delete to anon
  using (bucket_id = 'match-selfies');
