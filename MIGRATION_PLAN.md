# Migration Plan — playbook-bcl → Supabase backend

> Branche : `feat/supabase-backend` (worktree `claude/quirky-pascal-a4be57`)
> Projet Supabase : `orertxlsvkdqayybgwaq` — https://orertxlsvkdqayybgwaq.supabase.co
> Clé publishable (front, hardcodable) : `sb_publishable_pJwgqWwDDhhST6xh9IbzbA_a0ANDwUt`

## Objectif

Faire évoluer playbook-bcl d'un stockage 100 % localStorage vers un backend Supabase
permettant :
- la **persistance multi-device** des données équipe (matchs, joueuses, vidéos, planning),
- le **live score temps réel** diffusé du stat'man vers les spectateurs (n'importe quel device, sans compte),
- un système d'**authentification à 2 niveaux** : PIN simple (L1) pour les usages d'équipe, compte email/password (L2) pour les données perso joueur.

L'app reste **offline-first** : si Supabase est indisponible, on retombe sur localStorage et on resynchronise au retour en ligne.

---

## 1. Modèle d'authentification

### L1 — PIN client-side (compat actuelle)
- 3 rôles : `coach`, `stat`, `player`
- PINs stockés côté serveur dans `team_pins` (coach/stat) et `players.pin_hash` (chaque joueuse). Hash bcrypt via `pgcrypto`.
- Vérification via fonction RPC `verify_pin(role, player_id, pin)` → retourne `true|false`. Cooldown exponentiel toujours géré client-side (existant) ; le cooldown serveur n'est pas répliqué pour rester simple.
- **Pas de session Supabase Auth** au niveau L1 : on reste en client `anon`. Le rôle est juste un flag JS.
- Accès lecture à toutes les tables "équipe" (matchs, planning, vidéos, classements, etc.).

