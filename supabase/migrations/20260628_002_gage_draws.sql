-- ============================================================================
-- Migration : TIRAGES DE GAGES (gage_draws)
-- ----------------------------------------------------------------------------
-- Correction de modèle : le coach n'assigne PAS un gage précis à une joueuse.
-- Il lui assigne le DEVOIR de tirer au sort un gage dans le pool approuvé.
-- C'est la JOUEUSE qui découvre, au tirage (ouverture de l'app), quel gage du
-- pool elle a pioché (aléatoire, hors gages déjà tirés par elle).
--
-- `gages` (table existante) devient le POOL/propositions : statut pending →
-- approved | rejected. Les anciens champs assigned_to/assigned_at/etc. ne sont
-- plus utilisés par la nouvelle logique (laissés en place, inertes).
--
-- `gage_draws` = 1 row par TIRAGE dû/effectué :
--   - créé 'owed' par le coach (gage_id null) → quota de tirages à faire ;
--   - à l'ouverture, la joueuse pioche un gage → gage_id + drawn_at ;
--   - puis accepted | skipped (mécanique de DETTE : skip = +1 tirage).
-- assigned_at = clé de batch (tirages assignés ensemble) pour le reset de dette.
-- L'historique (player_id, gage_id, status) sert aussi à l'anti-répétition.
--
-- Posture RLS anon "sandbox équipe" (comme gages / broadcasts). Idempotente.
-- ============================================================================

create table if not exists public.gage_draws (
  id           text primary key,
  player_id    text not null,
  gage_id      text references public.gages(id) on delete set null,
  status       text not null default 'owed' check (status in ('owed','accepted','skipped')),
  assigned_at  timestamptz,
  drawn_at     timestamptz,
  completed_at timestamptz,
  season_id    text references public.seasons(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists gage_draws_player_idx on public.gage_draws (player_id);
create index if not exists gage_draws_status_idx on public.gage_draws (status);

alter table public.gage_draws enable row level security;
drop policy if exists gage_draws_all on public.gage_draws;
create policy "gage_draws_all"
  on public.gage_draws for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gage_draws'
  ) then
    alter publication supabase_realtime add table public.gage_draws;
  end if;
end $$;

-- Rollback (manuel) : drop table if exists public.gage_draws cascade;
