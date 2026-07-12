-- ============================================================================
-- Migration : DÉFIS — tags + favoris
-- ----------------------------------------------------------------------------
-- tags         : étiquettes libres pour recherche/filtre (GIN pour perf).
-- favorited_by : liste des identités (player id / coach id) ayant mis en favori.
-- Additive + idempotente.
-- ============================================================================

alter table public.challenges add column if not exists tags text[] not null default '{}';
create index if not exists challenges_tags_idx on public.challenges using gin (tags);

alter table public.challenges add column if not exists favorited_by text[] not null default '{}';

-- ============================================================================
-- Rollback (manuel) :
--   drop index if exists challenges_tags_idx;
--   alter table public.challenges drop column if exists tags, drop column if exists favorited_by;
-- ============================================================================
