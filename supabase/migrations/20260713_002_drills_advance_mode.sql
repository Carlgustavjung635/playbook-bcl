-- ============================================================================
-- Migration : DRILL CIRCUIT — mode de passage entre étapes (auto / manuel)
-- ----------------------------------------------------------------------------
-- `advance_mode` au niveau du circuit (drill) :
--   'auto'   : chaque étape avance selon sa règle propre (cap / temps écoulé)
--   'manual' : toutes les étapes forcent le tap « Suivant » (ignore auto_cap /
--              advance_after_ms des étapes individuelles)
-- NULL = 'auto' (backward-compat : les circuits existants restent en auto).
--
-- Le temps de repos entre étapes (`rest_after_ms`) vit dans le jsonb `stages`
-- (par étape) → pas de nouvelle colonne nécessaire.
--
-- Additive + idempotente.
-- ============================================================================

alter table public.drills add column if not exists advance_mode text
  check (advance_mode in ('auto', 'manual'));

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.drills drop constraint if exists drills_advance_mode_check;
--   alter table public.drills drop column if exists advance_mode;
-- ============================================================================
