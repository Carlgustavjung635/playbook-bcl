-- ============================================================================
-- Migration : LICENCES AUTO-DÉCLARÉES PAR LA JOUEUSE (+ override coach)
-- ----------------------------------------------------------------------------
-- Remplace le vocabulaire de statuts de 20260729_001 : le suivi n'est plus une
-- saisie du coach, c'est la JOUEUSE qui déclare où elle en est depuis sa carte
-- d'accueil. Les 4 états reprennent mot pour mot le vécu terrain :
--   email_received_todo → « J'ai reçu l'e-mail, faut que je m'en occupe »
--   email_missing       → « J'ai pas reçu l'e-mail de la FFBB »
--   in_progress         → « C'est en cours »
--   done                → « C'est fait ! »
-- ABSENCE DE LIGNE = « pas encore répondu » : c'est un état à part entière (le
-- coach doit voir qui n'a jamais répondu), et il ne coûte aucune ligne.
--
-- `updated_by` ('player' | 'coach') tracé pour deux raisons : le coach peut
-- marquer « c'est fait » après vérification dans le portail FFBB officiel, et la
-- joueuse doit pouvoir lire « ta coach a marqué ta licence comme faite ».
--
-- POURQUOI TOUJOURS UNE TABLE À PART ET PAS DES COLONNES licence_* SUR `players`
-- (comme la demande le proposait) : une licence est un objet PAR SAISON, alors
-- que `players` est GLOBAL (le roster existe une fois ; l'appartenance saison
-- vit dans `season_players`). Des colonnes plates écraseraient le statut au
-- changement de saison et afficheraient en silence celui de l'an dernier —
-- le « cumul cross-saison » déjà corrigé 4× ici. La table porte déjà season_id
-- et couvre donc l'intégralité du besoin, sans ce risque.
--
-- RLS : posture anon inchangée (cf. 20260729_001). Une policy
-- « player updates own row / coach updates any » via auth.uid() n'est PAS
-- exprimable : l'app n'a pas d'auth par joueuse (PIN L1 + rôle anon Supabase),
-- auth.uid() est NULL pour tout le monde — une telle policy bloquerait TOUS les
-- writes, joueuse ET coach. Le partage des droits (la joueuse ne touche que sa
-- ligne, le coach peut toucher toutes) est appliqué CÔTÉ FRONT, comme pour
-- l'ensemble des entités de ce projet.
--
-- Idempotente. La table est vide à ce stade : le changement de CHECK est sûr.
-- ============================================================================

-- 1) Nouveau vocabulaire de statuts -----------------------------------------
-- Les anciennes valeurs ('not_started', 'certif_missing', …) n'ont jamais été
-- écrites en prod (table créée vide le même jour) : pas de reprise de données.
-- Le mapping est fait quand même, pour qu'un environnement de test qui aurait
-- des lignes ne viole pas la nouvelle contrainte.
alter table public.player_licences drop constraint if exists player_licences_status_check;

update public.player_licences set status = case status
  when 'not_started'    then 'email_received_todo'
  when 'certif_missing' then 'email_missing'
  when 'validated'      then 'done'
  else status
end
where status in ('not_started', 'certif_missing', 'validated');

alter table public.player_licences
  add constraint player_licences_status_check
  check (status in ('email_received_todo', 'email_missing', 'in_progress', 'done'));

-- Plus de valeur par défaut : une ligne n'existe QUE si un statut a été déclaré.
alter table public.player_licences alter column status drop default;

-- 2) Traçabilité de l'auteur de la dernière mise à jour ----------------------
alter table public.player_licences
  add column if not exists updated_by text;

alter table public.player_licences drop constraint if exists player_licences_updated_by_check;
alter table public.player_licences
  add constraint player_licences_updated_by_check
  check (updated_by is null or updated_by in ('player', 'coach'));

-- ============================================================================
-- Rollback (manuel) :
--   alter table public.player_licences drop constraint if exists player_licences_status_check;
--   alter table public.player_licences drop column if exists updated_by;
-- ============================================================================
