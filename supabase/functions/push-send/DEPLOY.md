# Edge Function `push-send` (Phase 2 notifications push) — état & maintenance

## État (déployé ✅)
- **Fonction déployée** en prod : `push-send` (mode `--no-verify-jwt`, l'app appelle avec la clé anon).
  Endpoint : `https://orertxlsvkdqayybgwaq.supabase.co/functions/v1/push-send`
- **Secrets posés** (`supabase secrets set`) : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` sont **auto-injectés** par la plateforme
  (la fonction les lit en repli de `PROJECT_URL` / `SERVICE_ROLE_KEY`).
- **Clé publique VAPID** correspondante embarquée dans `index.html` (`VAPID_PUBLIC_KEY`).
  La **clé privée n'est PAS dans le repo** (uniquement secret Supabase).
- Migration `push_subscriptions` appliquée.

Vérif déploiement (dry-run, doit renvoyer `{"ok":true,"sent":0,...}` HTTP 200) :
```bash
curl -s -X POST "https://orertxlsvkdqayybgwaq.supabase.co/functions/v1/push-send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_PUBLISHABLE_KEY>" \
  -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" \
  -d '{"ownerKeys":["coach:-__dryrun__"],"payload":{"title":"test"}}'
```

## Re-déployer / mettre à jour la fonction
```bash
export SUPABASE_ACCESS_TOKEN=<PAT>
npx supabase functions deploy push-send --no-verify-jwt --project-ref orertxlsvkdqayybgwaq --use-api
```

## Rotation des clés VAPID (si besoin)
```bash
# 1) générer une paire (web-push generate-vapid-keys, ou crypto P-256)
# 2) mettre la PUBLIQUE dans index.html (VAPID_PUBLIC_KEY) + redéployer le front
# 3) poser la paire en secret (la privée NE VA PAS dans le repo) :
export SUPABASE_ACCESS_TOKEN=<PAT>
npx supabase secrets set VAPID_PUBLIC_KEY="<pub>" VAPID_PRIVATE_KEY="<priv set via supabase secrets>" \
  VAPID_SUBJECT="mailto:coach@playbook-bcl.app" --project-ref orertxlsvkdqayybgwaq
# 4) redéployer la fonction (cf. ci-dessus)
# Note : après rotation, les abonnements existants restent valides (la paire ne
# change pas l'endpoint), mais par sécurité les clients ré-souscrivent à l'opt-in.
```

## Rollback SW (si incident de chargement)
Dans `index.html` : `window.__PUSH_KILL__ = true` → bump version → redéployer le front.
Au prochain load, le `push-sw` est désenregistré pour tous (retour à 0 SW).
Indépendant de l'Edge Function.
