-- ============================================================================
-- Phase 4 — Plays liés à un match (préparation).
--
-- Le coach veut, dans l'onglet d'un match `to_play`, rattacher 3-6 plays de
-- la bibliothèque qu'il compte exécuter ou faire répéter sur ce match précis,
-- avec une note coach par lien (rappel tactique, consigne contre cet
-- adversaire). L'ordre compte (1er play = la priorité).
--
-- Choix : table de jointure N-N plutôt qu'un jsonb sur matches.
--   - Permet onDelete cascade propre des 2 côtés (suppression d'un play ou
--     d'un match nettoie automatiquement les liens).
--   - Évite de versionner un tableau entier sur chaque ré-ordonnancement
--     (chaque drag-to-reorder = un seul upsert par row au lieu d'un dump
--     complet du jsonb).
--   - Reste cohérent avec season_plays / season_players (même pattern PK
--     composite anon write-all).
--
-- coach_note : texte libre court (1-2 phrases). Pas markdown, white-space
-- preserved côté affichage.
--
-- position : entier, 0-indexé. Source de tri exclusif (pas de ORDER BY
-- created_at). Sur ajout, mettre à max(position) + 1 ou la position désirée.
-- Reorder = update position sur chaque row concernée.
-- ============================================================================

create table if not exists public.match_play_links (
  match_id   text not null references public.matches(id) on delete cascade,
  play_id    text not null references public.plays(id)   on delete cascade,
  position   int  not null default 0,
  coach_note text,
  created_at timestamptz not null default now(),
  primary key (match_id, play_id)
);

create index if not exists match_play_links_match_idx on public.match_play_links(match_id);

alter table public.match_play_links enable row level security;

drop policy if exists "match_play_links_anon_all" on public.match_play_links;
create policy "match_play_links_anon_all"
  on public.match_play_links
  for all
  to anon
  using (true)
  with check (true);

-- Realtime : le coach sur PC ajoute un play, le coach sur téléphone (ou la
-- vue match d'un autre onglet) doit voir le lien apparaître sans reload.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_play_links'
  ) then
    alter publication supabase_realtime add table public.match_play_links;
  end if;
end $$;
