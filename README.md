# Playbook BCL

App tout-en-un pour le **IE-Basket Club L'Islois (D2F)** : playbook, planning,
stats, vidéos, défis, intersaison, **live score temps réel** diffusable au
public, le tout dans un seul `index.html` (vanilla JS, mobile-first).

## Architecture

- **Frontend** : `index.html` (vanilla JS, ~13k lignes, mobile-first, dark theme).
- **Backend** : [Supabase](https://supabase.com) — Postgres + Auth + Realtime.
- **Stockage offline** : `localStorage` (fallback systématique si Supabase
  indisponible).
- **FFBB scraping** : Netlify Function `netlify/functions/ffbb-scraper.js`.

## Authentification — 2 niveaux

| Niveau | Méthode                  | Donne accès à                                  |
|--------|--------------------------|------------------------------------------------|
| **L1** | PIN 4 chiffres (coach / stat / joueuse) | data équipe : matchs, planning, vidéos, live score |
| **L2** | Email + mot de passe (Supabase Auth) | data perso joueuse : retours, intersaison, sync multi-device |

Le L1 est conservé tel quel pour ne pas casser l'usage actuel. Le L2 est
**optionnel** : on ne le propose qu'à l'utilisateur qui veut ses données perso
synchronisées entre appareils.

## Live score multi-device

Le stat'man tape ses actions → elles sont :
1. Persistées en `localStorage` (offline-safe),
2. Pushées dans Supabase (`live_events`, `match_player_stats`, `matches`),
3. Diffusées en **Realtime** (publication Postgres) à tous les spectateurs
   abonnés au portail `#public`.

Côté spectateur : aucun compte requis, juste l'URL `…/#public`. La clé
publishable Supabase est hardcodée dans le HTML (elle est faite pour ça).

## Setup

### 0) Configurer `.env.local` (déjà ignoré par git)

```bash
SUPABASE_URL=https://orertxlsvkdqayybgwaq.supabase.co
SUPABASE_PROJECT_REF=orertxlsvkdqayybgwaq
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...    # OK à hardcoder, RLS-protégée
SUPABASE_SECRET_KEY=sb_secret_...              # NE JAMAIS commiter
# Pour exécuter scripts/migrate.mjs : choisir A ou B
# SUPABASE_ACCESS_TOKEN=sbp_...                # (A) PAT — recommandé
# SUPABASE_DB_URL=postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres  # (B)
```

> ⚠️ Le `sb_secret_*` (service_role) **ne suffit pas** pour exécuter du DDL via API.
> Il sert uniquement aux scripts qui lisent/écrivent dans des tables déjà créées
> (`scripts/smoke.mjs`, futurs scripts admin). Pour la migration, fournir un PAT
> (`sbp_*`, créé en 30 sec à https://app.supabase.com/account/tokens) ou l'URL DB.

### 1) Exécuter la migration SQL dans Supabase

**Trois options, choisir une seule :**

**A. Automatique — Management API (recommandé)**
```bash
# Ajouter SUPABASE_ACCESS_TOKEN=sbp_... dans .env.local, puis :
node scripts/migrate.mjs
```

**B. Automatique — connexion Postgres directe**
```bash
# Ajouter SUPABASE_DB_URL=postgresql://... dans .env.local, puis :
npm install pg
node scripts/migrate.mjs
```

**C. Manuel — SQL Editor du dashboard**
1. Aller sur https://app.supabase.com/project/orertxlsvkdqayybgwaq/sql/new
2. Coller le contenu de [`supabase/migrations/20260517_initial.sql`](supabase/migrations/20260517_initial.sql) → **Run**

### 1bis) Vérifier le déploiement

```bash
node scripts/smoke.mjs
```

Le script vérifie : 17 tables exposées par PostgREST, INSERT/SELECT/DELETE sur
`matches`, déclenchement du trigger `enforce_live_event_open_match`, RPC
`verify_pin` avec les PINs par défaut.

### 2) Activer Email/Password dans Supabase Auth

1. **Authentication → Providers** : activer **Email** (déjà activé par défaut)
2. (Optionnel) Désactiver "Confirm email" si tu veux du signup direct sans
   email de vérification — utile en démo, à réactiver pour la prod.

### 3) Tester en local

```bash
# Depuis la racine du repo :
python -m http.server 8080
# Puis ouvrir http://localhost:8080
```

Pour tester le live score multi-device en local :
- Fenêtre 1 (stat'man) : `http://localhost:8080/#stat` → PIN `1234` → ouvre un match
  → "Live public" ON
- Fenêtre 2 (spectateur) : `http://localhost:8080/#public` → tu vois le score
  se mettre à jour en temps réel à chaque tap du stat'man.

### 4) Déployer (Netlify)

Le repo est déjà configuré pour Netlify (`netlify.toml`). Le hosting du
`index.html` se fait à la racine, et la function FFBB est dans
`netlify/functions/`.

## Modifier un PIN

- **Coach / Stat'man** : depuis la console du browser (post-login) :
  ```js
  await sb.rpc('set_team_pin', { p_role: 'coach', p_new_pin: 'XXXX' });
  ```
  Ou via le menu Settings (existant).
- **Joueuse** : même menu Settings → "Changer mon code PIN".

## Sécurité

- La **clé publishable** est hardcodée et c'est OK : elle est protégée par RLS.
- La **service_role** n'est **jamais** dans le code client.
- Les PINs sont stockés en **bcrypt** (`pgcrypto`) côté serveur.
- L'écriture du score live par anon est volontairement autorisée
  (compromis "pas de friction stat'man" — c'est de la data d'équipe non
  sensible et tournée vers le partage public).

## Structure repo

```
.
├── index.html                              # App entière (vanilla JS)
├── netlify.toml                            # Build / functions / redirects
├── netlify/functions/ffbb-scraper.js       # Scraper FFBB
├── supabase/migrations/
│   └── 20260517_initial.sql                # Schéma + RLS + seed initial
├── scripts/
│   ├── migrate.mjs                         # Runner migrations (PAT ou pg)
│   └── smoke.mjs                           # Smoke test post-migration
├── MIGRATION_PLAN.md                       # Design détaillé du backend
├── Backups/index_pre_supabase_*.html       # Sauvegarde avant refacto
├── .env.local                              # Secrets locaux (gitignored)
├── .gitignore
└── README.md
```

## Documentation détaillée

Voir [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) pour le design complet
(schéma, RLS, realtime, stratégie de sync).
