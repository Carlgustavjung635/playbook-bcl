-- ============================================================================
-- Migration : LES DÉFIS-GAGES RAPPORTENT DES POINTS
-- ----------------------------------------------------------------------------
-- Un défi relevé et validé par le coach crédite des points de saison. Le barème
-- est PROPRE À CHAQUE DÉFI (défaut 20) : « 100 lancers francs » et « battre le
-- record du club » n'ont pas à valoir pareil.
--
-- FIGEAGE — `gage_draws.points_awarded` porte la valeur du barème au moment où
-- le défi a été TIRÉ (c'est là qu'on sait de quel défi il s'agit ; le coach
-- n'assigne qu'un type, cf. 20260824_001 et la v.159). Modifier le barème du
-- modèle plus tard ne retarife donc PAS les défis déjà en cours ni ceux déjà
-- validés — même posture que l'ardoise et que les séances de prépa.
--
-- Les points restent DÉRIVÉS (recompute-on-read) : aucune ligne n'est écrite
-- dans le ledger, et le type de source reste `gage_done` — inventer un
-- `defi_gage_done` aurait exigé d'élargir l'enum applicatif ET la contrainte
-- côté base, faute de quoi une surcharge coach sur cette source ferait échouer
-- tout le lot d'upsert du ledger, gelant sa synchro pour tout le monde.
--
-- SANCTIONS PHYSIQUES : aucun point. C'est une sanction, pas une récompense.
-- La colonne points_awarded reste à 0 sur ces lignes.
--
-- Idempotente.
-- ============================================================================

alter table public.gage_defis_templates
  add column if not exists points_reward integer not null default 20;

do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.gage_defis_templates'::regclass
               and conname = 'gage_defis_templates_points_reward_check') then
    alter table public.gage_defis_templates drop constraint gage_defis_templates_points_reward_check;
  end if;
  alter table public.gage_defis_templates
    add constraint gage_defis_templates_points_reward_check check (points_reward >= 0);
end $$;

alter table public.gage_draws
  add column if not exists points_awarded integer not null default 0;

-- Rollback (manuel) :
--   alter table public.gage_defis_templates drop column if exists points_reward;
--   alter table public.gage_draws drop column if exists points_awarded;
