# 🏆 Le score de saison — et sa banque

> Livré en **v.126**. Migrations : `supabase/migrations/20260815_003_points_system.sql`
> et `supabase/migrations/20260815_004_points_banque_recolter.sql`.
> Tests : `scripts/test-points-system.mjs` (47 assertions, cœur pur) et
> `scripts/test-points-integration.mjs` (code réel d'`index.html`).

---

## Le jeu, en trois phrases

Tout ce qu'une joueuse fait rapporte des points : venir aux entraînements,
valider ses séances de prépa, réussir un défi, tenir un gage, régler son ardoise.
Ces points ne tombent pas sur son score : ils tombent d'abord dans sa **banque**.
Il faut ouvrir l'app et appuyer sur **🎁 Récolter** pour les encaisser — avec les
pièces qui volent, le compteur qui grimpe et les confettis.

**Rien ne se perd si elle attend.** Le bouton ne sert pas à mériter les points,
il sert à en profiter.

---

## Le barème

| Source | Ce que ça rapporte | Réglable |
|---|---|---|
| 📋 Présence à un entraînement **clôturé** | **10 pts** | oui — barème global |
| 💪 Séance de prépa validée | les points **figés** à la validation | via la config prépa |
| 🏆 Défi réussi (un score enregistré) | **5 pts** par défaut | oui — **défi par défi** |
| 🎁 Gage tenu **et confirmé par le coach** | **15 pts** | oui — barème global |
| 🍽 Ardoise réglée | les points **figés** du menu | via le menu |
| ✍️ Ajustement du coach | ce qu'il décide (−1000 à +1000) | — |

Réglages : **Admin → Score général → ⚙️ Barème des points**. Le barème est global
(il retarife les deux effectifs), il est donc réservé à l'admin ; **ajuster une
joueuse**, en revanche, est un acte d'entraîneuse et reste ouvert à tout coach
depuis le classement.

### Ce qui ne rapporte RIEN, et pourquoi

- **Les matchs.** `training_attendance` dit ce qu'il dit. Un match se joue sur
  sélection, pas sur assiduité : créditer la présence à un match reviendrait à
  payer la compo du coach.
- **Les défis AUTO** (« Présences », « Ponctualité »). Leurs compteurs dérivent
  eux-mêmes des entraînements clôturés : les créditer paierait la même séance
  deux fois.
- **Les défis collectifs.** Leur score est un compteur d'équipe, sans
  attribution individuelle possible.
- **Un défi réglé à 0 point.** C'est un réglage, pas un oubli — il reste dans sa
  progression perso, il ne pèse simplement pas sur le score.

---

## Score, banque, classement : trois nombres, un seul total

|  | Ce que c'est | Où ça s'affiche |
|---|---|---|
| **Score** | les points **encaissés** | le gros chiffre de sa carte d'accueil |
| **Banque** | les points **gagnés, pas encore récoltés** | la ligne 🏦, juste en dessous |
| **Total** | score + banque | le **classement** de l'équipe |

Le classement compte les points **gagnés**, récoltés ou non. Ne pas avoir appuyé
sur « Récolter » est un délai, pas un moindre mérite — faire glisser une joueuse
au classement parce qu'elle n'a pas ouvert l'app depuis trois jours publierait
son assiduité de connexion à toute l'équipe. Le coach voit malgré tout la banque
en petit sous chaque total, pour que « j'ai 1 240 » et « je lis 1 640 » ne
deviennent pas un motif de suspicion.

---

## Bonus en banque, malus tout de suite

Quand le coach ajuste une joueuse, une case décide où vont les points :

- **Bonus** → par défaut **dans la banque**. C'est une bonne nouvelle, elle
  mérite son animation.
- **Malus** → **direct sur le score**, case cochée et verrouillée. Un malus
  qu'on peut refuser d'encaisser n'est pas un malus : il suffirait de ne jamais
  appuyer sur « Récolter » pour ne jamais le subir — et le bouton demanderait à
  la joueuse de valider elle-même sa punition, avec des confettis.

Cette règle est tenue **trois fois** : à la saisie (la case se verrouille), à
l'écriture (elle est refaite, un `disabled` s'édite), et à la lecture (tout gain
négatif est compté comme encaissé, quoi qu'en dise la base — ce qui couvre les
lignes posées par une version antérieure du front).

Le **motif est obligatoire**, et **visible par la joueuse** : c'est lui qui fait
la différence entre une récompense et une punition inexpliquée.

---

## Comment ça marche vraiment (pour la prochaine personne qui y touche)

