# Playbook-BCL — Audit intégrations & design du système de notifications

> Statut : **proposition à valider** (defaults raisonnables choisis). Une fois validé,
> on implémente les phases côté app + on active les workflows n8n.

---

## 1. Audit de l'existant

### 1.1 Workflows n8n actuels
- **Aucune référence n8n / webhook dans le dépôt** (grep `n8n|webhook|gdms` → 0 résultat applicatif).
- L'instance `n8n-1.gdms.fr` n'est **pas accessible programmatiquement** depuis cet environnement
  (pas de clé API n8n, pas de connecteur/MCP n8n configuré). L'inventaire exhaustif des WFs
  *déjà déployés sur l'instance* doit donc être fait :
  - soit manuellement dans l'UI n8n (menu *Workflows*, filtrer ceux qui ciblent l'URL Supabase
    `orertxlsvkdqayybgwaq.supabase.co` ou un webhook Playbook),
  - soit en me fournissant une **clé API n8n** (Settings → n8n API) : je pourrai alors lister via
    `GET /api/v1/workflows` et auditer triggers/nœuds.
- **Conclusion** : côté Playbook, il n'existe à ce jour **aucune intégration sortante** (ni webhook,
  ni notification). Tout est à construire — terrain vierge, pas de dette.

### 1.2 Surface d'intégration disponible
| Élément | Détail |
|---|---|
| Backend | Supabase `https://orertxlsvkdqayybgwaq.supabase.co` (Postgres + Realtime + Auth) |
| Tables clés | 27 tables ; pour les notifs : `team_reviews`, `convocation_responses`, `convocations`, `matches`, `training_plans`, `player_match_feedback`, `challenge_scores`, `player_wellness_log` |
| Realtime | `postgres_changes` actif sur ~20 tables |
| Netlify Functions | 1 seule : `ffbb-scraper` (proxy CORS FFBB) |
| Service Worker | `sw.js` = **kill-switch** (vidé, aucun listener `push`) |
| Manifest PWA | présent et valide, mais pas d'offline ni de push |
| Push web | **absent** (pas de VAPID, pas de `pushManager.subscribe`) |
| Badges in-app | **absent** |

---

## 2. Événements métier candidats

| # | Événement | Émetteur | Cible | Fonction app | Table source |
|---|---|---|---|---|---|
| E1 | Ressenti bien-être équipe soumis | Joueuse | **Coach** | `saveTeamReview()` | `team_reviews` (INSERT) |
| E2 | Réponse convocation = **absente** | Joueuse | **Coach** | `saveAbsence()` | `convocation_responses` (INSERT/UPDATE) |
| E3 | Ressenti post-match soumis | Joueuse | **Coach** | `savePlayerReview()` | `player_match_feedback` (INSERT) |
| E4 | Nouvelle convocation / match publié·e | Coach | **Joueuses** | `saveConvoc()` / `saveMatch()` | `convocations` / `matches` (INSERT) |
| E5 | Plan d'entraînement **validé** | Coach | **Joueuses** | `validateTrainingPlan()` | `training_plans` (UPDATE `validated=true`) |
| E6 | Nouveau défi / score défi | Coach/Joueuse | l'autre camp | `saveChallengeScore()` | `challenge_scores` |
| E7 | Bien-être quotidien alarmant (score bas) | Joueuse | **Coach** | wellness log | `player_wellness_log` |

---

## 3. Système de notifications proposé

### 3.1 Canaux — recommandation (par ordre de priorité)
1. **In-app (badge + centre de notifs)** — *MVP, à faire en premier.*
   Aucune infra externe, fonctionne immédiatement (lecture d'une table `notifications` synchronisée
   via le moteur PbSync existant). Fiable, pas de permission navigateur.
2. **Email (via n8n)** — *Phase 2.* Idéal pour le **coach** (faible volume, pas besoin d'app ouverte).
   n8n a des nœuds SMTP/Gmail/SendGrid prêts. Déclenché par Supabase Database Webhook → n8n.
3. **Push web PWA** — *Phase 3.* Le plus engageant côté **joueuses**, mais coûteux :
   nécessite de **reconstruire le service worker** (actuellement kill-switch), générer des clés
   **VAPID**, gérer `pushManager.subscribe` + stocker les subscriptions, et un nœud n8n « Web Push ».

### 3.2 Cibles par défaut
- **Coach** : E1, E2, E3, E7 (ce que les joueuses remontent).
- **Joueuses** : E4, E5 (ce que le coach publie). E6 : les deux.

### 3.3 Architecture retenue (défaut) : **Supabase Database Webhooks → n8n**
```
[App] --persist()--> [Supabase tables]
                          |  (Database Webhook natif Supabase, INSERT/UPDATE)
                          v
                    [n8n Webhook node]  (n8n-1.gdms.fr)
                          |
              +-----------+-----------+
              v                       v
        [Email node]            [Web Push node]   (+ insert table `notifications` pour le badge in-app)
```
**Pourquoi** : zéro code client requis pour E1–E7, temps réel, découplé, rejouable, observable
dans n8n. Alternative (client POST direct vers webhook n8n) écartée : couple le front à n8n,
problèmes CORS, perd les events si l'app est fermée.

### 3.4 Table `notifications` (pour le badge in-app, Phase 1)
```sql
create table if not exists public.notifications (
  id          bigserial primary key,
  audience    text not null,              -- 'coach' | 'player' | 'all'
  player_id   text,                       -- destinataire précis (si audience='player')
  kind        text not null,              -- 'wellness' | 'absence' | 'convocation' | 'plan' ...
  title       text not null,
  body        text,
  link        text,                       -- deep-link in-app (ex: '#convoc/<id>')
  created_at  timestamptz not null default now(),
  read_by     jsonb not null default '{}'::jsonb  -- { "<playerId|coach>": true }
);
```
Synchronisée via une nouvelle entité `ENTITIES` (`key:'notifications'`, `auth:'anon'`, `realtime:true`),
badge = count des non-lues pour l'identité courante.

---

## 4. Plan d'implémentation (post-validation)

| Phase | Lot | Contenu |
|---|---|---|
| **P1** | In-app | Migration table `notifications` + entité PbSync + badge UI + centre de notifs. n8n écrit dans cette table. |
| **P2** | Email coach | Database Webhooks Supabase (E1,E2,E3,E7) → WF n8n → email. Templates fournis dans `n8n/`. |
| **P3** | Push joueuses | Reconstruire SW (push handler), VAPID, subscribe + table `push_subscriptions`, WF n8n Web Push (E4,E5). |

Les **templates n8n prêts à importer** sont dans `n8n/` (voir `n8n/README.md`).

---

## 5. Décisions par défaut (modifiables)
- **Canal prioritaire** : in-app badge (P1) puis email coach (P2). Push web en P3 (effort SW/VAPID).
- **Set d'événements initial** : E1, E2, E4, E5 (le cœur coach↔joueuses). E3/E6/E7 en extension.
- **Anti-spam** : agrégation côté n8n (ex : 1 email coach max / 15 min, digest des absences).
- **Stat'man** : jamais ciblé (rôle partagé, cf. email binding strict).

👉 **À valider** : priorité des canaux, set d'événements, et fourniture éventuelle d'une clé API n8n
pour que je puisse auditer/déployer les WFs directement sur `n8n-1.gdms.fr`.
