-- ============================================================================
-- Migration : DRILL RÉACTION — mode « circuit training »
-- ----------------------------------------------------------------------------
-- Nouveau mode de drill à côté du `stimulus` classique : `circuit`. Un circuit =
-- N étapes séquentielles (jsonb array `stages`), chaque étape étant :
--   - counter   : compteur croissant/décroissant (nombre géant, s'incrémente
--                 d'un pas toutes les X s ; pas fixe/paliers/multiplicateur/interp)
--   - countdown : chrono descendant (réutilise le moteur countdown existant)
--   - stimulus  : le drill de réaction classique (réutilise la config stimuli)
--
-- Chaque étape porte ses propres réglages audio (bip) + voix (TTS Web Speech).
--
-- Backward-compat : les drills existants n'ont pas `mode` → default 'stimulus',
-- et `stages` NULL (le runtime stimulus classique reste inchangé). Le champ
-- `stages` est libre (jsonb), validé CÔTÉ FRONT (comme stimuli_json). Aucune
-- contrainte de forme en base pour rester souple sur l'évolution du schéma étape.
--
-- POSTURE RLS : inchangée (policy `drills_all` anon héritée de _001). Additive +
-- idempotente.
-- ============================================================================

alter table public.drills add column if not exists mode text not null default 'stimulus'
  check (mode in ('stimulus', 'circuit'));

alter table public.drills add column if not exists stages jsonb;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.drills drop column if exists stages;
--   alter table public.drills drop constraint if exists drills_mode_check;
--   alter table public.drills drop column if exists mode;
-- ============================================================================
