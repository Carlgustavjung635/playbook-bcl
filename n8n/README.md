# Workflows n8n — Playbook-BCL (notifications)

Templates **prêts à importer** dans `n8n-1.gdms.fr`. Architecture : **Supabase Database
Webhooks → n8n Webhook node** (cf. `../NOTIFICATIONS_DESIGN.md`).

## Import
1. n8n → *Workflows* → *Import from File* → choisir un `.json` de ce dossier.
2. Ouvrir le node **Webhook**, copier l'URL de production (`https://n8n-1.gdms.fr/webhook/<path>`).
3. Renseigner les **credentials** manquants (SMTP/Gmail pour l'email ; Header Auth pour le secret
   partagé ; Supabase pour l'insert in-app).
4. Activer le workflow (toggle *Active*).

## Câblage Supabase → n8n (côté Supabase, à faire une fois)
Supabase Studio → *Database* → *Webhooks* → *Create a new hook* :
- **Table** : `team_reviews` (E1), `convocation_responses` (E2), `player_match_feedback` (E3),
  `player_wellness_log` (E7), `convocations`/`matches` (E4), `training_plans` (E5).
- **Events** : `INSERT` (et `UPDATE` pour E2/E5).
- **Type** : HTTP Request → **URL = l'URL Webhook n8n** copiée à l'étape 2.
- **HTTP Headers** : `x-pb-secret: <le même secret que dans le node Webhook>` (anti-abus).

Supabase POSTe alors `{ type, table, record, old_record, schema }` à n8n à chaque événement.

## Fichiers
| Fichier | Rôle | Phase |
|---|---|---|
| `wf-supabase-to-coach-email.json` | Joueuse → email coach (E1/E2/E3/E7), routé par `table` | P2 |
| `wf-supabase-to-inapp-notification.json` | Tout événement → insert table `notifications` (badge in-app) | P1 |

> Le secret `x-pb-secret` est un placeholder `CHANGE_ME_SHARED_SECRET` — remplace-le par une vraie
> valeur identique côté Supabase webhook et côté node Webhook (Header Auth) avant activation.
