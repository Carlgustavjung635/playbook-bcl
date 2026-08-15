-- ============================================================================
-- Migration : montant de la DERNIÈRE récolte (banque de points)
-- ----------------------------------------------------------------------------
-- Le feed du groupe (migration 20260816_001) montre « 🎁 Delph a récolté 400
-- pts ». Ce nombre n'était dérivable de rien : le repère de récolte
-- (`player_points_harvests`, migration 20260815_004) ne garde qu'un CUMUL
-- (`claimed_total`) et une date (`last_claimed_at`) — de quoi savoir QUAND elle
-- a récolté, jamais COMBIEN elle a encaissé ce jour-là.
--
-- Une colonne, écrite au moment même de la récolte par l'appareil qui la fait
-- (un seul, celui de la joueuse) : c'est la donnée la moins chère qui rende
-- l'événement possible. Le reste du feed continue de se dériver.
--
-- LIMITE ASSUMÉE, ET ELLE EST DANS LE MODÈLE : le repère est UNE ligne par
-- (joueuse, saison), pas un journal. On ne peut donc dériver que la DERNIÈRE
-- récolte de chacune — une grosse récolte de mardi disparaît du mur si elle en
-- refait une petite jeudi. C'est le prix d'un repère qui reste une ligne, et le
-- choix reste le bon : un journal des récoltes serait une table de plus à
-- écrire, purger et tenir synchrone pour un mur qui s'efface au bout de 60
-- jours de toute façon.
--
-- Additive et idempotente. `default 0` : les repères existants valent zéro, donc
-- aucun ne fabrique un faux « gros lot » rétroactif.
-- ============================================================================

-- ORDRE D'APPLICATION : cette migration suit `20260815_004_points_banque_recolter`
-- (qui crée la table). L'ordre alphabétique des fichiers le garantit pour
-- `scripts/migrate.mjs` ; le message ci-dessous est là pour l'application
-- fichier par fichier via `scripts/apply-one.mjs`.
--
-- Le FRONT, lui, ne dépend PAS de cet ordre : il détecte la présence de la
-- colonne avant de la pousser (cf. `_pointsHarvestAmountCol` dans index.html).
-- Appliquer la banque sans cette migration ne casse donc rien : l'événement
-- « 🎁 gros lot » du feed attend, la banque fonctionne.
do $$
begin
  if to_regclass('public.player_points_harvests') is null then
    raise exception 'Applique d''abord 20260815_004_points_banque_recolter.sql (la banque crée la table).';
  end if;
end $$;

alter table public.player_points_harvests
  add column if not exists last_claimed_amount integer not null default 0;

comment on column public.player_points_harvests.last_claimed_amount is
  'Montant de la DERNIÈRE récolte (claimed_total en est le cumul). Sert au feed du groupe : « 🎁 a récolté 400 pts ». Cf. migration 20260816_002.';

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.player_points_harvests drop column if exists last_claimed_amount;
-- ============================================================================
