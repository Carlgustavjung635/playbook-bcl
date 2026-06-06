-- ============================================================================
-- ffbb_config : surnom d'équipe (nickname).
-- Objectif : permettre au coach de définir un surnom court affiché dans l'app
-- (en-tête / topbar) à la place du nom officiel FFBB ("IE - BASKET CLUB
-- L'ISLOIS - 2"), qui sert lui à la détection auto V/D et au classement.
--
-- Nullable, SANS default : pas de surnom = on retombe sur "BCL · L'Islois".
--
-- IMPORTANT — couplage sync : le dump de l'entité 'ffbb' (index.html, ENTITIES)
-- envoie désormais la colonne `nickname` dans l'upsert ffbb_config. Tant que
-- cette migration n'est pas appliquée en prod, l'upsert ffbb_config échouera
-- (colonne inconnue) → matches/standings ne syncront plus. À appliquer AVANT
-- ou EN MÊME TEMPS que le déploiement de cette PR.
--
-- Pas de nouvelles policies : public.ffbb_config a déjà ses policies anon
-- (select public + write). Pas de changement realtime (entité non realtime).
-- ============================================================================

alter table public.ffbb_config
  add column if not exists nickname text;
-- NULL = pas de surnom → l'app affiche "BCL · L'Islois" par défaut.
