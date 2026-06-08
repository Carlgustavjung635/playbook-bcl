-- ============================================================================
-- Migration : STATS PDF FFBB côté coach (import + diffusion joueuses)
-- ----------------------------------------------------------------------------
-- Feature 1. Dans la fiche match, le coach peut importer le PDF de statistiques
-- officiel de la FFBB (feuille de match / box score exporté). Une checkbox
-- "Diffuser aux joueuses" décide si ce PDF apparaît dans la vue match côté
-- joueuse (sinon il reste visible coach uniquement).
--
-- On ajoute 4 colonnes optionnelles, nullables / défaut, rétro-compat sur la
-- table `matches` existante (AUCUNE nouvelle table) :
--
--   matches.stats_pdf_url         text  : URL publique Storage du PDF (bucket
--                                          match-stats). null = pas de PDF.
--   matches.stats_pdf_filename    text  : nom de fichier original (affichage).
--   matches.stats_pdf_shared      bool  : true = visible par les joueuses.
--   matches.stats_pdf_uploaded_at timestamptz : horodatage de l'upload.
--
-- + bucket Storage "match-stats" (PDF uniquement, public read, anon write —
--   même posture "sandbox équipe" que broadcast-media / match-selfies).
--
-- Idempotente : rejouable (add column if not exists / on conflict / drop policy
-- if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes stats PDF sur matches
-- ----------------------------------------------------------------------------
alter table public.matches
  add column if not exists stats_pdf_url         text,
  add column if not exists stats_pdf_filename    text,
  add column if not exists stats_pdf_shared      boolean not null default false,
  add column if not exists stats_pdf_uploaded_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Bucket Storage "match-stats" (PDF). public read, anon write.
--    file_size_limit 10 Mo (PDF feuille de match FFBB = quelques centaines Ko).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'match-stats', 'match-stats', true, 10485760,
    array['application/pdf']
  )
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "match_stats_anon_read"   on storage.objects;
drop policy if exists "match_stats_anon_insert" on storage.objects;
drop policy if exists "match_stats_anon_update" on storage.objects;
drop policy if exists "match_stats_anon_delete" on storage.objects;

create policy "match_stats_anon_read"
  on storage.objects for select to anon
  using (bucket_id = 'match-stats');

create policy "match_stats_anon_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'match-stats');

create policy "match_stats_anon_update"
  on storage.objects for update to anon
  using (bucket_id = 'match-stats')
  with check (bucket_id = 'match-stats');

create policy "match_stats_anon_delete"
  on storage.objects for delete to anon
  using (bucket_id = 'match-stats');

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   alter table public.matches drop column if exists stats_pdf_url;
--   alter table public.matches drop column if exists stats_pdf_filename;
--   alter table public.matches drop column if exists stats_pdf_shared;
--   alter table public.matches drop column if exists stats_pdf_uploaded_at;
--   delete from storage.buckets where id = 'match-stats';
-- ============================================================================
