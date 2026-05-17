-- ============================================================================
-- Multi-vidéos par play : ajoute une colonne `videos jsonb` qui stocke un
-- tableau de [{url, label?}]. La colonne `video_url` legacy reste pour
-- backward compat (= videos[0].url à l'écriture).
-- ============================================================================

alter table public.plays
  add column if not exists videos jsonb not null default '[]'::jsonb;

-- Backfill : pour chaque play avec un video_url legacy mais sans videos,
-- créer un array à un seul élément.
update public.plays
   set videos = jsonb_build_array(jsonb_build_object('url', video_url))
 where (videos is null or videos = '[]'::jsonb)
   and video_url is not null
   and video_url <> '';
