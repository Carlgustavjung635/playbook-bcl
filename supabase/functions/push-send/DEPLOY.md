# Déploiement de l'Edge Function `push-send` (Phase 2 notifications push)

La migration `push_subscriptions` est **déjà appliquée** en prod. Côté front, tout
est livré et **dégrade silencieusement** tant que la fonction n'est pas déployée
(les appels `notifyPush` échouent en silence, aucune casse). Pour activer la
livraison réelle des push, **3 commandes** (Supabase CLI, une seule fois) :

```bash
# 1) Lier le projet (si pas déjà fait)
supabase link --project-ref orertxlsvkdqayybgwaq

# 2) Secrets VAPID (clé privée = NE PAS committer). La clé PUBLIQUE est déjà
#    embarquée dans index.html (VAPID_PUBLIC_KEY). Doivent former la MÊME paire.
supabase secrets set \
  VAPID_PUBLIC_KEY="BMVoXX7h2iTGcH6QUFwL97JMNq48wXeHOOU8agVlCTBjiNvnjVYJsS_T-36HUdrSUX0v-DgXIMjvG5T_A7e9ukk" \
  VAPID_PRIVATE_KEY="Squt1BZq8cL-ypGrQTqwRoMNfzssq-gunc7KxESwhs4" \
  VAPID_SUBJECT="mailto:coach@playbook-bcl.app" \
  PROJECT_URL="https://orertxlsvkdqayybgwaq.supabase.co" \
  SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY du projet>"

# 3) Déployer la fonction (sans vérif JWT : l'app appelle avec la clé anon)
supabase functions deploy push-send --no-verify-jwt
```

Vérif : `supabase functions list` doit montrer `push-send` ACTIVE. Test rapide :
opter pour les notifs sur 2 devices (1 coach, 1 joueuse), envoyer un message →
la joueuse reçoit la bannière + badge.

> ⚠️ Si la clé privée doit être régénérée, regénère AUSSI la publique embarquée
> (`web-push generate-vapid-keys` ou `crypto`), et redéploie le front.

## Rollback SW (si incident)
Dans `index.html`, passer `window.__PUSH_KILL__ = true` puis bump version +
redéployer : au prochain load, le `push-sw` est désenregistré pour tous (retour
à 0 SW). Aucune dépendance au déploiement de la fonction.
