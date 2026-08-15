-- ============================================================================
-- Migration : LE COACH ENREGISTRE UNE SÉANCE À LA PLACE D'UNE JOUEUSE
-- ----------------------------------------------------------------------------
-- Cas d'usage : elle a fait la séance, elle a oublié de la valider dans l'app,
-- et la fenêtre de rattrapage (48 h) est passée. Jusqu'ici la séance était
-- définitivement perdue pour le classement — le coach pouvait CORRIGER une
-- validation (v.95) ou la SUPPRIMER, jamais en CRÉER une.
--
-- Cette migration n'ajoute que de la TRAÇABILITÉ. Aucune colonne existante
-- n'est touchée, aucun backfill : le scoring reste figé dans la ligne
-- (base_points / points_total) et la validation joueuse est inchangée.
--
-- POURQUOI DEUX COLONNES ET PAS UNE :
-- `created_by` seul ne suffirait pas à répondre à la question posée à l'écran.
-- Toute l'historique (des dizaines de milliers de lignes validées par les
-- joueuses elles-mêmes) a `created_by` NULL, et NULL veut alors dire deux
-- choses à la fois : « c'est la joueuse » et « on ne sait pas ». Le booléen
-- porte le FAIT (« cette ligne n'a pas été saisie par la joueuse »), la colonne
-- texte porte l'AUTEUR (coaches.id). C'est le booléen qui pilote l'affichage
-- côté joueuse (« 👋 Ajoutée par ton coach ») : il est vrai ou faux, jamais
-- « peut-être ».
--
-- POURQUOI PAS DE FK SUR `created_by` :
-- même posture que `updated_by` (migration 20260730_002) et
-- `player_licences.updated_by` : la suppression d'un coach ne doit pas effacer
-- la trace de ce qu'il a fait.
--
-- CE QUI N'EST PAS TOUCHÉ, VOLONTAIREMENT :
-- l'index unique partiel (session_id, player_id, date_planned) where deleted_at
-- is null reste la seule règle d'unicité. Une saisie coach est une validation
-- comme une autre : elle ne peut pas doubler celle de la joueuse, et si le coach
-- la supprime (soft-delete), la joueuse peut re-valider si elle est encore dans
-- sa fenêtre.
--
-- Idempotente (add column if not exists). L'absence de valeur signifie
-- « validée par la joueuse elle-même », ce qui est l'état correct pour tout
-- l'historique existant.
-- ============================================================================

alter table public.training_completions
  -- Qui a enregistré la ligne à la place de la joueuse : coaches.id.
  -- NULL = personne (la joueuse a validé elle-même).
  add column if not exists created_by                 text,
  -- Le FAIT, indépendamment de l'auteur. `not null default false` : toute ligne
  -- existante devient explicitement « validée par la joueuse », et le front n'a
  -- jamais à distinguer false de NULL.
  add column if not exists created_on_behalf_by_coach boolean not null default false;

comment on column public.training_completions.created_by is
  'coaches.id du coach ayant enregistré la séance à la place de la joueuse. NULL = validation joueuse.';
comment on column public.training_completions.created_on_behalf_by_coach is
  'true = ligne créée par un coach pour une joueuse (rattrapage hors délai). Pilote le badge côté joueuse.';
