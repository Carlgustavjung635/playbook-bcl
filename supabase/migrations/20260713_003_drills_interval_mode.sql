-- ============================================================================
-- Migration : DRILL — mode « interval » (fractionné / HIIT / Tabata)
-- ----------------------------------------------------------------------------
-- 3e mode de drill à côté de `stimulus` et `circuit` : `interval`. Structure
-- fixe = Échauffement (optionnel) + Cycles Work/Rest + Cool-down (optionnel),
-- avec progression optionnelle (linéaire / pyramide / cycles variables).
--
-- `interval_config` : jsonb libre (validé CÔTÉ FRONT, comme stimuli_json/stages).
-- `is_preset` : marqueur pour les presets perso réutilisables (drills que le
--   coach sauvegarde comme modèles, listés dans le picker Niveau 1).
--
-- Backward-compat : drills existants → mode inchangé, interval_config NULL,
-- is_preset false. Additive + idempotente.
-- ============================================================================

-- 1. Élargir le CHECK du mode (stimulus | circuit → + interval)
alter table public.drills drop constraint if exists drills_mode_check;
alter table public.drills add constraint drills_mode_check
  check (mode in ('stimulus', 'circuit', 'interval'));

-- 2. Config du fractionné (jsonb libre)
alter table public.drills add column if not exists interval_config jsonb;

-- 3. Marqueur preset perso réutilisable
alter table public.drills add column if not exists is_preset boolean not null default false;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.drills drop column if exists is_preset;
--   alter table public.drills drop column if exists interval_config;
--   alter table public.drills drop constraint if exists drills_mode_check;
--   alter table public.drills add constraint drills_mode_check
--     check (mode in ('stimulus','circuit'));
-- ============================================================================
