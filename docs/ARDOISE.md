# 🍽 L'Ardoise — dettes sportives « menu du chef »

> Livrée en **v.124**. Migration : `supabase/migrations/20260815_001_ardoise.sql`.
> Tests : `scripts/test-ardoise.mjs` (50 assertions).

---

## Le jeu, en trois phrases

Le coach **ardoise** une joueuse (une dette, ou plusieurs d'un coup). Pour chaque
dette, elle **tire son menu au sort** — pas de choix à la carte — puis a
**7 jours** pour le consommer, devant le coach à l'entraînement ou à la maison
avec une photo. Menu validé = **points positifs** ; menu non consommé = la dette
**expire et une autre la remplace**, déjà tirée, avec un nouveau délai.

Thème visuel : ardoise de restaurant, craie, carte du chef.

---

## Les règles retenues

| Règle | Valeur | Réglable |
|---|---|---|
| Qui assigne | **le coach seul** — aucune auto-sanction sur absence | non |
| Tirage au sort | **obligatoire** à chaque dette | non |
| Menus en parallèle | **un seul à la fois** | non |
| Délai pour consommer | **7 jours** à partir du **tirage** | oui |
| Non consommé dans les délais | +1 dette auto, **déjà tirée**, nouveau délai | oui |
| Plafond de dettes | **10** | oui |
| Ajout coach | **empile** (2 + 2 = 4) | non |
| Preuve maison | **photo simple** (galerie autorisée) | oui |
| Récompense | points positifs, **par menu** | par menu |

### « Un seul menu à la fois » — où ça se joue

Dans `ardoiseCurrentDebt()`, et nulle part ailleurs. S'il existe une dette déjà
tirée (`in_progress`) ou dont la preuve attend le coach (`done_home`), **c'est
elle la courante, quoi qu'il arrive** — même si le coach a posé d'autres dettes
avant. Les dettes en attente de tirage patientent derrière.

Sans cette priorité, une dette de pénalité (auto-tirée, donc arrivée *après* des
dettes en attente) ferait tourner un **second chrono en parallèle** du premier.

### « 7 jours » — figés au tirage, pas recalculés

`deadline_at` est écrit une fois, au tirage. Le coach qui passe le délai de 7 à
30 jours demain n'allonge **pas** les ardoises déjà tirées : elles gardent le
contrat qu'elles avaient. Même posture que le barème figé de la prépa
(`base_points`).

---

## ⚠ Un écart assumé avec la spécification d'origine

La spec disait : *« au plafond, l'expiration ne régénère rien »*.

Appliqué littéralement, **le plafond devient une porte de sortie** : une joueuse
à 10 dettes n'a qu'à ne rien faire pendant 10 semaines pour que ses ardoises
s'éteignent une à une jusqu'à zéro. L'inaction totale serait la stratégie
optimale — exactement l'inverse de ce que la feature cherche.

**Ce qui est livré :** le remplacement est **toujours 1-pour-1**. Une dette meurt
avant que sa remplaçante ne naisse, donc le plafond ne peut jamais être dépassé,
mais il ne décroît pas tout seul non plus. Le plafond garde son vrai rôle :
**borner ce que le coach ajoute**.

La garde `>= max_debts` du code reste en place et sert pour une donnée importée
ou aberrante (11 dettes en base → l'anomalie se résorbe). Les deux comportements
sont verrouillés par des tests.

Pour revenir au comportement littéral : déplacer le test de plafond **avant**
`a.status = 'expired_penalized'` dans `ardoiseSweep()`. Une ligne.

---

## L'architecture : ce qui est dérivé, ce qui est écrit

### Dérivé (jamais stocké, recalculé à la lecture)

- le **nombre de dettes actives** (`ardoiseDebtCount`)
- la **dette courante** (`ardoiseCurrentDebt`)
- le **total de points** (`ardoisePointsOf`)
- le **retard** (`ardoiseIsOverdue`)

Un compteur écrit en base serait incrémenté par le client **qui constate**
l'événement — or ils sont onze. Le projet a déjà payé ce prix (convocations en
double, quatre cumuls cross-saison).

### Écrit — et le seul point délicat de la feature

La dette de remplacement ne peut pas être dérivée : c'est une **ligne**, et une
ligne doit bien être écrite par quelqu'un. Onze appareils qui constatent la même
expiration écriraient onze dettes.

**La parade n'est pas un verrou, c'est le déterminisme :**

| Champ | Comment il est obtenu |
|---|---|
| `id` | `_ardPenaltyIdFor(parent.id)` → `'xard' + <id parent nettoyé> + 'p'` |
| `drawn_at` | `parent.deadline_at` — **pas** `Date.now()` |
| `deadline_at` | `drawn_at + deadline_days` |
| `menu_id` | hachage FNV-1a de l'`id` sur le vivier **trié par id** |
| `assigned_at` | `parent.deadline_at` |

Onze appareils écrivent donc **exactement la même ligne, sur la même clé
primaire** : l'upsert n'en fait qu'une. Idempotent par construction, y compris
pour un appareil resté trois semaines hors ligne, qui rejoue la chaîne entière et
retombe sur les mêmes identifiants.

Le préfixe **`x`** de l'id n'est pas décoratif : c'est l'heuristique anti-wipe de
tous les `apply()` de PbSync (une ligne locale pas encore flushée dont l'id ne
commence pas par `x` est effacée au premier fetch).

### Pourquoi la pénalité est tirée automatiquement

Une dette qui attend que la joueuse ouvre l'app pour redémarrer son chrono, c'est
une sanction **qu'on esquive en n'ouvrant pas l'app**. Le cycle doit tourner sans
elle. Réglable (`auto_draw_on_penalty`), mais le défaut est `true` et il vaut
mieux ne pas y toucher.

### `done_home` n'expire JAMAIS

La joueuse a envoyé sa preuve : la balle est dans le camp du coach. La
sanctionner de la lenteur de quelqu'un d'autre serait injuste — et c'est
exactement le genre de détail qui fait désinstaller une app.

### Qui balaie quoi

`ardoiseSweep()` : le **coach balaie toute l'équipe**, une **joueuse ne balaie
que ses propres dettes**. Pas une question de droits (le RLS est un bac à sable
partagé), mais de bruit : onze appareils qui matérialisent les onze mêmes
chaînes, c'est onze fois le même lot d'upserts pour rien.

Déclenché au boot (1,8 s après la 1ʳᵉ sync — jamais sur un localStorage périmé)
puis par un veilleur toutes les 60 s.

---

## Le modèle de données

### `exo_templates` — la bibliothèque **partagée**

Une seule bibliothèque pour **deux** systèmes : les menus de l'Ardoise **et** les
blocs de séance de la prépa physique (`training_sessions.blocks`). Un exercice
écrit une fois sert aux deux — c'est tout l'intérêt d'avoir une table plutôt que
deux catalogues jumeaux qui divergent au bout de trois semaines.

Côté prépa, le point d'entrée est le sélecteur **« — depuis la bibliothèque
d'exos — »** dans le wizard de séance (`_twExoLibraryPicker`). Il n'apparaît que
si la bibliothèque est peuplée.

Les `default_*` sont des **suggestions** : chaque menu fige sa propre dose.
Modifier l'exo demain ne réécrit aucun menu déjà composé, ni aucune séance déjà
écrite.

### `ardoise_menus` — la carte

Niveaux : `starter` ⭐ · `plat` 🥘 · `dessert` 🔥 · `feu` 🌋.

`items` (jsonb) : `[{ exo_id, name, sets, reps, duration_sec, rest_sec, note, order }]`.

**`name` y est dupliqué depuis l'exo, exprès** : un exo supprimé de la
bibliothèque ne doit pas transformer un menu déjà tiré au sort en liste de lignes
vides. Le lien `exo_id` reste pour retrouver la fiche quand elle existe encore.

`is_active` plutôt qu'une suppression : un menu retiré du tirage doit rester
**lisible** sur les dettes qui le portent déjà. Un menu **vide** n'est jamais
tiré.

### `ardoise_assignments` — les dettes

```
pending_draw      assignée, pas encore tirée
in_progress       tirée : menu_id, drawn_at et deadline_at sont posés
done_home         photo envoyée, en attente du coach       ← n'expire pas
done_validated    photo validée par le coach               → points acquis
done_at_training  validée de visu par le coach             → points acquis
expired_penalized délai dépassé : dette morte, remplacée (cf. parent_id)
```

Un **refus de photo** revient à `in_progress` : ce n'est pas un état terminal,
c'est « recommence ». L'échéance d'origine est conservée — pas de double peine ;
le coach qui veut être clément prolonge explicitement.

Une dette posée par erreur se **soft-delete**. Jamais de hard delete : une ligne
d'id `x…` supprimée en dur est repoussée par n'importe quel client au flush
suivant.

`points_awarded` est **figé à la validation** depuis `menus.points_reward`.
Changer le barème d'un menu ne réécrit jamais l'historique.

### `ardoise_rules` — singleton `'default'`

`deadline_days`, `max_debts`, `auto_penalty_on_expire`, `auto_draw_on_penalty`,
`require_photo_at_home`, `rules_text_md` (CMS markdown).

Tant que le coach n'a rien réglé, `state.ardoiseRules` vaut `null` et **rien
n'est poussé** : pousser des défauts front écraserait la ligne seedée par la
migration, et les réglages d'un coach depuis un appareil qui n'aurait pas encore
lu le serveur (le mode de panne de la v.104).

Idem pour `rules_text_md` : un texte identique au défaut est stocké `''`, pas
recopié. Le coach qui n'a rien changé continue de suivre les évolutions du jeu.

---

## Les écrans

### Joueuse

- **Carte d'accueil** — muette s'il n'y a aucune dette. Rappeler la sanction à
  celles qui n'en ont pas n'apporte rien.
- **« 🍽 Mon Ardoise »** (modale, pas un onglet — la nav est pleine à 5 entrées et
  y toucher ferait courir un risque à toutes les vues) : règles en accordéon,
  3 compteurs, la dette courante, le livre de comptes.
- **Tirage au sort** : plein écran hors `#root` (insensible aux re-renders),
  décompte 3-2-1 → roulette de menus → révélation. **Rien n'est écrit avant la
  fin de l'animation** : une fermeture forcée laisse la dette intacte, en attente
  de tirage.
- **Deux gestes** : « ✅ Fait à l'entraînement » (n'auto-valide **rien** — ça
  prévient le coach, il tranche) et « 📸 Envoyer une preuve maison ».

