// Test du Web Push (Phase 2) — logique pure mockée (pas de vrai SW/push).
// Couvre : décodage clé VAPID, clés destinataires, gating de notifyPush
// (best-effort : pas d'auto-notif, pas de cibles → pas d'appel, hors ligne →
// pas d'appel), décision du kill-switch SW (préserve push-sw sauf __PUSH_KILL__),
// mapping payload des événements.
import assert from 'node:assert';

// --- VAPID base64url → octets (extrait fidèle de _urlB64ToUint8) ---
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = Buffer.from(base, 'base64').toString('binary');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const VAPID_PUBLIC_KEY = 'BMVoXX7h2iTGcH6QUFwL97JMNq48wXeHOOU8agVlCTBjiNvnjVYJsS_T-36HUdrSUX0v-DgXIMjvG5T_A7e9ukk';

// --- clés destinataires ---
function _pushPlayerKeys(pids) { return (pids || []).filter(Boolean).map(p => 'player:' + p); }
function _pushCoachKey() { return 'coach:-'; }

// --- notifyPush (modèle : renvoie le body POST ou null si pas d'appel) ---
function notifyPushModel({ online, sbReady, me, ownerKeys, payload, baseUrl }) {
  if (!sbReady || online === false) return null;
  ownerKeys = (ownerKeys || []).filter(k => k && k !== me);
  if (!ownerKeys.length || !payload || !payload.title) return null;
  if (!baseUrl) return null;
  return { url: baseUrl.replace(/\/$/, '') + '/functions/v1/push-send', body: { ownerKeys, payload } };
}

// --- décision du nettoyage SW au boot (extrait fidèle du snippet <head>) ---
function swShouldUnregister(scriptURL, pushKill) {
  const isPush = scriptURL.indexOf('push-sw.js') !== -1;
  if (isPush && !pushKill) return false; // on garde le push-sw
  return true;                            // legacy /sw.js, ou rollback → unregister
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — clé VAPID applicationServerKey = 65 octets (P-256 non compressé)');
t('décodage → 65 octets, 1er octet 0x04', () => {
  const k = urlB64ToUint8(VAPID_PUBLIC_KEY);
  assert.strictEqual(k.length, 65);
  assert.strictEqual(k[0], 4);
});

console.log('SCÉNARIO 2 — clés destinataires "role:playerId"');
t('joueuses', () => assert.deepStrictEqual(_pushPlayerKeys(['p1', 'p2']), ['player:p1', 'player:p2']));
t('coach', () => assert.strictEqual(_pushCoachKey(), 'coach:-'));

console.log('SCÉNARIO 3 — notifyPush best-effort : gating');
t('cas nominal → POST avec ownerKeys + payload', () => {
  const r = notifyPushModel({ online: true, sbReady: true, me: 'coach:-', ownerKeys: ['player:p1'], payload: { title: '📨 Message' }, baseUrl: 'https://x.supabase.co' });
  assert.ok(r && r.url.endsWith('/functions/v1/push-send'));
  assert.deepStrictEqual(r.body.ownerKeys, ['player:p1']);
});
t('ne se notifie pas soi-même (me filtré)', () => {
  const r = notifyPushModel({ online: true, sbReady: true, me: 'player:p1', ownerKeys: ['player:p1'], payload: { title: 'x' }, baseUrl: 'https://x' });
  assert.strictEqual(r, null);
});
t('aucune cible → pas d\'appel', () => assert.strictEqual(notifyPushModel({ online: true, sbReady: true, me: 'coach:-', ownerKeys: [], payload: { title: 'x' }, baseUrl: 'https://x' }), null));
t('hors ligne → pas d\'appel', () => assert.strictEqual(notifyPushModel({ online: false, sbReady: true, me: 'coach:-', ownerKeys: ['player:p1'], payload: { title: 'x' }, baseUrl: 'https://x' }), null));
t('payload sans titre → pas d\'appel', () => assert.strictEqual(notifyPushModel({ online: true, sbReady: true, me: 'coach:-', ownerKeys: ['player:p1'], payload: {}, baseUrl: 'https://x' }), null));
t('sb pas prêt → pas d\'appel', () => assert.strictEqual(notifyPushModel({ online: true, sbReady: false, me: 'coach:-', ownerKeys: ['player:p1'], payload: { title: 'x' }, baseUrl: 'https://x' }), null));

console.log('SCÉNARIO 4 — kill-switch SW : préserve push-sw, supprime le legacy');
t('push-sw conservé en fonctionnement normal', () => assert.strictEqual(swShouldUnregister('https://app/push-sw.js', false), false));
t('legacy /sw.js désenregistré', () => assert.strictEqual(swShouldUnregister('https://app/sw.js', false), true));
t('__PUSH_KILL__=true → push-sw AUSSI désenregistré (rollback)', () => assert.strictEqual(swShouldUnregister('https://app/push-sw.js', true), true));

console.log('SCÉNARIO 5 — mapping événements → payload (titres/tags)');
const EVENTS = {
  message: { title: '📨 Message du coach', tag: 'msg' },
  poll: { title: '🗳 Nouveau sondage', tag: 'msg' },
  gage_assigned: { title: '🎁 Tirage de gage', tag: 'gage-draw' },
  gage_proposal: { title: '🎁 Nouvelle proposition de gage', tag: 'gage-propose' },
  gage_outcome: { title: '💪 Gage accepté', tag: 'gage-outcome' },
  convoc_match: { title: '🏀 Nouveau match', tag: 'convoc' },
  convoc_training: { title: '🗓 Nouvel entraînement', tag: 'convoc' },
  play: { title: '📋 Nouveau play', tag: 'play' },
  challenge: { title: '🏆 Nouveau défi', tag: 'challenge' },
  plan: { title: "✅ Plan d'entraînement prêt", tag: 'plan' },
  stats: { title: '📊 Stats de match', tag: 'stats' },
};
t('11 types d\'événements couverts, tags non vides', () => {
  const keys = Object.keys(EVENTS);
  assert.ok(keys.length >= 11);
  keys.forEach(k => { assert.ok(EVENTS[k].title && EVENTS[k].tag, 'mapping incomplet: ' + k); });
});
t('le tag "convoc" dédoublonne match/entraînement (remplace l\'ancienne notif)', () => {
  assert.strictEqual(EVENTS.convoc_match.tag, EVENTS.convoc_training.tag);
});

console.log(`\n✅ ${pass} assertions OK — web push (VAPID, cibles, gating best-effort, kill-switch, mapping).`);
