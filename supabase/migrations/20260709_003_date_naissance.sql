-- ============================================================================
-- Migration : DATE DE NAISSANCE (joueuses + coachs)
-- ----------------------------------------------------------------------------
-- Colonne `date_naissance date` (nullable) sur players ET coaches (profils
-- joueuse + coach admin/non-admin). Sert à l'affichage anniversaire + âge
-- calculé côté front. Bornes plausibles (1950-01-01 .. today-8ans) enforcées
-- côté UI ; la DB reste permissive (nullable) pour ne rien casser.
--
-- IDEMPOTENTE (add column if not exists). SAFE data existante.
-- ============================================================================

alter table public.players add column if not exists date_naissance date;
alter table public.coaches add column if not exists date_naissance date;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.players drop column if exists date_naissance;
--   alter table public.coaches drop column if exists date_naissance;
-- ============================================================================
