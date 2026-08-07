-- ============================================================================
-- Migration : LA PINTADE — DEUX CHRONOS AU LIEU D'UN (v.107)
-- ----------------------------------------------------------------------------
-- CE QUI ÉTAIT FAUX EN v.106
-- ----------------------------------------------------------------------------
-- Le délai de 30 secondes courait depuis `requested_at`. Autrement dit : une
-- demande postée à 3 h du matin était perdue avant que la porteuse n'ouvre les
-- yeux. Le jeu punissait le sommeil, pas la négligence — et une joueuse pouvait
-- collectionner les ratés sans avoir jamais rien vu passer.
--
-- ----------------------------------------------------------------------------
-- LE MODÈLE CORRIGÉ : DEUX FENÊTRES QUI S'ENCHAÎNENT
-- ----------------------------------------------------------------------------
--   1. FENÊTRE DE CONNEXION (2 h par défaut, réglable) — la porteuse doit
--      OUVRIR L'APP dans les 2 h qui suivent la demande. Le chrono de la photo
--      ne démarre pas tant qu'elle n'a rien vu.
--   2. FENÊTRE DE PHOTO (30 s) — elle démarre à la SECONDE où l'écran de preuve
--      s'affiche chez elle, pas avant. C'est là que le jeu se joue.
--
-- D'où deux échéances distinctes, et deux échecs distincts :
--   • `failed_not_seen` — 2 h sans ouvrir l'app. Ça peut arriver honnêtement
--     (la nuit, un tunnel, une batterie morte). Le feed le dit sans railler.
--   • `failed_timeout`  — l'écran s'est affiché, le chrono a filé. Là, elle
--     avait le temps. Le feed est nettement moins tendre.
-- Les deux comptent comme un raté pour la série et les prolongations : sans
-- quoi ignorer l'app deviendrait la stratégie gagnante.
--
-- ----------------------------------------------------------------------------
-- POURQUOI `opened_at` EST POSÉ UNE SEULE FOIS, ET JAMAIS RÉÉCRIT
-- ----------------------------------------------------------------------------
-- C'est le point de sécurité de tout le mécanisme. Si le client réécrivait
-- `opened_at` à chaque affichage, il suffirait de tuer l'app à la 25e seconde
-- et de la rouvrir pour repartir de 30 — le chrono ne se terminerait jamais.
-- La règle « on ne tamponne que si `opened_at IS NULL` » est tenue CÔTÉ FRONT
-- (RLS anon, comme partout ici), et le CHECK ci-dessous garantit au moins la
-- cohérence de la paire : pas de `photo_deadline_at` sans `opened_at`.
--
-- ----------------------------------------------------------------------------
-- MIGRATION DES LIGNES v.106
-- ----------------------------------------------------------------------------
-- `deadline_at` (= requested_at + 30 s) est RENOMMÉE en `connect_deadline_at`,
-- puis RECALCULÉE à `requested_at + 2 h` pour les lignes encore en attente :
-- garder l'ancienne valeur ferait échouer d'un coup toutes les demandes
-- ouvertes, au titre d'une règle qui n'existait pas quand elles ont été créées.
-- Les lignes déjà résolues gardent leur horodatage tel quel.
-- Anciens statuts → nouveaux : 'failed' (la porteuse avait constaté) devient
-- `failed_timeout`, 'expired' (personne n'avait rien vu) devient
-- `failed_not_seen`. C'est exactement ce que ces deux mots voulaient dire.
--
-- ----------------------------------------------------------------------------
-- PRÉREQUIS : 20260807_001_pintade_and_notif_permission.sql doit être appliquée
-- AVANT celle-ci (elle crée les tables). Ce fichier ne fait qu'ALTER, et chaque
-- étape est gardée : le rejouer ne casse rien, et l'appliquer sur un schéma
-- déjà à jour ne fait rien.
-- ============================================================================

do $$
begin
  if to_regclass('public.pintade_proof_requests') is null then
    raise exception 'pintade_proof_requests absente : applique d''abord 20260807_001_pintade_and_notif_permission.sql';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1) deadline_at → connect_deadline_at
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'pintade_proof_requests'
               and column_name = 'deadline_at')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'pintade_proof_requests'
                       and column_name = 'connect_deadline_at')
  then
    alter table public.pintade_proof_requests rename column deadline_at to connect_deadline_at;
  end if;
end $$;

-- Filet : si la colonne n'existe toujours pas (schéma inattendu), on la crée.
alter table public.pintade_proof_requests
  add column if not exists connect_deadline_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2) Les deux nouvelles colonnes du second chrono
