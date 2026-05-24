-- ============================================================================
-- Players : sync du feedback coach par joueuse (forces / axes de progression)
-- vers Supabase. Avant : p.feedback = { positives, negatives, updatedAt }
-- vivait uniquement en localStorage (pb8_players) côté coach → invisible
-- cross-device, perdu à chaque purge cache. Symptôme : coach prend ses notes
-- sur le téléphone à l'entraînement, ouvre la tablette le lendemain → vide.
--
-- Pattern : 1 colonne jsonb avec default non-null (cohérent avec
-- matches.transport / roster / on_court de 20260524_004), pour éviter les
-- checks `|| {}` partout côté apply.
--
-- Pas de nouvelles policies : public.players a déjà ses policies anon de
-- 20260517_002_players_anon_write. Pas non plus de changement realtime :
-- players est déjà subscribed via PbStore.subscribePlayers (canal dédié).
--
-- Migration legacy : pas nécessaire. Au prochain saveFeedback de chaque coach
-- actuel, son p.feedback local sera pushé via PbStore.upsertPlayer enrichi.
-- ============================================================================

alter table public.players
  add column if not exists feedback jsonb not null default '{}'::jsonb;
-- format: { positives: [string...], negatives: [string...], updatedAt: timestamp_ms }
-- {} = pas de feedback. getFeedback() défensif côté client renvoie
-- { positives: [], negatives: [] } pour les deux cas.
