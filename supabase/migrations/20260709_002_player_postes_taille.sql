-- ============================================================================
-- Migration : POSTES + TAILLE joueuse
-- ----------------------------------------------------------------------------
-- players.postes    : postes de basket joués (multi-valué). Valeurs 1..5 =
--                     meneur / arrière / ailier / ailier fort / pivot.
--                     Défaut '{}' (rétrocompat : joueuses existantes = vide ;
--                     le front exige ≥1 poste à la saisie, pas au niveau DB).
-- players.taille_cm : taille en cm (entier, nullable). Check LENIENT (100..260)
--                     pour bloquer les valeurs absurdes sans contraindre la
--                     plage UI (140..220 côté front).
--
-- IDEMPOTENTE (add column if not exists). SAFE data existante (colonnes
-- additives : default '{}' / nullable).
-- ============================================================================

alter table public.players add column if not exists postes int[] not null default '{}';
alter table public.players add column if not exists taille_cm int;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'players' and constraint_name = 'players_taille_cm_range'
  ) then
    alter table public.players
      add constraint players_taille_cm_range
      check (taille_cm is null or (taille_cm between 100 and 260));
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.players drop constraint if exists players_taille_cm_range;
--   alter table public.players drop column if exists postes;
--   alter table public.players drop column if exists taille_cm;
-- ============================================================================
