-- ============================================================================
-- v.153 — NOTES COACHS + EXOS ALTERNATIFS
-- ----------------------------------------------------------------------------
-- DEUX chantiers ; UN SEUL a besoin de DDL.
--
-- 1. training_coach_notes : le fil privé entre coachs sur une séance.
--
--    ⚠ IL N'EXISTE AUCUNE TABLE `trainings` DANS CE PROJET. L'entraînement vit
--    dans `convocations` (+ ses instance_overrides pour les récurrents). Une FK
--    `references trainings(id)` aurait fait échouer la migration ENTIÈRE. La clé
--    retenue est donc celle qu'utilise déjà `training_plans` : le couple
--    (convocation_id, instance_date), dupliqué dans `training_key` = "id::date"
--    pour que le fil se retrouve d'une seule égalité côté client.
--
-- 2. Les exos alternatifs n'ajoutent RIEN ici, et c'est délibéré : il n'existe
--    pas non plus de table `training_plan_items`. Le plan d'entraînement est un
--    blob jsonb libre — `training_plans.plan = { exercises:[…] }`. L'alternative
--    vit donc DANS l'exercice (`ex.alt`), en passthrough jsonb, exactement comme
--    les modes de drill (cf. v.69/v.70). Zéro colonne = zéro risque de tuer la
--    synchro d'une table entière si le front part avant la migration (le mode de
--    panne payé en v.115).
--
-- RLS — À LIRE AVANT DE CROIRE LA TABLE PROTÉGÉE :
--    Ce projet lit et écrit TOUT avec la clé anon publique. Le rôle (coach /
--    joueuse) est une notion de la couche L1 (rôle + PIN, côté client) : il
--    n'atteint jamais Postgres, il n'y a pas de JWT porteur du rôle. Une policy
--    « coachs seulement » basée sur auth.jwt() rendrait donc la table illisible
--    pour l'application elle-même. On garde le patron maison (accès anon), et le
--    cloisonnement coach est appliqué CÔTÉ CLIENT — même contrat que
--    `matches.coach_note`, jamais exposé aux joueuses. Un vrai secret au niveau
--    du transport exigerait de migrer l'app vers l'auth L2 pour tout le monde.
-- ============================================================================

create table if not exists public.training_coach_notes (
  id              text primary key,
  training_key    text not null,                 -- "convocationId::instanceDate"
  convocation_id  text not null references public.convocations(id) on delete cascade,
  instance_date   date not null,
  season_id       text,
  coach_id        text,
  coach_name      text,
  text_md         text not null default '',
  photo_data_url  text,                          -- dataURL base64 (cf. pintade / photo de profil)
  play_refs       jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  edited_at       timestamptz,                   -- non NULL ⇒ badge « modifié »
  deleted_at      timestamptz                    -- soft-delete : SEUL état terminal durable
);

create index if not exists training_coach_notes_key_idx
  on public.training_coach_notes (training_key, created_at desc) where deleted_at is null;
create index if not exists training_coach_notes_deleted_at_idx
  on public.training_coach_notes (deleted_at);

alter table public.training_coach_notes enable row level security;
drop policy if exists training_coach_notes_all on public.training_coach_notes;
create policy "training_coach_notes_all" on public.training_coach_notes for all using (true) with check (true);
