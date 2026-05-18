-- ============================================================================
-- Sync effectif (players) multi-device.
--
-- Décision : autoriser anon ALL sur public.players, cohérent avec le pattern
-- live_events (le contrôle d'accès est fait côté front via PIN coach L1).
-- Mais on protège pin_hash : un trigger BEFORE INSERT/UPDATE empêche anon de
-- le modifier — la modif PIN passe uniquement par les RPC set_player_pin /
-- set_team_pin qui sont SECURITY DEFINER + check is_coach() (L2 requise).
--
-- Ajoute aussi public.players à la publication supabase_realtime pour le
-- broadcast multi-device.
-- ============================================================================

-- 1) Drop les policies write coach-only existantes
drop policy if exists "coach_write_players_ins" on public.players;
drop policy if exists "coach_write_players_upd" on public.players;
drop policy if exists "coach_write_players_del" on public.players;

-- 2) Nouvelle policy : anon (et authenticated) écriture libre
create policy "players_write_all" on public.players
  for all using (true) with check (true);

-- 3) Trigger : protéger pin_hash contre toute modif anon
create or replace function public.protect_player_pin_hash()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_is_coach boolean;
begin
  v_is_coach := coalesce(public.is_coach(), false);
  if tg_op = 'INSERT' then
    -- Anon INSERT : forcer pin_hash à un bcrypt('0000') (jamais accepter une
    -- valeur fournie par le client)
    if not v_is_coach then
      new.pin_hash := crypt('0000', gen_salt('bf'));
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Anon UPDATE : préserver l'ancien pin_hash
    if not v_is_coach then
      new.pin_hash := old.pin_hash;
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists players_protect_pin_hash on public.players;
create trigger players_protect_pin_hash
  before insert or update on public.players
  for each row execute function public.protect_player_pin_hash();

-- 4) Ajouter players à la publication Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;