### Coach

Écran à 4 onglets (`openArdoiseCoach`) :

| Onglet | Contenu |
|---|---|
| 🍽 Ardoises | preuves à valider, ardoisées, fiche par joueuse, « + Ardoiser » |
| 📖 Menus | composition de la carte (exos + niveau + points + activation) |
| 🏋 Biblio | la bibliothèque partagée avec la prépa |
| ⚙️ Réglages | délai, plafond, interrupteurs, **texte CMS des règles** |

Points d'entrée : carte d'accueil coach, panneau Admin, et **menu Réglages de
tous les coachs** — ardoiser, valider une preuve et composer un menu font partie
du métier ; réserver ça à l'admin obligerait le coach E2 à passer par quelqu'un
pour sanctionner sa propre équipe.

### Cloche

- joueuse : dette à tirer / à consommer (**actionnable**), preuve envoyée
  (informatif — elle attend le coach, la relancer donnerait l'impression d'un
  reproche) ;
- coach : preuves à valider (**actionnable** — tant qu'il ne tranche pas, la
  dette reste ouverte de son fait à lui).

### Push

`ardoise_assign` · `ardoise_drawn` · `ardoise_proof` · `ardoise_declared` ·
`ardoise_validated` · `ardoise_rejected` · `ardoise_penalty`.

