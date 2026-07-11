-- ============================================================================
-- Migration : DRILL RÉACTION — transitions avancées
-- ----------------------------------------------------------------------------
-- Ajoute au drill 3 modes de durée de cue + une horloge d'anticipation :
--   length_end_ms      : accélération LINÉAIRE (durée du cue interpole de
--                        length_ms → length_end_ms sur la session). NULL = off.
--   length_min_ms/max_ms : durée ALÉATOIRE tirée dans [min,max] à chaque cue.
--                        NULL = off. PRIME sur length_ms quand présent.
--   anticipation_clock : petit décompte visuel pendant la phase `delay` (>=1s).
--
-- Accélération XOR Randomize (contrainte DB). Idempotente.
-- ============================================================================

alter table public.drills add column if not exists length_end_ms int;
alter table public.drills add column if not exists length_min_ms int;
alter table public.drills add column if not exists length_max_ms int;
alter table public.drills add column if not exists anticipation_clock boolean not null default false;

-- Cohérence : on ne peut pas avoir accélération ET randomize en même temps.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drills_length_mode_check' and conrelid = 'public.drills'::regclass
  ) then
    alter table public.drills add constraint drills_length_mode_check
      check (not (length_end_ms is not null and length_min_ms is not null));
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.drills drop constraint if exists drills_length_mode_check;
--   alter table public.drills drop column if exists length_end_ms;
--   alter table public.drills drop column if exists length_min_ms;
--   alter table public.drills drop column if exists length_max_ms;
--   alter table public.drills drop column if exists anticipation_clock;
-- ============================================================================
