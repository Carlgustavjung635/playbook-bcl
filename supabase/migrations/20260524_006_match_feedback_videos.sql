-- ============================================================================
-- Phase 3 — Vidéos YouTube dans points positifs/négatifs match.
-- Ajoute une colonne `videos jsonb` à match_feedback. Chaque item :
--   { url: string, label?: string, startSec?: number }
-- Pas de bucket Storage (les vidéos vivent chez YouTube). Pas de policy RLS
-- additionnelle : la table porte déjà ses policies anon (cf. 20260518_001).
-- ============================================================================

alter table public.match_feedback
  add column if not exists videos jsonb not null default '[]'::jsonb;
