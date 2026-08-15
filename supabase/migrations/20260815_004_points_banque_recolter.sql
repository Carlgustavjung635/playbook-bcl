-- =============================================================================
-- 20260815_004 — LA BANQUE ET LE BOUTON « RÉCOLTER » (v.126)
-- =============================================================================
--
-- POURQUOI
-- --------
-- La v.124 a livré le score de saison : il monte tout seul, à chaque présence,
-- chaque séance validée, chaque défi. Tout seul, c'est-à-dire sans que la
-- joueuse ait rien à faire — et c'est précisément le problème. Un compteur qui
-- avance pendant qu'on regarde ailleurs ne récompense rien : il se contente
-- d'être exact.
--
-- Cette migration ajoute l'étape qui manquait : les gains n'atterrissent plus
-- directement sur le score, ils tombent d'abord dans une BANQUE. Il faut ouvrir
-- l'app et appuyer sur « 🎁 Récolter » pour les encaisser — avec les pièces qui
-- volent, le compteur qui grimpe et les confettis. Le geste est gratuit (rien
-- ne se perd si elle attend), mais il transforme un relevé de compte en moment.
--
-- -----------------------------------------------------------------------------
-- LE POINT DÉLICAT : LE SCORE EST DÉRIVÉ, IL N'Y A PAS UNE LIGNE PAR GAIN
-- -----------------------------------------------------------------------------
-- La demande initiale disait : « chaque gain = une ligne de ledger en
-- state = 'pending' ». On ne l'a pas fait, pour la raison exposée en long dans
-- l'en-tête de 20260815_003 : matérialiser un événement dérivable, dans une app
-- sans serveur, c'est désigner un appareil comme responsable de l'écrire — et
-- il y a toujours un cas où il n'est pas là (double comptage à deux appareils,
-- rétro-correction perdue, joueuse qui n'ouvre pas l'app, lot d'upsert gelé).
-- Le score continue donc d'être RECALCULÉ à la lecture depuis les sources.
--
-- Alors où vit la frontière banque / score ? Dans un REPÈRE, pas dans N lignes.
--
--   `player_points_harvests` : UNE ligne par (joueuse, saison), qui dit
--   jusqu'où les gains ont été encaissés. Un gain dérivé est « récolté » si son
--   horodatage est antérieur au repère. Récolter = avancer le repère à
--   maintenant. Une écriture par clic, par une seule joueuse, sur sa propre
--   ligne — l'exact opposé du modèle « une ligne par gain », qui en aurait
--   demandé des centaines écrites par plusieurs appareils.
--
-- Ce choix a trois conséquences qu'on assume, et même qu'on voulait :
--
--   • RÉTRO-COMPATIBLE PAR CONSTRUCTION. Une ligne de repère absente (personne
--     n'a jamais récolté) vaut repère à zéro : tout est en banque, rien n'est
--     perdu, et le premier « Récolter » encaisse toute l'histoire d'un coup.
--   • LES RATTRAPAGES DU COACH SONT DÉJÀ ENCAISSÉS. Une séance validée
--     rétroactivement par le coach (v.122) porte la date de la séance, pas
--     celle de la saisie : elle passe donc sous le repère et rejoint le score
--     directement, sans repasser par la banque. C'est ce qu'on veut — la
--     joueuse n'a pas à « récolter » un oubli d'il y a trois semaines.
--   • UNE CORRECTION DE SOURCE CORRIGE LE SCORE. Une présence rectifiée après
--     récolte change le total, sans passe de rattrapage ni ligne à réécrire.
--
-- `claimed_keys` rattrape le seul cas que le repère ne sait pas couvrir : un
-- gain qui n'a pas d'horodatage utilisable, ou qui en a un dans le FUTUR (un
-- défi encore ouvert est daté de sa date de fin — cf. `_derivePointsEntries`).
-- Avancer le repère à « maintenant » ne le couvrirait jamais : il resterait en
-- banque à vie, et le bouton « Récolter » ne s'éteindrait plus. On mémorise
-- donc explicitement ces quelques clés-là. La liste est PURGÉE à chaque
-- récolte de tout ce que le repère couvre désormais : elle reste minuscule.
--
-- -----------------------------------------------------------------------------
-- CE QUE `state` AJOUTE MALGRÉ TOUT AU LEDGER
-- -----------------------------------------------------------------------------
-- Le repère traite les gains DÉRIVÉS. Le ledger, lui, porte ce qui n'est
-- dérivable de rien — les ajustements du coach — et ceux-là ont besoin d'un
-- état individuel, pour UNE raison précise :
--
--   UNE SANCTION NE SE REFUSE PAS. Un malus posé par le coach entre au score
--   IMMÉDIATEMENT (`state = 'claimed'`). S'il passait par la banque, il
--   suffirait de ne jamais appuyer sur « Récolter » pour ne jamais le subir —
--   et pire, le bouton demanderait à la joueuse de valider elle-même sa propre
--   punition, avec des confettis. Un bonus, lui, passe par la banque : c'est
--   une bonne nouvelle, elle mérite son animation.
--
-- Le front tient cette règle deux fois, et ce n'est pas une redondance : à
-- l'écriture (le toggle « direct sur le score » de la modale d'ajustement, coché
-- et verrouillé dès que le montant est négatif) ET à la lecture (tout gain
-- négatif est compté comme encaissé, quelle que soit la valeur en base). La
-- seconde garde couvre les lignes écrites par une version antérieure du front,
-- que la première ne peut pas rattraper.
--
-- Idempotente, additive, sans perte. Rejouable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) L'ÉTAT D'UNE LIGNE DE LEDGER
-- -----------------------------------------------------------------------------
-- DEFAULT 'pending' : une ligne écrite par un client qui ne connaîtrait pas
-- encore la colonne (déploiement en avance d'une migration) tombe donc dans la
-- banque. C'est le défaut le moins nuisible : un point qui attend d'être
-- récolté se voit et se rattrape d'un clic, alors qu'un point encaissé en
-- silence ne se rattrape pas.
--
-- 'canceled' n'est utilisé par aucun code aujourd'hui — le coach annule un
-- ajustement par soft-delete (`deleted_at`), qui est le seul état terminal
-- durable de ce dépôt. La valeur est dans le CHECK pour ne pas avoir à
-- re-migrer une contrainte le jour où un « annulé mais visible » sera demandé :
-- une valeur hors CHECK ferait échouer TOUT le lot d'upsert de la table.
alter table public.player_points_ledger
  add column if not exists state text not null default 'pending',
  add column if not exists claimed_at timestamptz;

-- BACKFILL — EXACTEMENT UNE FOIS, et c'est tout l'intérêt du montage ci-dessous.
--
-- Toutes les lignes antérieures passent en 'claimed' : elles ont déjà été
-- COMPTÉES dans le score affiché à la joueuse depuis la v.124. Les laisser en
-- 'pending' ferait chuter son score du montant de tous les ajustements passés,
-- et lui demanderait de re-récolter un bonus qu'elle a déjà vu.
--
-- Mais un `update ... where state = 'pending'` posé à plat serait un piège :
-- rejoué six mois plus tard (et ce dépôt rejoue ses migrations), il encaisserait
-- d'office toutes les banques en cours, sans clic et sans animation. Le backfill
-- est donc conditionné à l'ABSENCE de la contrainte, c'est-à-dire au fait qu'on
-- soit sur la toute première exécution — puis la contrainte est posée dans la
-- même transaction. Un rejeu ne fait alors plus rien du tout.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_points_ledger_state_chk') then
    update public.player_points_ledger
       set state = 'claimed',
           claimed_at = coalesce(claimed_at, created_at);
    alter table public.player_points_ledger
      add constraint player_points_ledger_state_chk
      check (state in ('pending', 'claimed', 'canceled'));
  end if;
end $$;

comment on column public.player_points_ledger.state is
  '''pending'' = en banque, en attente du bouton « Récolter » de la joueuse ; '
  '''claimed'' = encaissé, compté dans le score. Les MALUS du coach (delta < 0) '
  'sont écrits ''claimed'' directement : une sanction qu''on peut refuser '
  'd''encaisser n''est pas une sanction. Le front applique aussi cette règle à '
  'la lecture, pour les lignes écrites par une version antérieure.';

comment on column public.player_points_ledger.claimed_at is
  'Horodatage de la récolte. NULL tant que la ligne est en banque.';

-- -----------------------------------------------------------------------------
-- 2) LE REPÈRE DE RÉCOLTE
-- -----------------------------------------------------------------------------
create table if not exists public.player_points_harvests (
  -- Id DÉTERMINISTE '<player_id>|<season_id>'. C'est ce qui rend la récolte
  -- idempotente entre appareils : deux téléphones qui récoltent la même saison
  -- écrivent la MÊME clé, et le last-writer-wins par `updated_at` tranche, au
  -- lieu de créer deux repères concurrents.
  id             text primary key,
  player_id      text not null,
  season_id      text,
  -- Le repère : tout gain dérivé antérieur est considéré encaissé.
  claimed_through timestamptz,
  -- Les clés de gains encaissés que le repère ne couvre pas (gain sans date, ou
  -- daté dans le futur). Purgée à chaque récolte — quelques entrées, jamais
  -- l'historique complet. jsonb et pas text[] : le moteur de synchro pousse déjà
  -- du jsonb ailleurs (drills, stats_pdfs) et le passthrough y est éprouvé.
  claimed_keys   jsonb not null default '[]'::jsonb,
  -- Purement informatif : le cumul de ce qui a été récolté, pour pouvoir dire
  -- « tu as récolté 1 240 pts cette saison » sans rejouer tout l'historique.
  -- Le score, lui, ne se lit JAMAIS ici : il reste dérivé des sources.
  claimed_total  integer not null default 0,
  last_claimed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- PAS de foreign key sur player_id / season_id, même raison que le ledger :
-- l'ordre des upserts entre tables n'est pas garanti par le moteur de synchro,
-- et un lot en échec est rejoué indéfiniment — la synchro gèlerait pour tout le
-- monde tant que la joueuse ne serait pas passée.

create index if not exists player_points_harvests_player_idx
  on public.player_points_harvests (player_id, season_id)
  where deleted_at is null;

comment on table public.player_points_harvests is
  'Le repère de récolte : UNE ligne par (joueuse, saison) qui dit jusqu''où les '
  'gains ont été encaissés. Ce n''est PAS un compteur de points — le score reste '
  'dérivé des sources à la lecture. Ligne absente = rien n''a jamais été récolté '
  '= tout est en banque, ce qui est le bon défaut pour une joueuse arrivée avant '
  'cette migration.';

comment on column public.player_points_harvests.claimed_keys is
  'Clés « <source_type>|<source_id> » encaissées mais NON couvertes par le '
  'repère : gain sans horodatage, ou daté dans le futur (un défi encore ouvert '
  'est daté de sa date de fin). Sans elles, ces gains resteraient en banque à '
  'vie et le bouton « Récolter » ne s''éteindrait jamais. Purgée à chaque récolte.';

-- -----------------------------------------------------------------------------
-- 3) RLS — même posture « bac à sable équipe » que le reste de l'app
-- -----------------------------------------------------------------------------
alter table public.player_points_harvests enable row level security;
drop policy if exists player_points_harvests_all on public.player_points_harvests;
create policy "player_points_harvests_all" on public.player_points_harvests
  for all using (true) with check (true);

-- -----------------------------------------------------------------------------
-- 4) REALTIME
-- -----------------------------------------------------------------------------
-- Utile pour qu'une récolte faite sur le téléphone se voie sur la tablette sans
-- recharger — et surtout pour que la banque ne se re-remplisse pas toute seule
-- sur le second appareil, ce qui rejouerait l'animation sur des points déjà pris.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'player_points_harvests'
  ) then
    alter publication supabase_realtime add table public.player_points_harvests;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Retour arrière (si jamais) :
--   drop table if exists public.player_points_harvests;
--   alter table public.player_points_ledger
--     drop constraint if exists player_points_ledger_state_chk;
--   alter table public.player_points_ledger drop column if exists state;
--   alter table public.player_points_ledger drop column if exists claimed_at;
-- Le score reste juste après un retour arrière : il est dérivé, et le ledger
-- retrouve son comportement « tout compte » de la v.124.
-- -----------------------------------------------------------------------------
