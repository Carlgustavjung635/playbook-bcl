-- ============================================================================
-- Migration : DIFFUSIONS scopées par saison (fix cumul cross-saison)
-- ----------------------------------------------------------------------------
-- Symptôme (remonté user) : les diffusions/sondages d'une saison continuaient
-- d'apparaître à la nouvelle saison (popup joueuse + dashboard coach + badge),
-- exactement comme le bug des défis auto (fix PR #61).
--
-- La colonne `broadcasts.season_id` existait DÉJÀ (migration _004) mais n'avait
-- jamais été backfillée → toutes les diffusions actuelles ont season_id NULL,
-- et le front (sans filtre saison) les montrait quelle que soit la saison.
--
-- Ce que fait cette migration :
--   1. BACKFILL : assigne toutes les diffusions sans season_id à la saison
--      ACTIVE actuelle ('2025-2026'). Après ça, quand on basculera en saison
--      N+1, ces diffusions (season_id='2025-2026') seront filtrées côté front.
--   2. season_id reste NULLABLE (rollback safe) : un broadcast futur sans
--      season_id est rattaché à la saison active par le fallback front
--      (_broadcastInSeason), exactement comme matches/convocs/challenges.
--
-- broadcast_receipts : PAS de colonne season_id ajoutée. Un receipt est lié à
-- son broadcast (FK broadcast_id) ; le filtre saison sur le broadcast suffit.
-- On ne touche pas aux receipts (un broadcast de saison N reste accessible et
-- son historique de réception intact si on rebascule sur N).
--
-- Idempotente : le backfill ne touche que les rows season_id IS NULL.
-- Non destructif : aucune suppression, aucun NOT NULL ajouté.
-- ============================================================================

-- Filet de sécurité : si la colonne n'existait pas (env divergent), on la crée.
alter table public.broadcasts
  add column if not exists season_id text references public.seasons(id) on delete set null;

-- Backfill : rattache les diffusions orphelines à la saison active actuelle.
-- (Sous-requête robuste : la saison réellement marquée 'active', pas un id en dur.)
update public.broadcasts
   set season_id = (select id from public.seasons where status = 'active' limit 1)
 where season_id is null
   and exists (select 1 from public.seasons where status = 'active');

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   update public.broadcasts set season_id = null;  -- ou cibler par saison
-- ============================================================================
