-- ============================================================================
-- Players : dernière connexion joueuse (last_seen_at).
-- Objectif : côté coach, voir dans l'effectif quand chaque joueuse a ouvert
-- l'app pour la dernière fois ("vue il y a 2 jours"), avec un indicateur visuel
-- (vert < 24h, orange < 7j, rouge > 7j ou jamais).
--
-- Écriture : à chaque chargement de l'app par une joueuse (rôle 'player'),
-- via un UPDATE ciblé PbStore.touchLastSeen(playerId) — PAS via upsertPlayer
-- (qui omet la colonne → préservée lors des éditions coach, sémantique ON
-- CONFLICT DO UPDATE limitée aux colonnes envoyées).
--
-- Nullable, SANS default : une joueuse qui n'a jamais ouvert l'app depuis cette
-- feature reste à NULL = "jamais vue" (honnête, pas de faux "vue maintenant").
--
-- Pas de nouvelles policies : public.players a déjà ses policies anon de
-- 20260517_002_players_anon_write. Pas de changement realtime : players est
-- déjà subscribed via PbStore.subscribePlayers (canal dédié) → l'UPDATE
-- last_seen_at se propage aux autres devices (coach voit en quasi temps réel).
-- ============================================================================

alter table public.players
  add column if not exists last_seen_at timestamptz;
-- NULL = jamais vue. Sinon = timestamp de la dernière ouverture par la joueuse.
