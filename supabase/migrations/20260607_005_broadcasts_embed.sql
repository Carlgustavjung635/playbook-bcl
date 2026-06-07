-- ============================================================================
-- Migration : diffusions coach — support vidéo HÉBERGÉE par URL (embed)
-- ----------------------------------------------------------------------------
-- Itération chantier D. En plus de l'upload de fichier (bucket broadcast-media),
-- le coach peut coller une URL de vidéo hébergée (YouTube, Vimeo, Instagram, ou
-- lien direct). Dans ce cas media_type = 'embed' et media_url = l'URL externe ;
-- le front parse l'URL pour générer une iframe responsive (parseEmbedUrl).
--
-- Seul changement de schéma : étendre le CHECK de broadcasts.media_type pour
-- accepter 'embed'. Le CHECK inline d'origine (migration 20260607_004) a un nom
-- auto-généré → on le retrouve dynamiquement et on le remplace par un CHECK
-- nommé déterministe (rejouable).
--
-- Idempotente : drop dynamique de l'ancien CHECK + add du nouveau seulement s'il
-- n'existe pas déjà.
-- ============================================================================

do $$
declare
  c_name text;
begin
  -- 1. Retrouver et supprimer TOUT CHECK existant portant sur media_type
  --    (le nom auto-généré était probablement broadcasts_media_type_check).
  for c_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'broadcasts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%media_type%'
  loop
    execute format('alter table public.broadcasts drop constraint %I', c_name);
  end loop;

  -- 2. (Ré)ajouter le CHECK étendu sous un nom déterministe, s'il manque.
  if not exists (
    select 1 from pg_constraint
    where conname = 'broadcasts_media_type_check2'
      and conrelid = 'public.broadcasts'::regclass
  ) then
    alter table public.broadcasts
      add constraint broadcasts_media_type_check2
      check (media_type in ('image', 'video', 'embed') or media_type is null);
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   alter table public.broadcasts drop constraint if exists broadcasts_media_type_check2;
--   alter table public.broadcasts add constraint broadcasts_media_type_check
--     check (media_type in ('image','video') or media_type is null);
-- ============================================================================