Le push de pénalité passe par un **filigrane local** (`pb8_ardoise_pushed`,
jamais synchronisé) : sans lui, chaque balayage ré-émettrait.

---

## Le rendu « ardoise »

`.ard-slate` et compagnie sont le **seul bloc CSS de l'app à ne pas suivre les
tokens de thème**, délibérément : une ardoise de restaurant est noire dans les
dix thèmes, sinon ce n'est plus une ardoise. Le contraste (craie `#f4f1e8` sur
`#23262a`) tient l'AA partout, et rien d'autre dans l'app ne réutilise ces
classes.

Typo craie : polices manuscrites **système** d'abord (`Chalkduster` sur
iOS/macOS, `Bradley Hand`, `Segoe Script`) puis cursive générique. **Aucune
WebFont ajoutée** — l'app est un fichier unique servi offline-first, une
dépendance CDN ne serait pas disponible hors ligne.

Tout est en `clamp()` / `%` : mobile-first, aucun palier nécessaire sous la
tablette. `prefers-reduced-motion` coupe les animations.

---

## Appliquer la migration

```bash
node scripts/apply-one.mjs supabase/migrations/20260815_001_ardoise.sql
```

Crée 4 tables + RLS anon + realtime + bucket `ardoise-proofs`. **Additive
uniquement**, idempotente de bout en bout. Rollback manuel documenté en pied de
fichier.

⚠ **La migration passe AVANT le deploy** : sans les tables, `_flushEntity` sur
une table absente ne fait qu'un `console.warn` et la synchro de l'entité cesse en
silence.

---

## Pièges à ne pas rejouer

1. **Ne jamais retirer le préfixe `x`** de `_ardPenaltyIdFor` : les dettes de
   pénalité seraient effacées au premier fetch par l'anti-wipe de PbSync.
2. **Ne jamais remplacer `parent.deadline_at` par `Date.now()`** dans la création
   de la pénalité : le déterminisme tombe, et onze appareils écrivent onze
   échéances différentes (LWW en boucle).
3. **Les bornes des CHECK sont écrites DEUX fois** — dans le bloc
   `<script type="module">` (`_ardClampInt` & co) et dans la migration. Les blocs
   `<script>` ne partagent pas leur portée. Une valeur hors bornes fait échouer
   **tout le lot d'upsert**, et un lot en échec est rejoué indéfiniment : la
   synchro de la table gèle pour toute l'équipe.
4. **`ardoiseMenuById` ne filtre pas `deletedAt`, exprès** : une dette tirée il y
   a quinze jours doit rester lisible même si le coach a depuis supprimé son
   menu.
5. **Ne pas faire expirer `done_home`** (cf. plus haut).
6. Le **système de points général** est un chantier séparé. `ardoisePointsOf()`
   est autonome et ne touche à rien d'autre : c'est le point de raccordement.
