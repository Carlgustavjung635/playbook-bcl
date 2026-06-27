// Test du pull-to-refresh custom (PWA standalone). Reproduit fidèlement la
// logique de gating + garde-fous anti-déclenchement accidentel de index.html,
// sans DOM (modèle pur du state-machine du geste).
import assert from 'node:assert';

const PTR_SHOW = 45;
const PTR_THRESHOLD = 120;
const PTR_COOLDOWN_MS = 3000;

// --- SUJET (extrait fidèle de index.html) ---
function ptrShouldActivate(env) {
  env = env || {};
  return !!(env.standaloneMedia || env.iosStandalone);
}
function ptrArmed(dy, threshold) { return dy >= (threshold || PTR_THRESHOLD); }
function ptrVertical(dx, dy) { return dy > 0 && Math.abs(dx) <= dy * 0.5; }
function ptrShouldCommit(dy, dx, sinceLastMs) {
  return ptrArmed(dy) && ptrVertical(dx, dy) && sinceLastMs >= PTR_COOLDOWN_MS;
}
// L'indicateur s'affiche-t-il (pull engagé) ?
function ptrEngaged(dx, dy) { return ptrVertical(dx, dy) && dy >= PTR_SHOW; }

// Modèle du geste complet : gating + engagement indicateur + commit.
function simulateGesture({ env, scrollTopAtStart, dy, dx = 0, sinceLast = 99999 }) {
  let refreshCount = 0;
  const activated = ptrShouldActivate(env);
  if (!activated) return { activated: false, engaged: false, refreshCount };
  if (scrollTopAtStart > 2) return { activated: true, engaged: false, refreshCount };
  const engaged = ptrEngaged(dx, dy);
  if (ptrShouldCommit(dy, dx, sinceLast)) refreshCount++;
  return { activated: true, engaged, refreshCount };
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — gating : navigateur classique → rien');
t('ni standalone ni iOS → non activé', () => assert.strictEqual(ptrShouldActivate({}), false));
t('grand tirage en navigateur → aucun refresh', () => {
  const r = simulateGesture({ env: {}, scrollTopAtStart: 0, dy: 300 });
  assert.strictEqual(r.activated, false);
  assert.strictEqual(r.refreshCount, 0);
});

console.log('SCÉNARIO 2 — activation en PWA standalone');
t('display-mode standalone → activé', () => assert.strictEqual(ptrShouldActivate({ standaloneMedia: true }), true));
t('navigator.standalone iOS → activé', () => assert.strictEqual(ptrShouldActivate({ iosStandalone: true }), true));

console.log('SCÉNARIO 3 — seuil franc (120px) + zone morte indicateur (45px)');
t('petit scroll 40px → PAS d\'indicateur, PAS de refresh (régression corrigée)', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 40 });
  assert.strictEqual(r.engaged, false, 'indicateur masqué sous 45px');
  assert.strictEqual(r.refreshCount, 0);
});
t('tirage 60px → indicateur visible mais PAS armé (sous 120) → pas de refresh', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 60 });
  assert.strictEqual(r.engaged, true);
  assert.strictEqual(r.refreshCount, 0);
});
t('tirage 119px → pas de refresh ; 120px → refresh', () => {
  assert.strictEqual(ptrArmed(119), false);
  assert.strictEqual(ptrArmed(120), true);
  assert.strictEqual(simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 130 }).refreshCount, 1);
});

console.log('SCÉNARIO 4 — quasi-vertical requis (anti swipe diagonal)');
t('geste diagonal (dx=80, dy=130) → abort (|dx|>dy/2)', () => {
  assert.strictEqual(ptrVertical(80, 130), false);
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 130, dx: 80 });
  assert.strictEqual(r.engaged, false);
  assert.strictEqual(r.refreshCount, 0);
});
t('geste quasi-vertical (dx=30, dy=130) → OK', () => {
  assert.strictEqual(ptrVertical(30, 130), true);
  assert.strictEqual(simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 130, dx: 30 }).refreshCount, 1);
});

console.log('SCÉNARIO 5 — cooldown 3s (anti double-déclenchement)');
t('refresh < 3s après le précédent → ignoré', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 150, sinceLast: 1200 });
  assert.strictEqual(r.refreshCount, 0);
});
t('refresh > 3s après → autorisé', () => {
  const r = simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: 150, sinceLast: 3500 });
  assert.strictEqual(r.refreshCount, 1);
});

console.log('SCÉNARIO 6 — garde-fous historiques conservés');
t('scrollTop > 2 → pas de pull', () => {
  assert.strictEqual(simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 120, dy: 200 }).refreshCount, 0);
});
t('tirage vers le haut (dy<=0) → rien', () => {
  assert.strictEqual(ptrVertical(0, -50), false);
  assert.strictEqual(simulateGesture({ env: { standaloneMedia: true }, scrollTopAtStart: 0, dy: -50 }).refreshCount, 0);
});

console.log(`\n✅ ${pass} assertions OK — pull durci (seuil ${PTR_THRESHOLD}px, zone morte ${PTR_SHOW}px, vertical, cooldown ${PTR_COOLDOWN_MS}ms).`);
