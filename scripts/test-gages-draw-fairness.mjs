// Audit de FAIRNESS du tirage au sort des gages (suite au doute user « le tirage
// bug »). Modélise fidèlement _drawPoolFor + _pickGageForDraw d'index.html et
// vérifie : (1) distribution uniforme sur le pool éligible ; (2) aucun filtre par
// TYPE (standard/secret/sport/time_limited tous tirables) ; (3) exclusions
// correctes (deleted_at / completed_at) ; (4) anti-répétition post-fix skip
// (un skip reste tirable ; accepted/player_done/coach_confirmed/invalidated non).
// RNG SEEDÉ (mulberry32) → test déterministe, non flaky.
import assert from 'node:assert';

// RNG déterministe pour remplacer Math.random pendant le test.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let RAND = Math.random;

// --- SUJET (extrait fidèle d'index.html) ---
let state;
function _gageTirable(g) { return !!g && g.status === 'approved' && !g.deletedAt && !g.completedAt; }
function _drawPoolFor(pid) {
  const approved = (state.gages || []).filter(g => _gageTirable(g));
  // Un SKIP ne compte PAS comme « déjà tiré » (fix précédent).
  const drawn = new Set((state.gageDraws || []).filter(d => d.playerId === pid && d.gageId && d.status !== 'skipped').map(d => d.gageId));
  const fresh = approved.filter(g => !drawn.has(g.id));
  return fresh.length ? fresh : approved;
}
function _pickGageForDraw(pid) {
  const pool = _drawPoolFor(pid);
  if (!pool.length) return null;
  return pool[Math.floor(RAND() * pool.length)]; // ← ligne testée (uniforme)
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

// Pool réaliste : 22 standard + 3 secret (comme la prod), + 1 deleted + 1 completed
// (doivent être exclus). Anti-répétition : joueuse 'p1'.
function buildState() {
  const gages = [];
  for (let i = 0; i < 22; i++) gages.push({ id: 'g' + i, status: 'approved', gageType: 'standard', deletedAt: null, completedAt: null });
  for (let i = 0; i < 3; i++) gages.push({ id: 's' + i, status: 'approved', gageType: 'secret', deletedAt: null, completedAt: null });
  gages.push({ id: 'del', status: 'approved', gageType: 'standard', deletedAt: 123, completedAt: null });   // supprimé
  gages.push({ id: 'done', status: 'approved', gageType: 'standard', deletedAt: null, completedAt: 456 });   // réalisé
  gages.push({ id: 'pend', status: 'pending', gageType: 'standard', deletedAt: null, completedAt: null });   // non approuvé
  state = { gages, gageDraws: [], players: [{ id: 'p1' }] };
}

console.log('SCÉNARIO 1 — pool éligible correct (25) : exclut deleted/completed/pending');
buildState();
t('taille du pool éligible = 25 (22 standard + 3 secret)', () => {
  const pool = _drawPoolFor('p1');
  assert.strictEqual(pool.length, 25);
  assert.ok(!pool.some(g => ['del', 'done', 'pend'].includes(g.id)), 'deleted/completed/pending exclus');
});
t('les 3 types du pool sont représentés (aucun filtre par type)', () => {
  const pool = _drawPoolFor('p1');
  assert.strictEqual(pool.filter(g => g.gageType === 'secret').length, 3);
  assert.strictEqual(pool.filter(g => g.gageType === 'standard').length, 22);
});

console.log('SCÉNARIO 2 — distribution UNIFORME sur 100 000 tirages (RNG seedé)');
buildState();
t('chaque gage tiré ~4000× (±12%), aucun sur/sous-représenté', () => {
  RAND = mulberry32(0xC0FFEE);
  const N = 100000; const counts = {};
  for (let i = 0; i < N; i++) { const g = _pickGageForDraw('p1'); counts[g.id] = (counts[g.id] || 0) + 1; }
  RAND = Math.random;
  const poolSize = 25; const expected = N / poolSize; // 4000
  const vals = Object.values(counts);
  assert.strictEqual(Object.keys(counts).length, poolSize, 'les 25 gages sont tous tirés au moins une fois');
  const min = Math.min(...vals), max = Math.max(...vals);
  assert.ok(min > expected * 0.88, `min ${min} trop bas (attendu ~${expected})`);
  assert.ok(max < expected * 1.12, `max ${max} trop haut (attendu ~${expected})`);
});
t('les SECRET sont tirés à leur juste proportion (~12%), ni plus ni moins', () => {
  RAND = mulberry32(0x1234);
  const N = 100000; let secret = 0;
  for (let i = 0; i < N; i++) { if (_pickGageForDraw('p1').gageType === 'secret') secret++; }
  RAND = Math.random;
  const ratio = secret / N; // attendu 3/25 = 0.12
  assert.ok(Math.abs(ratio - 0.12) < 0.01, `proportion secret ${ratio.toFixed(3)} != ~0.12`);
});

console.log('SCÉNARIO 3 — anti-répétition : skip re-tirable, engagé exclu');
t('un gage SKIPPÉ reste dans le pool tirable', () => {
  buildState();
  state.gageDraws.push({ playerId: 'p1', gageId: 'g0', status: 'skipped' });
  assert.ok(_drawPoolFor('p1').some(g => g.id === 'g0'), 'g0 skippé encore tirable');
  assert.strictEqual(_drawPoolFor('p1').length, 25);
});
t('un gage ENGAGÉ (accepted/player_done/coach_confirmed/invalidated) sort du pool fresh', () => {
  ['accepted', 'player_done', 'coach_confirmed', 'invalidated'].forEach(st => {
    buildState();
    state.gageDraws.push({ playerId: 'p1', gageId: 'g0', status: st });
    assert.ok(!_drawPoolFor('p1').some(g => g.id === 'g0'), `g0 ${st} exclu du fresh`);
    assert.strictEqual(_drawPoolFor('p1').length, 24);
  });
});
t('anti-répétition SCOPÉE par joueuse (l\'engagement de p1 n\'affecte pas p2)', () => {
  buildState();
  state.gageDraws.push({ playerId: 'p1', gageId: 'g0', status: 'accepted' });
  assert.ok(_drawPoolFor('p2').some(g => g.id === 'g0'), 'g0 tirable pour p2');
});

console.log('SCÉNARIO 4 — repli : tout engagé → pool complet (pas de blocage)');
t('si p1 a engagé les 25, fresh vide → repli sur le pool complet', () => {
  buildState();
  _drawPoolFor('p1').forEach(g => state.gageDraws.push({ playerId: 'p1', gageId: g.id, status: 'accepted' }));
  const pool = _drawPoolFor('p1');
  assert.strictEqual(pool.length, 25, 'repli sur les 25 approuvés (jamais bloqué)');
});

console.log(`\n✅ ${pass} assertions OK — tirage uniforme, aucun biais de type, exclusions correctes, anti-répétition scopée.`);
