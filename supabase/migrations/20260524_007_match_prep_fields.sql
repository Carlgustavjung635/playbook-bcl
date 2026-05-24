-- ============================================================================
-- Phase 4 — Préparation match.
--
-- Un match est aujourd'hui créé à l'avance dans state.matches avec
-- scoreUs=0/scoreOpp=0, et "à venir vs joué" est inféré à la volée
-- (`played = scoreUs > 0 || scoreOpp > 0`). C'est fragile dès qu'on veut :
--   - distinguer un match "annulé" d'un "pas encore joué"
--   - stocker du contenu de prépa (vidéos adverses, notes coach, plays liés)
--     SANS qu'il pollue la vue "post-match" (points±, stats, selfie victoire)
--
-- Pattern : on enrichit `matches` plutôt que créer une table parallèle
-- `match_preparations`. Évite un join sur 99% des reads et garde la sémantique
-- "le match = un objet unique" (la prépa ET le compte-rendu sont 2 faces d'un
-- même objet temporel).
--
-- 5 colonnes ajoutées :
--   status        — explicite ('to_play' | 'played' | 'cancelled'). Plus de
--                   calcul depuis les scores. Bascule 'played' soit auto
--                   (1ère saisie de score), soit manuelle (bandeau UI).
--   prep_videos   — jsonb [{url, label?, startSec?}]. Même format que
--                   match_feedback.videos (Phase 3) pour réutiliser parseVideo
--                   / viewFocusVideo. Coach-only en lecture (joueuse ne voit
--                   pas les extraits adversaire).
--   prep_comment  — texte libre du coach (consignes, focus tactique). Pas
--                   markdown — assumé brut, affiché en white-space:pre-wrap.
--   location      — lieu du match. Mappé côté JS sur `m.place` (existait déjà
--                   en localStorage seul depuis longtemps, jamais sérialisé).
--   time          — heure du match. Idem `m.time`, vivait en local seul.
--
-- Backfill : tous les matches avec score > 0 passent à 'played'. Les autres
-- restent 'to_play' (le default). Aucune ligne ne devient 'cancelled' — c'est
-- une transition qui devra être explicite côté UI.
--
-- Pas de policies à ajouter : matches porte déjà ses anon write-all (cf.
-- 20260518_001_sync_all_entities). Déjà dans supabase_realtime.
-- ============================================================================

alter table public.matches
  add column if not exists status text not null default 'to_play';

-- Check séparé pour pouvoir être skippé si déjà présent (idempotence).
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='matches' and constraint_name='matches_status_check'
  ) then
    alter table public.matches
      add constraint matches_status_check check (status in ('to_play','played','cancelled'));
  end if;
end $$;

alter table public.matches
  add column if not exists prep_videos jsonb not null default '[]'::jsonb;

alter table public.matches
  add column if not exists prep_comment text;

alter table public.matches
  add column if not exists location text;

alter table public.matches
  add column if not exists "time" text;

-- Backfill : matches déjà joués (au moins un score saisi) → status='played'.
-- Idempotent : un re-run retombera sur les mêmes lignes.
update public.matches
   set status = 'played'
 where status = 'to_play'
   and (coalesce(score_us, 0) > 0 or coalesce(score_opp, 0) > 0);
