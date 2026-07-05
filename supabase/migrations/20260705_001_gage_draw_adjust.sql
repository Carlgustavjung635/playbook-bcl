-- ============================================================================
-- Migration : AJUSTEMENT MANUEL DE DETTE DE TIRAGE (gage_draws.delta + status)
-- ----------------------------------------------------------------------------
-- La dette de tirage est recomputée-on-read (cf. gageDebt côté front) à partir
-- des tirages skippés depuis le dernier batch propre. Le coach a besoin d'un
-- outil de CORRECTION D'ERREUR : +1 / −1 dette, ou remise à zéro.
--
-- Plutôt qu'un scalaire stocké (qui casserait le modèle recompute-on-read), on
-- matérialise chaque correction comme une ligne gage_draws de statut 'adjust'
-- portant un `delta` entier (+1, −1, ou −dette courante pour un reset). Ces
-- lignes sont INERTES partout sauf dans gageDebt : elles n'ont ni gage_id, ni
-- assigned_at, ne sont jamais 'owed' (donc pas de tirage à faire), ni dans
-- l'historique (qui ne liste que accepted/skipped).
--
-- Idempotente. Ne touche pas aux lignes existantes (delta défaut 0).
-- ============================================================================

-- 1) Colonne delta (correction manuelle de dette ; 0 pour tous les tirages réels)
alter table public.gage_draws
  add column if not exists delta integer not null default 0;

-- 2) Élargir la contrainte de statut pour accepter 'adjust'
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gage_draws'::regclass
      and conname = 'gage_draws_status_check'
  ) then
    alter table public.gage_draws drop constraint gage_draws_status_check;
  end if;
  alter table public.gage_draws
    add constraint gage_draws_status_check
    check (status in ('owed','accepted','skipped','adjust'));
end $$;

-- Rollback (manuel) :
--   alter table public.gage_draws drop column if exists delta;
--   (et restaurer l'ancienne contrainte status sans 'adjust')
