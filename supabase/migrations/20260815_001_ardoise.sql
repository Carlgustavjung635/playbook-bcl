-- ============================================================================
-- Migration : L'ARDOISE — dettes sportives « menu du chef »
-- ----------------------------------------------------------------------------
-- Le coach ardoise une joueuse (1, 2, 3 dettes…). Pour CHAQUE dette, la joueuse
-- tire au sort son « menu » (un programme d'exos), puis a N jours pour le
-- consommer : soit devant le coach à l'entraînement, soit à la maison avec une
-- photo de preuve. Menu réussi = points positifs. Menu non consommé dans les
-- délais = la dette expire ET une nouvelle dette la remplace, déjà tirée au sort,
-- avec un nouveau délai. Le cycle ne s'arrête que quand elle s'exécute.
--
-- QUATRE TABLES, ET POURQUOI :
--   exo_templates       la bibliothèque d'exercices. PARTAGÉE avec la prépa
--                       (training_sessions.blocks) : mono-usage, un exercice
--                       écrit une fois sert aux deux systèmes.
--   ardoise_menus       les recettes : une liste ordonnée d'exos + un niveau +
--                       des points. Le coach les compose une fois pour toutes.
--   ardoise_assignments les dettes. UNE LIGNE = UNE DETTE. Un raté ne réécrit
--                       JAMAIS la ligne : il la clôt (expired_penalized) et en
--                       ouvre une neuve qui la référence (parent_id) — même
--                       posture que pintade_holders, sans quoi l'historique de
--                       la dette serait perdu à chaque cycle.
--   ardoise_rules       singleton de configuration + texte CMS des règles.
--
-- ----------------------------------------------------------------------------
-- CE QUI N'EST **PAS** STOCKÉ, ET POURQUOI
-- ----------------------------------------------------------------------------
-- Ni le nombre de dettes actives, ni le total de points gagnés, ni « quelle
-- dette est la courante » ne sont matérialisés : tout se dérive à la lecture des
-- `ardoise_assignments`, comme la dette de gages ou les compteurs de la pintade.
-- Un compteur écrit en base serait incrémenté par le client qui CONSTATE
-- l'événement — or ils sont onze, et le projet a déjà payé ce prix (convocations
-- en double, cumuls cross-saison).
--
-- ----------------------------------------------------------------------------
-- LA PÉNALITÉ AUTOMATIQUE EST **DÉTERMINISTE** — c'est le cœur du dossier
-- ----------------------------------------------------------------------------
-- La dette de remplacement, elle, ne peut pas être dérivée : c'est une LIGNE, et
-- une ligne doit bien être écrite par quelqu'un. Onze appareils qui constatent la
-- même expiration écriraient onze dettes.
--
-- La parade n'est pas un verrou, c'est le DÉTERMINISME : la dette de pénalité
-- porte un identifiant CALCULÉ à partir de celui de la dette expirée
-- ('xard…p'), et toutes ses dates sont calculées elles aussi (tirage = échéance
-- de la dette morte, nouvelle échéance = tirage + délai). Le menu tiré au sort
-- l'est par hachage de cet identifiant sur la liste triée des menus actifs. Onze
-- appareils écrivent donc EXACTEMENT la même ligne, sur la même clé primaire :
-- l'upsert en fait une seule. Idempotent par construction, y compris pour un
-- appareil resté trois semaines hors ligne, qui rejoue la chaîne entière et
-- retombe sur les mêmes identifiants.
--
-- C'est aussi pour ça que la pénalité est TIRÉE AUTOMATIQUEMENT et non laissée
-- en 'pending_draw' : une dette qui attend que la joueuse ouvre l'app pour
-- redémarrer son chrono, c'est une sanction qu'on esquive en n'ouvrant pas
-- l'app. Le cycle doit tourner sans elle.
--
-- ----------------------------------------------------------------------------
-- POSTURE RLS : anon « sandbox équipe », identique au reste du projet. L'app n'a
-- pas d'auth par joueuse (PIN L1 + rôle anon Supabase partagé) : `auth.uid()`
-- est NULL pour tout le monde, une policy nominative bloquerait TOUS les writes.
-- « Seul le coach assigne / valide » est tenu CÔTÉ FRONT, comme partout ailleurs.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère ses
-- ids via uid() (préfixe 'x'), heuristique anti-wipe des apply() de PbSync.
--
-- Idempotente de bout en bout (if not exists / drop policy if exists / garde
-- pg_publication_tables). Additive uniquement : aucune table existante modifiée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) LA BIBLIOTHÈQUE D'EXERCICES (partagée prépa + ardoise)
-- ----------------------------------------------------------------------------
-- Une seule bibliothèque pour les deux systèmes. Les valeurs `default_*` sont
-- des SUGGESTIONS : un menu qui reprend un exo en fige sa propre dose (séries,
-- reps, durée) dans son jsonb `items`. Modifier l'exo ensuite ne réécrit donc
-- jamais un menu déjà composé — même principe que le barème figé de la prépa.
create table if not exists public.exo_templates (
  id                   text primary key default gen_random_uuid()::text,
  name                 text not null default '',
  category             text not null default 'autre'
                       check (category in ('cardio', 'gainage', 'jambes', 'bras',
                                           'mobilite', 'combine', 'autre')),
  default_sets         integer check (default_sets is null or default_sets between 1 and 50),
  default_reps         integer check (default_reps is null or default_reps between 1 and 999),
  default_duration_sec integer check (default_duration_sec is null or default_duration_sec between 1 and 7200),
  default_rest_sec     integer not null default 30 check (default_rest_sec between 0 and 3600),
  description_md       text,
  illustration_url     text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index if not exists exo_templates_category_idx
  on public.exo_templates (category) where deleted_at is null;
create index if not exists exo_templates_deleted_at_idx on public.exo_templates (deleted_at);

-- ----------------------------------------------------------------------------
-- 2) LES MENUS (les recettes de l'ardoise)
-- ----------------------------------------------------------------------------
-- `level` est la « lourdeur » du menu, en langage de carte :
--   starter (⭐ mise en bouche) · plat (🥘 le vrai repas)
--   dessert (🔥 ça pique)       · feu (🌋 le menu du chef)
--
-- `items` : [{ exo_id, name, sets, reps, duration_sec, rest_sec, note, order }].
-- `name` y est DUPLIQUÉ depuis l'exo au moment de la composition, exprès : un
-- exo supprimé de la bibliothèque ne doit pas transformer un menu déjà tiré au
-- sort en liste de lignes vides. Le lien `exo_id` reste pour retrouver la fiche
-- quand elle existe encore.
--
-- `is_active` plutôt qu'une suppression : un menu retiré du tirage doit rester
-- lisible sur les dettes qui le portent déjà.
create table if not exists public.ardoise_menus (
  id                     text primary key default gen_random_uuid()::text,
  name                   text not null default '',
  level                  text not null default 'plat'
                         check (level in ('starter', 'plat', 'dessert', 'feu')),
  description_md         text,
  theme_emoji            text default '🍽',
  estimated_duration_min integer check (estimated_duration_min is null or estimated_duration_min between 1 and 600),
  items                  jsonb not null default '[]'::jsonb,
  -- Points positifs gagnés quand le menu est validé. FIGÉ dans la dette au
  -- moment de la validation (cf. ardoise_assignments.points_awarded) : changer
  -- le barème ne doit pas réécrire l'historique.
  points_reward          integer not null default 20 check (points_reward between 0 and 1000),
  is_active              boolean not null default true,
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create index if not exists ardoise_menus_active_idx
  on public.ardoise_menus (is_active, level) where deleted_at is null;
create index if not exists ardoise_menus_deleted_at_idx on public.ardoise_menus (deleted_at);

-- ----------------------------------------------------------------------------
-- 3) LES DETTES
-- ----------------------------------------------------------------------------
-- Cycle de vie :
--   pending_draw      assignée par le coach, pas encore tirée au sort.
--   in_progress       tirée : `menu_id`, `drawn_at` et `deadline_at` sont posés.
--   done_home         photo envoyée, en attente de validation du coach.
--   done_validated    photo validée par le coach              → points acquis
--   done_at_training  validée de visu par le coach            → points acquis
--   expired_penalized délai dépassé : dette morte, remplacée (cf. parent_id).
--
-- Un refus de photo par le coach REVIENT à 'in_progress' : ce n'est pas un état
-- terminal, c'est « recommence ». Une dette assignée par erreur se soft-delete
-- (`deleted_at`) — JAMAIS de hard delete : une ligne d'id « x… » supprimée en
-- dur est repoussée par n'importe quel client au flush suivant.
create table if not exists public.ardoise_assignments (
  id               text primary key default gen_random_uuid()::text,
  player_id        text not null references public.players(id) on delete cascade,
  -- NULL tant que la dette n'est pas tirée au sort.
  menu_id          text references public.ardoise_menus(id) on delete set null,
  drawn_at         timestamptz,
  -- drawn_at + rules.deadline_days, FIGÉ au tirage : si le coach change le délai
  -- entre-temps, une dette déjà tirée garde son contrat.
  deadline_at      timestamptz,
  status           text not null default 'pending_draw'
                   check (status in ('pending_draw', 'in_progress', 'done_at_training',
                                     'done_home', 'done_validated', 'expired_penalized')),
  proof_photo_url  text,
  assigned_by      text,
  assigned_at      timestamptz not null default now(),
  validated_by     text,
  validated_at     timestamptz,
  -- Points RÉELLEMENT acquis, figés à la validation depuis menus.points_reward.
  points_awarded   integer not null default 0,
  -- Dette de pénalité : pointe la dette expirée qui l'a engendrée. C'est aussi
  -- ce qui rend la chaîne relisible (« 4e tour de cette dette-là »).
  parent_id        text references public.ardoise_assignments(id) on delete set null,
  notes            text,
  season_id        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists ardoise_assignments_player_active_idx
  on public.ardoise_assignments (player_id, status) where deleted_at is null;
create index if not exists ardoise_assignments_deadline_idx
  on public.ardoise_assignments (deadline_at)
  where deleted_at is null and status = 'in_progress';
create index if not exists ardoise_assignments_parent_idx on public.ardoise_assignments (parent_id);
create index if not exists ardoise_assignments_deleted_at_idx on public.ardoise_assignments (deleted_at);

-- ----------------------------------------------------------------------------
-- 4) LES RÈGLES (singleton, id = 'default')
-- ----------------------------------------------------------------------------
-- Même modèle que pintade_rules / team_settings : une seule ligne, éditée par le
-- coach, lue par tout le monde.
create table if not exists public.ardoise_rules (
  id                     text primary key default 'default',
  -- Combien de jours pour consommer un menu, à partir du tirage.
  deadline_days          integer not null default 7 check (deadline_days between 1 and 90),
  -- Plafond de dettes cumulées. Au plafond, une expiration ne régénère plus rien
  -- (sinon la sanction devient une spirale dont on ne sort jamais).
  max_debts              integer not null default 10 check (max_debts between 1 and 50),
  auto_penalty_on_expire boolean not null default true,
  -- La pénalité est-elle tirée au sort automatiquement ? true = le chrono
  -- repart sans attendre que la joueuse ouvre l'app (cf. en-tête).
  auto_draw_on_penalty   boolean not null default true,
  require_photo_at_home  boolean not null default true,
  -- Règles du jeu écrites par le coach (markdown). NULL = pas personnalisé → le
  -- front affiche SON texte par défaut, qui suit les évolutions du jeu.
  rules_text_md          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text
);
-- Seed de la ligne unique. `on conflict do nothing` → rejouer la migration ne
-- réinitialise JAMAIS des règles déjà personnalisées par le coach.
insert into public.ardoise_rules (id) values ('default') on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5) RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.exo_templates       enable row level security;
alter table public.ardoise_menus       enable row level security;
alter table public.ardoise_assignments enable row level security;
alter table public.ardoise_rules       enable row level security;

