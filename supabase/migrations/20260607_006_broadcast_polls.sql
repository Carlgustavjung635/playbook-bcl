-- ============================================================================
-- Migration : DIFFUSIONS COACH — SONDAGES (polls type WhatsApp)
-- ----------------------------------------------------------------------------
-- Itération chantier D. Un broadcast peut désormais être un SONDAGE : une
-- question (réutilise broadcasts.message) + N options (2 à 6) + mode de vote
-- (choix simple ou multiple). Chaque joueuse ciblée vote ; le coach voit les
-- résultats en temps réel (realtime déjà actif sur broadcast_receipts).
--
-- Réutilise l'infra existante (tables broadcasts + broadcast_receipts) — AUCUNE
-- nouvelle table. On ajoute des colonnes optionnelles, nullables, rétro-compat :
-- les broadcasts "message" existants ont poll_options = null (= pas un sondage).
--
--   broadcasts.poll_options jsonb  : array de strings (les options), ex.
--                                    ["Option A","Option B","Option C"].
--                                    null = ce n'est PAS un sondage (message).
--   broadcasts.poll_multi   bool   : true = choix multiples autorisés.
--   broadcast_receipts.poll_choice jsonb : array d'index choisis par la joueuse,
--                                    ex. [0,2] = options A et C. null = pas voté.
--
-- MVP — règle de vote : un vote final, pas de modification après validation
-- (la joueuse choisit puis clique "Voter" → status 'acknowledged' + poll_choice).
--
-- Idempotente : add column if not exists (rejouable sans effet de bord).
-- ============================================================================

alter table public.broadcasts
  add column if not exists poll_options jsonb default null,
  add column if not exists poll_multi   boolean default false;

alter table public.broadcast_receipts
  add column if not exists poll_choice jsonb default null;

-- ============================================================================
-- Rollback (manuel, si besoin) :
--   alter table public.broadcasts drop column if exists poll_options;
--   alter table public.broadcasts drop column if exists poll_multi;
--   alter table public.broadcast_receipts drop column if exists poll_choice;
-- ============================================================================
