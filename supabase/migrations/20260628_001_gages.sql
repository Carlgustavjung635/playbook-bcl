-- ============================================================================
-- Migration : BOÎTE À GAGES (gages)
-- ----------------------------------------------------------------------------
-- Joueuses + coach proposent des idées de gages → le coach modère (approuve /
-- rejette) → le coach assigne un gage approuvé à une joueuse → à sa prochaine
-- ouverture, écran bloquant "tirage au sort" → reveal → accepte / passe.
-- Le "skip" n'est autorisé que si la joueuse a >= 2 gages acceptés (crédit
-- recomputé-on-read côté front, saison courante).
--
-- 1 seule table. Statuts : pending → approved → assigned → accepted | skipped,
-- + rejected (depuis pending). season_id = cloisonnement (saison de assigned_at).
--
-- ANONYMAT : author_id est conservé en base (intégrité sync + audit) mais n'est
-- JAMAIS affiché dans l'app (invariant UI ; un device joueuse ne s'en sert que
-- pour reconnaître SES propres propositions, via son propre id). Le stack étant
-- en rôle anon partagé, une vraie occultation serveur exigerait une auth par
-- utilisateur (hors périmètre) — cf. note dans la PR.
--
-- Posture RLS : "sandbox équipe" anon, cohérent avec broadcasts / convocations /
-- team_reviews (contrôle d'accès réel = PIN L1 côté front).
-- Idempotente (if not exists / drop policy if exists).
-- ============================================================================

create table if not exists public.gages (
  id              text primary key,
  text            text not null,
  author_id       text,                        -- jamais exposé dans l'UI (cf. en-tête)
  status          text not null default 'pending'
                  check (status in ('pending','approved','assigned','accepted','skipped','rejected')),
  assigned_to     text,                         -- player_id (null tant que non assigné)
  assigned_at     timestamptz,
  revealed_at     timestamptz,
  completed_at    timestamptz,
  rejected_reason text,
  season_id       text references public.seasons(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists gages_status_idx      on public.gages (status);
create index if not exists gages_assigned_to_idx  on public.gages (assigned_to);

-- ----------------------------------------------------------------------------
-- RLS (posture anon "sandbox équipe", comme le reste de l'app)
-- ----------------------------------------------------------------------------
alter table public.gages enable row level security;
drop policy if exists gages_all on public.gages;
create policy "gages_all"
  on public.gages for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Realtime (modération coach + tirage joueuse en direct)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gages'
  ) then
    alter publication supabase_realtime add table public.gages;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) : drop table if exists public.gages cascade;
-- ============================================================================