### L2 — Supabase Auth email/password (optionnel, requis pour données perso)
- Méthode : `signInWithPassword` / `signUp` email + mot de passe (le plus universel, pas d'email mobile requis pour magic link).
- Au signup, on crée une ligne `profiles` liée à `auth.uid()` avec :
  - `display_name`
  - `role` (`coach` | `player`)
  - `player_id` (FK vers `players` si rôle player — la joueuse se lie à sa fiche existante)
- Le L2 **n'est demandé que** pour les écrans personnels : stats perso joueur, profil, messages (futur), paramètres compte.
- L2 inclut L1 : si tu es L2, tu as aussi le rôle équivalent au L1.

### Justification du choix email/password vs magic link
- Beaucoup de joueuses utilisent une vieille adresse perso peu consultée depuis le mobile → magic link = friction et abandons.
- Password reset = email Supabase intégré, ça suffit.

---

## 2. Portail public (`#public`)
- Pas de lien de login affiché (déjà conforme à la décision : le lien existant `→ Connexion coach / joueuse` sera caché, on ne laisse que l'accès via suppression manuelle du `#public` dans l'URL).
- Affiche : score live (Realtime), prochain match, derniers résultats, bilan saison.
- Subscribe au channel `match_live:<matchId>` pour le score temps réel.

---

## 3. Schéma Postgres (Supabase)

### Convention
- IDs : `text` pour rester compatibles avec les IDs client existants (`pl1`, `m1`, etc.) — défaut `gen_random_uuid()::text` pour les nouveaux.
- Colonnes JSON complexes : `jsonb` (quarters, recurrence, attachments, images, etc.).
- Tous les timestamps : `timestamptz`, `created_at`/`updated_at` gérés par trigger.
- Un seul "club" par déploiement (singleton) → pas de colonne `club_id`. Si multi-club un jour, on rajoutera.

### Tables

| Table                     | Contenu                                            | Realtime | Lecture L1 anon | Écriture |
|---------------------------|----------------------------------------------------|----------|-----------------|----------|
| `profiles`                | profil L2 (lié à auth.users)                       | non      | auth uniquement | propriétaire |
| `team_pins`               | PINs coach/stat (1 ligne par rôle)                 | non      | jamais (RPC)    | service_role |
| `players`                 | roster (n°, nom, photo, pin_hash)                  | non      | oui (sans pin_hash via vue) | coach L2 |
| `plays`                   | playbook (concepts, exos, ATO)                     | non      | oui             | coach L2 |
| `custom_concepts`         | concepts ajoutés par le coach                      | non      | oui             | coach L2 |
| `matches`                 | matchs (score, quarters, notes, flags live)        | **oui**  | oui             | coach L2 + stat L1 (score colonnes uniquement) |
| `match_player_stats`      | stats par match × joueuse                          | **oui**  | oui             | stat L1 / coach L2 |
| `match_feedback`          | positifs / négatifs (1 ligne / item)               | non      | oui             | coach L2 |
| `live_events`             | log événements live (append-only)                  | **oui**  | oui             | stat L1 quand match.public_live=true |
| `challenges`              | défis                                              | non      | oui             | coach L2 |
| `challenge_scores`        | scores par joueuse × challenge                     | non      | oui             | coach L2 + joueuse propriétaire L2 |
| `convocations`            | événements planning                                | non      | oui             | coach L2 |
| `convocation_responses`   | RSVP joueuses                                      | non      | oui             | joueuse L2 (sa propre réponse) + coach L2 |
| `lineups`                 | lineups enregistrées                               | non      | oui             | coach L2 |
| `ffbb_config`             | URL club + cache FFBB                              | non      | oui             | coach L2 |
| `team_reviews`            | retours bien-être joueuse (perso)                  | non      | propriétaire L2 | propriétaire L2 + coach L2 |
| `offseason_program`       | programme intersaison                              | non      | oui             | coach L2 |
| `offseason_logs`          | logs perso d'intersaison                           | non      | propriétaire L2 | propriétaire L2 |

### RLS — règles synthétiques
- Toutes les tables ont **RLS activée**.
- **Lecture publique (`anon` + `authenticated`)** pour le data partagé : `plays`, `players` (vue sans hash), `matches`, `match_player_stats`, `match_feedback`, `live_events`, `challenges`, `challenge_scores`, `convocations`, `convocation_responses`, `lineups`, `ffbb_config`, `custom_concepts`, `offseason_program`.
- **Écriture restreinte L2 coach** pour : `plays`, `custom_concepts`, `matches` (sauf cas live), `match_feedback`, `players`, `challenges`, `convocations`, `lineups`, `ffbb_config`, `offseason_program`.
- **Écriture anon autorisée — uniquement pour le live score** :
  - `live_events` : INSERT autorisé si la ligne `matches` ciblée a `public_live = true`.
  - `matches` : UPDATE autorisé sur les colonnes `score_us`, `score_opp`, `last_live_update` si `public_live = true`.
  - `match_player_stats` : INSERT/UPDATE autorisé si `matches.public_live = true`.
  - C'est le compromis pragmatique pour que le stat'man (L1) puisse pousser le score sans compte. Le risque résiduel (un visiteur du portail public pourrait falsifier le score) est accepté — c'est un projet d'équipe interne, le PIN stat'man reste sur le client.
- **Personal data (L2 only)** : `team_reviews`, `offseason_logs`, `profiles`, `challenge_scores` (UPDATE par joueuse).

### Realtime
- Activé sur `matches`, `match_player_stats`, `live_events` via `alter publication supabase_realtime add table ...`.
- Client subscribe : `supabase.channel('match-live').on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'public_live=eq.true' }, …)` + idem sur `live_events`.

### Triggers
- `set_updated_at()` : met à jour `updated_at` à chaque UPDATE.
- `enforce_live_event_open_match()` : refuse INSERT dans `live_events` si le match n'est pas en live public.
- Tous les schemas exposent `updated_at` pour la sync incrémentale future.

---

## 4. Stratégie de sync localStorage ↔ Supabase

Une couche d'abstraction `window.PbStore` (injectée inline dans `index.html`) :
- **Lecture** : retourne d'abord la valeur localStorage (sync), puis lance un fetch Supabase qui re-render à la réception.
- **Écriture** : écrit localStorage + push vers Supabase (best-effort, retry simple). Si offline, on flag dirty et on resynchronise au prochain online.
- **Realtime** : sur `matches`, `match_player_stats`, `live_events` → met à jour `state` + re-render.

**Stratégie d'ordre** : last-write-wins par `updated_at`. Pas de CRDT, pas de merge complexe (équipe de < 15 personnes, conflits rarissimes).

**Migration douce** : au premier login L2, on push tout le localStorage existant vers Supabase (one-shot). Les utilisateurs L1 continuent en local jusqu'à ce qu'un coach L2 sync les données équipe.

---

## 5. Architecture realtime live score

```
stat'man (L1)                                   spectateur (#public)
─────────────                                   ────────────────────
liveActionFor()                                 subscribe('match-live')
  ↓                                                       ↑
  upsert match_player_stats (Supabase)         ←─ postgres_changes (table=match_player_stats)
  update matches.score_us/score_opp           ←─ postgres_changes (table=matches)
  insert live_events                          ←─ postgres_changes (table=live_events)
  ↓
  localStorage (fallback)
```

Le spectateur n'a besoin d'aucun compte ; la clé publishable suffit.

---

## 6. Plan d'application des migrations

L'utilisateur doit exécuter manuellement, dans cet ordre :
1. Aller sur https://app.supabase.com/project/orertxlsvkdqayybgwaq/sql/new
2. Coller le contenu de `supabase/migrations/20260517_initial.sql` → **Run**
3. Vérifier dans **Database → Tables** que les 17 tables sont créées
4. Vérifier dans **Database → Replication** que `matches`, `match_player_stats`, `live_events` sont dans la publication `supabase_realtime`
5. (Optionnel) Créer un premier compte coach via **Authentication → Add user** ou via le formulaire signup de l'app

---

## 7. Garde-fous & limites connues

- **PINs au plain text dans le seed** : le SQL initial seed les PINs par défaut (`1234` coach/stat, `0000` joueuses) en hash bcrypt. Les coachs peuvent les modifier ensuite via l'app.
- **Pas de service_role utilisée côté client** : on ne stocke jamais cette clé, on ne l'expose jamais.
- **Live score : pas d'auth forte** — décision assumée. Si abus, on rajoutera un `live_token` par session.
- **Sync localStorage → Supabase** : limitée au push initial L2. Pas de delta sync sophistiqué dans cette V1.
- **FFBB scraping** : reste piloté par la Netlify Function, on enregistre juste le résultat dans `ffbb_config`.

---

## 8. Livrables

- ✅ `MIGRATION_PLAN.md` (ce fichier)
- ✅ `supabase/migrations/20260517_initial.sql`
- ✅ `index.html` patché avec couche Supabase + auth L2 + realtime
- ✅ `README.md` (instructions setup)
- ✅ `.gitignore` (exclut `.env`, `node_modules`)
- ✅ `Backups/index_pre_supabase_<timestamp>.html`