drop policy if exists exo_templates_all       on public.exo_templates;
drop policy if exists ardoise_menus_all       on public.ardoise_menus;
drop policy if exists ardoise_assignments_all on public.ardoise_assignments;
drop policy if exists ardoise_rules_all       on public.ardoise_rules;

create policy "exo_templates_all"       on public.exo_templates       for all using (true) with check (true);
create policy "ardoise_menus_all"       on public.ardoise_menus       for all using (true) with check (true);
create policy "ardoise_assignments_all" on public.ardoise_assignments for all using (true) with check (true);
create policy "ardoise_rules_all"       on public.ardoise_rules       for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 6) REALTIME
-- ----------------------------------------------------------------------------
-- Nécessaire ici : le coach doit voir la photo de preuve arriver sans recharger,
-- et la joueuse doit voir sa dette disparaître dès qu'il valide.
do $$
declare t text;
begin
  foreach t in array array['exo_templates', 'ardoise_menus', 'ardoise_assignments', 'ardoise_rules']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7) BUCKET DES PREUVES
-- ----------------------------------------------------------------------------
-- Public en lecture, comme 'pintade-proofs' / 'training-photos' : le coach
-- consulte les preuves et l'app n'a pas d'auth par joueuse permettant une URL
-- signée par destinataire.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ardoise-proofs', 'ardoise-proofs', true, 8388608,
          array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "ardoise_proofs_anon_read"   on storage.objects;
