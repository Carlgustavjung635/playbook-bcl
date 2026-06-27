// Test du détecteur de mise à jour (anti-staleness PWA). Reproduit la logique de
// checkForUpdate de index.html : comparaison APP_VERSION (embarquée) vs
// /version.json (servie), throttle, et déclenchement du bandeau.
import assert from 'node:assert';

// --- modèle fidèle de checkForUpdate (fetch + throttle injectables) ---
function makeChecker(APP_VERSION) {
  const st = { bannerShown: false, lastCheck: 0, fetchCount: 0 };
  async function checkForUpdate(opts, remoteVersion, now, ok = true) {
    opts = opts || {};
    if (st.bannerShown) return;
    if (!opts.force && now - st.lastCheck < 60000) return; // throttle 1/min
    st.lastCheck = now;
    st.fetchCount++;
    if (!ok) return;                       // réponse non-ok → ignore
    const remote = remoteVersion;
    if (remote && remote !== APP_VERSION) st.bannerShown = true;
  }
  return { st, checkForUpdate };
}

let pass = 0;
function t(name, fn) { return Promise.resolve(fn()).then(() => { pass++; console.log('  ✓', name); }); }

console.log('SCÉNARIO 1 — version identique → pas de bandeau');
{
  const { st, checkForUpdate } = makeChecker('2026-06-28.1');
  await t('même version → rien', async () => {
    await checkForUpdate({ force: true }, '2026-06-28.1', 1000);
    assert.strictEqual(st.bannerShown, false);
  });
}

console.log('SCÉNARIO 2 — version distante différente → bandeau affiché');
{
  const { st, checkForUpdate } = makeChecker('2026-06-28.1');
  await t('nouvelle version déployée → bannerShown=true', async () => {
    await checkForUpdate({ force: true }, '2026-06-28.2', 1000);
    assert.strictEqual(st.bannerShown, true);
  });
}

console.log('SCÉNARIO 3 — throttle hors pull-to-refresh (1/min)');
{
  const T = 1_700_000_000_000; // epoch réaliste (lastCheck=0 → 1er check passe)
  const { st, checkForUpdate } = makeChecker('v1');
  await t('2 checks rapprochés non forcés → 1 seul fetch', async () => {
    await checkForUpdate({}, 'v1', T);
    await checkForUpdate({}, 'v1', T + 1500); // < 60s après → throttlé
    assert.strictEqual(st.fetchCount, 1);
  });
  await t('force=true ignore le throttle', async () => {
    await checkForUpdate({ force: true }, 'v1', T + 1600);
    assert.strictEqual(st.fetchCount, 2);
  });
}

console.log('SCÉNARIO 4 — robustesse : réponse non-ok / version absente → pas de bandeau');
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('fetch !ok → pas de bandeau', async () => {
    await checkForUpdate({ force: true }, 'v2', 1000, /*ok*/ false);
    assert.strictEqual(st.bannerShown, false);
  });
  await t('version distante vide → pas de bandeau', async () => {
    await checkForUpdate({ force: true }, '', 2000);
    assert.strictEqual(st.bannerShown, false);
  });
}

console.log('SCÉNARIO 5 — une fois le bandeau affiché, on ne re-check plus');
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('bannerShown bloque les checks suivants', async () => {
    await checkForUpdate({ force: true }, 'v2', 1000); // → banner
    const before = st.fetchCount;
    await checkForUpdate({ force: true }, 'v3', 2000); // ignoré
    assert.strictEqual(st.fetchCount, before);
  });
}

console.log(`\n✅ ${pass} assertions OK — détecteur de mise à jour (version, throttle, robustesse).`);
