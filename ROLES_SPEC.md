# Rôles multi-coach & multi-équipes — spécification figée

> Statut : validé avec l'user, implémenté sur `feat/coach-roles-multi-team`.
> Cette matrice fait foi. Toute évolution des permissions doit mettre ce fichier à jour.

## Contexte

Un vrai club (BCL) gère deux équipes seniors féminines (E1 / E2). Historiquement,
l'app a **un seul coach** = admin de fait (rôle applicatif `coach`, un PIN partagé).
On introduit **plusieurs coachs**, chacun avec une portée d'équipe, sans casser le
golden path mono-coach.

L'axe « équipe » réutilise le **multi-effectif existant** (`team_tag` = `e1` | `e2` |
`both`, migration `20260607_001_multi_squad.sql`). Un coach est rattaché à un ou
plusieurs `team_tag`. Il n'y a **pas** de nouvel identifiant d'équipe entier : E1=`e1`,
E2=`e2`.

## Les trois rôles

| Rôle | Qui | Portée |
|---|---|---|
| `admin_coach` | Le coach historique (l'user actuel), renommé avec son prénom | Tout le club, toutes les équipes, + tâches d'admin |
| `coach` | Coach non-admin (E2 au départ) | Scopé à ses `team_tag` |
| `player` | Joueuse | Inchangé (aucun rôle mixte coach/joueuse) |

> **Note d'implémentation.** Au niveau L1 (`state.auth.role`), tous les coachs — admin
> ou non — restent `role: 'coach'` : toute l'UI coach existante fonctionne pour les deux.
> La distinction admin/non-admin vit dans `state.auth.coachRole` (`admin_coach` |
> `coach`) résolue depuis l'entité `coaches`. Un coach déjà connecté avant la mise à
> jour (sans `coachId`) est traité comme **admin** (rétrocompat).

## Ressources COMMUNES aux deux équipes

Visibles par tous les coachs, **édition admin only** :

- **Playbook** (bibliothèque de plays) — création / édition / suppression = admin only.
- **Prépa physique** (programmes / exercices) — création / édition / suppression = admin only.
- **Pool de gages** — la **modération** (valider / refuser les propositions) = admin only.

## Ressources SCOPÉES par équipe

Chaque coach n'agit que sur ses équipes (`team_tag`) :

- Effectif joueuses (l'admin attribue chaque joueuse à E1, E2, ou les deux).
- Matchs / convocations.
- Championnat & scouting FFBB adversaires.
- Compo / lineup / prépa match / notes / messages.
- Routines d'échauffement par match.
- Points forts / faibles des joueuses de son effectif.

## Matrice des permissions

| Action | `admin_coach` | `coach` (non-admin) | `player` |
|---|:--:|:--:|:--:|
| Voir toutes les équipes / toutes les joueuses | ✅ | ❌ (ses équipes) | ❌ |
| Créer / éditer matchs, convocations | ✅ | ✅ (ses équipes) | ❌ |
| Compo, lineup, prépa, notes match | ✅ | ✅ (ses équipes) | ❌ (lecture révélée) |
| Routines d'échauffement par match | ✅ | ✅ | ❌ |
| Points forts/faibles de ses joueuses | ✅ | ✅ (ses joueuses) | ❌ |
| Scouting FFBB adversaires | ✅ | ✅ (son championnat) | 👁 (readonly home) |
| Envoyer messages à ses joueuses | ✅ | ✅ (ses joueuses) | ❌ |
| **Proposer** un gage | ✅ (direct pool) | ✅ (→ `pending`, modéré) | ✅ (→ `pending`) |
| **Attribuer** un tirage à une joueuse | ✅ | ✅ (ses joueuses) | ❌ |
| Gérer les dettes de tirage | ✅ | ✅ (ses joueuses) | ❌ |
| **Modérer** les propositions de gages | ✅ | ❌ | ❌ |
| Créer / éditer le **playbook** | ✅ | ❌ (consultation) | ❌ (consultation) |
| Créer / éditer la **prépa physique** | ✅ | ❌ (consultation) | 👁 (sa vue) |
| Convoquer une joueuse hors de son effectif (renfort) | ✅ | ❌ | — |
| Créer / renommer / supprimer d'autres coachs | ✅ | ❌ | — |
| Attribuer coach ↔ équipe(s) | ✅ | ❌ | — |
| Attribuer joueuses à un effectif (E1/E2/both) | ✅ | ❌ | — |
| Réglages club (thème club, logo, identité, saisons) | ✅ | ❌ | — |
| Zone dangereuse (suppressions saison, reset) | ✅ | ❌ | — |
| Renommer son propre profil | ✅ | ✅ | — (via PIN) |
| Changer son propre code PIN / thème perso | ✅ | ✅ | ✅ |

Légende : ✅ autorisé · ❌ interdit / masqué · 👁 lecture seule · — sans objet.

## Ce que l'admin fait EN PLUS (panneau ⚙️ Admin)

- **Mon profil** : renommer (prénom affiché de l'admin).
- **Gérer les coachs** : liste + « + Coach » (prénom, équipes E1/E2/les deux,
  **code à 6 chiffres auto-généré** à partager), édition, suppression.
- **Effectifs par équipe** : attribuer les joueuses à E1 / E2 / les deux
  (réutilise l'éditeur de roster de saison, `team_tag` sur `season_players`).
- **Modérer les gages proposés** : valider / refuser les propositions (coach + joueuses).

## Non-buts / limites connues

- **Auth inchangée** : pas de nouveau système de comptes. Les coachs sont des identités
  PIN-only (comme les joueuses), synchronisées via l'entité `coaches` (rôle anon,
  posture « sandbox équipe » identique au reste de l'app). Le code coach a le même
  niveau de secret qu'un PIN joueuse : contrôle d'accès réel = PIN L1 côté front.
- **Convocation renfort inter-équipe** : le coach non-admin ne peut pas convoquer une
  joueuse hors de son effectif. L'admin le fait via sa propre UI (aucune restriction).
  La « demande de renfort » (task/notif à l'admin) est **différée** (hors périmètre v1).
- **Compte joueuse** : strictement séparé du coach, aucun changement fonctionnel.
- **Golden path mono-coach** : tant qu'aucun coach non-admin n'existe, l'app est
  **strictement identique** à avant (pas de sélecteur de coach au login, admin implicite).

## Champs profil : postes, taille, date de naissance

Ajoutés dans la même PR (migrations `20260709_002` postes/taille, `20260709_003` date de naissance).

| Champ | Table | Type | Édité par | Visible par |
|---|---|---|---|---|
| `postes` | players | `int[]` (valeurs 1–5) | joueuse (soi) + coach (ses joueuses) | coachs (leurs joueuses) |
| `taille_cm` | players | `int` nullable | joueuse (soi) + coach (ses joueuses) | coachs (leurs joueuses) |
| `date_naissance` | players **et** coaches | `date` nullable | soi-même | joueuse : soi ; coach : ses joueuses + lui-même ; admin : tout |

- Postes 1–5 = **meneuse / arrière / ailière / ailière forte / pivot** (multi-valué, chips toggle `PLAYER_POSTES`, distinct du `POSTES` des compos/lineups).
- **Âge calculé** (`_ageFromDob`) affiché « nn ans » sur la fiche + la liste roster ; date affichée en `JJ/MM/AAAA`.
- **Filtre roster par poste** (bonus) : chips `Tous · 1..5` dans la liste des joueuses (coach).
- Un coach non-admin voit/édite ces champs **uniquement sur ses joueuses** (`_playerVisibleToUser` + liste roster scopée) ; la gestion roster (ajout/retrait/attribution d'équipe) reste admin.

### Décisions tranchées (postes/taille/naissance)
- **Sélecteur postes** : chips toggle (plus rapide/lisible mobile) — retenu.
- **Cardinalité** : min **1 poste** exigé dans le profil **joueuse** (self-edit) ; côté **coach**, postes **optionnels** (il ne connaît pas toujours → ne pas bloquer l'édition d'une joueuse legacy sans poste).
- **Taille** : bornée **140–220 cm** côté UI (DB check permissif 100–260), nullable, placeholder « ex : 170 ».
- **Date de naissance** : bornée **1950-01-01 .. aujourd'hui−8 ans** côté UI, nullable, dans le bloc identité (après nom/postes/taille).

## Décisions de design tranchées en autonomie

- **Modèle d'identité coach** : entité synchronisée `coaches` (pas la table `profiles`,
  qui est réservée à l'auth L2 e-mail optionnelle et absente pour la plupart des
  installs PIN-only). Justifié : cohérent avec `players` (PIN-only, anon-sync).
- **Axe équipe** : réutilise `team_tag` (`e1`/`e2`/`both`) existant plutôt qu'un
  `team_ids int[]` parallèle. L'activation du multi-effectif (`team_settings.multi_squad`)
  passe automatiquement à `true` dès qu'un coach non-admin est créé.
- **Code coach** : 6 chiffres, comme les PIN joueuses.
- **Emplacement du bouton Admin** : dans le menu ⚙ (openSettings), section coach,
  visible admin only.
- **Rétrocompat login** : le coach historique se connecte comme avant (rôle Coach + son
  PIN) et devient `admin_coach` automatiquement (seed au boot depuis `state.pins.coach`).
