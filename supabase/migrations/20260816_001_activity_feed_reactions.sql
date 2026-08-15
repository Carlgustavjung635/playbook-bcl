-- ============================================================================
-- Migration : LE FEED DU GROUPE — réactions emoji
-- ----------------------------------------------------------------------------
-- Un mur d'activité POSITIVE sur l'accueil (joueuse ET coach) : séance de prépa
-- validée, photo de pintade réussie, participation à un défi, record perso ou
-- record équipe, anniversaire du jour, menu de l'Ardoise réglé. Chaque
-- événement peut recevoir 4 réactions emoji (❤️ 🔥 💪 👏), plusieurs par
-- personne, une par emoji.
--
-- ----------------------------------------------------------------------------
-- IL N'Y A **PAS** DE TABLE `activity_feed` — ET C'EST LE CŒUR DU DOSSIER
-- ----------------------------------------------------------------------------
-- La spec d'origine prévoyait une table d'événements alimentée par un « hook »
-- posé dans chaque feature (une séance validée → une ligne, une preuve validée →
-- une ligne…). Ce projet a déjà payé ce modèle trois fois : convocations en
-- double, cumuls cross-saison, compteurs de gages divergents. Un événement écrit
-- par le client qui le CONSTATE, sur une base partagée par onze appareils, ça
-- dérive. Ici, ça mentirait en plus — et de trois façons :
--
--   • le coach INVALIDE une preuve de pintade après coup (migration
--     20260811_002) : la ligne de feed continuerait de la célébrer ;
--   • il REFUSE une photo d'Ardoise : la dette repasse 'in_progress', mais
--     « Delph a fini son menu » resterait affiché ;
--   • une tentative de défi est modifiable rétroactivement (v.121) ou
--     supprimable : le « record perso » gravé en base ne suivrait pas.
--
-- Or TOUTE la matière du feed est déjà en base et déjà synchronisée :
-- training_completions, pintade_proof_requests, challenges.series,
-- ardoise_assignments, players.date_naissance. Le feed est donc DÉRIVÉ à la
-- lecture (`pbFeedEvents()` côté front), exactement comme le flux de
-- notifications (notifFeed), la dette de gages, le tally de la pintade ou les
-- scores de défis auto. Ce qu'on y gagne :
--
--   • zéro écriture, donc zéro doublon et zéro hook à ne pas oublier ;
--   • RÉTROACTIF : le feed est plein dès le déploiement, au lieu de rester vide
--     plusieurs jours en attendant que des événements neufs se produisent ;
--   • une source corrigée (preuve invalidée, tentative éditée, dette
--     re-ouverte) corrige le feed dans la seconde, sans reprise de données ;
--   • la rétention 60 jours est un FILTRE, pas un cron : rien à purger.
--
-- Ne reste donc en base que ce qui ne se dérive de rien : les RÉACTIONS.
--
-- ----------------------------------------------------------------------------
-- CE QUI REND LES RÉACTIONS ROBUSTES : L'IDENTIFIANT DÉTERMINISTE
-- ----------------------------------------------------------------------------
-- L'événement réagi n'a pas de ligne : son identifiant est CALCULÉ depuis sa
-- source ('af:train:<completion_id>', 'af:pintade:<request_id>'…). Tout appareil
-- recalcule le même. `event_id` est donc stable, et une réaction s'y raccroche
-- sans jointure.
--
-- L'id de la RÉACTION est lui aussi calculé :
--   'xafr:' || event_id || ':' || actor_id || ':' || emoji
-- Conséquence : retirer puis remettre un ❤️ réécrit LA MÊME ligne (deleted_at
-- posé, puis effacé) au lieu d'en créer une seconde. C'est ce qui permet un
-- soft-delete sans jamais violer la contrainte d'unicité — et un soft-delete est
-- ici obligatoire : une ligne d'id « x… » supprimée en dur est repoussée par
-- n'importe quel client au flush suivant (cf. playbook PbSync).
--
-- ----------------------------------------------------------------------------
-- `actor_id` SANS FK, ET `actor_kind` À CÔTÉ
-- ----------------------------------------------------------------------------
-- Le coach réagit aussi. Une FK vers players(id) refuserait sa ligne ; deux
-- colonnes (une par type d'acteur) rendraient chaque lecture conditionnelle.
-- L'acteur est donc un couple (kind, id) — même posture que
-- gages.proposed_by / 'coach:<id>' | 'player:<id>', en séparé pour rester
-- indexable.
--
-- `event_at` (l'horodatage de l'ÉVÉNEMENT, pas de la réaction) est dupliqué ici
-- exprès : c'est ce qui permet de balayer les réactions dont l'événement est
-- sorti de la fenêtre de 60 jours sans avoir à rejouer toute la dérivation.
--
-- POSTURE RLS : anon « sandbox équipe », identique au reste du projet. L'app n'a
-- pas d'auth par joueuse (PIN L1 + rôle anon Supabase partagé) : `auth.uid()`
-- est NULL pour tout le monde, une policy nominative bloquerait TOUS les writes.
-- « Le stat'man n'a pas accès au feed » est tenu CÔTÉ FRONT, comme partout
-- ailleurs (il partage le rôle anon avec les autres).
--
-- Idempotente de bout en bout. Additive uniquement : aucune table existante
-- modifiée, aucune colonne ajoutée ailleurs.
-- ============================================================================

create table if not exists public.activity_feed_reactions (
  id         text primary key default gen_random_uuid()::text,
  -- Identifiant DÉRIVÉ de l'événement (cf. en-tête). Pas de FK : la table
  -- d'événements n'existe pas, et c'est délibéré.
  event_id   text not null,
  actor_id   text not null,
  actor_kind text not null default 'player' check (actor_kind in ('player', 'coach')),
  emoji      text not null check (emoji in ('heart', 'fire', 'muscle', 'clap')),
  -- Horodatage de l'ÉVÉNEMENT (pas de la réaction) : sert au balayage 60 jours.
  event_at   timestamptz,
  season_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Filet de sécurité : l'id déterministe garantit déjà l'unicité côté client.
  -- Une ligne retirée est SOFT-deleted (même id réutilisé), donc la contrainte
  -- porte bien sur le triplet complet, sans clause partielle.
  unique (event_id, actor_id, emoji)
);

create index if not exists activity_feed_reactions_event_idx
  on public.activity_feed_reactions (event_id) where deleted_at is null;
create index if not exists activity_feed_reactions_event_at_idx
  on public.activity_feed_reactions (event_at) where deleted_at is null;
create index if not exists activity_feed_reactions_deleted_at_idx
  on public.activity_feed_reactions (deleted_at);

-- ----------------------------------------------------------------------------
-- RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.activity_feed_reactions enable row level security;
drop policy if exists activity_feed_reactions_all on public.activity_feed_reactions;
create policy "activity_feed_reactions_all"
  on public.activity_feed_reactions for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------------------------
-- Utile ici : une réaction posée par une coéquipière doit apparaître sans
-- recharger — c'est tout l'intérêt d'un mur social.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'activity_feed_reactions') then
    execute 'alter publication supabase_realtime add table public.activity_feed_reactions';
  end if;
end $$;

comment on table public.activity_feed_reactions is
  'Réactions emoji du feed du groupe. Les ÉVÉNEMENTS, eux, ne sont pas stockés : ils sont dérivés à la lecture de leurs sources (cf. en-tête de la migration 20260816_001).';
comment on column public.activity_feed_reactions.event_id is
  'Id DÉRIVÉ de l''événement, calculé depuis sa source (''af:train:<completion_id>'', ''af:pintade:<request_id>''…). Aucune FK : il n''existe pas de table d''événements.';
comment on column public.activity_feed_reactions.event_at is
  'Horodatage de l''ÉVÉNEMENT (pas de la réaction) : permet le balayage des réactions sorties de la fenêtre de 60 jours sans rejouer la dérivation.';

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.activity_feed_reactions;
-- ============================================================================
