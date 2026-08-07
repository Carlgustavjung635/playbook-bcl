-- ============================================================================
-- Migration : LA PINTADE DU MOIS + ÉTAT DES NOTIFICATIONS PAR JOUEUSE
-- ----------------------------------------------------------------------------
-- Deux chantiers, UN SEUL fichier : ils partent ensemble en v.106 et n'ont
-- aucune raison d'être appliqués séparément. Idempotente de bout en bout.
--
-- ============================================================================
-- PARTIE 1 — LA PINTADE
-- ----------------------------------------------------------------------------
-- La pintade est une peluche géante. Une joueuse en est la PORTEUSE : elle doit
-- la trimbaler partout, et n'importe qui (coach ou coéquipière) peut lui
-- réclamer une preuve photo à tout moment. Elle a 30 secondes pour la prendre,
-- appareil photo obligatoire.
--
-- ----------------------------------------------------------------------------
-- CE QUI N'EST **PAS** STOCKÉ, ET POURQUOI
-- ----------------------------------------------------------------------------
-- Ni la date de fin effective, ni le compteur de ratés consécutifs, ni la
-- prochaine fenêtre de demande ne sont matérialisés. Tous sont DÉRIVÉS à la
-- lecture des `pintade_proof_requests`, comme la dette de gages (recompute-on-
-- read) ou les compteurs de défis automatiques.
--
-- Ce n'est pas une élégance gratuite. Une prolongation « +24 h par raté » écrite
-- en base serait appliquée par le client qui CONSTATE le raté — or ce client
-- peut être n'importe lequel des onze de l'équipe, plusieurs à la fois, et un
-- même raté serait alors compté deux ou trois fois. Le projet a déjà payé ce
-- prix (convocations en double, cumuls cross-saison). Dérivée, la sanction est
-- idempotente par construction : dix appareils qui recalculent trouvent la même
-- date, et un appareil hors ligne qui rate l'événement n'introduit aucun écart.
--
-- `end_at` est donc une date de fin **de base**, et `bonus_hours` le cumul des
-- prolongations décidées EXPLICITEMENT par le coach. La fin réelle vaut :
--     end_at + bonus_hours + (ratés comptés × extension_hours_per_fail)
--
-- ----------------------------------------------------------------------------
-- POSTURE RLS : anon « sandbox équipe », identique au reste du projet. L'app n'a
-- pas d'auth par joueuse (PIN L1 + rôle anon Supabase partagé) : `auth.uid()`
-- est NULL pour tout le monde, une policy nominative bloquerait TOUS les writes.
-- « Seul le coach transfère / libère » est tenu CÔTÉ FRONT, comme partout.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère ses
-- ids via uid() (préfixe 'x'), heuristique anti-wipe des apply PbSync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 — LES RÈGLES DU JEU (une seule ligne, id = 'default')
-- ----------------------------------------------------------------------------
-- Singleton, sur le modèle de `team_settings` : le coach les édite depuis
-- l'écran « Règles de la pintade », tout le monde les lit.
create table if not exists public.pintade_rules (
  id                       text primary key default 'default',
  -- Durée par défaut d'une garde, en jours, proposée à l'assignation.
  default_duration_days    integer not null default 30 check (default_duration_days between 1 and 365),
  -- Fenêtre anti-harcèlement : une seule demande de preuve par tranche, POUR LA
  -- PORTEUSE, quel que soit le demandeur.
  rate_limit_hours         integer not null default 2 check (rate_limit_hours between 1 and 168),
  -- Combien de secondes pour dégainer l'appareil photo.
  proof_timeout_seconds    integer not null default 30 check (proof_timeout_seconds between 10 and 300),
  -- Prolongation automatique par raté.
  extension_hours_per_fail integer not null default 24 check (extension_hours_per_fail between 0 and 168),
  -- Au-delà de N ratés CONSÉCUTIFS, plus aucune sanction automatique : le
  -- système se tait et attend l'arbitrage du coach.
  max_consecutive_fails    integer not null default 3 check (max_consecutive_fails between 1 and 10),
  -- Interrupteurs de sanctions (le coach peut jouer la version douce).
  sanction_feed_post       boolean not null default true,
  sanction_extension       boolean not null default true,
  sanction_coach_alert     boolean not null default true,
  -- Le feed des preuves est-il visible de toute l'équipe ? (false = coach only)
  feed_public              boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               text
);
-- Seed de la ligne unique. `on conflict do nothing` → rejouer la migration ne
-- réinitialise JAMAIS des règles déjà personnalisées par le coach.
insert into public.pintade_rules (id) values ('default') on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1.2 — LES GARDES (qui porte la pintade, et depuis quand)
-- ----------------------------------------------------------------------------
-- Une ligne par PÉRIODE de garde. Un transfert n'écrase pas la ligne : il clôt
-- l'ancienne (`ended`) et en ouvre une neuve qui pointe la précédente — sans
-- quoi l'historique de la peluche serait perdu à chaque passage de témoin.
create table if not exists public.pintade_holders (
  id                   text primary key default gen_random_uuid()::text,
  holder_id            text not null references public.players(id) on delete cascade,
  start_at             timestamptz not null default now(),
  -- Fin DE BASE (cf. en-tête : la fin réelle est dérivée).
  end_at               timestamptz not null,
  -- Prolongations décidées explicitement par le coach, cumulées en heures.
  bonus_hours          integer not null default 0,
  -- D'où vient la peluche, si elle a été transmise.
  transferred_from_id  text references public.players(id) on delete set null,
  transferred_at       timestamptz,
  -- Clôture EXPLICITE (libération anticipée, ou transfert vers une autre
  -- joueuse). Une garde arrivée au bout de sa durée s'éteint toute seule, sans
  -- écriture : `ended` ne sert qu'aux fins ANTICIPÉES.
  ended                boolean not null default false,
  ended_at             timestamptz,
  ended_reason         text,
  -- Saison de rattachement, pour ne pas mélanger deux exercices (le projet a
  -- déjà corrigé quatre cumuls cross-saison).
  season_id            text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
-- Lecture principale : « la garde en cours ».
create index if not exists pintade_holders_active_idx
  on public.pintade_holders (end_at desc)
  where deleted_at is null and ended = false;
create index if not exists pintade_holders_player_idx
  on public.pintade_holders (holder_id, start_at desc);
create index if not exists pintade_holders_deleted_at_idx
  on public.pintade_holders (deleted_at);

-- ----------------------------------------------------------------------------
-- 1.3 — LES DEMANDES DE PREUVE
-- ----------------------------------------------------------------------------
-- Le cœur du jeu. Une ligne par « montre-moi la pintade ». C'est aussi le
-- registre dont TOUT le reste est dérivé : fenêtre de rate limit, ratés
-- consécutifs, prolongations, feed public.
create table if not exists public.pintade_proof_requests (
  id            text primary key default gen_random_uuid()::text,
  -- La garde concernée. Un raté n'a de sens qu'à l'intérieur d'une garde : sans
  -- ce lien, une nouvelle porteuse hériterait de la série de ratés de la
  -- précédente.
  period_id     text not null references public.pintade_holders(id) on delete cascade,
  holder_id     text not null references public.players(id) on delete cascade,
  -- Qui demande : '<playerId>' ou 'coach:<coachId>'. Pas de FK : les coachs
  -- vivent dans une autre table, et l'anonymat n'est pas recherché ici (au
  -- contraire — savoir qui a piégé qui fait partie du jeu).
  requester_id  text not null,
  requester_label text,
  requested_at  timestamptz not null default now(),
  -- requested_at + proof_timeout_seconds, FIGÉ à la création : si le coach
  -- change le timeout entre-temps, une demande déjà partie garde son contrat.
  deadline_at   timestamptz not null,
  photo_url     text,
  -- pending  : le chrono tourne
  -- ok       : photo reçue dans les temps
  -- failed   : la porteuse était là et a laissé filer le chrono
  -- expired  : personne n'a rien vu passer — constaté APRÈS COUP par n'importe
  --            quel appareil qui relit une demande dont la deadline est passée.
  --            Compte comme un raté, exactement comme `failed` : sans ce
  --            statut, il suffirait de ne pas ouvrir l'app pour ne jamais rater.
  status        text not null default 'pending'
                check (status in ('pending', 'ok', 'failed', 'expired')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists pintade_requests_period_idx
  on public.pintade_proof_requests (period_id, requested_at desc)
  where deleted_at is null;
create index if not exists pintade_requests_pending_idx
  on public.pintade_proof_requests (holder_id, deadline_at)
  where deleted_at is null and status = 'pending';
create index if not exists pintade_requests_deleted_at_idx
  on public.pintade_proof_requests (deleted_at);

-- ----------------------------------------------------------------------------
-- 1.4 — LE JOURNAL D'INCIDENTS
-- ----------------------------------------------------------------------------
-- Append-only. Ne sert PAS à compter les ratés (ils se dérivent des demandes) :
-- il trace les ARBITRAGES du coach, et c'est lui qui éteint l'alerte « 3 ratés
-- consécutifs ». `metadata.handledRequestId` retient le dernier raté connu au
-- moment de la décision : tant qu'aucun raté plus récent n'est apparu, l'alerte
-- reste éteinte — sans ce repère, elle se rallumerait à chaque render.
create table if not exists public.pintade_incident_log (
  id             text primary key default gen_random_uuid()::text,
  period_id      text,
  holder_id      text not null,
  -- 'fail_streak_max_reached' | 'coach_action'
  incident_type  text not null,
  streak_count   integer,
  -- 'sanction_added' | 'transfer' | 'release' | 'extend_cumulative'
  coach_decision text,
  notes          text,
  metadata       jsonb not null default '{}'::jsonb,
  created_by     text,
  created_at     timestamptz not null default now(),
  -- updated_at / deleted_at : pas dans la demande initiale, ajoutés parce que
  -- TOUTE entité PbSync en a besoin. `updated_at` porte l'arbitrage last-writer-
  -- wins (sans lui, un écho realtime peut ramener une ligne à sa version
  -- d'avant : c'est le mode de panne corrigé en v.104), et `deleted_at` est le
  -- SEUL état terminal durable — un hard delete d'une ligne d'id « x… » est
  -- repoussé par n'importe quel client au flush suivant.
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists pintade_incidents_holder_idx
  on public.pintade_incident_log (holder_id, created_at desc)
  where deleted_at is null;
create index if not exists pintade_incidents_period_idx
  on public.pintade_incident_log (period_id, created_at desc)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 1.5 — RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.pintade_rules          enable row level security;
alter table public.pintade_holders        enable row level security;
alter table public.pintade_proof_requests enable row level security;
alter table public.pintade_incident_log   enable row level security;

drop policy if exists pintade_rules_all          on public.pintade_rules;
drop policy if exists pintade_holders_all        on public.pintade_holders;
drop policy if exists pintade_proof_requests_all on public.pintade_proof_requests;
drop policy if exists pintade_incident_log_all   on public.pintade_incident_log;

create policy "pintade_rules_all" on public.pintade_rules
  for all using (true) with check (true);
create policy "pintade_holders_all" on public.pintade_holders
  for all using (true) with check (true);
create policy "pintade_proof_requests_all" on public.pintade_proof_requests
  for all using (true) with check (true);
create policy "pintade_incident_log_all" on public.pintade_incident_log
  for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 1.6 — REALTIME
-- ----------------------------------------------------------------------------
-- Indispensable ici, contrairement à la plupart des tables : la porteuse doit
-- voir la demande arriver SANS recharger, et le chrono de 30 s ne pardonne pas
-- un aller-retour de pull-to-refresh.
do $$
declare t text;
begin
  foreach t in array array['pintade_rules', 'pintade_holders', 'pintade_proof_requests', 'pintade_incident_log']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 1.7 — BUCKET DES PREUVES
-- ----------------------------------------------------------------------------
-- Public en lecture : le feed est consulté par toute l'équipe, et l'app n'a pas
-- d'auth par joueuse permettant une URL signée par destinataire. Même posture
-- que 'training-photos' et 'drill-images'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('pintade-proofs', 'pintade-proofs', true, 8388608,
          array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "pintade_proofs_anon_read"   on storage.objects;
drop policy if exists "pintade_proofs_anon_insert" on storage.objects;
drop policy if exists "pintade_proofs_anon_update" on storage.objects;

create policy "pintade_proofs_anon_read"
  on storage.objects for select to anon using (bucket_id = 'pintade-proofs');
create policy "pintade_proofs_anon_insert"
  on storage.objects for insert to anon with check (bucket_id = 'pintade-proofs');
create policy "pintade_proofs_anon_update"
  on storage.objects for update to anon using (bucket_id = 'pintade-proofs') with check (bucket_id = 'pintade-proofs');
-- PAS de policy DELETE : une preuve est une pièce du dossier. Une porteuse qui
-- pourrait effacer sa propre photo effacerait la moitié de l'intérêt du jeu.

-- ============================================================================
-- PARTIE 2 — ÉTAT DES NOTIFICATIONS PAR JOUEUSE
-- ----------------------------------------------------------------------------
-- Jusqu'ici, `Notification.permission` ne vivait que dans le navigateur de la
-- joueuse : le coach n'avait AUCUN moyen de savoir qui recevait ses messages.
-- Il relançait tout le monde « au cas où », ce qui est exactement ce qui rend
-- les notifications insupportables.
--
-- Deux colonnes sur `players`, et non une table dédiée : c'est un état COURANT
-- et GLOBAL (pas par saison), lu au même endroit que le reste de la fiche
-- (l'écran Effectif). Une table de plus voudrait dire une entité PbSync de plus
-- pour un unique champ scalaire.
--
-- NULL = jamais mesuré (appareil qui n'a pas encore ouvert la v.106). C'est un
-- état distinct de 'denied', et l'écran Effectif les distingue : accuser une
-- joueuse d'avoir refusé les notifications alors qu'on n'en sait rien serait la
-- meilleure façon de lui faire fermer l'app.
-- ============================================================================
alter table public.players add column if not exists notif_permission    text;
alter table public.players add column if not exists notif_permission_at timestamptz;

-- Contrainte posée séparément et en NOT VALID : `add constraint if not exists`
-- n'existe pas en PostgreSQL, et une validation immédiate échouerait sur une
-- éventuelle valeur héritée. Les nouvelles écritures sont bien contrôlées.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'players_notif_permission_chk') then
    alter table public.players
      add constraint players_notif_permission_chk
      check (notif_permission is null
             or notif_permission in ('granted', 'default', 'denied', 'unsupported'))
      not valid;
  end if;
end $$;

comment on column public.players.notif_permission is
  'Dernier état connu de Notification.permission sur l''appareil de la joueuse. NULL = jamais mesuré.';
comment on column public.players.notif_permission_at is
  'Horodatage de la mesure. Un ''granted'' d''il y a six mois ne prouve rien.';

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.pintade_incident_log;
--   drop table if exists public.pintade_proof_requests;
--   drop table if exists public.pintade_holders;
--   drop table if exists public.pintade_rules;
--   delete from storage.buckets where id = 'pintade-proofs';
--   alter table public.players drop constraint if exists players_notif_permission_chk;
--   alter table public.players drop column if exists notif_permission;
--   alter table public.players drop column if exists notif_permission_at;
-- ============================================================================
