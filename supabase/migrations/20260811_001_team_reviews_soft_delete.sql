-- ============================================================================
-- Migration : SUPPRESSION DOUCE DES RESSENTIS ÉQUIPE (team_reviews)
-- ----------------------------------------------------------------------------
-- L'admin peut retirer un ressenti manifestement hors sujet (test, insulte,
-- doublon). La suppression est DOUCE, jamais un DELETE dur, pour deux raisons :
--
--   1. Traçabilité. Un ressenti est une parole de joueuse : on doit pouvoir
--      dire QUI l'a retiré et QUAND. D'où `deleted_by` (id du coach, aligné sur
--      coaches.id) en plus de `deleted_at`.
--   2. Contrainte du moteur de sync. Un DELETE dur ne tue pas durablement une
--      ligne : le premier appareil dont le localStorage contient encore
--      l'entrée la repousse au flush suivant. Le seul état terminal stable
--      dans PbSync est le soft-delete (même posture que broadcasts
--      20260610_001 et gages 20260706_001).
--
-- Une ligne deleted_at != null n'est plus affichée nulle part côté front (ni
-- carte d'accueil coach, ni tableau de bord, ni historique joueuse) et ne
-- compte dans AUCUNE moyenne.
--
-- Idempotente (add column if not exists) : rejouable sans risque.
-- ============================================================================

alter table public.team_reviews
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

-- Index partiel : toutes les lectures filtrent sur « non supprimé ».
create index if not exists team_reviews_active_idx
  on public.team_reviews (player_id, date desc)
  where deleted_at is null;

-- Rollback (manuel) :
--   drop index if exists public.team_reviews_active_idx;
--   alter table public.team_reviews
--     drop column if exists deleted_at,
--     drop column if exists deleted_by;
