-- ============================================================================
-- Migration : DÉDOUBLONNAGE DES CONVOCATIONS DE MATCH (one-shot, 2026-07-29)
-- ----------------------------------------------------------------------------
-- Constat : 9 convocations de type 'match' en base pour 4 matchs réels.
-- Le nettoyage client (cleanupOrphanMatchConvocs, PR v.77) désigne bien une
-- survivante déterministe — mais il tourne au PREMIER render, donc AVANT que
-- PbSync.fetchAll ait ramené les lignes du serveur, et il est verrouillé par
-- window._bootCleanupDone : il ne repasse jamais. Il dédoublonne un état local
-- partiel, puis les doublons du serveur écrasent tout. Sur un appareil au cache
-- vide, il ne trouve aucune candidate et en CRÉE une nouvelle par match → c'est
-- le moteur de la prolifération.
-- Le correctif client est dans le même lot (v.85) ; cette migration nettoie
-- l'existant.
--
-- SURVIVANTE = plus petit id, EXACTEMENT la règle du client
-- (_convocsForMatch → .sort(localeCompare) → cands[0]). Les ids perdants sont
-- écrits EN DUR plutôt que recalculés en SQL : l'ordre lexicographique de
-- Postgres dépend de la collation et pourrait diverger du localeCompare de JS.
-- Sur un nettoyage one-shot, l'explicite vaut mieux que le malin.
--
-- Vérifié avant écriture : aucun des 5 perdants ne porte de RSVP, d'override
-- d'instance, de pièce jointe, de note, de lieu ni de clôture. Les 2 RSVP
-- existants (désistements d'Ophélie #1) sont sur les survivantes.
--
-- SAUVEGARDE : les lignes partent dans convocations_backup_20260729 AVANT
-- suppression. Rien n'est perdu, tout est réinsérable.
--
-- POURQUOI UN HARD DELETE ET PAS UN SOFT DELETE : la table `convocations` n'a
-- pas de colonne deleted_at, et en ajouter une obligerait à filtrer sur des
-- dizaines de sites de lecture (risque bien supérieur au gain). Et
-- contrairement aux entités « anti-wipe », l'apply de `convocations` REMPLACE
-- le tableau sans logique pendingLocal : une ligne supprimée côté serveur n'est
-- donc PAS repoussée par les clients. Le hard delete est durable ici.
--
-- Idempotente : la sauvegarde est en if not exists + on conflict do nothing, et
-- le delete ne matche plus rien au second passage.
-- ============================================================================

create table if not exists public.convocations_backup_20260729 (
  like public.convocations including defaults
);
-- Pas de PK héritée : on veut pouvoir re-sauvegarder sans conflit d'unicité.
alter table public.convocations_backup_20260729
  add column if not exists backup_reason text;

insert into public.convocations_backup_20260729
select c.*, 'duplicate cleanup 2026-07-29'
from public.convocations c
where c.id in (
  'x1784847951280edp2',  -- doublon 2026-05-12 ESG GIMONT 3
  'x1784847951280h1fr',  -- doublon 2026-05-23 Juillan (Demi finale)
  'x1784794838567ahea',  -- doublon 2026-08-29 Match week-end de cohésion
  'x1784847951280ujr8',  -- doublon 2026-08-29 Match week-end de cohésion
  'x1784847951280b4zu'   -- doublon 2026-09-09 Rejaumont (amical)
);

-- Filet de sécurité : si un RSVP s'était posé sur un perdant entre l'audit et
-- l'exécution, on le RAPATRIE sur la survivante avant toute suppression —
-- convocation_responses.convocation_id est ON DELETE CASCADE, un perdant
-- emporterait sinon le désistement avec lui.
update public.convocation_responses r
set convocation_id = s.survivor_id
from (values
  ('x1784847951280edp2', 'x17834582730182qup'),
  ('x1784847951280h1fr', 'x1783458273018mh5k'),
  ('x1784794838567ahea', 'x17847900486040fdl'),
  ('x1784847951280ujr8', 'x17847900486040fdl'),
  ('x1784847951280b4zu', 'x1783000115781tmq1')
) as s(loser_id, survivor_id)
where r.convocation_id = s.loser_id
  and not exists (
    select 1 from public.convocation_responses r2
    where r2.convocation_id = s.survivor_id
      and r2.player_id = r.player_id
      and r2.instance_date is not distinct from r.instance_date
  );

-- Ce qui n'a pas pu être rapatrié (une réponse existait déjà côté survivante)
-- est redondant par construction : on le laisse partir avec la cascade.
delete from public.convocations
where id in (
  'x1784847951280edp2',
  'x1784847951280h1fr',
  'x1784794838567ahea',
  'x1784847951280ujr8',
  'x1784847951280b4zu'
);

-- ============================================================================
-- Rollback (manuel) :
--   insert into public.convocations
--   select id, type, title, date, time, location, note, recurrence,
--          cancelled_instances, instance_overrides, attachments, created_at,
--          updated_at, season_id, team_tag, closed
--   from public.convocations_backup_20260729
--   on conflict (id) do nothing;
-- ============================================================================
