-- ============================================================================
-- Migration : DIFFUSIONS — soft-delete + horodatage de modification
-- ----------------------------------------------------------------------------
-- Contexte (demande user, branche fix/messages-archived-hide) :
--   1. Le coach peut MODIFIER un message tant qu'aucun destinataire ne l'a lu
--      (read_count === 0). À la sauvegarde on veut tracer la modification sans
--      écraser l'horodatage de création → colonne `updated_at`.
--   2. Le coach peut SUPPRIMER un message à tout moment. Choix retenu :
--      SOFT-DELETE (tag) plutôt que hard-delete, pour rester clean côté
--      audit / RGPD → colonne `deleted_at`. Un broadcast deleted_at != null
--      disparaît de TOUTE l'UI (com en cours, archives, recherche, popup
--      joueuse) mais reste en base.
--
-- Modèle existant conservé :
--   - `archived` (boolean, migration _004) reste le flag d'archivage manuel.
--     On NE le convertit PAS en archived_at : l'équivalent booléen suffit et
--     évite de casser le code/les données déjà en prod (PR #66).
--   - created_at / expires_at inchangés.
--
-- Idempotente (add column if not exists). Non destructif : aucune suppression,
-- aucun NOT NULL ajouté. Backward compat : un broadcast sans ces colonnes
-- (deleted_at NULL, updated_at backfillé = created_at) reste visible.
-- ============================================================================

-- 1. Colonnes nullable (rollback safe).
--    PAS de `default now()` sur updated_at : sinon l'ajout de colonne peuple
--    les rows existantes avec now() et le backfill (where … is null) ne matche
--    plus rien → updated_at != created_at à tort. La valeur est pilotée par le
--    front (dump sync) qui envoie toujours updated_at (= created_at à la
--    création, = Date.now() à l'édition).
alter table public.broadcasts
  add column if not exists deleted_at timestamptz;

alter table public.broadcasts
  add column if not exists updated_at timestamptz;

-- 2. Backfill : les diffusions existantes n'ont jamais été modifiées →
--    updated_at = created_at (et deleted_at reste NULL = visibles).
--    Conditionnel sur IS NULL → idempotent : ne réécrase pas une édition future.
update public.broadcasts
   set updated_at = created_at
 where updated_at is null
   and created_at is not null;

-- 3. Index partiel : la quasi-totalité des lectures filtrent deleted_at IS NULL.
create index if not exists broadcasts_not_deleted_idx
  on public.broadcasts (season_id)
  where deleted_at is null;

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   drop index if exists public.broadcasts_not_deleted_idx;
--   alter table public.broadcasts drop column if exists deleted_at;
--   alter table public.broadcasts drop column if exists updated_at;
-- ============================================================================
