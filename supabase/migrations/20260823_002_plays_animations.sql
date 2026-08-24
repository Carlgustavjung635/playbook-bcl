-- ============================================================================
-- Migration : les ANIMATIONS deviennent un média du play
-- ----------------------------------------------------------------------------
-- REMPLACE 20260823_001 (table `plays_v2`), qui n'a jamais été appliquée et
-- dont le fichier est supprimé dans le même commit. Le raisonnement a changé,
-- et il vaut la peine d'être écrit : une animation n'est pas une entité
-- concurrente du play, c'est un MÉDIA du play — au même titre qu'une vidéo ou
-- qu'une photo. Une table séparée aurait obligé chaque écran à recoller deux
-- objets pour afficher une fiche complète, et aurait fait diverger le cycle de
-- vie (supprimer un play aurait laissé ses animations orphelines).
--
-- Si `plays_v2` a malgré tout été créée par un essai de 20260823_001 :
--   drop table if exists public.plays_v2;
--
-- FORME DE LA COLONNE — un TABLEAU d'animations (plusieurs variantes
-- tactiques par play), chacune au format d'échange de l'éditeur :
--   [ { id, title, tag, side, color, description, points_md,
--       court_type:'half'|'full', defense_enabled, ball_start,
--       players:[{id,side,n,x,y}],            positions au temps 0
--       steps:[ { n, note, positions:{tokId:{x,y}},
--                 moves:[{player,to,via}], pass:{from,to}, passes:[], shot } ],
--       arrows:[…],                           vue aplatie, lecture seule
--       created_by, updated_at, format:'pb-play/2' } , … ]
-- Coordonnées terrain, 1 unité = 10 cm, origine au coin haut-gauche de la zone
-- hors-jeu (marge de 12 unités autour de l'aire de jeu, là où se place la
-- remise en touche). Le numéro de joueuse est SIGNÉ : +n attaque, −n défense.
--
-- ── QUI ÉCRIT CETTE COLONNE ────────────────────────────────────────────────
-- L'ÉDITEUR, ET LUI SEUL (src/plays-editor-poc.html, en direct via PostgREST).
-- L'entité PbSync `plays` d'index.html la LIT — pour lister les animations
-- d'un play — mais son `dump` ne la pousse JAMAIS. Cette asymétrie est le
-- cœur du dispositif : un upsert PostgREST ne touche pas aux colonnes qu'on ne
-- lui fournit pas, donc un appareil dont le localStorage est en retard ne peut
-- pas réécrire un `animations` périmé au prochain flush et effacer le travail
-- d'un autre. C'est exactement le scénario du playbook « réconcilier avant de
-- pousser » (v.104), pris à la racine plutôt que rattrapé après coup.
--
-- ⚠️ Corollaire à ne pas perdre : le jour où l'app aura besoin d'ÉCRIRE des
-- animations (duplication d'un play, import en masse), il faudra soit passer
-- par le même chemin read-modify-write que l'éditeur, soit ajouter la colonne
-- au `dump` ET traiter la réconciliation. Ajouter la colonne au dump seul
-- rouvrirait exactement le trou refermé ici.
--
-- Pas de contrainte de forme côté base : le contenu est validé par l'éditeur à
-- l'import (clés obligatoires id/title/players/steps) et une contrainte jsonb
-- ici bloquerait toute évolution du format sans migration.
-- ============================================================================

alter table public.plays
  add column if not exists animations jsonb not null default '[]'::jsonb;

comment on column public.plays.animations is
  'Animations tactiques du play (éditeur v2), sous forme de TABLEAU — plusieurs variantes par play. Écrite UNIQUEMENT par src/plays-editor-poc.html via PostgREST ; l''entité PbSync `plays` la lit mais ne la pousse jamais (sinon un appareil en retard effacerait le travail d''un autre au flush suivant). Format détaillé dans l''en-tête de la migration 20260823_002.';

-- ============================================================================
-- Rollback (manuel — perd toutes les animations dessinées) :
--   alter table public.plays drop column if exists animations;
-- ============================================================================
