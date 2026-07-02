// Test de la dernière connexion joueuse (lastSeenAt).
// Correctif : le tampon ne se déclenchait qu'au login/boot → une PWA installée
// restant connectée ne rafraîchissait jamais la date. Fix : touch au retour au
// premier plan (throttlé), force au login/boot. Exécute les vraies fonctions.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// Bloc contenant let _lastSeenTouchAt + _touchCurrentPlayerLastSeen +
// _ensureLastSeenForegroundTouch + _lastSeenBadge.
const block = html.slice(html.indexOf('let _lastSeenTouchAt = 0;'), html.indexOf('function _initPlayersSync'));

function makeEnv({ role = 'player', pid = 'p1', lastSeenAt = 1000 } = {}) {
  const env = { touched: [], saved: 0, listeners: {}, visibility: 'visible' };
  const players = [{ id: 'p1', lastSeenAt }];
  const state = { auth: { role, playerId: pid }, players };
  const PbStore = { touchLastSeen: id => { env.touched.push(id); return Promise.resolve(); } };
  // window.PbStore sert de gate dans le code (if (window.PbStore) ...).
  const win = { _lastSeenFgBound: false, PbStore, addEventListener: (ev, h) => { env.listeners[ev] = h; } };
  const doc = { addEventListener: (ev, h) => { env.listeners[ev] = h; }, get visibilityState() { return env.visibility; } };
  const api = new Function('state', 'save', 'K', 'window', 'document', 'PbStore',
    block + '\nreturn { _touchCurrentPlayerLastSeen, _ensureLastSeenForegroundTouch, _lastSeenBadge };'
  )(state, () => { env.saved++; }, { players: 'pb8_players' }, win, doc, PbStore);
  return { api, env, state, players, win, doc };
}

console.log('SCÉNARIO 1 — force (login/boot) : maj + push serveur');
{
  const { api, env, players } = makeEnv({ lastSeenAt: 1000 });
  api._touchCurrentPlayerLastSeen(true);
  t('lastSeenAt mis à jour (> ancienne valeur) + save + push', () => {
    assert.ok(players[0].lastSeenAt > 1000);
    assert.ok(env.saved >= 1);
    assert.deepStrictEqual(env.touched, ['p1']);
  });
  t('force bypass le throttle (2e appel force → 2e push)', () => {
    api._touchCurrentPlayerLastSeen(true);
    assert.strictEqual(env.touched.length, 2);
  });
}

console.log('SCÉNARIO 2 — throttle : non-force juste après = no-op');
{
  const { api, env, players } = makeEnv({ lastSeenAt: 1000 });
  api._touchCurrentPlayerLastSeen(true);        // pose le throttle
  const after = players[0].lastSeenAt;
  env.touched = []; env.saved = 0;
  api._touchCurrentPlayerLastSeen(false);       // dans les 5 min → ignoré
  api._touchCurrentPlayerLastSeen(false);
  t('aucun push ni changement dans la fenêtre de throttle', () => {
    assert.strictEqual(env.touched.length, 0);
    assert.strictEqual(env.saved, 0);
    assert.strictEqual(players[0].lastSeenAt, after);
  });
}

console.log('SCÉNARIO 3 — gating rôle : coach / stat / non-loggé = no-op');
for (const role of ['coach', 'stat']) {
  const { api, env, players } = makeEnv({ role, lastSeenAt: 5 });
  api._touchCurrentPlayerLastSeen(true);
  t(`${role} → aucun tampon`, () => { assert.strictEqual(env.touched.length, 0); assert.strictEqual(players[0].lastSeenAt, 5); });
}

console.log('SCÉNARIO 4 — retour au premier plan : listener installé + touch throttlé');
{
  const { api, env, players } = makeEnv({ lastSeenAt: 1000 });
  api._ensureLastSeenForegroundTouch();
  t('listeners visibilitychange + focus enregistrés', () => {
    assert.ok(typeof env.listeners.visibilitychange === 'function');
    assert.ok(typeof env.listeners.focus === 'function');
  });
  t('devenir visible → tampon (1er passage, throttle vierge)', () => {
    env.visibility = 'visible';
    env.listeners.visibilitychange();
    assert.deepStrictEqual(env.touched, ['p1']);
    assert.ok(players[0].lastSeenAt > 1000);
  });
  t('onglet caché (hidden) → pas de tampon', () => {
    env.touched = [];
    env.visibility = 'hidden';
    env.listeners.visibilitychange();
    assert.strictEqual(env.touched.length, 0);
  });
}

console.log('SCÉNARIO 5 — _lastSeenBadge : formatage (non-régression)');
{
  const { api } = makeEnv();
  const b = api._lastSeenBadge;
  const now = Date.now();
  t('null → « jamais vue » rouge', () => { const r = b(null); assert.strictEqual(r.label, 'jamais vue'); assert.ok(/red/.test(r.color)); });
  t('< 24h → vert « vue aujourd\'hui »', () => { const r = b(now - 2 * 3600000); assert.ok(/green/.test(r.color)); assert.strictEqual(r.label, "vue aujourd'hui"); });
  t('2 jours → orange « il y a 2j »', () => { const r = b(now - 2 * 24 * 3600000); assert.ok(/orange/.test(r.color)); assert.strictEqual(r.label, 'vue il y a 2j'); });
  t('10 jours → rouge « il y a 1 sem »', () => { const r = b(now - 10 * 24 * 3600000); assert.ok(/red/.test(r.color)); assert.ok(/sem/.test(r.label)); });
}

console.log('SCÉNARIO 6 — câblage (statique)');
t('login : _touchCurrentPlayerLastSeen(true)', () => {
  assert.ok(/login frais d'une joueuse[\s\S]*?_touchCurrentPlayerLastSeen\(true\)/.test(html));
});
t('boot fetch : _touchCurrentPlayerLastSeen(true)', () => {
  assert.ok(/la joueuse existe dans state\.players[\s\S]*?_touchCurrentPlayerLastSeen\(true\)/.test(html));
});
t('_renderBody installe _ensureLastSeenForegroundTouch', () => {
  assert.ok(/_initPlayersSync\(\);[\s\S]{0,160}_ensureLastSeenForegroundTouch\(\);/.test(html));
});

console.log(`\n✅ ${pass} assertions OK — dernière connexion joueuse (touch foreground + throttle).`);
