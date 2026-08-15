-- ============================================================================
-- Migration : DÉFIS — éditer un score APRÈS le chrono (journal d'édition)
-- ----------------------------------------------------------------------------
-- Contexte : sur un défi « chrono » (timed) ou « compte à rebours »
-- (countdown_score), la tentative était figée dès la fin du chrono. Deux cas
-- réels le rendaient faux :
--   1) le dernier tir était EN L'AIR au buzzer → le panier doit pouvoir être
--      ajouté après coup ;
--   2) on lance le chrono comme simple minuteur et on rentre le total à la fin.
--
-- On ouvre donc l'édition rétroactive d'une tentative (joueuse ET coach), avec
-- une trace : qui a édité, quand, et la valeur d'AVANT cette édition.
--
--   edited_by      : id de l'acteur (joueuse ou coach) ayant fait la dernière
--                    édition. NULL = jamais éditée.
--   edited_at      : horodatage de la dernière édition.
--   previous_score : valeur juste AVANT la dernière édition — `made` en mode
--                    series/countdown_score, `duration_ms` en mode timed
--                    (les ms tiennent largement dans un int4).
--
-- Additive + idempotente. Aucune tentative existante n'est touchée : sans
-- édition, les 3 colonnes restent NULL et l'agrégat est inchangé.
-- ============================================================================

alter table public.challenge_series add column if not exists edited_by text;
alter table public.challenge_series add column if not exists edited_at timestamptz;
alter table public.challenge_series add column if not exists previous_score int;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.challenge_series
--     drop column if exists edited_by,
--     drop column if exists edited_at,
--     drop column if exists previous_score;
-- ============================================================================