-- ----------------------------------------------------------------------------
alter table public.pintade_proof_requests
  add column if not exists opened_at         timestamptz,
  add column if not exists photo_deadline_at timestamptz;

comment on column public.pintade_proof_requests.connect_deadline_at is
  'Fin de la fenêtre de CONNEXION (requested_at + connect_window_hours). Passée sans opened_at → failed_not_seen.';
comment on column public.pintade_proof_requests.opened_at is
  'Instant où l''écran de preuve s''est affiché chez la porteuse. POSÉ UNE SEULE FOIS : le réécrire relancerait le chrono à volonté.';
comment on column public.pintade_proof_requests.photo_deadline_at is
  'opened_at + proof_timeout_seconds. Fin du chrono de la photo.';

-- ----------------------------------------------------------------------------
-- 3) Reprise des données v.106
-- ----------------------------------------------------------------------------
-- Statuts d'abord (le CHECK n'est pas encore reposé, donc rien ne s'y oppose).
update public.pintade_proof_requests set status = 'failed_timeout'   where status = 'failed';
update public.pintade_proof_requests set status = 'failed_not_seen'  where status = 'expired';

-- Puis la fenêtre de connexion des demandes ENCORE EN ATTENTE : +2 h à partir
-- de la demande, et non l'ancienne échéance de 30 s (cf. en-tête).
update public.pintade_proof_requests
   set connect_deadline_at = requested_at + interval '2 hours'
 where status = 'pending'
   and (connect_deadline_at is null or connect_deadline_at < requested_at + interval '2 hours');

-- Lignes résolues sans échéance (cas de schéma bancal) : on la rend cohérente.
update public.pintade_proof_requests
   set connect_deadline_at = requested_at + interval '2 hours'
 where connect_deadline_at is null;

alter table public.pintade_proof_requests
  alter column connect_deadline_at set not null;

-- ----------------------------------------------------------------------------
-- 4) Les statuts
-- ----------------------------------------------------------------------------
alter table public.pintade_proof_requests
  drop constraint if exists pintade_proof_requests_status_check;
alter table public.pintade_proof_requests
  add constraint pintade_proof_requests_status_check
  check (status in ('pending', 'awaiting_photo', 'ok', 'failed_not_seen', 'failed_timeout'));

-- Cohérence de la paire : un chrono de photo n'existe pas sans ouverture. NOT
-- VALID parce qu'on ne bloque pas une reprise sur une éventuelle ligne bancale
-- héritée ; les écritures nouvelles, elles, sont bien contrôlées.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pintade_requests_photo_needs_open_chk') then
    alter table public.pintade_proof_requests
      add constraint pintade_requests_photo_needs_open_chk
      check (photo_deadline_at is null or opened_at is not null)
      not valid;
  end if;
end $$;

-- L'index partiel des demandes vivantes portait sur `deadline_at` et sur le
-- seul statut 'pending' : il faut couvrir les deux étapes du parcours.
drop index if exists public.pintade_requests_pending_idx;
create index if not exists pintade_requests_live_idx
  on public.pintade_proof_requests (holder_id, connect_deadline_at)
  where deleted_at is null and status in ('pending', 'awaiting_photo');

-- ----------------------------------------------------------------------------
-- 5) La fenêtre de connexion devient une RÈGLE, réglable par le coach
-- ----------------------------------------------------------------------------
-- Elle vit à côté de `proof_timeout_seconds` dans l'écran « Règles de la
-- pintade » : les deux chronos se règlent au même endroit, sinon le coach n'a
-- aucun moyen de comprendre pourquoi une joueuse a « raté sans rien voir ».
-- Distincte de `rate_limit_hours` malgré le même défaut de 2 h : l'une borne
-- l'espacement ENTRE deux demandes, l'autre le temps laissé POUR RÉPONDRE.
alter table public.pintade_rules
  add column if not exists connect_window_hours integer not null default 2;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pintade_rules_connect_window_chk') then
    alter table public.pintade_rules
      add constraint pintade_rules_connect_window_chk
      check (connect_window_hours between 1 and 168);
  end if;
end $$;

comment on column public.pintade_rules.connect_window_hours is
  'Heures dont dispose la porteuse pour OUVRIR l''app après une demande. Au-delà : failed_not_seen.';

-- ============================================================================
-- Rollback (manuel, et sans retour possible sur les statuts déjà réécrits) :
--   alter table public.pintade_proof_requests rename column connect_deadline_at to deadline_at;
--   alter table public.pintade_proof_requests drop column if exists opened_at;
--   alter table public.pintade_proof_requests drop column if exists photo_deadline_at;
--   alter table public.pintade_rules drop column if exists connect_window_hours;
-- ============================================================================
