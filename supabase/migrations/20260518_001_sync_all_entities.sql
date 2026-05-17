-- ============================================================================
-- Sync globale : ouvrir l'écriture anon sur toutes les entités équipe.
--
-- Pattern : drop des policies coach_write_* (L2 only), créer une seule policy
-- "<entity>_write_all" pour tout (anon + authenticated). Le contrôle d'accès
-- est fait côté front via PIN coach L1.
--
-- Entités touchées (12) :
--   plays, custom_concepts, match_feedback, challenges, convocations,
--   lineups, ffbb_config, offseason_program, matches, match_player_stats,
--   challenge_scores, convocation_responses
--
-- Restent L2-only (data perso ou sensible) :
--   profiles, team_reviews, offseason_logs, team_pins
--
-- Realtime ajouté pour les entités multi-device collaboratives :
--   plays, custom_concepts, challenges, challenge_scores, convocations,
--   convocation_responses, lineups, match_feedback, ffbb_config,
--   offseason_program
-- (matches / match_player_stats / live_events / players déjà dedans)
-- ============================================================================

-- 1) Helper : drop toutes les anciennes policies pour repartir propre
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public' and (
      policyname like 'coach_write_%'
      or policyname in (
        'matches_coach_ins','matches_coach_upd_full','matches_coach_del',
        'matches_anon_live_update',
        'mps_coach_all','mps_anon_live_ins','mps_anon_live_upd',
        'le_coach_all','le_anon_ins',
        'cs_coach_all','cs_self_upd',
        'cr_coach_all','cr_self_ins','cr_self_upd'
      )
    )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) Nouvelle policy unique anon ALL pour les 12 entités équipe
do $$
declare
  t text;
  tbls text[] := array[
    'plays', 'custom_concepts', 'match_feedback', 'challenges',
    'convocations', 'lineups', 'ffbb_config', 'offseason_program',
    'matches', 'match_player_stats', 'challenge_scores',
    'convocation_responses', 'live_events'
  ];
begin
  foreach t in array tbls loop
    execute format(
      'create policy "%s_write_all" on public.%I for all using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- 3) Trigger : protect_live_event_match — déjà couvert par
--    enforce_live_event_open_match (initial.sql) qui empêche INSERT si le
--    match n'est pas en public_live. On laisse, c'est une garde côté DB.

-- 4) Ajouter les tables manquantes à supabase_realtime
do $$
declare
  t text;
  tbls text[] := array[
    'plays', 'custom_concepts', 'challenges', 'challenge_scores',
    'convocations', 'convocation_responses', 'lineups', 'match_feedback',
    'ffbb_config', 'offseason_program'
  ];
begin
  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- NOTE sécurité :
-- - team_reviews, offseason_logs : restent L2 strict (data perso joueuse)
-- - profiles : reste self-only L2
-- - team_pins : pas de policy SELECT donc inaccessible direct (RPC only)
-- - players.pin_hash : protégé par trigger players_protect_pin_hash
--   (déjà appliqué par 002)
-- Le compromis assumé : les autres tables sont en sandbox équipe, l'accès
-- est gardé par le PIN coach côté front (cohérent avec live_events).
-- ============================================================================
