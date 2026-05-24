-- ============================================================================
-- Matches : sync des "extras" coach (covoiturage, feuille de match, rotation
-- live). Avant : ces 3 champs vivaient uniquement dans m.transport / m.roster
-- / m.onCourt côté state JS et n'étaient JAMAIS sérialisés par le dump
-- ENTITIES.matches → localStorage par device uniquement → coach attribue
-- les covoiturages sur PC, ouvre le téléphone le jour J → tout vide.
--
-- Pattern : 3 colonnes jsonb dédiées avec defaults non-null pour éviter les
-- checks `|| {}` partout côté apply. Cohérent avec matches.quarters jsonb
-- NOT NULL DEFAULT '{}' déjà présent.
--
-- Pas de nouvelles policies : la table matches a déjà ses policies anon
-- write_all héritées de 20260518_001_sync_all_entities. Pas non plus de
-- changement realtime : matches est déjà dans supabase_realtime.
--
-- Migration legacy : pas nécessaire. Les champs locaux existants seront
-- pushés au prochain persist() de chaque coach via le dump enrichi.
-- ============================================================================

alter table public.matches
  add column if not exists transport jsonb not null default '{}'::jsonb;
-- format: { drivers: { pid: { seats: int } }, coachDriving: { seats: int } | null, direct: [pid...] }

alter table public.matches
  add column if not exists roster jsonb not null default '{}'::jsonb;
-- format: { included: [pid...] }  — joueuses sur la feuille de match.
-- {} = roster pas encore défini, auto-calculé depuis la convoc présentes.

alter table public.matches
  add column if not exists on_court jsonb not null default '[]'::jsonb;
-- format: [pid, pid, pid, pid, pid]  — les 5 sur le parquet à l'instant T.
-- Utilisé par le live tracker + écrans de rotation.
