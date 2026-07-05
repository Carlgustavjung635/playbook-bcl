// Test des TYPES de gages : standard (défaut) / secret / sport / time_limited.
//   - création avec type + durée ;
//   - expiration auto d'un gage à durée limitée (deadline atteinte → invalidated) ;
//   - métadonnées d'affichage (icône) ; type par défaut = standard.
// Extrait fidèle d'index.html.
import assert from 'node:assert';

let state;
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extrait fidèle) ---
const GAGE_TYPES = {
  standard:     { icon: '📝', label: 'Standard' },
  secret:       { icon: '🤫', label: 'Secret' },
  sport:        { icon: '💪', label: 'Sportif' },
  time_limited: { icon: '⏱️', label: 'Durée limitée' },
};
function _gageById(id) { return (state.gages || []).find(g => g.id === id); }
function _gageTypeOf(g) { return (g && GAGE_TYPES[g.gageType]) ? g.gageType : 'standard'; }
function _gageTypeMeta(g) { return GAGE_TYPES[_gageTypeOf(g)]; }
function _drawDeadline(draw) {
  if (!draw || !draw.completedAt) return null;
  const g = _gageById(draw.gageId);
  if (!g || _gageTypeOf(g) !== 'time_limited' || !g.timeLimitHours) return null;
  return draw.completedAt + g.timeLimitHours * 3600000;
}
// Sweep piloté par une horloge injectable (au lieu de Date.now()).
function _sweepExpiredGages(nowMs) {
  let changed = false;
  (state.gageDraws || []).forEach(d => {
    if (d.status !== 'accepted' && d.status !== 'player_done') return;
    const dl = _drawDeadline(d);
    if (dl && nowMs > dl) { d.status = 'invalidated'; d.invalidatedAt = nowMs; d.invalidationReason = d.invalidationReason || 'Temps écoulé'; changed = true; }
  });
  return changed;
}
function submitCoachGage(text, type, hours) {
  const gType = GAGE_TYPES[type] ? type : 'standard';
  const g = { id: uid(), text, authorId: 'coach', status: 'approved', completedAt: null, deletedAt: null,
    gageType: gType, timeLimitHours: gType === 'time_limited' ? (Number.isFinite(hours) ? hours : 24) : null,
    seasonId: null, createdAt: now(), updatedAt: now() };
  state.gages.unshift(g); return g.id;
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() { state = { gages: [], gageDraws: [] }; _uid = 0; CLOCK = 1000; }

console.log('SCÉNARIO 1 — type par défaut = standard');
fresh();
t('sans type → standard', () => {
  const id = submitCoachGage('gage simple');
  assert.strictEqual(_gageById(id).gageType, 'standard');
  assert.strictEqual(_gageTypeMeta(_gageById(id)).icon, '📝');
});
t('type inconnu → replié sur standard', () => {
  const id = submitCoachGage('x', 'bidon');
  assert.strictEqual(_gageById(id).gageType, 'standard');
});

console.log('SCÉNARIO 2 — gage secret : métadonnées');
fresh();
t('type secret → icône 🤫', () => {
  const id = submitCoachGage('mission secrète', 'secret');
  assert.strictEqual(_gageById(id).gageType, 'secret');
  assert.strictEqual(_gageTypeMeta(_gageById(id)).icon, '🤫');
});

console.log('SCÉNARIO 3 — gage sportif');
fresh();
t('type sport → icône 💪', () => {
  const id = submitCoachGage('20 pompes', 'sport');
  assert.strictEqual(_gageTypeMeta(_gageById(id)).icon, '💪');
});

console.log('SCÉNARIO 4 — durée limitée : deadline + expiration auto');
fresh();
t('time_limited stocke la durée (heures)', () => {
  const id = submitCoachGage('dans l\'heure', 'time_limited', 2);
  assert.strictEqual(_gageById(id).gageType, 'time_limited');
  assert.strictEqual(_gageById(id).timeLimitHours, 2);
});
t('durée par défaut = 24h si non fournie', () => {
  const id = submitCoachGage('sans durée', 'time_limited');
  assert.strictEqual(_gageById(id).timeLimitHours, 24);
});
t('deadline = acceptation + durée', () => {
  const gid = submitCoachGage('t', 'time_limited', 3);
  const acceptedAt = 1_000_000;
  const d = { id: uid(), playerId: 'p1', gageId: gid, status: 'accepted', completedAt: acceptedAt };
  state.gageDraws.push(d);
  assert.strictEqual(_drawDeadline(d), acceptedAt + 3 * 3600000);
});
t('avant la deadline → pas d\'expiration', () => {
  const d = state.gageDraws[0];
  const before = d.completedAt + 2 * 3600000; // 2h < 3h
  assert.strictEqual(_sweepExpiredGages(before), false);
  assert.strictEqual(d.status, 'accepted');
});
t('après la deadline → invalidated (NEUTRE, raison « Temps écoulé »)', () => {
  const d = state.gageDraws[0];
  const after = d.completedAt + 4 * 3600000; // 4h > 3h
  assert.strictEqual(_sweepExpiredGages(after), true);
  assert.strictEqual(d.status, 'invalidated');
  assert.strictEqual(d.invalidationReason, 'Temps écoulé');
});
t('un gage standard n\'expire jamais', () => {
  fresh();
  const gid = submitCoachGage('std');
  const d = { id: uid(), playerId: 'p1', gageId: gid, status: 'accepted', completedAt: 1000 };
  state.gageDraws.push(d);
  assert.strictEqual(_drawDeadline(d), null);
  assert.strictEqual(_sweepExpiredGages(9e15), false);
  assert.strictEqual(d.status, 'accepted');
});

console.log(`\n✅ ${pass} assertions OK — types (défaut standard), secret/sport, durée limitée + expiration auto.`);
