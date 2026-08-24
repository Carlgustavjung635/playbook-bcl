-- ============================================================================
-- Migration : plays_v2 — les plays DESSINÉS (éditeur jalon 3)
-- ----------------------------------------------------------------------------
-- POURQUOI UNE NOUVELLE TABLE plutôt que des colonnes sur `plays` — la table
-- `plays` existante porte des plays RÉDIGÉS (titre, description, vidéos,
-- images, concepts). Le nouvel éditeur produit autre chose : une GÉOMÉTRIE
-- animée (positions de départ, flèches, temps). Greffer 6 colonnes jsonb sur
-- `plays` aurait embarqué cette géométrie dans l'entité PbSync `plays`, donc
-- dans le dump/apply de TOUS les appareils, y compris ceux qui n'ouvriront
-- jamais l'éditeur. `plays_v2` reste HORS PbSync : le POC parle à PostgREST en
-- direct (fetch), il ne pousse rien dans `state`. Cf. l'en-tête du fichier
-- src/plays-editor-poc.html.
--
-- SOFT-DELETE — `deleted_at`, jamais de DELETE. Même posture que le reste de
-- l'app : un hard DELETE ne tue pas durablement une ligne d'id « x… » quand
-- plusieurs appareils désynchronisés peuvent la ré-écrire, seul un état
-- terminal PERSISTANT tient. Toutes les lectures filtrent `deleted_at is null`.
--
-- FORME DES jsonb (ce que le front écrit ; documenté aussi en commentaires
-- de colonnes plus bas) :
--   players : [ {id:'a1', side:'atk', n:1, x:87, y:112}, … ]  positions au
--             temps 0, en coordonnées terrain (1 unité = 10 cm).
--   steps   : [ { n:1, note:'', positions:{'a1':{x,y},…},
--                 moves:[{player:1, to:{x,y}, via:[{x,y}…]}],
--                 pass:{from:1,to:2}, passes:[…], shot:3 }, … ]
--             Le numéro de joueuse est SIGNÉ : +n = attaque, −n = défense.
--             `positions` est la photo au DÉBUT du temps ; `moves` décrit ce
--             qui se passe PENDANT. `pass` (singulier) est le doublon du
--             premier élément de `passes`, gardé pour la compat du format
--             d'échange atk-zone.json.
--   arrows  : à plat, toutes les flèches de tous les temps, chacune portant
--             son `step`. Redondant avec steps[].moves/passes — c'est une vue
--             de LECTURE pour un consommateur qui ne veut pas dérouler les
--             temps (ex. une vignette statique). Le front ne la relit jamais.
--
-- RLS — mêmes règles que le reste du schéma : politique permissive et
-- cloisonnement CÔTÉ CLIENT (l'éditeur n'est atteignable que depuis la section
-- coach de l'app). Aucune politique « coach only » n'est possible côté base :
-- l'app n'a pas d'identité Supabase par rôle (la couche L1 rôle+PIN est
-- applicative), la clé publishable est la même pour tout le monde.
-- ============================================================================

create table if not exists public.plays_v2 (
  id              text primary key,
  title           text not null,
  tag             text,
  side            text,
  color           text,
  description     text,
  points_md       text,
  ball_start      int,
  players         jsonb not null default '[]'::jsonb,
  arrows          jsonb not null default '[]'::jsonb,
  steps           jsonb not null default '[]'::jsonb,
  defense_enabled boolean not null default false,
  court_type      text not null default 'half',
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Contraintes posées à part : `create table if not exists` ne les ajoute pas
-- sur une table déjà créée par un passage antérieur de cette migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plays_v2_side_chk') then
    alter table public.plays_v2 add constraint plays_v2_side_chk
      check (side is null or side in ('attaque','defense','transition','remise'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plays_v2_court_chk') then
    alter table public.plays_v2 add constraint plays_v2_court_chk
      check (court_type in ('half','full'));
  end if;
end $$;

-- La liste de l'éditeur ne montre que les plays vivants, triés par fraîcheur :
-- index partiel, il ne porte donc pas le poids des lignes supprimées.
create index if not exists plays_v2_alive_idx
  on public.plays_v2 (updated_at desc) where deleted_at is null;

alter table public.plays_v2 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'plays_v2' and policyname = 'plays_v2_all'
  ) then
    create policy "plays_v2_all" on public.plays_v2 for all using (true) with check (true);
  end if;
end $$;

comment on table public.plays_v2 is
  'Plays DESSINÉS par l''éditeur (src/plays-editor-poc.html). Distincte de `plays` (plays rédigés : vidéos, images, concepts) et HORS PbSync : le front parle à PostgREST en direct. Suppression = soft-delete via deleted_at, jamais de DELETE.';
comment on column public.plays_v2.players is
  'Positions au temps 0 : [{id,side,n,x,y}]. Coordonnées terrain, 1 unité = 10 cm, origine au coin haut-gauche de la zone hors-jeu (marge de 12 unités autour de l''aire de jeu, là où se place la remise en touche).';
comment on column public.plays_v2.steps is
  'Les temps du play : [{n, note, positions:{tokId:{x,y}}, moves:[{player,to,via}], pass:{from,to}, passes:[], shot}]. Numéro de joueuse SIGNÉ : +n attaque, −n défense. `positions` = photo au début du temps, `moves` = ce qui se passe pendant. `pass` singulier duplique passes[0] pour la compat du format d''échange.';
comment on column public.plays_v2.arrows is
  'Vue APLATIE de toutes les flèches, chacune portant son `step`. Redondante avec steps[] — destinée à un lecteur qui ne déroule pas les temps. Le front ne la relit jamais : au chargement, seule `steps` fait foi.';
comment on column public.plays_v2.ball_start is
  'Numéro SIGNÉ de la porteuse au temps 0 (+n attaque, −n défense), ou NULL pour une situation sans ballon (ex. un écran hors ballon).';
comment on column public.plays_v2.court_type is
  'half = demi-terrain vertical, full = terrain complet horizontal. L''éditeur garde UN schéma par mode (les deux n''ont pas le même repère) ; c''est celui-ci qui est publié.';
comment on column public.plays_v2.created_by is
  'Nom libre saisi côté coach. Aucune FK : la table vit hors PbSync et hors du modèle de rôles.';

-- ============================================================================
-- Rollback (manuel — perd tous les plays dessinés) :
--   drop table if exists public.plays_v2;
-- ============================================================================
