-- ============================================================================
-- Migration : LA PINTADE — RÈGLES ÉDITABLES + AUTO-LIBÉRATION (v.108)
-- ----------------------------------------------------------------------------
-- Deux ajouts, tous deux sur `pintade_rules`. Pure ALTER, gardée, idempotente.
-- PRÉREQUIS : 20260807_001 puis _002 doivent être appliquées avant.
-- ============================================================================

do $$
begin
  if to_regclass('public.pintade_rules') is null then
    raise exception 'pintade_rules absente : applique d''abord 20260807_001 puis 20260807_002';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1) LE TEXTE DES RÈGLES, ÉDITABLE PAR LE COACH
-- ----------------------------------------------------------------------------
-- Markdown, rendu côté client par `mdToHtml` (le même moteur que les messages
-- du coach et les descriptions de plays — échappement AVANT rendu, donc pas de
-- HTML injectable même si le coach colle n'importe quoi).
--
-- ----------------------------------------------------------------------------
-- POURQUOI CETTE COLONNE EST NULLABLE ET SANS LONG DEFAULT SQL
-- ----------------------------------------------------------------------------
-- La demande prévoyait d'inscrire le texte par défaut comme DEFAULT de la
-- colonne. Il vit finalement dans le front (`PINTADE_RULES_TEXT_DEFAULT`), et
-- la colonne reste NULL tant que le coach n'a rien réécrit. Trois raisons :
--
--   • le bouton « Réinitialiser au texte par défaut » a de toute façon besoin
--     du texte CÔTÉ CLIENT : un client ne peut pas restaurer un DEFAULT SQL. Le
--     mettre aussi en base ferait deux copies du même paragraphe, qui
--     divergeraient à la première correction de formulation ;
--   • figé en base à l'installation, le texte ne suivrait JAMAIS les évolutions
--     du jeu. Les règles ont déjà changé deux fois en deux versions (2 h + 30 s
--     en v.107, auto-libération ici) : un texte gelé mentirait aux joueuses ;
--   • NULL porte une information vraie et utile — « le coach n'a rien
--     personnalisé » — que le front distingue à l'écran de configuration.
--
-- Dès que le coach enregistre son propre texte, c'est LUI qui fait foi, et plus
-- aucune mise à jour de l'app n'y touche.
-- ----------------------------------------------------------------------------
alter table public.pintade_rules
  add column if not exists rules_text text;

comment on column public.pintade_rules.rules_text is
  'Règles du jeu en Markdown, écrites par le coach. NULL = pas personnalisé, le front affiche son texte par défaut (PINTADE_RULES_TEXT_DEFAULT).';

-- ----------------------------------------------------------------------------
-- 2) L'AUTO-LIBÉRATION APRÈS N PREUVES CONSÉCUTIVES
-- ----------------------------------------------------------------------------
-- Nouvelle mécanique : 6 preuves réussies d'affilée et la porteuse est libérée.
-- La pintade passe alors À CELLE QUI A DEMANDÉ LA 6e — récompense d'un côté,
-- retour de bâton de l'autre.
--
-- C'est ce qui transforme les demandes de preuve en jeu à part entière : jusque
-- là, demander ne coûtait rien et la porteuse ne pouvait que subir. Désormais
-- la porteuse a un objectif atteignable, et les demandeuses un risque à
-- calculer — ce qui régule le harcèlement bien mieux qu'un rate limit.
--
-- 0 = mécanique désactivée (le coach garde la main sur tout).
alter table public.pintade_rules
  add column if not exists auto_release_after_ok integer not null default 6;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pintade_rules_auto_release_chk') then
    alter table public.pintade_rules
      add constraint pintade_rules_auto_release_chk
      check (auto_release_after_ok between 0 and 50);
  end if;
end $$;

comment on column public.pintade_rules.auto_release_after_ok is
  'Nombre de preuves consécutives qui libèrent la porteuse (la pintade passe à l''autrice de la dernière demande). 0 = désactivé.';

-- ----------------------------------------------------------------------------
-- 3) LE NOUVEAU TYPE D'INCIDENT
-- ----------------------------------------------------------------------------
-- `pintade_incident_log.incident_type` n'a volontairement pas de contrainte
-- CHECK (cf. 20260807_001) : un lot d'upsert PbSync qui violerait une contrainte
-- serait rejoué indéfiniment et gèlerait la synchro de toute la table. Les
-- valeurs sont donc tenues côté front. On documente la nouvelle ici.
--
--   'auto_release_success_streak' — la porteuse a enchaîné N preuves.
--       metadata : { releasedHolderId, newHolderId, streakCount, newPeriodId,
--                    triggerRequestId, pendingCoachPick }
--       `pendingCoachPick: true` quand la 6e demande venait du COACH (ou d'une
--       joueuse qui a quitté l'effectif) : transférer la peluche au coach n'a
--       aucun sens, la garde s'arrête et c'est lui qui désigne la suivante.
comment on column public.pintade_incident_log.incident_type is
  'coach_action | auto_release_success_streak | fail_streak_max_reached';

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.pintade_rules drop column if exists rules_text;
--   alter table public.pintade_rules drop constraint if exists pintade_rules_auto_release_chk;
--   alter table public.pintade_rules drop column if exists auto_release_after_ok;
-- ============================================================================
