-- ============================================================================
-- Migration : l'exo pointe vers son drill + « récemment utilisés »
-- ----------------------------------------------------------------------------
-- DEUX colonnes, deux chantiers qui se tiennent : la bibliothèque de drills a
-- grossi (réaction, circuit, fractionné) au point qu'on ne la parcourt plus, et
-- rien ne reliait un exercice écrit dans `exo_templates` au drill qui le fait
-- vraiment travailler.
--
-- 1) exo_templates.drill_id
--    Un exo de la bibliothèque partagée (Ardoise + prépa) peut désigner UN
--    drill. Partout où l'exo apparaît — la carte d'ardoise de la joueuse, le
--    bloc de séance du coach — un bouton « ▶ Lancer » ouvre ce drill en plein
--    écran. Le patron existe déjà sur `training_sessions.blocks[].drill_id`
--    (jsonb) ; ici c'est une vraie colonne, donc une vraie clé étrangère.
--
--    `on delete set null` : les drills sont SOFT-supprimés (deleted_at) et rien
--    ne les efface jamais vraiment, mais si un ménage manuel passait un jour,
--    l'exo doit survivre en perdant seulement son bouton — pas disparaître.
--
--    ⚠ ORDRE DE POUSSÉE : la clé étrangère impose que la ligne `drills` existe
--    AVANT la ligne `exo_templates` qui la cite. C'est déjà le cas — dans
--    `ENTITIES` (index.html) l'entité `drills` est déclarée avant
--    `exoTemplates`, et `flushAll` les traite dans cet ordre. Le front valide en
--    plus l'id contre `state.drills` avant d'écrire : un id fantôme ferait
--    échouer TOUT le lot d'upsert de la table, et un lot en échec ne fait qu'un
--    console.warn (la table cesserait de se synchroniser en silence — mode de
--    panne déjà payé en v.115).
--
-- 2) drills.last_used_at
--    Horodatage du DERNIER lancement, écrit côté coach uniquement. Il alimente
--    la section « 🕐 Récemment utilisés » en tête de la bibliothèque. Une
--    colonne plutôt qu'un journal : on ne veut afficher que les cinq derniers,
--    jamais un historique — une table de plus serait à écrire, purger et tenir
--    synchrone pour un affichage qui ne remonte pas au-delà de cinq lignes.
--
--    LIMITE ASSUMÉE, elle est dans le modèle : une seule date par drill, donc
--    aucune notion de fréquence (« lancé 12 fois ce mois-ci » n'est pas
--    dérivable). C'est le prix d'un repère qui reste une colonne.
--
--    NULL par défaut : aucun drill existant ne se fabrique un faux passé, et la
--    section reste vide jusqu'au premier lancement réel.
--
-- LE FRONT NE DÉPEND PAS DE L'ORDRE D'APPLICATION : il détecte la présence de
-- chaque colonne (le serveur l'a-t-il renvoyée au moins une fois ?) avant de la
-- pousser — cf. `_exoDrillCol` et `_drillLastUsedCol` dans index.html. Déployer
-- le front avant cette migration ne casse donc rien : l'association et les
-- récents attendent, l'Ardoise et les drills ne bronchent pas.
--
-- Additive et idempotente.
-- ============================================================================

do $$
begin
  if to_regclass('public.drills') is null then
    raise exception 'Applique d''abord 20260710_001_drills.sql (la table drills).';
  end if;
  if to_regclass('public.exo_templates') is null then
    raise exception 'Applique d''abord 20260815_001_ardoise.sql (la table exo_templates).';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1) L'exo désigne son drill
-- ----------------------------------------------------------------------------
alter table public.exo_templates
  add column if not exists drill_id text references public.drills(id) on delete set null;

create index if not exists exo_templates_drill_id_idx
  on public.exo_templates (drill_id) where drill_id is not null;

comment on column public.exo_templates.drill_id is
  'Drill associé à cet exercice (optionnel). Affiche un bouton « ▶ Lancer » partout où l''exo apparaît : carte d''ardoise, bloc de prépa. Cf. migration 20260816_003.';

-- ----------------------------------------------------------------------------
-- 2) Dernier lancement (section « Récemment utilisés »)
-- ----------------------------------------------------------------------------
alter table public.drills
  add column if not exists last_used_at timestamptz;

create index if not exists drills_last_used_at_idx
  on public.drills (last_used_at desc nulls last) where deleted_at is null;

comment on column public.drills.last_used_at is
  'Dernier lancement du drill, écrit CÔTÉ COACH uniquement (une joueuse qui répète son fractionné ne doit pas réordonner la bibliothèque du coach). Alimente « 🕐 Récemment utilisés ». Cf. migration 20260816_003.';

-- ============================================================================
-- Rollback (manuel) :
--   drop index if exists public.exo_templates_drill_id_idx;
--   alter table public.exo_templates drop column if exists drill_id;
--   drop index if exists public.drills_last_used_at_idx;
--   alter table public.drills drop column if exists last_used_at;
-- ============================================================================
