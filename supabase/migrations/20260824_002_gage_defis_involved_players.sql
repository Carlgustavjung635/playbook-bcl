-- ============================================================================
-- Migration : DÉFIS-GAGES — JOUEUSES IMPLIQUÉES (citées + tirée au sort)
-- ----------------------------------------------------------------------------
-- Un défi peut CITER des joueuses : « battre le meilleur temps d'Emma aux BLS »
-- implique Emma. Une joueuse citée ne peut pas tomber sur ce défi — on ne se
-- défie pas soi-même. L'app le refuse au picker ET dans la fonction
-- d'assignation (garde défensive : le filtre UI n'est pas une sécurité).
--
-- Un défi peut aussi impliquer une joueuse AU HASARD, non nommée à la création :
-- « bats le temps d'Emma au 3pts avec <aléatoire> ». La joueuse est tirée AU
-- MOMENT DE L'ASSIGNATION, dans la roster active MOINS la cible MOINS les
-- citées — puis FIGÉE sur l'assignation. C'est le même principe que
-- `gage_draws.gage_id` figé au reveal : ce qui a été tiré ne se retire pas à
-- chaque lecture, sinon le défi changerait de sens entre deux ouvertures.
--
-- NB : la table d'assignation est `gage_draws` (il n'existe pas de
-- `gage_assignments` dans ce schéma) — cf. 20260824_001.
--
-- Idempotente.
-- ============================================================================

-- ---- Le modèle de défi : qui il cite, et s'il tire quelqu'un au sort --------
alter table public.gage_defis_templates
  add column if not exists involved_player_ids text[] not null default '{}',
  add column if not exists involves_random     boolean not null default false;

-- ---- L'assignation : qui a FINALEMENT été impliqué (citées + random résolue)
alter table public.gage_draws
  add column if not exists resolved_involved_player_ids text[] not null default '{}';

-- Rollback (manuel) :
--   alter table public.gage_defis_templates
--     drop column if exists involved_player_ids, drop column if exists involves_random;
--   alter table public.gage_draws drop column if exists resolved_involved_player_ids;
