-- ============================================================================
-- Migration : MULTI-PDF stats FFBB par match (refonte du singulier vers liste)
-- ----------------------------------------------------------------------------
-- La FFBB fournit PLUSIEURS documents par match (feuille de match, stats
-- équipe, stats individuelles…). On passe du modèle singulier (1 PDF/match,
-- colonnes stats_pdf_* de la migration 20260607_007) à une liste JSONB.
--
-- Chaque item de `matches.stats_pdfs` :
--   { "id": "uuid", "url": "https://…", "filename": "Feuille de match.pdf",
--     "shared": true, "uploaded_at": "2026-06-07T…" }
-- `shared` est PAR PDF : le coach choisit individuellement lesquels diffuser
-- aux joueuses.
--
-- Les anciennes colonnes stats_pdf_* sont CONSERVÉES (rétro-compat le temps que
-- tous les clients front passent au nouveau format) — la nouvelle UI les ignore.
-- À supprimer dans une migration ultérieure si besoin.
--
-- Idempotente : rejouable (add column if not exists + backfill conditionnel).
-- Le bucket Storage 'match-stats' reste celui de la migration 007 (inchangé).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Nouvelle colonne JSONB pour la liste des PDFs
-- ----------------------------------------------------------------------------
alter table public.matches
  add column if not exists stats_pdfs jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. Backfill : convertir l'ancien champ singulier en array d'1 élément.
--    Ne touche que les matches qui ont un PDF singulier ET pas encore de liste
--    (rejouable : where jsonb_array_length(stats_pdfs) = 0).
-- ----------------------------------------------------------------------------
update public.matches
set stats_pdfs = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid()::text,
  'url', stats_pdf_url,
  'filename', coalesce(stats_pdf_filename, 'Feuille de stats FFBB.pdf'),
  'shared', coalesce(stats_pdf_shared, false),
  'uploaded_at', stats_pdf_uploaded_at
))
where stats_pdf_url is not null
  and stats_pdf_url <> ''
  and (stats_pdfs is null or jsonb_array_length(stats_pdfs) = 0);

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   alter table public.matches drop column if exists stats_pdfs;
--   (les colonnes stats_pdf_* singulières sont toujours là, rien d'autre à faire)
-- ============================================================================
