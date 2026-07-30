-- ============================================================================
-- Migration : SUIVI COACH DE LA PRÉPA — correction tracée + mot du coach
-- ----------------------------------------------------------------------------
-- Le coach dispose désormais d'un écran « Suivi détaillé » (onglet du dashboard
-- prépa) qui liste TOUTES les validations avec photos, distances et messages, et
-- lui permet de CORRIGER une validation erronée (mauvais niveau coché, squad
-- oubliée, distance fausse) ou de la supprimer.
--
-- Cette migration n'ajoute que de l'AUDIT et un canal de retour. Aucune colonne
-- existante n'est touchée : le scoring reste figé dans la ligne (base_points /
-- points_total), la validation joueuse est inchangée.
--
-- POURQUOI `edited_at` ALORS QUE `updated_at` EXISTE DÉJÀ :
-- `updated_at` est l'horloge de LWW de PbSync — elle est bumpée par TOUTE
-- écriture, y compris un simple re-upsert anti-clobber (_reassertRows). Elle ne
-- peut donc pas servir de trace d'audit : elle ne dit pas « un coach a corrigé
-- cette ligne », seulement « la ligne a été touchée ». D'où une colonne dédiée,
-- posée UNIQUEMENT par les corrections coach.
--
-- POURQUOI `coach_note` SUR LA VALIDATION ET PAS UNE TABLE DE MESSAGES :
-- le mot d'encouragement du coach porte TOUJOURS sur une séance précise (« ta
-- séance de mercredi, respect »). L'ancrer sur la ligne lui donne gratuitement
-- son contexte, sa portée (la joueuse concernée, personne d'autre) et son entrée
-- dans notifFeed() — la règle du projet étant qu'une notif push sans entrée de
-- feed est un cul-de-sac. Un canal de messagerie générique serait une autre
-- feature, pas celle-ci.
--
-- Idempotente (add column if not exists). Aucun backfill : l'absence de valeur
-- signifie « jamais corrigé / aucun mot », ce qui est l'état correct pour tout
-- l'historique existant.
-- ============================================================================

alter table public.training_completions
  -- Qui a corrigé en dernier : coaches.id. Pas de FK — un coach supprimé ne doit
  -- pas effacer la trace de sa correction (même posture que les autres colonnes
  -- d'audit du projet, cf. player_licences.updated_by).
  add column if not exists updated_by    text,
  -- Instant de la dernière correction coach (cf. en-tête : distinct de updated_at).
  add column if not exists edited_at     timestamptz,
  -- Mot du coach sur CETTE séance, lu par la joueuse (feed + écran de la séance).
  add column if not exists coach_note    text,
  add column if not exists coach_note_at timestamptz;

-- Index sur le mot du coach : notifFeed() balaie les validations à chaque render
-- pour en dériver l'entrée « un mot du coach ». Partiel = quelques lignes seulement.
create index if not exists training_completions_coach_note_idx
  on public.training_completions (coach_note_at)
  where coach_note_at is not null;

-- ----------------------------------------------------------------------------
-- Rappel : la SUPPRESSION d'une validation par le coach est un SOFT-DELETE
-- (deleted_at, colonne déjà présente). Un hard delete serait inutile ET nocif :
-- tout client qui a encore la ligne en cache la repousserait au flush suivant
-- (heuristique pendingLocal de PbSync sur les ids 'x…'). L'index unique partiel
-- `training_completions_unique_idx ... where deleted_at is null` est justement
-- fait pour ça : une validation soft-deleted ne bloque pas une re-validation.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Rollback (manuel) :
--   drop index if exists training_completions_coach_note_idx;
--   alter table public.training_completions
--     drop column if exists updated_by,
--     drop column if exists edited_at,
--     drop column if exists coach_note,
--     drop column if exists coach_note_at;
-- ============================================================================
