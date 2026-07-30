-- ============================================================================
-- Migration : MOTS D'ANNIVERSAIRE (birthday_messages)
-- ----------------------------------------------------------------------------
-- Une joueuse écrit un mot pour l'anniversaire d'une coéquipière. Le mot est
-- ÉCRIT À L'AVANCE (la section « prochains anniversaires » de l'accueil montre
-- les anniversaires des 14 prochains jours) et n'est LU QUE LE JOUR J, par la
-- fêtée, dans une modale de célébration.
--
-- L'anniversaire n'est donc pas un événement stocké : il se dérive de
-- `players.date_naissance` (migration 20260709_003). Cette table ne stocke que
-- les mots. `birthday_year` = l'année civile de l'anniversaire visé, pour
-- distinguer les éditions successives (le mot de 2026 ne réapparaît pas en
-- 2027) sans avoir à créer une entité « édition d'anniversaire ».
--
-- PAS DE season_id : un anniversaire n'appartient pas à une saison, et une
-- date de naissance vit sur `players` (global), pas sur `season_players`.
--
-- ----------------------------------------------------------------------------
-- POURQUOI AUCUNE CONTRAINTE UNIQUE (birthday_player_id, author_player_id,
-- birthday_year) ALORS QUE LA RÈGLE MÉTIER EST « 1 MOT PAR AUTRICE »
-- ----------------------------------------------------------------------------
-- Le flush PbSync est un `upsert(rows, { onConflict: 'id' })` par entité. Une
-- violation d'unicité ferait échouer TOUT le lot de la table — et comme le
-- cache `_lastSeen` n'est pas mis à jour en cas d'erreur, le même lot serait
-- rejoué indéfiniment : une seule ligne en doublon suffirait à bloquer pour
-- toujours la synchro de tous les mots, sur tous les appareils.
--
-- La règle est donc tenue CÔTÉ FRONT, avec le pattern déjà éprouvé sur les
-- convocations en double (cf. dédoublonnage par signature) :
--   • à l'écriture, on RÉUTILISE la ligne existante du triplet (y compris une
--     ligne soft-deletée, qu'on ressuscite) au lieu d'en créer une seconde ;
--   • à la lecture, `birthdayMessagesFor()` ne garde qu'un mot par autrice,
--     la survivante étant déterministe (id le plus petit) — donc identique sur
--     tous les appareils.
--
-- Le pire cas dégradé est un doublon transitoire affiché une seule fois, pas
-- une synchro cassée.
--
-- ----------------------------------------------------------------------------
-- POSTURE RLS : anon « sandbox équipe », identique au reste du projet. La
-- demande prévoyait « INSERT/UPDATE réservé à l'autrice (author_player_id =
-- auth.uid()) » : ce n'est pas exprimable ici. L'app n'a pas d'auth par
-- joueuse (PIN L1 + rôle anon Supabase partagé) : `auth.uid()` est NULL pour
-- tout le monde, une telle policy bloquerait TOUS les writes, y compris ceux
-- de l'autrice. Le « seule l'autrice modifie / seul le coach modère » est
-- appliqué CÔTÉ FRONT, comme partout ailleurs dans ce projet.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère
-- ses ids via uid() (préfixe 'x'), heuristique anti-wipe des apply PbSync.
--
-- Idempotente.
-- ============================================================================

create table if not exists public.birthday_messages (
  id                 text primary key default gen_random_uuid()::text,
  -- La fêtée. CASCADE : si la joueuse quitte le club et est supprimée, ses
  -- mots d'anniversaire n'ont plus de destinataire.
  birthday_player_id text not null references public.players(id) on delete cascade,
  -- L'autrice. CASCADE aussi : un mot sans autrice ne serait plus attribuable.
  author_player_id   text not null references public.players(id) on delete cascade,
  -- Année civile de l'anniversaire visé (2026 = celui du 12/08/2026).
  birthday_year      integer not null,
  message            text not null check (char_length(message) <= 500),
  -- Horodatage de la lecture par la fêtée (bouton « Merci 💕 » de la modale de
  -- célébration). Sert à afficher « ✓ lue » à l'autrice. NULL = pas encore lue.
  read_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- Lecture principale : « tous les mots vivants pour (fêtée, année) ».
create index if not exists birthday_messages_active_idx
  on public.birthday_messages (birthday_player_id, birthday_year)
  where deleted_at is null;
-- Lecture secondaire : « mes mots à moi » (historique côté autrice).
create index if not exists birthday_messages_author_idx
  on public.birthday_messages (author_player_id, birthday_year)
  where deleted_at is null;
create index if not exists birthday_messages_deleted_at_idx
  on public.birthday_messages (deleted_at);

-- ----------------------------------------------------------------------------
-- RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.birthday_messages enable row level security;
drop policy if exists birthday_messages_all on public.birthday_messages;
create policy "birthday_messages_all" on public.birthday_messages
  for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- REALTIME : un mot posté depuis un autre appareil apparaît sans reload (et le
-- compteur « N mots déjà écrits » se met à jour en direct).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'birthday_messages') then
    alter publication supabase_realtime add table public.birthday_messages;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.birthday_messages;
-- ============================================================================
