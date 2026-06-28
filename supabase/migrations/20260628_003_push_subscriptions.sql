-- ============================================================================
-- Migration : ABONNEMENTS PUSH WEB (push_subscriptions) — Phase 2 notifs
-- ----------------------------------------------------------------------------
-- 1 row par abonnement Web Push (= 1 navigateur/device opt-in). Écrite EN DIRECT
-- par le client (sb.from(...).upsert/delete sur l'endpoint) — PAS via PbSync :
-- le moteur générique supprime les lignes absentes du dump → il effacerait les
-- abonnements des AUTRES devices. La table reste donc hors ENTITIES.
-- L'Edge Function `push-send` lit ces rows (service role) pour envoyer les push.
--
-- owner_key = identité applicative "role:playerId" (ex. "player:pl3", "coach:-")
-- → cible des envois. endpoint = URL push unique (clé d'upsert).
-- RLS anon "sandbox équipe" (cohérent avec le reste ; pas de donnée sensible).
-- Idempotente.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id           text primary key,            -- uid applicatif
  owner_key    text not null,               -- "role:playerId"
  endpoint     text not null unique,         -- URL push (clé naturelle d'upsert)
  p256dh_key   text not null,
  auth_key     text not null,
  ua           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_owner_idx on public.push_subscriptions (owner_key);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy "push_subscriptions_all"
  on public.push_subscriptions for all using (true) with check (true);

-- Pas de Realtime (lecture serveur uniquement par l'Edge Function).
-- Rollback (manuel) : drop table if exists public.push_subscriptions cascade;
