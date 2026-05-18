-- ============================================================================
-- playbook-bcl — schéma Supabase initial
-- À exécuter dans : https://app.supabase.com/project/orertxlsvkdqayybgwaq/sql/new
-- ============================================================================
-- Convention :
--   - IDs : text (compat avec IDs client existants "pl1", "m1", ...)
--   - JSON imbriqué : jsonb
--   - Timestamps : timestamptz, updated_at géré par trigger
--   - RLS : activée sur toutes les tables
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. Helper : trigger updated_at
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 2. Profils L2 (Supabase Auth)
-- ============================================================================
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'player' check (role in ('coach','stat','player')),
  player_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Helper : profile courant
create or replace function public.current_profile()
returns public.profiles
language sql stable security definer
set search_path = public
as $$
  select * from public.profiles where user_id = auth.uid();
$$;

-- Helper : true si user courant est coach L2
create or replace function public.is_coach()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'coach'
  );
$$;

-- ============================================================================
-- 3. PINs équipe (L1) — coach / stat
-- ============================================================================
create table if not exists public.team_pins (
  role       text primary key check (role in ('coach','stat')),
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

create trigger team_pins_set_updated_at before update on public.team_pins
  for each row execute function public.set_updated_at();

-- Seed : 1234 / 1234 (modifiable depuis l'app)
insert into public.team_pins (role, pin_hash) values
  ('coach', crypt('1234', gen_salt('bf'))),
  ('stat',  crypt('1234', gen_salt('bf')))
on conflict (role) do nothing;

-- ============================================================================
-- 4. Joueuses
-- ============================================================================
create table if not exists public.players (
  id         text primary key,
  name       text not null,
  num        int,
  photo      text,
  pin_hash   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();

-- Vue publique : sans pin_hash
create or replace view public.players_public as
  select id, name, num, photo, created_at, updated_at from public.players;

-- Seed joueuses (PIN par défaut 0000)
insert into public.players (id, name, num, pin_hash) values
  ('pl1',  'Emery A.',                    4,  crypt('0000', gen_salt('bf'))),
  ('pl2',  'Megemont-Lascaux C.',         5,  crypt('0000', gen_salt('bf'))),
  ('pl3',  'Le J.',                       6,  crypt('0000', gen_salt('bf'))),
  ('pl4',  'Amet N. / Garcia P.',         7,  crypt('0000', gen_salt('bf'))),
  ('pl5',  'Palladin C.',                 9,  crypt('0000', gen_salt('bf'))),
  ('pl6',  'Morant C.',                   10, crypt('0000', gen_salt('bf'))),
  ('pl7',  'Antras A. / Le D.',           11, crypt('0000', gen_salt('bf'))),
  ('pl8',  'Palladin L. (CAP)',           12, crypt('0000', gen_salt('bf'))),
  ('pl9',  'Garcia C.',                   13, crypt('0000', gen_salt('bf'))),
  ('pl10', 'Toury C. / Gauran M.',        14, crypt('0000', gen_salt('bf'))),
  ('pl11', 'Tranier M.',                  15, crypt('0000', gen_salt('bf')))
on conflict (id) do nothing;

-- ============================================================================
-- 5. RPC : vérification PIN (jamais d'accès direct au hash côté client)
-- ============================================================================
create or replace function public.verify_pin(p_role text, p_player_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
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

grant execute on function public.verify_pin(text, text, text) to anon, authenticated;

-- RPC pour modifier un PIN (L2 coach uniquement)
create or replace function public.set_team_pin(p_role text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public
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

grant execute on function public.set_team_pin(text, text) to authenticated;

create or replace function public.set_player_pin(p_player_id text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_player text;
begin
  if public.is_coach() then
    update public.players set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = p_player_id;
    return;
  end if;
  -- La joueuse peut modifier son propre PIN si liée
  select player_id into v_self_player from public.profiles where user_id = auth.uid();
  if v_self_player is null or v_self_player <> p_player_id then
    raise exception 'forbidden';
  end if;
  update public.players set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = p_player_id;
end;
$$;

grant execute on function public.set_player_pin(text, text) to authenticated;

-- ============================================================================
-- 6. Plays (playbook)
-- ============================================================================
create table if not exists public.plays (
  id         text primary key,
  cat        text not null,
  title      text not null,
  descr      text,
  tags       jsonb not null default '[]'::jsonb,
  video_url  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plays_set_updated_at before update on public.plays
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. Concepts custom
-- ============================================================================
create table if not exists public.custom_concepts (
  label      text primary key,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 8. Matchs
-- ============================================================================
create table if not exists public.matches (
  id                    text primary key,
  date                  date not null,
  opponent              text not null,
  home                  boolean not null default true,
  score_us              int not null default 0,
  score_opp             int not null default 0,
  quarters              jsonb not null default '{}'::jsonb,
  notes                 text,
  video_url             text,
  is_live               boolean not null default false,
  live_stream_url       text,
  public_live           boolean not null default false,
  public_live_started_at timestamptz,
  last_live_update      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

create index if not exists matches_date_idx on public.matches(date desc);
create index if not exists matches_public_live_idx on public.matches(public_live) where public_live = true;

-- ============================================================================
-- 9. Stats par match × joueuse
-- ============================================================================
create table if not exists public.match_player_stats (
  match_id   text not null references public.matches(id) on delete cascade,
  player_id  text not null references public.players(id) on delete cascade,
  stats      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create trigger mps_set_updated_at before update on public.match_player_stats
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 10. Feedback (positifs / négatifs) attaché aux matchs
-- ============================================================================
create table if not exists public.match_feedback (
  id         text primary key,
  match_id   text not null references public.matches(id) on delete cascade,
  kind       text not null check (kind in ('positive','negative')),
  text       text not null,
  minute     text,
  images     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mf_match_idx on public.match_feedback(match_id);

-- ============================================================================
-- 11. Live events (log temps réel)
-- ============================================================================
create table if not exists public.live_events (
  id         bigserial primary key,
  match_id   text not null references public.matches(id) on delete cascade,
  player_id  text references public.players(id) on delete set null,
  key        text not null,
  inc        int  not null default 1,
  value      numeric,
  label      text,
  created_at timestamptz not null default now()
);
create index if not exists le_match_idx on public.live_events(match_id, created_at desc);

-- Garde : n'autorise INSERT que si le match est en diffusion publique
create or replace function public.enforce_live_event_open_match()
returns trigger
language plpgsql
as $$
declare
  v_open boolean;
begin
  select public_live into v_open from public.matches where id = new.match_id;
  if not coalesce(v_open, false) then
    raise exception 'live_events: match % is not in public live broadcast', new.match_id;
  end if;
  return new;
end;
$$;

create trigger live_events_enforce_open before insert on public.live_events
  for each row execute function public.enforce_live_event_open_match();

-- ============================================================================
-- 12. Défis
-- ============================================================================
create table if not exists public.challenges (
  id              text primary key,
  title           text not null,
  descr           text,
  type            text not null,
  metric          text,
  end_date        date,
  scope           text not null default 'individual' check (scope in ('individual','season','team')),
  auto_count      boolean not null default false,
  lower_is_better boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger challenges_set_updated_at before update on public.challenges
  for each row execute function public.set_updated_at();

create table if not exists public.challenge_scores (
  challenge_id text not null references public.challenges(id) on delete cascade,
  player_id    text not null references public.players(id) on delete cascade,
  score        numeric not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (challenge_id, player_id)
);
create trigger cs_set_updated_at before update on public.challenge_scores
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 13. Convocations (planning)
-- ============================================================================
create table if not exists public.convocations (
  id                   text primary key,
  type                 text not null,
  title                text not null,
  date                 date not null,
  time                 text,
  location             text,
  note                 text,
  recurrence           jsonb,
  cancelled_instances  jsonb not null default '[]'::jsonb,
  instance_overrides   jsonb not null default '{}'::jsonb,
  attachments          jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger convocations_set_updated_at before update on public.convocations
  for each row execute function public.set_updated_at();

create index if not exists convocations_date_idx on public.convocations(date);

create table if not exists public.convocation_responses (
  convocation_id text not null references public.convocations(id) on delete cascade,
  player_id      text not null references public.players(id) on delete cascade,
  instance_date  date,
  status         text,
  reason         text,
  late_minutes   int,
  updated_at     timestamptz not null default now(),
  primary key (convocation_id, player_id, instance_date)
);
create trigger cr_set_updated_at before update on public.convocation_responses
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 14. Lineups
-- ============================================================================
create table if not exists public.lineups (
  id         text primary key,
  name       text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lineups_set_updated_at before update on public.lineups
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 15. FFBB config (singleton)
-- ============================================================================
create table if not exists public.ffbb_config (
  id         int primary key default 1 check (id = 1),
  club_url   text,
  team_name  text,
  matches    jsonb not null default '[]'::jsonb,
  standings  jsonb not null default '[]'::jsonb,
  last_sync  timestamptz,
  updated_at timestamptz not null default now()
);
create trigger ffbb_set_updated_at before update on public.ffbb_config
  for each row execute function public.set_updated_at();

insert into public.ffbb_config (id, club_url, team_name) values
  (1, 'https://competitions.ffbb.com/ligues/occ/comites/0065/clubs/occ0032016',
      'IE - BASKET CLUB L''ISLOIS - 2')
on conflict (id) do nothing;

-- ============================================================================
-- 16. Bien-être / retours équipe (personnel)
-- ============================================================================
create table if not exists public.team_reviews (
  id            text primary key,
  player_id     text not null references public.players(id) on delete cascade,
  date          date not null,
  ambiance      int,
  role_clarity  int,
  playtime      int,
  physique      int,
  comment       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger tr_set_updated_at before update on public.team_reviews
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 17. Programme intersaison + logs perso
-- ============================================================================
create table if not exists public.offseason_program (
  id          int primary key default 1 check (id = 1),
  start_date  date,
  end_date    date,
  title       text,
  exercises   jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
create trigger os_program_set_updated_at before update on public.offseason_program
  for each row execute function public.set_updated_at();

create table if not exists public.offseason_logs (
  player_id   text not null references public.players(id) on delete cascade,
  iso_week    text not null,
  exercise_id text not null,
  done        boolean not null default false,
  value       numeric,
  logged_at   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (player_id, iso_week, exercise_id)
);
create trigger os_logs_set_updated_at before update on public.offseason_logs
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS — activation
-- ============================================================================
alter table public.profiles               enable row level security;
alter table public.team_pins              enable row level security;
alter table public.players                enable row level security;
alter table public.plays                  enable row level security;
alter table public.custom_concepts        enable row level security;
alter table public.matches                enable row level security;
alter table public.match_player_stats     enable row level security;
alter table public.match_feedback         enable row level security;
alter table public.live_events            enable row level security;
alter table public.challenges             enable row level security;
alter table public.challenge_scores       enable row level security;
alter table public.convocations           enable row level security;
alter table public.convocation_responses  enable row level security;
alter table public.lineups                enable row level security;
alter table public.ffbb_config            enable row level security;
alter table public.team_reviews           enable row level security;
alter table public.offseason_program      enable row level security;
alter table public.offseason_logs         enable row level security;

-- ============================================================================
-- POLICIES — lecture publique pour le data partagé
-- ============================================================================
-- Tables 100 % publiques en lecture (anon + authenticated)
create policy "read_public_plays"
  on public.plays for select using (true);
create policy "read_public_custom_concepts"
  on public.custom_concepts for select using (true);
create policy "read_public_matches"
  on public.matches for select using (true);
create policy "read_public_mps"
  on public.match_player_stats for select using (true);
create policy "read_public_mf"
  on public.match_feedback for select using (true);
create policy "read_public_le"
  on public.live_events for select using (true);
create policy "read_public_challenges"
  on public.challenges for select using (true);
create policy "read_public_cs"
  on public.challenge_scores for select using (true);
create policy "read_public_convocations"
  on public.convocations for select using (true);
create policy "read_public_cr"
  on public.convocation_responses for select using (true);
create policy "read_public_lineups"
  on public.lineups for select using (true);
create policy "read_public_ffbb"
  on public.ffbb_config for select using (true);
create policy "read_public_os_program"
  on public.offseason_program for select using (true);

-- players : lecture publique (sans hash car colonne pas exposée via vue ; mais
--           pour simplifier le client on autorise SELECT direct — le hash est
--           non sensible vu qu'on stocke bcrypt, mais on évite quand même
--           l'exposition systématique en passant via la vue côté client)
create policy "read_public_players"
  on public.players for select using (true);

-- profiles : lecture uniquement par soi-même
create policy "profiles_self_select"
  on public.profiles for select using (auth.uid() = user_id);

create policy "profiles_self_insert"
  on public.profiles for insert with check (auth.uid() = user_id);

create policy "profiles_self_update"
  on public.profiles for update using (auth.uid() = user_id);

-- team_pins : aucun accès direct (RPC seulement)
-- (pas de policy de SELECT → personne ne peut lire)

-- ============================================================================
-- POLICIES — écritures coach (L2)
-- ============================================================================
-- Macro : autoriser INSERT/UPDATE/DELETE aux coachs authentifiés
do $$
declare
  t text;
  tbls text[] := array[
    'plays', 'custom_concepts', 'match_feedback', 'players',
    'challenges', 'convocations', 'lineups', 'ffbb_config',
    'offseason_program'
  ];
begin
  foreach t in array tbls loop
    execute format('create policy "coach_write_%s_ins" on public.%I for insert with check (public.is_coach())', t, t);
    execute format('create policy "coach_write_%s_upd" on public.%I for update using (public.is_coach()) with check (public.is_coach())', t, t);
    execute format('create policy "coach_write_%s_del" on public.%I for delete using (public.is_coach())', t, t);
  end loop;
end $$;

-- ============================================================================
-- POLICIES — matchs : coach (L2) écrit tout ; anon peut UPDATE score si public_live
-- ============================================================================
create policy "matches_coach_ins"
  on public.matches for insert with check (public.is_coach());
create policy "matches_coach_upd_full"
  on public.matches for update using (public.is_coach()) with check (public.is_coach());
create policy "matches_coach_del"
  on public.matches for delete using (public.is_coach());

-- UPDATE anon (live score) : autorisé seulement sur les matchs déjà ouverts au public
-- (vérifie public_live=true côté USING + on garde public_live=true côté WITH CHECK
-- pour éviter qu'un visiteur puisse fermer le live)
create policy "matches_anon_live_update"
  on public.matches for update
  using (public_live = true)
  with check (public_live = true);

-- ============================================================================
-- POLICIES — match_player_stats : coach (L2) + anon si match public_live
-- ============================================================================
create policy "mps_coach_all"
  on public.match_player_stats for all
  using (public.is_coach()) with check (public.is_coach());

create policy "mps_anon_live_ins"
  on public.match_player_stats for insert
  with check (exists (select 1 from public.matches m where m.id = match_id and m.public_live));

create policy "mps_anon_live_upd"
  on public.match_player_stats for update
  using (exists (select 1 from public.matches m where m.id = match_id and m.public_live))
  with check (exists (select 1 from public.matches m where m.id = match_id and m.public_live));

-- ============================================================================
-- POLICIES — live_events : coach (L2) + anon si match public_live
--   (le trigger enforce_live_event_open_match() double-check à l'insert)
-- ============================================================================
create policy "le_coach_all"
  on public.live_events for all
  using (public.is_coach()) with check (public.is_coach());

create policy "le_anon_ins"
  on public.live_events for insert
  with check (exists (select 1 from public.matches m where m.id = match_id and m.public_live));

-- ============================================================================
-- POLICIES — challenge_scores : coach OU joueuse propriétaire (L2)
-- ============================================================================
create policy "cs_coach_all"
  on public.challenge_scores for all
  using (public.is_coach()) with check (public.is_coach());

create policy "cs_self_upd"
  on public.challenge_scores for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = challenge_scores.player_id))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = challenge_scores.player_id));

-- ============================================================================
-- POLICIES — convocation_responses : coach + joueuse pour sa propre réponse
-- ============================================================================
create policy "cr_coach_all"
  on public.convocation_responses for all
  using (public.is_coach()) with check (public.is_coach());

create policy "cr_self_ins"
  on public.convocation_responses for insert
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = convocation_responses.player_id));

create policy "cr_self_upd"
  on public.convocation_responses for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = convocation_responses.player_id))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = convocation_responses.player_id));

-- ============================================================================
-- POLICIES — team_reviews : joueuse propriétaire + coach
-- ============================================================================
create policy "tr_self_select"
  on public.team_reviews for select
  using (
    public.is_coach()
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = team_reviews.player_id)
  );

create policy "tr_self_ins"
  on public.team_reviews for insert
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = team_reviews.player_id));

create policy "tr_self_upd"
  on public.team_reviews for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = team_reviews.player_id))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = team_reviews.player_id));

create policy "tr_self_del"
  on public.team_reviews for delete
  using (
    public.is_coach()
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = team_reviews.player_id)
  );

-- ============================================================================
-- POLICIES — offseason_logs : joueuse propriétaire L2
-- ============================================================================
create policy "ol_select"
  on public.offseason_logs for select
  using (
    public.is_coach()
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = offseason_logs.player_id)
  );

create policy "ol_ins"
  on public.offseason_logs for insert
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = offseason_logs.player_id));

create policy "ol_upd"
  on public.offseason_logs for update
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = offseason_logs.player_id))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = offseason_logs.player_id));

create policy "ol_del"
  on public.offseason_logs for delete
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.player_id = offseason_logs.player_id));

-- ============================================================================
-- REALTIME — publication
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'match_player_stats'
  ) then
    alter publication supabase_realtime add table public.match_player_stats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'live_events'
  ) then
    alter publication supabase_realtime add table public.live_events;
  end if;
end $$;

-- ============================================================================
-- FIN
-- ============================================================================
-- Vérifications recommandées après run :
--   select tablename from pg_tables where schemaname='public' order by tablename;
--   select tablename from pg_publication_tables where pubname='supabase_realtime';
--   select tablename, policyname from pg_policies where schemaname='public' order by tablename, policyname;
-- ============================================================================
