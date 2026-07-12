-- ============================================================================
-- Migration : DÉFIS — paliers (tiers) + mode countdown_score + peer entry (audit)
-- ----------------------------------------------------------------------------
-- 1) Nouveau mode `countdown_score` : compter des réussis pendant un compte à
--    rebours (« combien de LF en X min »). Agrégat sur `made` (best défaut).
-- 2) `countdown_ms` : durée du compte à rebours.
-- 3) `tiers` jsonb : paliers configurables [{name, threshold}]. Direction du
--    seuil dérivée de lower_is_better (≥ si false, ≤ si true).
-- 4) `challenge_series.entered_by` : traçabilité peer entry (qui a saisi la
--    tentative). NULL = le joueur lui-même.
--
-- Additive + idempotente. Défis existants intacts.
-- ============================================================================

alter table public.challenges drop constraint if exists challenges_mode_check;
alter table public.challenges add constraint challenges_mode_check
  check (mode in ('single','series','timed','countdown_score'));

alter table public.challenges add column if not exists countdown_ms int;
alter table public.challenges add column if not exists tiers jsonb not null default '[]'::jsonb;

alter table public.challenge_series add column if not exists entered_by text;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.challenge_series drop column if exists entered_by;
--   alter table public.challenges drop column if exists countdown_ms, drop column if exists tiers;
--   alter table public.challenges drop constraint if exists challenges_mode_check;
--   alter table public.challenges add constraint challenges_mode_check
--     check (mode in ('single','series','timed'));
-- ============================================================================
