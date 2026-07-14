// Test FIX notifs en double — dédup souscriptions push (client + serveur).
// Extrait FIDÈLE de _pushStaleEndpoint (index.html) + dédup (owner_key, ua) de push-send.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

// ---- CLIENT : endpoint précédent à purger (rotation) ----
function _pushStaleEndpoint(prev, next) { return (prev && next && prev !== next) ? prev : null; }

eq('rotation E1→E2 : purge E1', _pushStaleEndpoint('E1', 'E2'), 'E1');
eq('même endpoint : rien à purger', _pushStaleEndpoint('E1', 'E1'), null);
eq('pas de précédent (1re souscription) : rien', _pushStaleEndpoint(null, 'E2'), null);
eq('pas de nouveau : rien', _pushStaleEndpoint('E1', null), null);

// ---- SERVEUR (push-send) : dédup (owner_key, ua) au last_seen_at le plus récent ----
function _dedupSubs(subs) {
  const seen = new Set();
  return (subs || [])
    .slice()
    .sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
    .filter(s => { const k = String(s.owner_key || '') + '|' + String(s.ua || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Cas réel du bug : coach:- , même iPhone, 2 endpoints (rotation) → 1 seul envoi (le récent).
const bug = [
  { id: 'a', owner_key: 'coach:-', ua: 'iPhone iOS 18_7', endpoint: 'E_old', last_seen_at: '2026-06-28T10:31:57Z' },
  { id: 'b', owner_key: 'coach:-', ua: 'iPhone iOS 18_7', endpoint: 'E_new', last_seen_at: '2026-07-06T06:13:51Z' }
];
const d1 = _dedupSubs(bug);
eq('bug coach:- 2 endpoints même appareil → 1 envoi', d1.length, 1);
eq('garde le plus récent (E_new)', d1[0].endpoint, 'E_new');

// 2 vrais appareils différents (ua différent) sous le même owner → les 2 gardés.
const twoDevices = [
  { id: 'a', owner_key: 'coach:-', ua: 'iPhone iOS 18_7', endpoint: 'E_iphone', last_seen_at: '2026-07-01T00:00:00Z' },
  { id: 'b', owner_key: 'coach:-', ua: 'Android Chrome', endpoint: 'E_android', last_seen_at: '2026-07-02T00:00:00Z' }
];
eq('2 appareils réels (ua différent) → 2 envois', _dedupSubs(twoDevices).length, 2);

// 2 joueuses différentes (owner différent) → 2 envois (jamais collapsées entre elles).
const twoPlayers = [
  { id: 'a', owner_key: 'player:p1', ua: 'iPhone iOS 18_7', endpoint: 'E1', last_seen_at: '2026-07-01T00:00:00Z' },
  { id: 'b', owner_key: 'player:p2', ua: 'iPhone iOS 18_7', endpoint: 'E2', last_seen_at: '2026-07-01T00:00:00Z' }
];
eq('2 joueuses (owner différent, ua identique) → 2 envois', _dedupSubs(twoPlayers).length, 2);

// 3 rotations empilées sur 1 appareil → 1 seul envoi.
const triple = [
  { owner_key: 'coach:-', ua: 'X', endpoint: 'E1', last_seen_at: '2026-06-01T00:00:00Z' },
  { owner_key: 'coach:-', ua: 'X', endpoint: 'E2', last_seen_at: '2026-06-15T00:00:00Z' },
  { owner_key: 'coach:-', ua: 'X', endpoint: 'E3', last_seen_at: '2026-07-01T00:00:00Z' }
];
const d3 = _dedupSubs(triple);
eq('3 rotations → 1 envoi', d3.length, 1);
eq('3 rotations → garde E3 (plus récent)', d3[0].endpoint, 'E3');

// Liste vide / null → pas de crash.
eq('vide → 0', _dedupSubs([]).length, 0);
eq('null → 0', _dedupSubs(null).length, 0);

console.log(`\n✓ ${passed} assertions passées — fix notifs doublons (dédup endpoint client + owner/ua serveur) OK`);
