-- ============================================================
-- Migration : mode journalier pour le programme intersaison
-- ============================================================
-- Le programme intersaison (offseason_program) ne connaissait qu'un mode
-- HEBDOMADAIRE : les mêmes exercices chaque semaine, suivi reseté chaque lundi.
-- On ajoute un mode JOURNALIER (telle date → tels exercices), mutuellement
-- exclusif avec le mode hebdo.
--
-- - `mode`           : 'weekly' (défaut, rétrocompat) | 'daily'.
-- - `daily_schedule` : jsonb { 'YYYY-MM-DD': [ { exercise_id, label, sets,
--                      reps, duration_min, notes } ] } utilisé quand mode='daily'.
--
-- Rétrocompat : toutes les lignes existantes prennent mode='weekly' via le
-- DEFAULT + un UPDATE explicite des lignes où mode serait resté NULL. La
-- structure hebdo existante (`exercises` jsonb) reste la source en mode weekly.
-- Aucune donnée détruite : les deux colonnes coexistent, le front choisit la
-- structure à lire selon `mode`.
-- ============================================================

alter table public.offseason_program
  add column if not exists mode text not null default 'weekly'
    check (mode in ('weekly', 'daily'));

alter table public.offseason_program
  add column if not exists daily_schedule jsonb not null default '{}'::jsonb;

-- Backfill défensif : toute ligne sans mode explicite → 'weekly'.
update public.offseason_program set mode = 'weekly' where mode is null;

-- RLS / realtime : inchangés. offseason_program a déjà sa policy anon (cf
-- migration 20260518_001_sync_all_entities) et est déjà dans la publication
-- supabase_realtime. Les nouvelles colonnes héritent de la table.

-- ============================================================
-- Rollback safe : alter table public.offseason_program
--   drop column if exists daily_schedule, drop column if exists mode;
-- (les colonnes sont additives, aucune contrainte sur le reste de la table).
-- ============================================================
