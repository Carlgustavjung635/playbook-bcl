-- =============================================================================
-- 20260812_001 — Les heures de repos de la pintade. (v.120)
-- =============================================================================
--
-- POURQUOI
-- --------
-- Le jeu tourne 24 h sur 24 et rien n'empêchait de réclamer une preuve à 3 h du
-- matin. La v.107 avait déjà corrigé la version la plus brutale du problème (les
-- 30 secondes de la photo ne s'écoulent plus pendant qu'elle dort), mais rien
-- n'interdisait la DEMANDE elle-même : réveiller quelqu'un reste réveiller
-- quelqu'un, et c'est la première chose qui fait couper ses notifications.
--
-- Une plage de repos, éditable par le coach, pendant laquelle personne ne peut
-- initier de demande. Par défaut 23 h → 7 h.
--
-- DEUX ENTIERS, PAS DEUX HORODATAGES
-- ----------------------------------
-- La règle est « toutes les nuits entre 23 h et 7 h », pas « du 12 août 23 h au
-- 13 août 7 h ». Deux heures pleines expriment exactement ça, se comparent sans
-- arithmétique de dates, et se règlent avec deux listes déroulantes.
--
-- Le passage de minuit est le cas NORMAL (23 > 7), pas l'exception : c'est au
-- code de le traiter, la base n'a pas à s'en mêler. Une plage « à l'endroit »
-- (ex. 13 → 15, une sieste d'après-midi) reste possible.
--
-- start = end signifie AUCUN REPOS. C'est la conséquence naturelle de la
-- comparaison (aucune heure ne peut être à la fois >= et < la même valeur), et
-- ça donne au coach un moyen évident de couper la mécanique sans colonne
-- supplémentaire.
--
-- FUSEAU : les heures s'entendent en Europe/Paris, appliqué CÔTÉ CLIENT. Stocker
-- un fuseau par équipe serait une complication sans usage — les joueuses sont
-- toutes en France, et une plage de repos n'a de sens que dans l'heure locale de
-- celle qui dort.
--
-- Idempotente, additive, sans perte. Rejouable.
-- =============================================================================

alter table public.pintade_rules
  add column if not exists rest_start_hour int not null default 23,
  add column if not exists rest_end_hour   int not null default 7;

-- Les bornes en contraintes NOMMÉES (donc rejouables), et pas seulement dans le
-- `check` inline d'un add column : sans nom, un rejeu empilerait des doublons.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pintade_rules_rest_start_chk') then
    alter table public.pintade_rules
      add constraint pintade_rules_rest_start_chk check (rest_start_hour between 0 and 23);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pintade_rules_rest_end_chk') then
    alter table public.pintade_rules
      add constraint pintade_rules_rest_end_chk check (rest_end_hour between 0 and 23);
  end if;
end $$;

comment on column public.pintade_rules.rest_start_hour is
  'Heure (0-23, Europe/Paris) à laquelle commence le repos : plus aucune demande '
  'de preuve ne peut être initiée. Par défaut 23.';
comment on column public.pintade_rules.rest_end_hour is
  'Heure (0-23, Europe/Paris) à laquelle le repos se termine. Par défaut 7. '
  'Le passage de minuit (start > end) est le cas normal. start = end désactive '
  'la mécanique — aucune heure ne peut être à la fois >= et < la même valeur.';

-- -----------------------------------------------------------------------------
-- Retour arrière (si jamais) :
--   alter table public.pintade_rules
--     drop constraint if exists pintade_rules_rest_start_chk,
--     drop constraint if exists pintade_rules_rest_end_chk;
--   alter table public.pintade_rules
--     drop column if exists rest_start_hour,
--     drop column if exists rest_end_hour;
-- -----------------------------------------------------------------------------
