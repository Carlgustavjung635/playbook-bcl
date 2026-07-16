# Smoke navigateur — mode « joueuse test » (PR #149)

Procédure exécutée sur la preview `deploy-preview-149--playbook-bcl.netlify.app`
(`.75`), pilotée via `javascript_tool`. Ce n'est PAS un test automatisé (il faut
un navigateur réel + la vraie base) : c'est la trace reproductible de ce qui a
été vérifié à la main. Le test automatisé équivalent est
`test-coach-test-player-mode.mjs` (vm à DOM stubé).

Pourquoi un smoke navigateur EN PLUS du test vm : le test unitaire prouve
qu'aucune écriture ne part *à travers les stubs qu'il contrôle*. Le smoke prouve
qu'aucune écriture ne part **réellement sur le réseau**, sur le vrai client
Supabase, contre la vraie base — c'est la seule preuve que le Proxy sur
`window.sb` et le drapeau `window.__PB_TEST_MODE__` du bloc `<script
type="module">` fonctionnent ensemble en conditions réelles.

## Instrumentation

Wrapper `window.fetch` pour compter les écritures réseau (tout ce qui n'est ni
GET ni HEAD vers `/rest/v1/`, `/storage/v1/object`, `/functions/v1/push-send`).
Compter les lignes des tables avant/après via des lectures.

## Étapes vérifiées (toutes ✓)

1. **Boot** : `__tmGuardOn` true (Proxy sb installé), API mode test présente.
2. **Entrée** : `openTestModeModal` → nom/poste/taille → `enterTestMode` →
   `_isTestMode()` true, `__PB_TEST_MODE__` true, ghost = `currentPlayer()` et
   absente de `state.players`, bandeau dans le DOM.
3. **Zéro écriture réseau** par tous les chemins :
   - `persist()` (completion fantôme injectée) → ni localStorage ni réseau
   - `sb.from().insert/upsert/delete` → neutralisés, forme `{data:null,error:null}`
   - `Storage.upload` → neutralisé ; `getPublicUrl` passe
   - `notifyPush` → aucun POST `push-send`
   - **lectures `select()` passent** → la ghost voit le vrai contenu
4. **Navigation** : home/plays/challenges/match/calendrier rendent avec le
   bandeau, toujours zéro écriture.
5. **Base prod inchangée** : mêmes comptes avant/après ; aucune ligne fantôme
   (`xGHOSTQA`/`xDIRECT`) en base.
6. **Sortie propre** : `pb8_auth` en localStorage = `null` (entrer en test
   n'écrit rien) → un reload ramène au login, pas de ghost ressuscitable.
7. **UI** : `.test-banner` stylé (fond `rgb(194,65,12)`, flex, bouton cliquable) ;
   bouton « mode joueuse test » présent sur le PIN **coach** uniquement (absent
   du PIN joueuse et du choix de rôle) ; console sans erreur.
