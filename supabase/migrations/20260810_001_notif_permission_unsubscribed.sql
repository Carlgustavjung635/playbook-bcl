-- =============================================================================
-- 20260810_001 — « notifs coupées sur l'appareil » : un état de plus, et pas
--                un détail. (v.112)
-- =============================================================================
--
-- CE QUI N'ALLAIT PAS
-- -------------------
-- `players.notif_permission` ne stockait que la permission du NAVIGATEUR
-- ('granted' / 'default' / 'denied' / 'unsupported'). Or une notification
-- n'arrive que si DEUX choses sont vraies à la fois : le navigateur autorise,
-- ET l'app a une souscription push vive.
--
-- `disablePush()` (le bouton « désactiver » dans l'app) désabonne le pushManager
-- et désenregistre le service worker — mais il ne touche pas, et ne PEUT pas
-- toucher, `Notification.permission` : seul le navigateur l'accorde ou la
-- retire. Une joueuse qui coupait ses notifs depuis l'app restait donc marquée
-- 'granted' en base. Le coach la voyait « joignable », sans badge, alors
-- qu'elle ne recevait plus rien. C'est précisément le mensonge que la colonne
-- avait été créée pour supprimer.
--
-- Même angle mort pour les souscriptions périmées sans geste de personne :
-- rotation d'endpoint iOS/FCM, cache Safari vidé, app réinstallée.
--
-- CE QUE ÇA CHANGE
-- ----------------
-- Un cinquième état, 'unsubscribed' : « le téléphone autorise, mais l'app n'est
-- plus abonnée ». C'est le plus réparable des états dégradés — un tap suffit,
-- le navigateur ne redemande rien — et c'est le seul qui était invisible.
--
-- On ÉLARGIT la contrainte, on ne la remplace pas par du permissif : la liste
-- fermée est ce qui empêche une valeur inventée de s'installer en base.
-- Aucune ligne existante n'est réécrite : 'granted' reste 'granted' jusqu'à ce
-- que l'appareil de la joueuse remonte lui-même la mesure au prochain boot.
--
-- Idempotente, additive, sans perte. Rejouable.
-- =============================================================================

alter table public.players
  drop constraint if exists players_notif_permission_chk;

alter table public.players
  add constraint players_notif_permission_chk
  check (notif_permission is null
         or notif_permission in ('granted', 'default', 'denied', 'unsupported', 'unsubscribed'));

comment on column public.players.notif_permission is
  'État effectif des notifications sur le dernier appareil vu de la joueuse. '
  'NULL = jamais mesuré (une joueuse qui n''a pas encore ouvert une version '
  'récente) — ce n''est PAS un refus, et l''UI ne doit jamais le présenter '
  'comme tel. granted = permission accordée ET souscription push vive. '
  'unsubscribed = permission accordée mais plus aucune souscription (notifs '
  'coupées depuis l''app, endpoint tourné, cache vidé, app réinstallée) : '
  'réparable en un tap, sans redemander la permission. denied = refusée au '
  'niveau du navigateur, seuls les réglages système la rétablissent. '
  'unsupported = navigateur/PWA hors d''état d''en recevoir.';

-- -----------------------------------------------------------------------------
-- Retour arrière (si jamais) :
--   update public.players set notif_permission = 'granted'
--     where notif_permission = 'unsubscribed';
--   alter table public.players drop constraint if exists players_notif_permission_chk;
--   alter table public.players add constraint players_notif_permission_chk
--     check (notif_permission is null
--            or notif_permission in ('granted','default','denied','unsupported'));
-- -----------------------------------------------------------------------------
