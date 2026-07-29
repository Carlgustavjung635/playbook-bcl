-- ============================================================================
-- Migration : SUIVI ADMINISTRATIF DES LICENCES (player_licences)
-- ----------------------------------------------------------------------------
-- Où en est chaque joueuse de sa licence FFBB : pas commencée / en cours /
-- certificat médical manquant / validée, + notes libres du coach.
--
-- POURQUOI UNE TABLE À PART ET PAS DES COLONNES SUR `players` :
-- une licence est un objet PAR SAISON, `players` ne l'est pas. Le roster est
-- GLOBAL (une joueuse existe une fois) et son appartenance à une saison vit
-- déjà dans `season_players`. Mettre licence_status sur `players` :
--   • écraserait le statut au changement de saison (l'historique 2025-2026
--     serait perdu à la première mise à jour 2026-2027) ;
--   • afficherait silencieusement le statut de la saison PRÉCÉDENTE tant que
--     personne n'a re-saisi — exactement le mode de panne « cumul cross-saison »
--     déjà corrigé quatre fois dans ce projet (défis auto, diffusions, présence,
--     gages). On ne le réintroduit pas.
-- Une ligne par (joueuse, saison) : l'historique est conservé gratuitement et
-- le scoping est explicite dans la clé.
--
-- POSTURE RLS : anon « sandbox équipe » (using(true)/with check(true)), IDENTIQUE
-- à gages/coaches/drills/training_*. L'app n'a PAS d'auth utilisateur final
-- (PIN L1 + rôle anon Supabase) : une policy « coach peut UPDATE / joueuse peut
-- SELECT sa ligne » n'est pas exprimable ici — il n'y a pas d'auth.uid() côté
-- joueuse. Le contrôle coach-only est appliqué CÔTÉ FRONT, comme partout
-- ailleurs. Ne pas « durcir » cette policy sans introduire d'abord une vraie
-- auth par joueuse : ça casserait tous les writes.
--
-- PK `text` + gen_random_uuid()::text (JAMAIS uuid natif) : le front génère ses
-- ids via uid() (format 'x…'), et ce préfixe est l'heuristique anti-wipe de tous
-- les apply() de PbSync (pendingLocal = id.startsWith('x')).
--
-- Idempotente (if not exists / drop policy if exists / garde pg_publication).
-- ============================================================================

create table if not exists public.player_licences (
  id          text primary key default gen_random_uuid()::text,
  player_id   text not null references public.players(id) on delete cascade,
  -- Saison au format applicatif ('2026-2027'), cf. public.seasons.id.
  season_id   text not null,
  status      text not null default 'not_started'
              check (status in ('not_started', 'in_progress', 'certif_missing', 'validated')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists player_licences_season_idx on public.player_licences (season_id, status);
create index if not exists player_licences_deleted_at_idx on public.player_licences (deleted_at);

-- Une seule licence vivante par (joueuse, saison). Partiel sur les lignes
-- vivantes : une ligne soft-deleted ne doit pas bloquer une re-création.
create unique index if not exists player_licences_unique_idx
  on public.player_licences (player_id, season_id)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- RLS (cf. posture en tête de fichier)
-- ----------------------------------------------------------------------------
alter table public.player_licences enable row level security;
drop policy if exists player_licences_all on public.player_licences;
create policy "player_licences_all" on public.player_licences for all using (true) with check (true);

-- ----------------------------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'player_licences') then
    alter publication supabase_realtime add table public.player_licences;
  end if;
end $$;

-- ============================================================================
-- Rollback (manuel) :
--   drop table if exists public.player_licences;
-- ============================================================================
