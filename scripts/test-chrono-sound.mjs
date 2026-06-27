// Test du sélecteur de son de chrono (audit Phase 2). Reproduit fidèlement la
// logique de index.html : catalogue 4 sons, persistance par identité (map
// localStorage), fallback défaut, toggle tension, et fréquences des ticks 3-2-1.
// (Les recettes Web Audio elles-mêmes ne sont pas exécutables hors navigateur ;
// on teste leur SÉLECTION, leur persistance et la signature des ticks.)
import assert from 'node:assert';

// --- mock localStorage + identité ---
const store = {};
const load = (k, d) => (k in store ? JSON.parse(store[k]) : d);
const save = (k, v) => { store[k] = JSON.stringify(v); };
let auth = { role: 'coach', playerId: null };
function themeIdentityKey() { return auth ? (auth.role + ':' + (auth.playerId || '-')) : '_guest'; }
const K = { chronoSound: 'pb8_chrono_sound', chronoTension: 'pb8_chrono_tension' };

// --- SUJET (extrait fidèle) ---
const CHRONO_SOUNDS = [
  { id: 'buzzer-arene', name: 'Buzzer Arène' },
  { id: 'cloche-zen', name: 'Cloche Zen' },
  { id: 'triple-pop', name: 'Triple Pop' },
  { id: 'sifflet-coach', name: 'Sifflet Coach' },
];
const DEFAULT_CHRONO_SOUND = 'buzzer-arene';
function getChronoSound() {
  const map = load(K.chronoSound, {}) || {};
  const id = map[themeIdentityKey()];
  return CHRONO_SOUNDS.some(s => s.id === id) ? id : DEFAULT_CHRONO_SOUND;
}
function setChronoSound(id) {
  if (!CHRONO_SOUNDS.some(s => s.id === id)) return;
  const map = load(K.chronoSound, {}) || {};
  map[themeIdentityKey()] = id; save(K.chronoSound, map);
}
function getChronoTension() { const map = load(K.chronoTension, {}) || {}; return map[themeIdentityKey()] === true; }
function setChronoTension(on) { const map = load(K.chronoTension, {}) || {}; map[themeIdentityKey()] = !!on; save(K.chronoTension, map); }
function tensionTickFreq(sec) { return sec === 3 ? 600 : sec === 2 ? 800 : sec === 1 ? 1100 : null; }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — catalogue : 4 ambiances distinctes');
t('exactement 4 sons, ids uniques', () => {
  assert.strictEqual(CHRONO_SOUNDS.length, 4);
  assert.strictEqual(new Set(CHRONO_SOUNDS.map(s => s.id)).size, 4);
});
t('le défaut fait partie du catalogue', () => assert.ok(CHRONO_SOUNDS.some(s => s.id === DEFAULT_CHRONO_SOUND)));

console.log('SCÉNARIO 2 — fallback défaut');
t('rien stocké → buzzer-arene', () => { delete store[K.chronoSound]; assert.strictEqual(getChronoSound(), 'buzzer-arene'); });
t('id invalide stocké → fallback défaut', () => {
  save(K.chronoSound, { 'coach:-': 'inexistant' });
  assert.strictEqual(getChronoSound(), 'buzzer-arene');
});

console.log('SCÉNARIO 3 — persistance PAR IDENTITÉ');
t('le coach choisit cloche-zen → persiste', () => {
  auth = { role: 'coach', playerId: null };
  setChronoSound('cloche-zen');
  assert.strictEqual(getChronoSound(), 'cloche-zen');
});
t('une joueuse a son propre son (sifflet-coach), indépendant du coach', () => {
  auth = { role: 'player', playerId: 'p1' };
  assert.strictEqual(getChronoSound(), 'buzzer-arene'); // pas encore choisi → défaut
  setChronoSound('sifflet-coach');
  assert.strictEqual(getChronoSound(), 'sifflet-coach');
  auth = { role: 'coach', playerId: null };
  assert.strictEqual(getChronoSound(), 'cloche-zen', 'le choix coach est intact');
});

console.log('SCÉNARIO 4 — toggle tension 3-2-1 (par identité)');
t('défaut désactivé', () => { delete store[K.chronoTension]; auth = { role: 'coach', playerId: null }; assert.strictEqual(getChronoTension(), false); });
t('activation persiste', () => { setChronoTension(true); assert.strictEqual(getChronoTension(), true); });
t('désactivation persiste', () => { setChronoTension(false); assert.strictEqual(getChronoTension(), false); });
t('tension indépendante par identité', () => {
  setChronoTension(true); // coach ON
  auth = { role: 'player', playerId: 'p1' };
  assert.strictEqual(getChronoTension(), false, 'joueuse non affectée');
});

console.log('SCÉNARIO 5 — fréquences des ticks de tension (montantes 3→2→1)');
t('600 / 800 / 1100 Hz pour 3 / 2 / 1', () => {
  assert.strictEqual(tensionTickFreq(3), 600);
  assert.strictEqual(tensionTickFreq(2), 800);
  assert.strictEqual(tensionTickFreq(1), 1100);
  assert.ok(tensionTickFreq(3) < tensionTickFreq(2) && tensionTickFreq(2) < tensionTickFreq(1), 'montantes');
});
t('hors fenêtre (4, 0) → pas de tick', () => {
  assert.strictEqual(tensionTickFreq(4), null);
  assert.strictEqual(tensionTickFreq(0), null);
});

console.log(`\n✅ ${pass} assertions OK — picker son chrono (catalogue, fallback, persistance/identité, tension).`);
