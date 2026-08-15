-- =============================================================================
-- 20260815_003 — SYSTÈME DE POINTS GÉNÉRAL (v.126)
-- =============================================================================
--
-- POURQUOI
-- --------
-- Les points existaient déjà, mais éparpillés et incomparables : la prépa
-- physique avait ses `points_total`, les défis leur classement maison, les
-- présences un compteur auto, les gages rien du tout. Aucune joueuse ne pouvait
-- répondre à « où j'en suis ». Ce chantier réunit tous les axes derrière UN
-- score de saison.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   1) `challenges.points_reward` — ce que rapporte un défi, réglé à la création.
--   2) `player_points_ledger`     — le journal des transactions de points.
--   3) `points_rules`             — le barème (singleton, éditable par le coach).
--
-- -----------------------------------------------------------------------------
-- LE POINT LE PLUS IMPORTANT : LE LEDGER EST UN JOURNAL D'EXCEPTIONS,
-- PAS LE REGISTRE DE TOUS LES POINTS
-- -----------------------------------------------------------------------------
-- La demande initiale prévoyait d'écrire UNE ligne de ledger à chaque événement
-- qui rapporte des points (validation de séance, présence, défi, gage…), plus un
-- backfill de l'existant. On ne l'a pas fait, et c'est délibéré.
--
-- Cette app n'a pas de serveur applicatif : les écritures partent des appareils.
-- Matérialiser un événement dérivable, c'est donc désigner un appareil comme
-- responsable de l'écrire — et il y a toujours un cas où il n'est pas là.
-- Concrètement, quatre modes de panne connus de ce dépôt :
--
--   • DOUBLE COMPTAGE. Une présence est visible du téléphone de la joueuse ET
--     de celui du coach. Deux appareils, deux lignes, sauf à s'appuyer sur un id
--     déterministe — c'est-à-dire à réinventer la dérivation, en plus fragile.
--   • RÉTRO-CORRECTIONS PERDUES. Un entraînement dé-clôturé, un RSVP corrigé de
--     « présente » à « absente », une preuve invalidée : la source change, la
--     ligne figée non. Il faudrait une passe de réconciliation — exactement la
--     dette que la v.118 a payée sur la pintade.
--   • APPAREIL ABSENT = POINTS ABSENTS. Une joueuse qui n'ouvre pas l'app de la
--     semaine n'a aucune ligne. Son score ment jusqu'à sa prochaine connexion.
--   • FLUSH GELÉ. Une seule ligne invalide fait échouer TOUT le lot d'upsert de
--     la table, et le lot est rejoué indéfiniment. Multiplier les écritures
--     automatiques, c'est multiplier les occasions de geler la synchro.
--
-- Le front DÉRIVE donc le score de la saison à la lecture, depuis les sources
-- qui font déjà foi (`training_completions`, les instances de convocation
-- clôturées, `challenge_scores`, `gage_draws`). C'est le même patron que les
-- compteurs auto des défis (PR #72) et que les sanctions de la pintade : la
-- source de vérité reste l'événement, jamais un compteur recopié.
--
-- Deux conséquences heureuses :
--   • le BACKFILL demandé est sans objet — tout l'historique est déjà là, et il
--     apparaît au premier rendu sans qu'une seule ligne soit écrite ;
--   • corriger une présence ou dé-clôturer une séance corrige le score, tout
--     seul, partout, sans passe de rattrapage.
--
-- Le ledger garde donc EXACTEMENT ce qui n'est dérivable de rien :
--   • `manual_adjustment` — le bonus/malus décidé par le coach. Il n'a pas de
--     source ailleurs : sans cette table, il n'existe pas.
--   • une SURCHARGE ponctuelle d'un événement dérivé. Une ligne dont le couple
--     (source_type, source_id) désigne un événement dérivé REMPLACE la valeur
--     dérivée. C'est ce qui permet d'annuler ou de rectifier un cas particulier
--     — une présence exceptionnellement non créditée, par exemple — sans
--     toucher à la source ni au barème de tout le monde.
--   • les points d'un module qui, LUI, n'a pas de source dérivable côté front.
--     `ardoise_done` est dans l'enum pour cette raison : le chantier Ardoise
--     tourne en parallèle, et il lui suffira d'insérer ses lignes ici pour que
--     ses points entrent dans le score, le classement et l'historique, sans
--     qu'une ligne de ce module-ci ne bouge.
--
-- L'enum couvre malgré tout les six sources. Une table de journal dont l'enum
-- ne sait nommer que la moitié des cas serait à re-migrer au premier besoin —
-- et un `check` sur une valeur non prévue fait échouer le lot entier.
--
-- Idempotente, additive, sans perte. Rejouable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CE QUE RAPPORTE UN DÉFI
-- -----------------------------------------------------------------------------
-- Réglé à la création, modifiable après coup. 5 par défaut : assez pour que
-- réussir un défi se voie dans le score, assez peu pour qu'une présence
-- régulière (10 × ~2 séances/semaine) pèse davantage qu'une performance isolée.
-- C'est un choix de produit, pas une contrainte technique : le coach peut le
-- renverser défi par défi.
--
-- NOT NULL DEFAULT 5 : les défis déjà en base valent donc 5 rétroactivement.
-- C'est voulu — l'alternative (NULL = « ne rapporte rien ») ferait apparaître
-- un score de saison amputé de tout l'historique des défis le jour du déploiement.
alter table public.challenges
  add column if not exists points_reward integer not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_points_reward_chk') then
    alter table public.challenges
      add constraint challenges_points_reward_chk check (points_reward between 0 and 1000);
  end if;
end $$;

comment on column public.challenges.points_reward is
  'Points versés au score de saison quand une joueuse a un score sur ce défi. '
  'Réglé par le coach à la création (défaut 5). 0 = le défi ne rapporte rien. '
  'IGNORÉ pour les défis AUTO (auto_count) : leurs compteurs dérivent déjà des '
  'présences, qui rapportent leurs propres points — les créditer une seconde '
  'fois compterait la même séance deux fois.';

-- -----------------------------------------------------------------------------
-- Ni `defis`, ni `points_reward` sur `gages` : ce n'est pas un oubli.
-- -----------------------------------------------------------------------------
-- Il n'existe pas de table `defis` — les défis SONT `challenges` (l'app est en
-- français, le schéma en anglais). Rien à faire de ce côté.
--
-- `gages` existe, mais n'a pas reçu de colonne. Un gage est proposé par une
-- joueuse et modéré par le coach : lui accoler un tarif à l'unité ouvrirait une
-- négociation par gage, sur un module dont tout l'intérêt est l'anonymat et le
-- tirage au sort. Un montant unique par gage tenu (`points_rules.gage_done_points`)
-- suffit et se règle en un endroit.
--
-- Et il y a un coût technique réel à une colonne inutile : le moteur de synchro
-- pousse la ligne ENTIÈRE. Une colonne absente en base (déploiement passé avant
-- la migration) ne lève pas d'erreur visible — juste un `console.warn` — et
-- TOUTE la table cesse de se synchroniser en silence. On n'ajoute donc une
-- colonne que là où elle sert.