drop policy if exists "ardoise_proofs_anon_insert" on storage.objects;
drop policy if exists "ardoise_proofs_anon_update" on storage.objects;

create policy "ardoise_proofs_anon_read"
  on storage.objects for select to anon using (bucket_id = 'ardoise-proofs');
create policy "ardoise_proofs_anon_insert"
  on storage.objects for insert to anon with check (bucket_id = 'ardoise-proofs');
create policy "ardoise_proofs_anon_update"
  on storage.objects for update to anon using (bucket_id = 'ardoise-proofs') with check (bucket_id = 'ardoise-proofs');
-- PAS de policy DELETE : une preuve validée est une pièce du dossier.

comment on table public.exo_templates is
  'Bibliothèque d''exercices PARTAGÉE entre la prépa (training_sessions.blocks) et L''Ardoise (ardoise_menus.items).';
comment on column public.ardoise_assignments.parent_id is
  'Dette expirée qui a engendré celle-ci. L''id de la pénalité est DÉRIVÉ de celui du parent (cf. en-tête) : c''est ce qui rend sa création idempotente entre onze appareils.';

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.ardoise_assignments;
--   drop table if exists public.ardoise_menus;
--   drop table if exists public.ardoise_rules;
--   drop table if exists public.exo_templates;
--   delete from storage.objects where bucket_id = 'ardoise-proofs';
--   delete from storage.buckets where id = 'ardoise-proofs';
-- NE PAS toucher training_sessions / training_programs : la bibliothèque est
-- LUE par la prépa, elle n'y est jamais référencée par une FK.
-- ============================================================================
