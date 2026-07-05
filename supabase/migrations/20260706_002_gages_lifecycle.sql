-- ============================================================================
-- Migration : CYCLE DE VIE DES GAGES + TYPES DE GAGES
-- ----------------------------------------------------------------------------
-- Feature 1 — cycle de vie d'un tirage réalisé (au-delà de accepted/skipped) :
--   accepted → player_done (la joueuse dit « fait ») → coach_confirmed (le coach
--   valide → gage retiré du pool) ; invalidated = échec neutre (gage secret grillé
--   / temps écoulé) sans dette supplémentaire.
--   NB : on N'ÉCRASE PAS `gage_draws.completed_at` existant (= horodatage de la
--   décision accept/skip, utilisé par le calcul de dette). On ajoute des colonnes
--   dédiées : player_done_at, confirmed_at (= coach_confirmed), invalidated_at.
--
-- Feature 2 — types de gages : standard | secret | sport | time_limited (+ durée).
-- Feature 1 (retrait du pool) — `gages.completed_at` : posé quand un tirage est
--   coach_confirmed → le gage sort du pool tirable (symétrique de deleted_at).
--   « Remettre au pool » = repasser completed_at à NULL.
--
-- Idempotente (add column if not exists + drop/recreate des CHECK).
-- ============================================================================

-- ---- gage_draws : nouveaux jalons de cycle de vie -------------------------
alter table public.gage_draws add column if not exists player_done_at      timestamptz;
alter table public.gage_draws add column if not exists confirmed_at        timestamptz;
alter table public.gage_draws add column if not exists invalidated_at      timestamptz;
alter table public.gage_draws add column if not exists invalidation_reason text;

do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.gage_draws'::regclass
               and conname = 'gage_draws_status_check') then
    alter table public.gage_draws drop constraint gage_draws_status_check;
  end if;
  alter table public.gage_draws
    add constraint gage_draws_status_check
    check (status in ('owed','accepted','skipped','adjust','player_done','coach_confirmed','invalidated'));
end $$;

-- ---- gages : types + retrait du pool sur réalisation ----------------------
alter table public.gages add column if not exists gage_type        text not null default 'standard';
alter table public.gages add column if not exists time_limit_hours integer;
alter table public.gages add column if not exists completed_at     timestamptz;

do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.gages'::regclass
               and conname = 'gages_gage_type_check') then
    alter table public.gages drop constraint gages_gage_type_check;
  end if;
  alter table public.gages
    add constraint gages_gage_type_check
    check (gage_type in ('standard','secret','sport','time_limited'));
end $$;

-- Rollback (manuel) :
--   alter table public.gage_draws drop column if exists player_done_at, drop column if exists confirmed_at,
--     drop column if exists invalidated_at, drop column if exists invalidation_reason;
--   alter table public.gages drop column if exists gage_type, drop column if exists time_limit_hours,
--     drop column if exists completed_at;
--   (et restaurer les CHECK d'origine)
