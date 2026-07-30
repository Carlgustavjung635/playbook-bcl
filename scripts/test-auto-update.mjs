// Test du détecteur de mise à jour (anti-staleness PWA). Reproduit la logique de
// checkForUpdate de index.html : comparaison APP_VERSION (embarquée) vs
// /version.json (servie), throttle, et déclenchement du bandeau.
import assert from 'node:assert';

// --- modèle fidèle de checkForUpdate (fetch + throttle injectables) ---
// v.92 : au RETOUR AU PREMIER PLAN, une version périmée déclenche un
// rechargement AUTOMATIQUE (une seule tentative par session), et fermer le
// bandeau ne fait que le repousser. Le bandeau seul ne suffisait pas : il
// fallait le remarquer puis le taper, et le ✕ le supprimait jusqu'à la fin de
// la session — une PWA n'étant jamais vraiment fermée, des correctifs déployés
// n'étaient jamais exécutés par l'appareil.
function makeChecker(APP_VERSION) {
  const st = { bannerShown: false, lastCheck: 0, fetchCount: 0, reloads: 0, autoTried: false, modalOpen: false };
  async function checkForUpdate(opts, remoteVersion, now, ok = true) {
    opts = opts || {};
    if (st.bannerShown) return;
    if (!opts.force && now - st.lastCheck < 60000) return; // throttle 1/min
    st.lastCheck = now;
    st.fetchCount++;
    if (!ok) return;                       // réponse non-ok → ignore
    const remote = remoteVersion;
    if (!remote || remote === APP_VERSION) return;
    if (opts.foreground && !st.autoTried && !st.modalOpen) {
      st.autoTried = true;
      st.reloads++;
      return;
    }
    st.bannerShown = true;
  }
  function dismissUpdateBanner(now) {
    st.bannerShown = false;
    st.lastCheck = now;
  }
  return { st, checkForUpdate, dismissUpdateBanner };
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

console.log('SCÉNARIO 6 — retour au 1er plan : rechargement AUTOMATIQUE');
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('version périmée + foreground → recharge sans rien demander', async () => {
    await checkForUpdate({ foreground: true }, 'v2', 100000);
    assert.strictEqual(st.reloads, 1);
    assert.strictEqual(st.bannerShown, false, 'un bandeau a été affiché au lieu de recharger');
  });
}
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('même version → aucun rechargement', async () => {
    await checkForUpdate({ foreground: true }, 'v1', 100000);
    assert.strictEqual(st.reloads, 0);
  });
}
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('UNE SEULE tentative auto par session (anti-boucle si le HTML reste périmé)', async () => {
    await checkForUpdate({ foreground: true }, 'v2', 100000);
    assert.strictEqual(st.reloads, 1);
    // Le rechargement n'a rien changé (CDN en retard) : on ne réessaie pas.
    await checkForUpdate({ foreground: true }, 'v2', 400000);
    assert.strictEqual(st.reloads, 1, 'boucle de rechargement');
    assert.strictEqual(st.bannerShown, true, 'après l\'essai auto, on doit retomber sur le bandeau');
  });
}
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('une modale ouverte empêche le rechargement (on ne coupe pas une saisie)', async () => {
    st.modalOpen = true;
    await checkForUpdate({ foreground: true }, 'v2', 100000);
    assert.strictEqual(st.reloads, 0);
    assert.strictEqual(st.bannerShown, true, 'ni rechargement ni bandeau : la mise à jour est perdue');
  });
}
{
  const { st, checkForUpdate } = makeChecker('v1');
  await t('un check ordinaire (pas foreground) ne recharge jamais', async () => {
    await checkForUpdate({ force: true }, 'v2', 100000);
    assert.strictEqual(st.reloads, 0);
    assert.strictEqual(st.bannerShown, true);
  });
}

console.log('SCÉNARIO 7 — fermer le bandeau le REPOUSSE, ne l\'annule pas');
{
  const { st, checkForUpdate, dismissUpdateBanner } = makeChecker('v1');
  await t('après un ✕, un check ultérieur peut le réafficher', async () => {
    await checkForUpdate({ force: true }, 'v2', 100000);
    assert.strictEqual(st.bannerShown, true);
    dismissUpdateBanner(1000);
    assert.strictEqual(st.bannerShown, false);
    await checkForUpdate({}, 'v2', 100000 + 61000);   // après le throttle
    assert.strictEqual(st.bannerShown, true, 'le ✕ a supprimé la mise à jour pour toute la session');
  });
  await t('le ✕ respecte quand même le throttle d\'une minute', async () => {
    const { st: s2, checkForUpdate: c2, dismissUpdateBanner: d2 } = makeChecker('v1');
    await c2({ force: true }, 'v2', 100000);
    d2(100000);
    await c2({}, 'v2', 100500);                        // trop tôt
    assert.strictEqual(s2.bannerShown, false, 'le bandeau revient en boucle');
  });
}

console.log(`\n✅ ${pass} assertions OK — détecteur de mise à jour (version, throttle, robustesse, auto-reload).`);
