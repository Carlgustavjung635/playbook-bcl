-- ============================================================================
-- Migration : la BIBLIOTHÈQUE d'animations (une animation, N plays)
-- ----------------------------------------------------------------------------
-- CE QUI CHANGE, ET POURQUOI ÇA NE CONTREDIT PAS 20260823_002
--
-- La 20260823_002 disait : « une animation n'est pas une entité concurrente du
-- play, c'est un MÉDIA du play ». C'était vrai tant qu'une animation ne servait
-- qu'à UN play. Le besoin a bougé : le même écran (une sortie de balle, une
-- rotation défensive) illustre trois plays différents, et jusqu'ici il fallait
-- le redessiner trois fois — puis le corriger trois fois. Un média qui se
-- partage n'est plus un média inline, c'est une ressource : d'où la table.
--
-- On ne renie donc pas le raisonnement précédent, on constate qu'une de ses
-- prémisses (1 animation ⇒ 1 hôte) ne tient plus. Ce que la 20260823_002
-- craignait — « recoller deux objets pour afficher une fiche » — reste vrai et
-- reste le prix payé : la fiche play résout maintenant ses refs contre la
-- bibliothèque, chargée une fois par session (`loadAnimLibrary`, index.html).
--
-- ── 1) TABLE `animations` — la bibliothèque ────────────────────────────────
-- `data` porte le blob d'échange de l'éditeur, EXACTEMENT au format décrit
-- dans l'en-tête de 20260823_002 (id, title, players[], steps[], branches,
-- zones, court_type, ball_start…). Aucune contrainte de forme ici : le format
-- évolue à chaque jalon de l'éditeur et une contrainte jsonb obligerait une
-- migration à chaque champ ajouté.
--
-- `title` est DUPLIQUÉ hors du blob : la bibliothèque doit pouvoir se lister et
-- se trier sans désérialiser N blobs de plusieurs dizaines de Ko. `data.title`
-- reste la source pour l'éditeur ; les deux sont écrits ensemble.
--
-- SOFT-DELETE (`deleted_at`) et pas de hard delete : une animation référencée
-- par plusieurs plays qui disparaîtrait vraiment laisserait autant de fiches
-- avec un trou muet. Soft-delete = le seul état terminal durable dans cette
-- app (cf. playbook PbSync), et la ref orpheline se rend simplement comme
-- « animation supprimée » au lieu de faire planter la résolution.
--
-- ── 2) COLONNE `plays.animation_refs` — l'attachement ──────────────────────
-- Un TABLEAU d'objets, ordonné (l'ordre d'affichage sur la fiche) :
--   [ { "id": "<anim>", "mode": "ref" },
--     { "id": "<source>", "mode": "copy", "copy_id": "<clone>" } ]
--
--   mode="ref"  → le play POINTE la ligne `animations.id`. Éditer l'animation
--                 propage à tous les plays qui la référencent. C'est le défaut.
--   mode="copy" → au moment de l'attachement, la source a été CLONÉE dans
--                 `animations` sous un nouvel id (`copy_id`) ; c'est lui qu'on
--                 affiche et qu'on édite. `id` garde la trace de la source,
--                 uniquement pour l'affichage (« copie de … ») — la copie est
--                 indépendante, plus rien ne la relie fonctionnellement.
--
-- POURQUOI PAS UNE TABLE DE JOINTURE `play_animations` ? Parce que l'ORDRE et
-- le MODE sont des propriétés du play, pas de la relation vue depuis la base :
-- une colonne jsonb se lit dans le même `select *` que le reste du play (donc
-- zéro requête de plus dans PbSync, qui fait déjà `select('*')`), là où une
-- table de jointure aurait imposé un second canal, une seconde souscription
-- realtime et un ordre à matérialiser dans une colonne `position` de toute
-- façon. Le prix : aucune intégrité référentielle côté base — une ref peut
-- pointer une animation soft-supprimée. C'est assumé et géré côté front.
--
-- ── 3) RÉTROCOMPAT — `plays.animations` reste LU ───────────────────────────
-- La colonne inline de 20260823_002 n'est ni supprimée ni vidée. Règle de
-- lecture, une seule, dans `getPlayAnimations()` :
--     animation_refs non vide  ⇒ la bibliothèque fait foi
--     animation_refs vide      ⇒ on rend `animations` inline (comme avant)
-- Un play jamais migré s'affiche donc exactement comme avant cette migration,
-- y compris côté joueuse et y compris si le front est déployé sans la table.
--
-- L'EXTRACTION est PROGRESSIVE et opportuniste : à la première ouverture de
-- l'écran Plays par un coach non scopé, `_migrateInlineAnimsToLibrary()`
-- déverse les animations inline dans la bibliothèque et écrit les refs, un
-- play à la fois. Rien n'est supprimé de `animations` au passage : si
-- l'extraction se casse en route, la lecture retombe sur l'inline.
--
-- ── 4) QUI ÉCRIT QUOI (le point qui se paie cher si on l'oublie) ───────────
-- `plays.animation_refs`, comme `plays.animations`, N'EST JAMAIS POUSSÉE par
-- le `dump` de l'entité PbSync `plays` — elle est seulement LUE par `apply`.
-- C'est la même asymétrie qu'en 20260823_002, pour la même raison : un upsert
-- PostgREST ne touche pas aux colonnes qu'on ne lui fournit pas, donc un
-- appareil dont le localStorage est en retard ne peut pas réécrire des refs
-- périmées au prochain flush (playbook « réconcilier avant de pousser »).
-- Tout attachement / détachement passe par un read-modify-write PostgREST
-- explicite (`_readAnimRefs` / `_writeAnimRefs` dans index.html) ; la table
-- `animations` est écrite par l'éditeur (mode `lib=`) et, pour le clonage et
-- le soft-delete, par ces mêmes appels directs. Ajouter la colonne au `dump`
-- rouvrirait exactement le trou refermé ici.
--
-- Additive et idempotente.
-- ============================================================================

do $$
begin
  if to_regclass('public.plays') is null then
    raise exception 'Table plays absente — applique d''abord les migrations plays.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1) La bibliothèque
-- ----------------------------------------------------------------------------
create table if not exists public.animations (
  id          text primary key,
  title       text not null default 'Sans titre',
  data        jsonb not null default '{}'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Le tri par défaut de la bibliothèque : les plus récemment retouchées d'abord.
create index if not exists idx_animations_updated on public.animations(updated_at desc);
-- Le filtre de TOUTES les lectures front : les vivantes seulement.
create index if not exists idx_animations_alive on public.animations(deleted_at) where deleted_at is null;

comment on table public.animations is
  'Bibliothèque d''animations tactiques PARTAGEABLES (éditeur v2). Une animation peut être attachée à N plays via plays.animation_refs. Soft-delete uniquement (deleted_at) : un hard delete laisserait des refs muettes sur des fiches encore publiées.';
comment on column public.animations.data is
  'Blob d''échange de l''éditeur (format pb-play/2, cf. en-tête de 20260823_002). Aucune contrainte de forme : le format évolue à chaque jalon de l''éditeur.';
comment on column public.animations.title is
  'Titre DUPLIQUÉ hors du blob pour lister/trier la bibliothèque sans désérialiser N blobs. Écrit en même temps que data.title.';

-- ----------------------------------------------------------------------------
-- 2) L'attachement, côté play
-- ----------------------------------------------------------------------------
alter table public.plays
  add column if not exists animation_refs jsonb not null default '[]'::jsonb;

comment on column public.plays.animation_refs is
  'Animations ATTACHÉES au play, ordonnées : [{id, mode:"ref"} | {id:<source>, mode:"copy", copy_id:<clone>}]. mode=ref ⇒ la modif de l''animation propage à tous les plays qui la référencent ; mode=copy ⇒ clone indépendant (copy_id) créé à l''attachement. Vide ⇒ on retombe sur plays.animations (inline, 20260823_002). JAMAIS poussée par le dump PbSync `plays` — read-modify-write PostgREST uniquement.';

-- ----------------------------------------------------------------------------
-- 3) RLS — même régime que `plays` : la clé publishable lit et écrit
-- ----------------------------------------------------------------------------
-- La bibliothèque suit exactement le modèle d'autorisation du reste de l'app :
-- il n'y a pas d'identité SQL par coach (l'auth L1 est un rôle + PIN côté
-- client), donc aucune policy ne saurait distinguer un coach d'une joueuse.
-- Le cloisonnement « la joueuse ne voit pas la bibliothèque » est une règle
-- d'UI (l'écran n'existe pas pour elle), pas une règle de base — comme pour
-- `plays`, `drills` ou `exo_templates`.
alter table public.animations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'animations' and policyname = 'animations_all'
  ) then
    create policy "animations_all" on public.animations for all using (true) with check (true);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4) REALTIME — une animation partagée corrigée doit arriver seule
-- ----------------------------------------------------------------------------
-- Sans ça, un coach qui corrige une animation référencée par trois plays
-- laisserait les autres appareils sur l'ancienne version jusqu'au prochain
-- passage au premier plan.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'animations'
  ) then
    alter publication supabase_realtime add table public.animations;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel — perd les attachements, PAS les animations inline) :
--   alter table public.plays drop column if exists animation_refs;
--   drop table if exists public.animations;
-- Les plays dont les animations ont déjà été extraites retomberaient sur leur
-- colonne `animations` inline, qui n'a jamais été vidée : ils réafficheraient
-- l'état d'AVANT l'extraction (les retouches faites depuis, en bibliothèque,
-- seraient perdues). C'est le prix du rollback, il est écrit ici exprès.
-- ============================================================================
