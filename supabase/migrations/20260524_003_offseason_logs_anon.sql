-- ============================================================================
-- Offseason logs : passer en sync équipe (anon write + realtime), comme tout
-- le reste de l'app.
--
-- Avant : table public.offseason_logs créée dans 20260517_initial.sql avec
-- des policies L2 strict (ol_select / ol_ins / ol_upd / ol_del) qui exigent
-- profiles.user_id = auth.uid() AND profiles.player_id = offseason_logs.player_id.
-- Conséquence : aucune joueuse n'a jamais créé de compte (auth.users = 0,
-- profiles = 0), donc toute insertion serait bloquée par RLS. Côté JS, le
-- toggle des exercices ne fait que persist() localStorage → données perdues
-- à chaque purge Safari iOS (ITP 7 jours / mode privé / cache plein) et
-- jamais synchronisées cross-device.
--
-- Après : posture anon identique à player_wellness_log (cf 20260518_003
-- bloc §3) → pattern "sandbox équipe" déjà établi (accès contrôlé côté
-- front via PIN local, anon Supabase key sandbox). offseason_logs en prod
-- a 0 rows actuellement, donc aucune donnée à protéger lors du switch.
--
-- Côté JS (PR jointe) : nouvelle entité dans ENTITIES qui dump/apply via le
-- sync engine générique (PbSync), exactement comme playerWellness.
-- ============================================================================

-- 1. Drop l'ancien set de policies L2 strict (créées dans initial.sql L635+)
drop policy if exists ol_select on public.offseason_logs;
drop policy if exists ol_ins    on public.offseason_logs;
drop policy if exists ol_upd    on public.offseason_logs;
drop policy if exists ol_del    on public.offseason_logs;

-- 2. Politique unifiée "ALL anon" (cohérent avec player_wellness_log,
--    team_reviews, player_match_feedback)
create policy "offseason_logs_write_all"
  on public.offseason_logs for all using (true) with check (true);

-- 3. Ajout à supabase_realtime si pas déjà fait. (offseason_logs n'a jamais
--    été poussé via realtime côté client, mais autant l'aligner pour que
--    PbSync.subscribeAll fonctionne nativement.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'offseason_logs'
  ) then
    alter publication supabase_realtime add table public.offseason_logs;
  end if;
end $$;
