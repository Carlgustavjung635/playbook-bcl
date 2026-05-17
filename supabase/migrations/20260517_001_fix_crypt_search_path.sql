-- ============================================================================
-- Patch : pgcrypto vit dans le schéma `extensions` sur Supabase, pas dans
-- `public`. Les fonctions SECURITY DEFINER avec search_path = public ne
-- peuvent donc pas appeler crypt() / gen_salt() directement.
-- Correction : étendre search_path à public,extensions sur les 3 RPC.
-- ============================================================================

create or replace function public.verify_pin(p_role text, p_player_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if p_role = 'player' then
    select pin_hash into v_hash from public.players where id = p_player_id;
  else
    select pin_hash into v_hash from public.team_pins where role = p_role;
  end if;
  if v_hash is null then return false; end if;
  return v_hash = crypt(p_pin, v_hash);
end;
$$;

create or replace function public.set_team_pin(p_role text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_coach() then
    raise exception 'forbidden: requires coach role';
  end if;
  if p_role not in ('coach','stat') then
    raise exception 'invalid role';
  end if;
  update public.team_pins
    set pin_hash = crypt(p_new_pin, gen_salt('bf'))
    where role = p_role;
end;
$$;

create or replace function public.set_player_pin(p_player_id text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_self_player text;
begin
  if public.is_coach() then
    update public.players set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = p_player_id;
    return;
  end if;
  select player_id into v_self_player from public.profiles where user_id = auth.uid();
  if v_self_player is null or v_self_player <> p_player_id then
    raise exception 'forbidden';
  end if;
  update public.players set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = p_player_id;
end;
$$;
