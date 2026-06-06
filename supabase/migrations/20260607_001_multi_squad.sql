-- ============================================================================
-- Multi-effectif (E1 / E2 / both) — chantier #2.
--
-- POURQUOI : un même club gère parfois 2 équipes (ex. Séniors 1 + U18) avec un
-- noyau partagé. Plutôt que dupliquer toute l'app par équipe, on tague chaque
-- entité saison-scopée d'un `team_tag` et on scope les vues côté coach via une
-- pillule topbar [E1 | E2 | Toutes]. Côté joueuse, le scope est AUTOMATIQUE
-- selon son propre tag (une joueuse E2 ne voit que E2 ; une joueuse `both` voit
-- les deux). Off par défaut (multi_squad=false) → l'app reste strictement
-- identique à aujourd'hui (golden path mono-équipe = tout en 'e1').
--
-- OÙ vit le team_tag :
--   - season_players.team_tag : l'appartenance d'une joueuse à une équipe est
--     PAR SAISON (le lien N-N joueuse↔saison), pas globale. Une joueuse peut
--     être E1 cette saison et E2 la suivante. Valeurs : e1 | e2 | both.
--   - matches.team_tag : un match appartient à UNE équipe (pas de match commun).
--     Valeurs : e1 | e2.
--   - convocations.team_tag / challenges.team_tag : peuvent être communes aux
--     deux équipes (entraînement commun, défi collectif partagé). Valeurs :
--     e1 | e2 | both.
--   - team_settings : flags d'activation + libellés personnalisables des 2
--     équipes (e1_label "Séniors 1", e2_label "U18", …). NULL = libellé défaut.
--
-- RÉTROCOMPAT : default 'e1' + backfill → tout l'existant bascule en E1, et le
-- front met un fallback `|| 'e1'` partout pour tourner MÊME avant cette
-- migration (colonnes absentes → apply() retombe sur 'e1').
--
-- NE PAS confondre avec les saisons (20260524_002) : une saison = une période ;
-- une équipe = une cohorte au sein d'une saison. Les deux axes sont orthogonaux.
-- ============================================================================

alter table public.season_players add column if not exists team_tag text not null default 'e1'
  check (team_tag in ('e1','e2','both'));
alter table public.matches add column if not exists team_tag text not null default 'e1'
  check (team_tag in ('e1','e2'));
alter table public.convocations add column if not exists team_tag text not null default 'e1'
  check (team_tag in ('e1','e2','both'));
alter table public.challenges add column if not exists team_tag text not null default 'e1'
  check (team_tag in ('e1','e2','both'));

alter table public.team_settings add column if not exists multi_squad boolean not null default false;
alter table public.team_settings add column if not exists e1_label text;
alter table public.team_settings add column if not exists e2_label text;

-- Backfill explicite (les lignes existantes prennent le default 'e1', mais on
-- force au cas où des NULL auraient été insérés avant l'ajout du NOT NULL).
update public.season_players set team_tag = 'e1' where team_tag is null;
update public.matches        set team_tag = 'e1' where team_tag is null;
update public.convocations   set team_tag = 'e1' where team_tag is null;
update public.challenges     set team_tag = 'e1' where team_tag is null;
