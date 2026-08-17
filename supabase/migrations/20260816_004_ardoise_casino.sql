-- ============================================================================
-- Migration : L'ARDOISE passe du RESTAURANT au CASINO
-- ----------------------------------------------------------------------------
-- La v.124 servait des « menus » composés à l'avance par le coach : une dette
-- tirait au sort UNE recette dans une carte. Le coach devait donc écrire la
-- carte avant que la moindre dette ne puisse exister — et une carte de trois
-- menus produisait trois programmes, toujours les mêmes.
--
-- La machine à sous inverse le sens : on ne tire plus une recette, on tire des
-- EXOS, un par catégorie corporelle, directement dans la bibliothèque partagée.
-- Cinq rouleaux (💪 bras · 🦵 jambes · 🧠 gainage · 🧘 mobilité · 🔥 cardio),
-- quatre exos par spin. Avec 4 exos par catégorie, ça fait déjà des centaines
-- de programmes distincts là où la carte en donnait trois.
--
-- ----------------------------------------------------------------------------
-- CE QUI DISPARAÎT, ET CE QUI RESTE
-- ----------------------------------------------------------------------------
-- `ardoise_menus` n'est PAS supprimée. Elle devient LEGACY : plus aucun CRUD
-- côté coach, plus aucune écriture, mais la table reste — et le front continue
-- de la LIRE. Une dette tirée avant cette migration porte un `menu_id` et rien
-- d'autre : la supprimer transformerait l'historique d'une joueuse en lignes
-- vides. (En prod au moment d'écrire ces lignes, la table est vide et aucune
-- dette n'existe : le legacy ne protège en pratique que des localStorage de
-- coachs qui auraient composé une carte sans jamais la synchroniser.)
--
-- ----------------------------------------------------------------------------
-- LE PROGRAMME VIT DÉSORMAIS DANS LA DETTE (`items`)
-- ----------------------------------------------------------------------------
-- C'est LE choix structurant de cette migration. Le programme n'est plus une
-- ligne étrangère qu'on référence, c'est une COPIE FIGÉE dans la dette :
--   [{ exo_id, name, category, sets, reps, duration_sec, rest_sec, note, order }]
--
-- Copie, pas lecture vivante — et c'est délibéré, à l'inverse du lien
-- exo→drill de la 20260816_003 :
--   • le nom et la dose sont figés AU TIRAGE parce qu'ils appartiennent au
--     contrat : supprimer un exo de la bibliothèque, ou corriger ses reps par
--     défaut, ne doit pas réécrire une dette déjà tirée ni la vider ;
--   • `exo_id` reste, lui, pour retrouver la fiche vivante quand elle existe
--     encore — c'est par lui que le bouton « ▶ Lancer » du drill associé
--     apparaît sur la carte de la joueuse.
-- Même partage des rôles que `ardoise_menus.items` avant elle. Ce qui change,
-- c'est le porteur : la dette, pas la recette.
--
-- `category` est copiée elle aussi : c'est ce qui permet de réafficher le
-- programme rouleau par rouleau (« 🔥 cardio · 💪 bras… ») même si l'exo a
-- changé de catégorie ou disparu depuis.
--
-- ----------------------------------------------------------------------------
-- LE TIRAGE N'EST PAS `random()` — IL EST SEEDÉ SUR L'ID DE LA DETTE
-- ----------------------------------------------------------------------------
-- Rien ici ne le contraint (c'est du front), mais le modèle en dépend, donc ça
-- se documente au même endroit que les colonnes.
--
-- Le spin est une FONCTION PURE de (id de la dette, bibliothèque). Deux
-- conséquences, et ce sont les deux raisons du choix :
--   1. « Tirage définitif » devient vrai au lieu d'être une promesse. Une
--      joueuse qui tue l'app pendant l'animation ne relance pas les dés : à la
--      réouverture, la machine recalcule EXACTEMENT le même programme.
--   2. La dette de pénalité automatique (dont l'id est déjà dérivé de celui de
--      la dette expirée, cf. 20260815_001) reste idempotente entre onze
--      appareils : ils tirent tous le même programme sur la même clé primaire.
--
-- ----------------------------------------------------------------------------
-- LES DEUX MODES D'ASSIGNATION (`mode`)
-- ----------------------------------------------------------------------------
--   'casino'  la dette naît en `pending_draw`, `items` vide. C'est la joueuse
--             qui fait tourner la machine, et le spin remplit `items`.
--   'manual'  le coach a choisi les exos lui-même : `items` est déjà rempli à
--             l'assignation, la dette naît en `in_progress`, chrono lancé.
--             Aucun spin — imposer une machine à sous dont le résultat est déjà
--             écrit serait un mensonge d'interface.
--
-- La colonne est sur la DETTE, pas seulement dans les règles : le coach choisit
-- au cas par cas, et une dette doit rester relisible des mois plus tard sans
-- dépendre du réglage du moment.
--
-- ----------------------------------------------------------------------------
-- LES POINTS QUITTENT LE MENU (`points_reward`)
-- ----------------------------------------------------------------------------
-- Le barème vivait dans `ardoise_menus.points_reward`. Sans menu, il lui faut
-- un nouveau domicile : le défaut est dans `ardoise_rules`, et il est COPIÉ
-- dans la dette au moment où elle naît. `points_awarded` (déjà là) reste ce qui
-- est réellement acquis, figé à la validation. Deux colonnes et pas une :
--   points_reward   ce que cette dette PROMET      (figé à la naissance)
--   points_awarded  ce qu'elle a RÉELLEMENT donné  (figé à la validation)
-- Changer le barème demain ne retarife donc ni les dettes en cours, ni
-- l'historique.
--
-- ----------------------------------------------------------------------------
-- LES TROIS RÉGLAGES DU TIRAGE
-- ----------------------------------------------------------------------------
-- `exos_per_spin` (4) — le nombre d'exos par programme. Le produit dit « 4, pas
--   paramétrable » et l'interface coach n'expose donc AUCUN réglage ; la
--   colonne existe quand même, parce que la valeur devait bien être écrite
--   quelque part et qu'un jour où l'on voudra 3 ou 5, ce sera un UPDATE et pas
--   une migration. Bornée 1..5 : au-delà de 5 il n'y a plus de catégorie à
--   tirer (le front sait doubler une catégorie pour compléter, mais ce n'est
--   pas une raison pour l'inviter).
--
-- `cardio_always` (true) — le rouleau 🔥 cardio est TOUJOURS servi, les trois
--   autres exos se tirent parmi les quatre catégories restantes. Choix
--   sportif : une dette est un rattrapage physique, et le cardio est ce qui se
--   perd le plus vite ; un programme « bras + gainage + mobilité + jambes »
--   sans cardio serait un tirage malchanceux plutôt qu'une sanction. Le front
--   DÉGRADE proprement si la bibliothèque n'a aucun exo cardio : il tire alors
--   4 catégories au hasard plutôt que d'échouer.
--
-- `random_seed_isolation` (true) — deux tirages CONSÉCUTIFS de la même joueuse
--   ne repiochent pas les mêmes exos : les exos de son programme précédent sont
--   écartés du vivier, catégorie par catégorie, TANT QU'IL RESTE AUTRE CHOSE
--   dans cette catégorie (sinon l'exclusion est levée pour elle — mieux vaut un
--   exo répété qu'un rouleau vide). Sans ce garde-fou, une bibliothèque de
--   trois exos par catégorie resservirait mécaniquement le même programme à
--   celle qui enchaîne les dettes, ce qui est exactement le public visé.
--
-- ----------------------------------------------------------------------------
-- AUCUNE COLONNE DE CATÉGORIE À AJOUTER
-- ----------------------------------------------------------------------------
-- Vérifié avant d'écrire : le CHECK de `exo_templates.category` (20260815_001)
-- contient déjà cardio, gainage, jambes, bras, mobilite — les cinq rouleaux —
-- plus combine et autre. Ces deux dernières n'ont PAS de rouleau : un exo qui y
-- est rangé n'est jamais tiré. Le front le dit au coach dans l'écran de
-- réglages plutôt que de le laisser deviner.
--
-- Additive et idempotente. Aucune donnée existante n'est réécrite.
-- ============================================================================

do $$
begin
  if to_regclass('public.ardoise_assignments') is null or to_regclass('public.ardoise_rules') is null then
    raise exception 'Applique d''abord 20260815_001_ardoise.sql (les tables de L''Ardoise).';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1) LA DETTE PORTE SON PROGRAMME
-- ----------------------------------------------------------------------------
alter table public.ardoise_assignments
  add column if not exists items          jsonb   not null default '[]'::jsonb,
  add column if not exists mode           text    not null default 'casino',
  add column if not exists points_reward  integer not null default 20,
  add column if not exists title          text;

-- Les CHECK sont posés à part : `add column if not exists` ne rejoue pas la
-- contrainte si la colonne est déjà là (migration relancée), et une contrainte
-- nommée se teste proprement dans pg_constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ardoise_assignments_mode_chk') then
    alter table public.ardoise_assignments
      add constraint ardoise_assignments_mode_chk check (mode in ('casino', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ardoise_assignments_points_reward_chk') then
    alter table public.ardoise_assignments
      add constraint ardoise_assignments_points_reward_chk check (points_reward between 0 and 1000);
  end if;
end $$;

comment on column public.ardoise_assignments.items is
  'Le programme tiré (ou choisi par le coach) : [{exo_id, name, category, sets, reps, duration_sec, rest_sec, note, order}]. COPIE FIGÉE — nom, dose et catégorie appartiennent au contrat de la dette ; seul exo_id reste un lien vivant, pour retrouver le drill associé. Cf. migration 20260816_004.';
comment on column public.ardoise_assignments.mode is
  'casino = la joueuse fait tourner la machine (items vide tant que status = pending_draw) · manual = le coach a choisi les exos, items déjà rempli et chrono lancé.';
comment on column public.ardoise_assignments.points_reward is
  'Ce que cette dette PROMET, copié depuis ardoise_rules à sa naissance. À ne pas confondre avec points_awarded, qui est ce qu''elle a réellement donné, figé à la validation.';
comment on column public.ardoise_assignments.title is
  'Nom du programme (« 💎 Carré d''As » tiré au sort, ou le titre écrit par le coach en mode manuel). Décoratif : rien ne s''y calcule.';

-- ----------------------------------------------------------------------------
-- 2) LES RÉGLAGES DE LA MACHINE
-- ----------------------------------------------------------------------------
alter table public.ardoise_rules
  add column if not exists assignment_mode       text    not null default 'casino',
  add column if not exists exos_per_spin         integer not null default 4,
  add column if not exists cardio_always         boolean not null default true,
  add column if not exists random_seed_isolation boolean not null default true,
  add column if not exists points_reward         integer not null default 20;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ardoise_rules_assignment_mode_chk') then
    alter table public.ardoise_rules
      add constraint ardoise_rules_assignment_mode_chk check (assignment_mode in ('casino', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ardoise_rules_exos_per_spin_chk') then
    alter table public.ardoise_rules
      add constraint ardoise_rules_exos_per_spin_chk check (exos_per_spin between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ardoise_rules_points_reward_chk') then
    alter table public.ardoise_rules
      add constraint ardoise_rules_points_reward_chk check (points_reward between 0 and 1000);
  end if;
end $$;

comment on column public.ardoise_rules.assignment_mode is
  'Mode PROPOSÉ par défaut quand le coach ardoise quelqu''un. Il peut en changer dette par dette : c''est ardoise_assignments.mode qui fait foi.';
comment on column public.ardoise_rules.exos_per_spin is
  'Exos par programme (4). Volontairement PAS exposé dans l''interface coach — la valeur devait exister quelque part, elle vit ici. Cf. en-tête de la migration.';
comment on column public.ardoise_rules.cardio_always is
  'Le rouleau cardio est toujours servi ; les autres exos se tirent parmi les 4 catégories restantes. Dégradé proprement par le front si la bibliothèque n''a aucun cardio.';
comment on column public.ardoise_rules.random_seed_isolation is
  'Écarte du vivier les exos du programme PRÉCÉDENT de la même joueuse, catégorie par catégorie, tant qu''il reste autre chose à y piocher. Sans ça, une bibliothèque courte ressert le même programme à celle qui enchaîne les dettes.';
comment on column public.ardoise_rules.points_reward is
  'Barème par défaut, copié dans chaque dette à sa naissance (ardoise_assignments.points_reward). Le changer ne retarife jamais une dette déjà née.';

-- ----------------------------------------------------------------------------
-- 3) `ardoise_menus` DEVIENT LEGACY
-- ----------------------------------------------------------------------------
-- Aucun DDL : la table, ses index et sa policy restent tels quels. Seul le
-- commentaire change, pour que la prochaine lecture du schéma n'aille pas
-- chercher un CRUD qui n'existe plus.
comment on table public.ardoise_menus is
  'LEGACY (depuis 20260816_004). Les « menus » du restaurant ont été remplacés par le tirage casino : le programme vit maintenant dans ardoise_assignments.items. Plus aucune écriture côté app ; la table survit uniquement pour que les dettes antérieures, qui ne portent qu''un menu_id, restent lisibles.';
comment on column public.ardoise_assignments.menu_id is
  'LEGACY : renseigné seulement sur les dettes tirées AVANT la migration 20260816_004. Les dettes récentes portent leur programme dans items.';

-- ============================================================================
-- Rollback (manuel — perd les programmes déjà tirés) :
--   alter table public.ardoise_assignments
--     drop constraint if exists ardoise_assignments_mode_chk,
--     drop constraint if exists ardoise_assignments_points_reward_chk,
--     drop column if exists items, drop column if exists mode,
--     drop column if exists points_reward, drop column if exists title;
--   alter table public.ardoise_rules
--     drop constraint if exists ardoise_rules_assignment_mode_chk,
--     drop constraint if exists ardoise_rules_exos_per_spin_chk,
--     drop constraint if exists ardoise_rules_points_reward_chk,
--     drop column if exists assignment_mode, drop column if exists exos_per_spin,
--     drop column if exists cardio_always, drop column if exists random_seed_isolation,
--     drop column if exists points_reward;
-- ============================================================================
