-- ============================================================================
-- FFBB Dashboard v2 — réglages persistés (itération 2).
--
-- Ajoute 3 colonnes à team_settings (singleton id=1) pour les nouveaux réglages
-- du Dashboard FFBB officiel (api.ffbb.app) :
--   - ffbb_club_code            : code organisme FFBB du club (ex. OCC0032016).
--                                 Configurable depuis l'UI (⚙ FFBB) au lieu d'être
--                                 codé en dur dans index.html. NULL = défaut app.
--   - ffbb_club_search          : terme de recherche engagements Meilisearch
--                                 (ex. "ISLOIS"). NULL = dérivé / défaut.
--   - ffbb_favorite_competitions: JSONB array d'ids de compétitions marquées
--                                 favorites (tri en tête + section ★). Défaut [].
--   - ffbb_auto_update_convocs  : bool, MAJ auto des convocs importées (salle /
--                                 heure / date) à chaque sync FFBB. Défaut true.
--
-- IDEMPOTENT : `add column if not exists` → ré-exécutable sans risque, et le
-- front a un fallback (apply() retombe sur défauts si colonnes absentes), donc
-- l'app tourne MÊME avant application de cette migration (les réglages vivent
-- alors uniquement en localStorage, par appareil).
--
-- Même table / mêmes policies que 20260606_001_team_settings.sql (anon ALL,
-- lecture publique). Aucune nouvelle policy nécessaire.
-- ============================================================================

alter table public.team_settings
  add column if not exists ffbb_club_code text;
alter table public.team_settings
  add column if not exists ffbb_club_search text;
alter table public.team_settings
  add column if not exists ffbb_favorite_competitions jsonb not null default '[]'::jsonb;
alter table public.team_settings
  add column if not exists ffbb_auto_update_convocs boolean not null default true;
