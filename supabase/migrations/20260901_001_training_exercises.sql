-- ============================================================================
-- Migration : EXERCICES D'ENTRAÎNEMENT — une entité à part, pas un play
-- ----------------------------------------------------------------------------
-- Le jalon 5 avait d'abord posé le terrain d'entraînement (dimensions libres,
-- paniers d'atelier, 20 joueuses, multi-ballon, accessoires) comme un
-- TROISIÈME mode de terrain à l'intérieur d'un play. Ça marchait, mais ça
-- rangeait un exercice de dribble-slalom dans le playbook — au milieu des
-- systèmes offensifs, filtré par les mêmes catégories, lié aux mêmes saisons.
--
-- Un exercice n'est pas un play :
--   • il n'a pas de VARIANTES (personne ne « bifurque » dans un atelier de
--     tirs : on fait la série, point) — sa structure est PLATE ;
--   • il n'appartient à aucune catégorie du playbook (off/def/transition) ;
--   • plusieurs exercices composent une SÉANCE, là où un play est une unité.
--
-- D'où cette table. Le moteur de dessin, lui, reste EXACTEMENT le même :
-- l'éditeur `/src/plays-editor-poc.html` s'ouvre avec `?exo=<id>` au lieu de
-- `?play=<id>`, et tout le reste (temps, zones, notes, highlights, dribble,
-- lecture, export photo) fonctionne à l'identique. Zéro duplication de code.
--
-- ----------------------------------------------------------------------------
-- POURQUOI UNE TABLE ET PAS UN CHAMP DANS training_plans
-- ----------------------------------------------------------------------------
-- `training_plans.plan.exercises[]` existe déjà et porte les exos d'UNE séance
-- datée (cf. jalon 4.5, `?plan=X&exo=Y`). C'est un blob de séance : un exo qui
-- y vit meurt avec la séance, et ne peut pas être rejoué la semaine suivante
-- sans un copier-coller.
--
-- Un exercice d'entraînement est une RESSOURCE RÉUTILISABLE, comme un play ou
-- un drill : il doit exister en dehors de toute date, être listé, ouvert,
-- corrigé, republié. C'est la même leçon que la bibliothèque d'animations de
-- la v.218 (`animations` sortie de `plays`) — une table, une identité, une
-- durée de vie propre.
--
-- Les deux ne se marchent pas dessus : `?plan=X&exo=Y` continue de désigner
-- l'exo d'une séance, `?exo=Z` SEUL (sans `plan=`) désigne cette table-ci.
--
-- ----------------------------------------------------------------------------
-- CE QUE PORTE `data`
-- ----------------------------------------------------------------------------
-- Le JSON de l'éditeur, format `pb-exo/1` :
--   { format, id, title, terrain_config: { court_size, extra_baskets },
--     players[], balls[], accessories[], steps[], arrows[], zones[],
--     notes, description, points_md, created_by, … }
--
-- PAS de clé `branches`, à aucun niveau : l'éditeur masque le bouton 🔀 et le
-- tiroir 🌳 en mode exercice, et `toJSON()` les retire de toute façon avant
-- d'écrire. Un lecteur n'a donc jamais à se demander quoi faire d'une
-- variante dans un exercice — il n'y en a pas.
--
-- Blob et pas colonnes : les mêmes raisons que `plays.animations` (v.177) —
-- le format bouge à chaque jalon de l'éditeur, et une migration par champ
-- ajouté serait un impôt permanent sur un contenu que seul l'éditeur écrit.
--
-- ----------------------------------------------------------------------------
-- SUPPRESSION
-- ----------------------------------------------------------------------------
-- `deleted_at` (soft-delete) et pas un DELETE : leçon PbSync — un hard DELETE
-- ne tue pas une ligne qu'un autre appareil garde en localStorage, elle
-- ressuscite au prochain flush. Le seul état terminal durable est le
-- soft-delete, que toutes les lectures filtrent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_exercises (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  deleted_at  timestamptz
);

-- La liste du coach comme celle de la joueuse trient par date de mise à jour
-- décroissante en filtrant les supprimés : c'est LA requête de la feature,
-- elle mérite son index.
CREATE INDEX IF NOT EXISTS training_exercises_live_idx
  ON training_exercises (updated_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE training_exercises IS
  'Exercices d''entraînement dessinés dans l''éditeur (format pb-exo/1, structure plate sans branches). Réutilisables hors séance ; une séance les référence par id.';
COMMENT ON COLUMN training_exercises.data IS
  'JSON pb-exo/1 écrit par /src/plays-editor-poc.html?exo=<id>. Jamais de clé branches.';
COMMENT ON COLUMN training_exercises.deleted_at IS
  'Soft-delete : un hard DELETE ressusciterait au prochain flush d''un appareil hors ligne.';
