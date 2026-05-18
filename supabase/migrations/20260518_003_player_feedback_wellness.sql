-- ============================================================================
-- v3 : Ressenti joueuse post-match + wellness journalier + sync team_reviews
--
-- Trois changements :
--   1. team_reviews : passer en mode "sync équipe" (anon all + realtime) pour
--      que le dashboard coach se MAJ live quand une joueuse soumet son
--      ressenti (avant : L2-only, jamais broadcast → coach devait reload).
--   2. player_match_feedback : nouvelle table — auto-évaluation joueuse pour
--      un match (rating 1-5 + positives + negatives + commentaire).
--      Avant : stocké uniquement dans m.playerReviews côté state JS, jamais
--      en base. Coach ne pouvait pas voir les ressentis multi-device.
--   3. player_wellness_log : nouvelle table — note physique + mentale + texte
--      libre, une entrée par (player, date). Coach lit, joueuse écrit self.
-- ============================================================================

-- ============================================================================
-- 1. team_reviews → anon write + realtime
-- ============================================================================
-- Drop l'ancien set de policies L2-only (créées dans initial.sql)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname='public' and tablename='team_reviews'
  loop
    execute format('drop policy if exists %I on public.team_reviews', r.policyname);
  end loop;
end $$;

-- Politique unifiée : ALL accessible anon (cohérent avec le reste — accès
-- contrôlé par PIN côté front, cf. 20260518_001)
create policy "team_reviews_write_all"
  on public.team_reviews for all using (true) with check (true);

-- Ajout à supabase_realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'team_reviews'
  ) then
    alter publication supabase_realtime add table public.team_reviews;
  end if;
end $$;

-- ============================================================================
-- 2. player_match_feedback : auto-évaluation joueuse post-match
-- ============================================================================
-- Modèle minimal pour sync. Le state JS conserve des champs additionnels
-- (positives[], negatives[]) qui restent locaux pour l'instant — on peut
-- toujours étendre via colonnes jsonb plus tard si besoin.
create table if not exists public.player_match_feedback (
  match_id    text not null references public.matches(id) on delete cascade,
  player_id   text not null references public.players(id) on delete cascade,
  rating      int  check (rating is null or (rating >= 1 and rating <= 5)),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (match_id, player_id)
);

create trigger pmf_set_updated_at before update on public.player_match_feedback
  for each row execute function public.set_updated_at();

create index if not exists pmf_player_idx
  on public.player_match_feedback(player_id, updated_at desc);

alter table public.player_match_feedback enable row level security;

create policy "player_match_feedback_write_all"
  on public.player_match_feedback for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'player_match_feedback'
  ) then
    alter publication supabase_realtime add table public.player_match_feedback;
  end if;
end $$;

-- ============================================================================
-- 3. player_wellness_log : ressenti quotidien (forme physique + mental)
-- ============================================================================
-- 1 row par (player_id, date). Utilisé par l'onglet "Forme" côté joueuse
-- (carte "Mon ressenti du jour") et le dashboard coach (vue détail joueuse).
create table if not exists public.player_wellness_log (
  player_id   text not null references public.players(id) on delete cascade,
  date        date not null,
  physical    int  check (physical is null or (physical >= 1 and physical <= 5)),
  mental      int  check (mental   is null or (mental   >= 1 and mental   <= 5)),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (player_id, date)
);

create trigger pwl_set_updated_at before update on public.player_wellness_log
  for each row execute function public.set_updated_at();

create index if not exists pwl_recent_idx
  on public.player_wellness_log(player_id, date desc);

alter table public.player_wellness_log enable row level security;

create policy "player_wellness_log_write_all"
  on public.player_wellness_log for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'player_wellness_log'
  ) then
    alter publication supabase_realtime add table public.player_wellness_log;
  end if;
end $$;

-- ============================================================================
-- NOTE sécurité : ces 3 tables suivent le pattern "sandbox équipe" déjà
-- établi (cf. 20260518_001) — toutes les entités équipe sont en write anon
-- pour permettre l'app sans compte L2. Le contrôle d'accès est géré côté
-- front via PIN coach/joueuse. C'est un compromis assumé pour la simplicité
-- multi-device sans contrainte auth.
-- ============================================================================
