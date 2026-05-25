-- ============================================================================
-- Phase 5 — Joueuses guests sur entraînement.
--
-- Cas d'usage : sur UNE instance précise d'un entraînement (le mardi 27 mai
-- par exemple), une joueuse vient accompagnée d'une copine, ou le club
-- envoie une essayeuse pour voir si le niveau lui correspond. Aujourd'hui
-- le coach n'a aucun moyen de noter cette présence (effectif `state.players`
-- est fermé, et la check-list de présence ne liste QUE les joueuses
-- régulières scopées à la saison).
--
-- Choix structurant : 2 nouvelles tables plutôt qu'un champ jsonb sur
-- convocations.instanceOverrides[date].guestPlayers.
--   - Permet le suivi cross-instance : "Lina (copine de Carla)" qui revient
--     3 entraînements de suite = même `guest_player_id`. Indispensable pour
--     la suggestion "Guests récents 30j" et la "promotion en régulière".
--   - Cascade onDelete propre (suppression d'une convoc nettoie les liens,
--     suppression d'un guest_player aussi).
--   - Évite de polluer instanceOverrides qui est déjà dense en surcharges.
--
-- guest_players : 1 row par humain temporaire identifié par son nom.
--   `name` est texte libre — coach peut écrire "Lina (copine Carla)" ou
--   "Essayeuse #2 du 5/05". Pas d'unicité côté DB : 2 guests avec le même
--   nom sur des dates très éloignées sont 2 personnes différentes, c'est
--   le coach qui juge (et qui peut les fusionner manuellement plus tard
--   si l'UX le justifie).
--   `promoted_to_player_id` : null par défaut, set quand le coach clique
--   "Promouvoir en joueuse régulière" (qui crée aussi une row dans
--   players). Garde l'historique du parcours guest→régulière.
--   `last_seen_at` : update à chaque add dans training_guests pour
--   alimenter le filtre "Guests récents 30j" (suggérer en priorité).
--
-- training_guests : jointure N-N convocation↔guest, PK COMPOSITE incluant
--   instance_date. Pour les trainings one-shot, instance_date = c.date.
--   Pour les récurrents, instance_date = la date du jour précis (cohérent
--   avec le pattern convocation_responses.instance_date déjà en place,
--   cf. 20260518_001).
--
-- Pas de policies fines : coach-only côté UI, mais RLS anon all comme
-- toutes les autres entités équipe (cf. 20260518_001).
-- ============================================================================

create table if not exists public.guest_players (
  id text primary key,
  name text not null,
  note text,
  promoted_to_player_id text references public.players(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists guest_players_last_seen_idx on public.guest_players(last_seen_at desc);

alter table public.guest_players enable row level security;

drop policy if exists "guest_players_anon_all" on public.guest_players;
create policy "guest_players_anon_all"
  on public.guest_players
  for all
  to anon
  using (true)
  with check (true);

create table if not exists public.training_guests (
  convocation_id  text not null references public.convocations(id) on delete cascade,
  guest_player_id text not null references public.guest_players(id) on delete cascade,
  instance_date   date not null,
  created_at      timestamptz not null default now(),
  primary key (convocation_id, guest_player_id, instance_date)
);

create index if not exists training_guests_convoc_idx on public.training_guests(convocation_id, instance_date);

alter table public.training_guests enable row level security;

drop policy if exists "training_guests_anon_all" on public.training_guests;
create policy "training_guests_anon_all"
  on public.training_guests
  for all
  to anon
  using (true)
  with check (true);

-- Realtime : le coach ajoute une guest sur PC, l'appel mobile doit voir
-- la guest apparaître dans la check-list sans reload.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guest_players'
  ) then
    alter publication supabase_realtime add table public.guest_players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'training_guests'
  ) then
    alter publication supabase_realtime add table public.training_guests;
  end if;
end $$;
