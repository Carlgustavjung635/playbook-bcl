-- ============================================================================
-- Migration : STATUT MÉDICAL DES JOUEUSES (players.injury / injury_history)
-- ----------------------------------------------------------------------------
-- POURQUOI — jusqu'ici, `p.injury` et `p.injuryHistory` ne quittaient JAMAIS
-- l'appareil : aucune colonne en base, rien dans PbStore.upsertPlayer, rien
-- dans fetchPlayers. Le coach qui déclarait une joueuse « ✕ Indispo » depuis la
-- fiche joueuse ne la retrouvait pas en changeant de téléphone — alors que
-- l'AUTRE gisement d'indisponibilité (🏖️ player_unavailabilities, migration
-- 20260729_004) suivait, lui. D'où le symptôme « certaines oui, pas toutes » :
-- deux canaux pour la même notion, un seul synchronisé.
--
-- resolveEffectivePresence() interroge les DEUX gisements pour décider si une
-- joueuse est absente par défaut d'une convocation. Tant que l'un des deux
-- restait local, la feuille de présence différait d'un appareil à l'autre.
--
-- FORME — jsonb et non des colonnes typées : `injury` est déjà un objet libre
-- côté client ({status, description, startDate, returnDate, restrictions}) et
-- `injuryHistory` un tableau d'épisodes archivés. Les figer en colonnes
-- obligerait à une seconde migration au premier champ ajouté, sans rien
-- apporter : rien ne filtre ni ne trie sur ces valeurs côté SQL.
--
-- `injury` NULLABLE : NULL = « apte, rien à signaler ». C'est aussi ce que pose
-- markAsHealed() (delete p.injury) — l'absence de valeur est une information,
-- pas un trou à combler par un défaut.
--
-- POSTURE RLS — inchangée, `players` reste en lecture anon comme le reste du
-- projet (l'app n'a pas d'auth par joueuse : PIN L1 + rôle anon Supabase, cf.
-- l'en-tête de 20260729_004). Le statut médical rejoint donc `feedback` — les
-- appréciations du coach — dans une table lisible par tout client porteur de la
-- clé anon. Le cloisonnement reste CÔTÉ FRONT : les rendus de `p.injury` vivent
-- tous derrière un écran coach, et _playerSafeView n'expose à la joueuse que
-- feedback.positives / negatives / technicals. À arbitrer si le modèle d'auth
-- change un jour.
--
-- ÉCRITURE CIBLÉE — le client écrit ces deux colonnes par un UPDATE dédié
-- (PbStore.updateInjury), JAMAIS via upsertPlayer qui pousse la ligne entière.
-- Sinon une simple correction de nom depuis un appareil dont la copie date
-- écraserait un statut saisi ailleurs entre-temps — exactement le mode de
-- panne corrigé en v.104 sur le moteur PbSync, que le canal `players` (qui vit
-- hors de ce moteur) n'aurait pas évité tout seul.
--
-- Idempotente. Aucune donnée existante touchée.
-- ============================================================================

alter table public.players
  add column if not exists injury jsonb;

alter table public.players
  add column if not exists injury_history jsonb not null default '[]'::jsonb;

comment on column public.players.injury is
  'Statut médical courant {status,description,startDate,returnDate,restrictions}. NULL = apte. Écrit par PbStore.updateInjury (UPDATE ciblé).';
comment on column public.players.injury_history is
  'Épisodes archivés par markAsHealed(). Tableau, [] par défaut.';

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.players drop column if exists injury;
--   alter table public.players drop column if exists injury_history;
-- ============================================================================
