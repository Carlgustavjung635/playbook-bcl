// Test du pull-to-refresh custom (PWA standalone). Reproduit fidèlement la
// logique de gating + seuil + invocation sync de index.html, sans DOM (modèle
// pur du state-machine du geste).
import assert from 'node:assert';

const PTR_THRESHOLD = 80;

// --- SUJET (extrait fidèle de index.html) ---
function ptrShouldActivate(env) {
  env = env || {};
  return !!(env.standaloneMedia || env.iosStandalone);
}
function ptrArmed(dy, threshold) { return dy >= (threshold || PTR_THRESHOLD); }

// Modèle du geste : reproduit touchstart→touchmove→touchend + le gating
// d'initialisation. Renvoie ce qui s'est passé + nb d'appels refresh.
function simulateGesture({ env, scrollTopAtStart, dyMax }) {
  let refreshCount = 0;
  const refresh = () => { refreshCount++; };
  // init : on n'attache les listeners QUE si standalone
  const activated = ptrShouldActivate(env);
  if (!activated) return { activated: false, pulled: false, refreshCount };
  // touchstart : ne s'amorce que tout en haut (scrollTop ~0)
  if (scrollTopAtStart > 2) return { activated: true, pulled: false, refreshCount };
  // touchmove : tirage vers le bas uniquement
  const pulled = dyMax > 0;
  // touchend : déclenche si armé
  if (pulled && ptrArmed(dyMax)) refresh();
  return { activated: true, pulled, refreshCount };
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — gating : navigateur classique → pas d\'activation, pas de refresh');
t('ni display-mode standalone ni iosStandalone → non activé', () => {
  assert.strictEqual(ptrShouldActivate({ standaloneMedia: false, iosStandalone: false }), false);
});
t('même un grand tirage ne déclenche rien en navigateur', () => {
  const r = simulateGesture({ env: { standaloneMedia: false }, scrollTopAtStart: 0, dyMax: 300 });
  assert.strictEqual(r.activated, false);
  assert.strictEqual(r.refreshCount, 0);
});

console.log('SCÉNARIO 2 — activation en PWA standalone (2 détections)');
t('display-mode: standalone → activé', () => assert.strictEqual(ptrShouldActivate({ standaloneMedia: true }), true));
t('navigator.standalone (iOS) → activé', () => assert.strictEqual(ptrShouldActivate({ iosStandalone: true }), true));

console.log('SCÉNARIO 3 — seuil de déclenchement');
t('tirage sous le seuil (79px) → pas de refresh', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dyMax: 79 });
  assert.strictEqual(r.refreshCount, 0);
});
t('tirage au seuil (80px) → refresh déclenché', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dyMax: 80 });
  assert.strictEqual(r.refreshCount, 1);
});
t('ptrArmed est strict sur le seuil', () => {
  assert.strictEqual(ptrArmed(79), false);
  assert.strictEqual(ptrArmed(80), true);
  assert.strictEqual(ptrArmed(200), true);
});

console.log('SCÉNARIO 4 — garde-fous : pas en haut / tirage vers le haut');
t('scrollTop > 0 au départ → pas de pull (laisse scroller)', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 120, dyMax: 200 });
  assert.strictEqual(r.pulled, false);
  assert.strictEqual(r.refreshCount, 0);
});
t('tirage vers le haut (dy <= 0) → pas de refresh', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dyMax: -50 });
  assert.strictEqual(r.refreshCount, 0);
});

console.log(`\n✅ ${pass} assertions OK — pull-to-refresh gaté standalone, seuil ${PTR_THRESHOLD}px, sync invoquée.`);
