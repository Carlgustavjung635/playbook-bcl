// Test DRILL STIMULI — joueuses (players) + lettres mode range/select.
// Extrait FIDÈLE de _drillExpandPool / résolution player d'index.html.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

const DRILL_COLORS = [{ id: 'red', hex: '#e5352b' }, { id: 'blue', hex: '#2f7bf5' }];
const DRILL_ARROW_DEG = { up: 0, right: 90, down: 180, left: 270 };
const DRILL_SHAPES = ['circle', 'triangle', 'square'];

// COPIE FIDÈLE (players en 3e arg ; defaults ignorés dans le test).
function _drillExpandPool(stimuli, images, players) {
  const s = stimuli || {}, imgs = images || [], plrs = players || [];
  const pool = [];
  (s.colors || []).forEach(c => { const col = DRILL_COLORS.find(x => x.id === c); if (col) pool.push({ type: 'color', value: col.id, hex: col.hex }); });
  (s.arrows || []).forEach(a => { if (DRILL_ARROW_DEG[a] != null) pool.push({ type: 'arrow', value: a }); });
  if (s.numbers && Number.isFinite(s.numbers.min) && Number.isFinite(s.numbers.max)) {
    const lo = Math.min(s.numbers.min, s.numbers.max), hi = Math.max(s.numbers.min, s.numbers.max);
    for (let n = lo; n <= hi && pool.length < 3000; n++) pool.push({ type: 'number', value: n });
  }
  if (s.letters) {
    if (s.letters.mode === 'select') {
      (s.letters.selected || []).forEach(ch => { const c = String(ch || '').toUpperCase().charAt(0); if (/[A-Z]/.test(c)) pool.push({ type: 'letter', value: c }); });
    } else if (s.letters.min && s.letters.max) {
      let lo = String(s.letters.min).toUpperCase().charCodeAt(0), hi = String(s.letters.max).toUpperCase().charCodeAt(0);
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      for (let c = lo; c <= hi; c++) if (c >= 65 && c <= 90) pool.push({ type: 'letter', value: String.fromCharCode(c) });
    }
  }
  (s.shapes || []).forEach(sh => { if (DRILL_SHAPES.includes(sh)) pool.push({ type: 'shape', value: sh }); });
  (s.imageIds || []).forEach(id => { const img = imgs.find(m => m.id === id && !m.deletedAt); if (img) pool.push({ type: 'image', value: id, url: img.url }); });
  (s.players || []).forEach(id => { if (plrs.some(p => p && p.id === id && !p.deletedAt)) pool.push({ type: 'player', value: id }); });
  return pool;
}
// Résolution player id → prénom (comme _drillCueHtml case 'player').
function _resolvePlayerName(id, players) { const p = (players || []).find(x => x && x.id === id); return p ? (p.name || 'Joueuse') : 'Joueuse'; }

const ROSTER = [{ id: 'p1', name: 'Marie' }, { id: 'p2', name: 'Léa' }, { id: 'p3', name: 'Zoé', deletedAt: 123 }];

// ============================================================================
// 1. Players dans le pool
// ============================================================================
let pool = _drillExpandPool({ players: ['p1', 'p2'] }, [], ROSTER);
eq('2 joueuses actives → 2 cues player', pool.filter(c => c.type === 'player').length, 2);
ok('cue player porte l\'id', pool.every(c => c.type === 'player' && (c.value === 'p1' || c.value === 'p2')));
eq('players absent → 0 cue player', _drillExpandPool({ colors: ['red'] }, [], ROSTER).filter(c => c.type === 'player').length, 0);
eq('player supprimé (deletedAt) exclu du pool', _drillExpandPool({ players: ['p1', 'p3'] }, [], ROSTER).filter(c => c.type === 'player').length, 1);
eq('player id inconnu ignoré', _drillExpandPool({ players: ['pX'] }, [], ROSTER).filter(c => c.type === 'player').length, 0);

// ============================================================================
// 2. Résolution id → prénom
// ============================================================================
eq('p1 → Marie', _resolvePlayerName('p1', ROSTER), 'Marie');
eq('p2 → Léa', _resolvePlayerName('p2', ROSTER), 'Léa');
eq('id inconnu → « Joueuse » (fallback)', _resolvePlayerName('pX', ROSTER), 'Joueuse');

// ============================================================================
// 3. Lettres mode select
// ============================================================================
pool = _drillExpandPool({ letters: { mode: 'select', selected: ['A', 'C', 'E', 'G'] } }, [], []);
eq('select : 4 lettres', pool.filter(c => c.type === 'letter').length, 4);
eq('select : exactement A,C,E,G', pool.filter(c => c.type === 'letter').map(c => c.value).join(''), 'ACEG');
ok('select : ne contient PAS B/D/F', !pool.some(c => c.value === 'B' || c.value === 'D' || c.value === 'F'));
// minuscules normalisées + non-lettres ignorées
pool = _drillExpandPool({ letters: { mode: 'select', selected: ['a', '3', 'z', ''] } }, [], []);
eq('select : minuscule→majuscule, chiffre/vide ignorés → A,Z', pool.map(c => c.value).join(''), 'AZ');

// ============================================================================
// 4. Lettres mode range (existant) + backward-compat (mode absent)
// ============================================================================
pool = _drillExpandPool({ letters: { mode: 'range', min: 'A', max: 'D' } }, [], []);
eq('range A→D : 4 lettres ABCD', pool.map(c => c.value).join(''), 'ABCD');
// backward-compat : letters sans mode = range implicite
pool = _drillExpandPool({ letters: { min: 'A', max: 'C' } }, [], []);
eq('lettres SANS mode (drill existant) → range A,B,C', pool.map(c => c.value).join(''), 'ABC');
// range inversé swap
pool = _drillExpandPool({ letters: { min: 'D', max: 'A' } }, [], []);
eq('range inversé D→A swap → ABCD', pool.map(c => c.value).join(''), 'ABCD');

// ============================================================================
// 5. Pool combiné : joueuses + lettres select uniquement (rien d'autre)
// ============================================================================
pool = _drillExpandPool({ players: ['p1', 'p2'], letters: { mode: 'select', selected: ['A', 'B'] } }, [], ROSTER);
eq('combiné : 2 players + 2 lettres = 4 cues', pool.length, 4);
ok('combiné : que des types player/letter (0 couleur/chiffre/forme/flèche)', pool.every(c => c.type === 'player' || c.type === 'letter'));
eq('combiné : 2 players', pool.filter(c => c.type === 'player').length, 2);
eq('combiné : 2 letters', pool.filter(c => c.type === 'letter').length, 2);

// ============================================================================
// 6. Backward-compat général : drills existants inchangés
// ============================================================================
pool = _drillExpandPool({ colors: ['red', 'blue'], arrows: ['up'], numbers: { min: 1, max: 3 } }, [], ROSTER);
eq('drill classique (couleurs+flèche+chiffres) inchangé : 2+1+3 = 6 cues', pool.length, 6);
ok('aucun cue player sans s.players', !pool.some(c => c.type === 'player'));

console.log(`\n✓ ${passed} assertions passées — drill stimuli joueuses + lettres range/select OK`);