### Le score est DÉRIVÉ, il n'est stocké nulle part

Il n'existe aucune ligne « +10 pts pour la séance de mardi ». À chaque lecture,
le front reconstruit la liste des gains depuis les sources qui font **déjà foi**
(`training_completions`, instances de convocation clôturées, `challenge_scores`,
`gage_draws`, `ardoise_assignments`).

Ce n'est pas une élégance : c'est ce qui évite quatre pannes que ce dépôt a déjà
payées ailleurs. Matérialiser un gain, dans une app sans serveur, c'est désigner
un appareil comme responsable de l'écrire — et il y a toujours un cas où il n'est
pas là : **double comptage** (deux appareils voient la même présence),
**rétro-correction perdue** (la source change, la ligne figée non), **score qui
ment** tant qu'une joueuse n'ouvre pas l'app, **lot d'upsert gelé** par une
écriture automatique de trop.

Conséquence heureuse : corriger une présence ou dé-clôturer une séance corrige le
score, tout seul, partout, sans passe de rattrapage.

Le ledger (`player_points_ledger`) ne garde donc que ce qui n'est dérivable de
rien : les **ajustements du coach**, et les **surcharges** — une ligne dont le
couple `(source_type, source_id)` désigne un gain dérivé le **remplace**, ce qui
permet de rectifier un cas particulier sans toucher au barème de tout le monde.

> **Une seule porte de lecture** : `playerPointsSplit()` (et
> `playerPointsEntries()` en dessous). Toute vue qui compte des points passe par
> là, sinon une vue oubliée afficherait un total qui ignore les surcharges.

### La banque est un REPÈRE, pas N lignes

`player_points_harvests` : **une ligne par (joueuse, saison)**, qui dit jusqu'où
les gains ont été encaissés. Un gain dérivé est récolté si son horodatage est
antérieur au repère. Récolter = avancer le repère à maintenant. Une écriture par
clic, par une seule joueuse, sur sa propre ligne.

Trois conséquences, toutes voulues :

- **Ligne absente = repère à zéro** = tout est en banque. C'est le bon défaut
  pour une joueuse arrivée avant la migration : rien n'est perdu, et son premier
  « Récolter » encaisse toute son histoire d'un coup.
- **Les rattrapages du coach sont déjà encaissés.** Une séance validée
  rétroactivement (v.122) porte la date de la **séance**, pas de la saisie : elle
  passe sous le repère et rejoint le score directement. La joueuse n'a pas à
  « récolter » un oubli d'il y a trois semaines.
- **`claimed_keys`** rattrape le seul cas que le repère ne couvre pas : un gain
  sans horodatage, ou daté dans le **futur** (un défi encore ouvert est daté de
  sa date de fin). Sans cette liste, il resterait en banque à vie et le bouton ne
  s'éteindrait jamais. Elle est **purgée à chaque récolte** de tout ce que le
  repère couvre désormais — elle reste minuscule.

### L'animation

3 secondes : les pièces volent de la banque vers le score (échelonnées, avec un
crochet vers le haut — une pièce qui suit la diagonale exacte a l'air tirée à la
ficelle), le compteur grimpe en `easeOutCubic`, les confettis saluent le
résultat, un toast annonce le total.

**L'écriture d'abord, la mise en scène ensuite.** L'état est muté et persisté
*avant* la première pièce : un téléphone verrouillé au milieu des confettis, une
PWA tuée par iOS, un rechargement — et la joueuse retrouve ses points.

`prefers-reduced-motion` retire le mouvement, **jamais l'information** : la
récolte a lieu, l'écran se re-rend, et le toast annonce le gain.

---

## Pièges connus

- **Ne PAS ranger le score dans une colonne.** Le moteur de synchro pousse la
  ligne entière ; une colonne absente en base ne lève qu'un `console.warn`, et
  **toute la table cesse de se synchroniser en silence**.
- **Changer le barème recalcule le passé.** « Une présence vaut 10 » est une
  règle, pas un prix historique. Pour geler un cas particulier, le coach pose une
  surcharge (ledger), il ne touche pas au barème.
- **Les points de prépa et d'ardoise, eux, sont FIGÉS** à la validation. On ne
  re-tarife pas une séance déjà validée : ça changerait rétroactivement un total
  annoncé à la joueuse le jour où elle l'a gagné.
- **Un hard delete ne tue pas une ligne d'id « x… »** : n'importe quel client la
  repousse au flush suivant. Le seul état terminal durable est le soft-delete
  (`deleted_at`), et c'est ce qu'utilise « annuler cet ajustement ».