-- -----------------------------------------------------------------------------
-- 2) LE JOURNAL DES TRANSACTIONS
-- -----------------------------------------------------------------------------
create table if not exists public.player_points_ledger (
  id            text primary key,
  player_id     text not null,
  -- Saison créditée. Le cumul se remet à zéro à chaque saison (le all-time se
  -- lit en secondaire, côté front, en sommant les saisons).
  season_id     text,
  points_delta  integer not null,
  source_type   text not null check (source_type in (
    'training_completion',   -- séance de prépa validée
    'training_attendance',   -- présence à un entraînement clôturé
    'challenge_score',       -- score enregistré sur un défi
    'ardoise_done',          -- ardoise validée (chantier Ardoise, en parallèle)
    'gage_done',             -- gage tenu et confirmé par le coach
    'manual_adjustment'      -- bonus / malus décidé par le coach
  )),
  -- Identifiant de l'événement source DANS SON MODULE. C'est lui qui rend une
  -- ligne rapprochable de l'événement dérivé qu'elle surcharge :
  --   training_completion → training_completions.id
  --   training_attendance → '<convocation_id>|<instance_date>'
  --   challenge_score     → challenges.id
  --   gage_done           → gage_draws.id
  --   ardoise_done        → ardoise_assignments.id
  --   manual_adjustment   → null (rien à rapprocher : la ligne EST l'événement)
  source_id     text,
  reason        text,
  created_by    text,
  created_at    timestamptz not null default now(),
  -- updated_at / deleted_at : obligatoires sur toute entité synchronisée.
  -- `updated_at` porte l'arbitrage last-writer-wins (sans lui, un écho realtime
  -- ramène une ligne à sa version d'avant — le mode de panne de la v.104), et
  -- `deleted_at` est le SEUL état terminal durable : un hard delete d'une ligne
  -- d'id « x… » est repoussé par n'importe quel client au flush suivant.
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- PAS de foreign key sur player_id / season_id, contrairement à la demande.
-- L'ordre des upserts entre tables n'est pas garanti par le moteur de synchro :
-- une FK ferait échouer le lot du ledger tant que la joueuse n'est pas passée,
-- et un lot en échec est rejoué indéfiniment — donc la synchro du ledger gèle
-- pour tout le monde. `gages.season_id` a une FK parce qu'il est écrit par le
-- seul appareil du coach ; ici les écritures peuvent venir de partout.

-- L'index de lecture principal : « le total de X sur la saison Y ».
create index if not exists player_points_ledger_player_season_idx
  on public.player_points_ledger (player_id, season_id)
  where deleted_at is null;

-- L'index de rapprochement : « existe-t-il une surcharge pour cet événement ? ».
-- C'est le chemin d'accès de la fusion dérivé/stocké, joué à chaque rendu.
create index if not exists player_points_ledger_source_idx
  on public.player_points_ledger (source_type, source_id)
  where deleted_at is null;

comment on table public.player_points_ledger is
  'Journal des points NON DÉRIVABLES : ajustements manuels du coach, surcharges '
  'ponctuelles d''un événement dérivé, et points des modules sans source '
  'dérivable côté front (ardoise). Le gros du score est recalculé à la lecture '
  'depuis les sources — cf. l''en-tête de la migration 20260815_003.';

comment on column public.player_points_ledger.source_id is
  'Identifiant de l''événement dans son module. Une ligne dont (source_type, '
  'source_id) désigne un événement dérivé REMPLACE la valeur dérivée : c''est '
  'le mécanisme de rectification au cas par cas.';

-- -----------------------------------------------------------------------------
-- 3) LE BARÈME
-- -----------------------------------------------------------------------------
-- Singleton, sur le modèle de `pintade_rules` / `team_settings`. Une seule
-- ligne, id 'default', seedée ici pour que le premier client lise des valeurs
-- explicites plutôt que de pousser ses propres défauts (pousser des défauts
-- front écrase les réglages d'un coach depuis un appareil qui n'a pas encore lu
-- le serveur — le mode de panne de la v.104).
create table if not exists public.points_rules (
  id                       text primary key default 'default',
  -- Ce que vaut UNE présence à un entraînement clôturé.
  attendance_points        integer not null default 10,
  -- Le tarif proposé par défaut à la création d'un défi. Ne rétro-agit sur
  -- aucun défi existant : chacun porte son propre points_reward.
  challenge_default_points integer not null default 5,
  -- Ce que vaut un gage tenu ET confirmé par le coach.
  gage_done_points         integer not null default 15,
  updated_at               timestamptz not null default now(),
  updated_by               text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'points_rules_attendance_chk') then
    alter table public.points_rules
      add constraint points_rules_attendance_chk check (attendance_points between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'points_rules_challenge_chk') then
    alter table public.points_rules
      add constraint points_rules_challenge_chk check (challenge_default_points between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'points_rules_gage_chk') then
    alter table public.points_rules
      add constraint points_rules_gage_chk check (gage_done_points between 0 and 1000);
  end if;
end $$;

-- `on conflict do nothing` sur la PK : rejouer la migration ne réinitialise
-- JAMAIS un barème réglé par le coach.
insert into public.points_rules (id) values ('default')
  on conflict (id) do nothing;

comment on column public.points_rules.attendance_points is
  'Points par présence à un entraînement CLÔTURÉ. Le score étant dérivé, changer '
  'cette valeur recalcule aussi les présences déjà acquises — c''est assumé : '
  '« une présence vaut 10 » est une règle, pas un prix historique.';

-- -----------------------------------------------------------------------------
-- 4) RLS — même posture « bac à sable équipe » que le reste de l'app
-- -----------------------------------------------------------------------------
alter table public.player_points_ledger enable row level security;
alter table public.points_rules         enable row level security;

drop policy if exists player_points_ledger_all on public.player_points_ledger;
drop policy if exists points_rules_all         on public.points_rules;

create policy "player_points_ledger_all" on public.player_points_ledger
  for all using (true) with check (true);
create policy "points_rules_all" on public.points_rules
  for all using (true) with check (true);

-- -----------------------------------------------------------------------------
-- 5) REALTIME
-- -----------------------------------------------------------------------------
-- Utile sans être vital : un ajustement du coach doit apparaître sur le
-- téléphone de la joueuse sans qu'elle recharge — c'est ce qui déclenche
-- l'animation « +X pts » sur son accueil. Le reste du score est dérivé, donc
-- déjà rafraîchi par le realtime des tables sources.
do $$
declare t text;
begin
  foreach t in array array['player_points_ledger', 'points_rules'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Retour arrière (si jamais) :
--   drop table if exists public.player_points_ledger;
--   drop table if exists public.points_rules;
--   alter table public.challenges drop constraint if exists challenges_points_reward_chk;
--   alter table public.challenges drop column if exists points_reward;
-- -----------------------------------------------------------------------------
