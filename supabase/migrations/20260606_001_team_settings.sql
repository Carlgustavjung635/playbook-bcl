-- ============================================================================
-- team_settings : identité / branding de l'équipe (singleton id=1).
--
-- POURQUOI une table dédiée — et PAS une colonne sur ffbb_config :
--   Le surnom de display ("Les Isloises", "La Team", …) sert UNIQUEMENT à
--   l'affichage dans la topbar de l'app. Il NE DOIT PAS être confondu avec
--   `ffbb_config.team_name` ("IE - BASKET CLUB L'ISLOIS - 2"), qui sert lui à
--   la détection auto V/D et au surlignage de la ligne dans le classement
--   scrapé FFBB. On les sépare physiquement pour éviter tout couplage entre
--   le branding et le sync FFBB (un surnom modifié ne touche plus du tout
--   l'upsert ffbb_config, donc aucun risque de casser matches/standings).
--
-- `display_nickname` nullable, SANS default : NULL/'' = pas de surnom, l'app
-- retombe sur « BCL · L'Islois » dans la topbar.
--
-- Sync : entité 'team' (index.html, ENTITIES) — auth anon, non realtime
-- (config rarement modifiée, comme ffbb_config). Propagé aux autres appareils
-- au prochain fetch (load). Policies anon ALL alignées sur ffbb_config.
--
-- NOTE : remplace la migration 20260606_001_ffbb_config_nickname.sql (V1, qui
-- ajoutait `nickname` à ffbb_config) — supprimée car le couplage était
-- incorrect. La V1 n'a JAMAIS été appliquée en prod, donc rien à nettoyer.
-- ============================================================================

create table if not exists public.team_settings (
  id               int primary key default 1 check (id = 1),
  display_nickname text,
  updated_at       timestamptz not null default now()
);

-- Réutilise le trigger générique set_updated_at() défini dans 20260517_initial.sql
create trigger team_settings_set_updated_at before update on public.team_settings
  for each row execute function public.set_updated_at();

-- Ligne singleton (surnom vide par défaut → fallback « BCL · L'Islois »)
insert into public.team_settings (id) values (1)
on conflict (id) do nothing;

alter table public.team_settings enable row level security;

-- Lecture publique (topbar visible côté joueuses/stat aussi)
create policy "read_public_team_settings"
  on public.team_settings for select using (true);

-- Écriture anon (même modèle que les entités équipe : cf. 20260518_001)
create policy "team_settings_write_all"
  on public.team_settings for all using (true) with check (true);
