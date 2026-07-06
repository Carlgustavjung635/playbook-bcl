-- ============================================================================
-- Migration : SUPPRESSION DOUCE DES GAGES (gages.deleted_at)
-- ----------------------------------------------------------------------------
-- Le coach peut désormais MODIFIER (texte) et SUPPRIMER un gage du pool. La
-- suppression est DOUCE (deleted_at timestamptz) et non un DELETE dur : les
-- tirages passés (gage_draws.gage_id) qui référencent ce gage doivent rester
-- consultables dans l'historique. Un gage deleted_at != null :
--   - n'apparaît plus dans le pool coach ni dans le réservoir tirable (front) ;
--   - reste résolu par son id pour afficher son texte dans l'historique.
--
-- Même posture que les broadcasts (migration 20260610_001_broadcasts_soft_delete).
-- Idempotente (add column if not exists).
-- ============================================================================

alter table public.gages
  add column if not exists deleted_at timestamptz;

-- Rollback (manuel) : alter table public.gages drop column if exists deleted_at;
