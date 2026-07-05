// Test du CYCLE DE VIE d'un gage tiré :
//   owed → accepted → player_done → coach_confirmed (gage retiré du pool) ;
//   « Remettre au pool » (correction) → gage.completed_at cleared → re-tirable ;
//   invalidation (secret grillé / temps écoulé) = échec NEUTRE, aucune dette.
// Extrait fidèle d'index.html.
import assert from 'node:assert';

let state;
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extrait fidèle) ---
function _gageById(id) { return (state.gages || []).find(g => g.id === id); }
function _gageTouch(g) { g.updatedAt = now(); }
function _gageInSeason(g, seasonId) { if (!_seasonsLoaded()) return true; if (g.seasonId) return g.seasonId === seasonId; return seasonId === getActiveSeasonId(); }
function currentSeasonGages() { const active = getActiveSeasonId(); if (!_seasonsLoaded() || !active) return state.gages || []; return (state.gages || []).filter(g => _gageInSeason(g, active)); }
function _gageTirable(g) { return !!g && g.status === 'approved' && !g.deletedAt && !g.completedAt; }
function _drawPoolFor(pid) {
  const approved = currentSeasonGages().filter(g => _gageTirable(g));
  // Un SKIP ne compte PAS comme « déjà tiré » → le gage reste re-tirable par elle.
  const drawn = new Set((state.gageDraws || []).filter(d => d.playerId === pid && d.gageId && d.status !== 'skipped').map(d => d.gageId));
  const fresh = approved.filter(g => !drawn.has(g.id));
  return fresh.length ? fresh : approved;
}
function _seasonGageDraws(pid) { const active = getActiveSeasonId(); return (state.gageDraws || []).filter(d => d.playerId === pid && (!_seasonsLoaded() || !active || (d.seasonId ? d.seasonId === active : true))); }
function gageDebt(pid) {
  const all = _seasonGageDraws(pid);
  const mine = all.filter(d => d.assignedAt && d.status !== 'adjust');
  const batches = {}; mine.forEach(d => { (batches[d.assignedAt] = batches[d.assignedAt] || []).push(d); });
  let resetTime = 0;
  Object.values(batches).forEach(arr => { const allDone = arr.every(d => d.completedAt); const clean = allDone && arr.every(d => d.status !== 'skipped'); if (clean) { const c = Math.max(...arr.map(d => d.completedAt || 0)); if (c > resetTime) resetTime = c; } });
  const skips = mine.filter(d => d.status === 'skipped' && (d.completedAt || 0) > resetTime).length;
  const adj = all.filter(d => d.status === 'adjust' && (d.completedAt || 0) > resetTime).reduce((s, d) => s + (Number.isFinite(d.delta) ? d.delta : 0), 0);
  return Math.max(0, skips + adj);
}
function submitCoachGage(text, type, hours) { const gType = ['standard','secret','sport','time_limited'].includes(type) ? type : 'standard'; const g = { id: uid(), text, authorId: 'coach', status: 'approved', completedAt: null, deletedAt: null, gageType: gType, timeLimitHours: gType === 'time_limited' ? (Number.isFinite(hours) ? hours : 24) : null, seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() }; state.gages.unshift(g); return g.id; }
function assignDraw(pid) { const t = now(); state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'owed', assignedAt: t, completedAt: null, seasonId: getActiveSeasonId(), createdAt: t, updatedAt: t }); return state.gageDraws[state.gageDraws.length - 1]; }
function drawAndAccept(pid) { const d = _seasonGageDraws(pid).find(x => x.status === 'owed'); const pool = _drawPoolFor(pid); if (!d || !pool.length) return null; d.gageId = pool[0].id; d.drawnAt = now(); d.status = 'accepted'; d.completedAt = now(); return d; }
function markGageDone(d) { if (d.status !== 'accepted') return false; d.status = 'player_done'; d.playerDoneAt = now(); return true; }
function confirmGage(d) { if (d.status !== 'player_done' && d.status !== 'accepted') return false; d.status = 'coach_confirmed'; d.confirmedAt = now(); const g = _gageById(d.gageId); if (g && !g.completedAt) g.completedAt = now(); return true; }
function reopenGage(d) { d.status = 'accepted'; d.confirmedAt = null; d.playerDoneAt = null; d.invalidatedAt = null; d.invalidationReason = null; d.completedAt = now(); const g = _gageById(d.gageId); if (g) { g.completedAt = null; g.deletedAt = null; } return true; }
function invalidateGage(d, reason) { if (d.status !== 'accepted' && d.status !== 'player_done') return false; d.status = 'invalidated'; d.invalidatedAt = now(); d.invalidationReason = reason || null; return true; }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  state = { seasons: [{ id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }], players: [{ id: 'p1', num: 4, name: 'Alice' }], gages: [], gageDraws: [] };
  _uid = 0; CLOCK = 1000;
}

console.log('SCÉNARIO 1 — flux nominal jusqu\'au retrait du pool');
fresh();
t('assign → accepted → player_done → coach_confirmed', () => {
  const gid = submitCoachGage('gage A');
  assignDraw('p1');
  const d = drawAndAccept('p1');
  assert.strictEqual(d.status, 'accepted');
  assert.ok(markGageDone(d)); assert.strictEqual(d.status, 'player_done');
  assert.ok(confirmGage(d)); assert.strictEqual(d.status, 'coach_confirmed');
  assert.ok(_gageById(gid).completedAt > 0);
});
t('gage confirmé → retiré du pool tirable', () => {
  assert.strictEqual(_drawPoolFor('p1').length, 0, 'le seul gage est réalisé → pool vide');
  assert.strictEqual(currentSeasonGages().filter(_gageTirable).length, 0);
});

console.log('SCÉNARIO 2 — « Remettre au pool » (correction) rend le gage re-tirable');
fresh();
t('confirmé puis remis au pool → completed_at cleared → tirable', () => {
  const gid = submitCoachGage('gage B');
  assignDraw('p1'); const d = drawAndAccept('p1'); markGageDone(d); confirmGage(d);
  assert.strictEqual(_gageById(gid).completedAt !== null, true);
  reopenGage(d);
  assert.strictEqual(_gageById(gid).completedAt, null);
  assert.strictEqual(d.status, 'accepted');
  // re-tirable pour une AUTRE joueuse (anti-répétition tient p1 à l'écart)
  assert.ok(currentSeasonGages().filter(_gageTirable).some(g => g.id === gid));
});

console.log('SCÉNARIO 3 — invalidation = échec NEUTRE, aucune dette supplémentaire');
fresh();
t('invalider un gage accepté → statut invalidated, dette inchangée', () => {
  submitCoachGage('secret C', 'secret');
  assignDraw('p1'); const d = drawAndAccept('p1');
  const before = gageDebt('p1');
  assert.ok(invalidateGage(d, 'grillé'));
  assert.strictEqual(d.status, 'invalidated');
  assert.strictEqual(d.invalidationReason, 'grillé');
  assert.strictEqual(gageDebt('p1'), before, 'pas de dette ajoutée (contrairement à un skip)');
});
t('un skip AJOUTE une dette (contraste)', () => {
  fresh(); submitCoachGage('g'); const d = assignDraw('p1');
  const pool = _drawPoolFor('p1'); d.gageId = pool[0].id; d.status = 'skipped'; d.completedAt = now();
  assert.strictEqual(gageDebt('p1'), 1);
});
t('un batch avec invalidated reste « propre » (reset dette) — pas un skip', () => {
  fresh(); submitCoachGage('g');
  assignDraw('p1'); const d = drawAndAccept('p1'); invalidateGage(d, 'grillé');
  assert.strictEqual(gageDebt('p1'), 0);
});

console.log('SCÉNARIO 4 — la confirmation directe (sans player_done) est permise');
fresh();
t('coach confirme un accepted directement', () => {
  submitCoachGage('g'); assignDraw('p1'); const d = drawAndAccept('p1');
  assert.ok(confirmGage(d));
  assert.strictEqual(d.status, 'coach_confirmed');
});

console.log('SCÉNARIO 5 — un SKIP renvoie le gage au pool (re-tirable, même joueuse)');
fresh();
t('gage skippé reste tirable pour la MÊME joueuse', () => {
  const gid = submitCoachGage('gage skippable');
  const d = assignDraw('p1');
  d.gageId = gid; d.drawnAt = now(); d.status = 'skipped'; d.completedAt = now(); // refus
  // le gage entity n'a pas été marqué réalisé…
  assert.strictEqual(_gageById(gid).completedAt, null);
  // …et il est de nouveau dans SON pool tirable (l'anti-répétition ignore les skips)
  assert.ok(_drawPoolFor('p1').some(g => g.id === gid), 'le gage skippé doit rester tirable par p1');
});
t('le hasard peut retomber dessus : re-tirage possible', () => {
  const gid = state.gages[0].id;
  const pool = _drawPoolFor('p1');
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].id, gid, 'seul gage du pool → peut être re-tiré');
});
t('gage skippé par PLUSIEURS joueuses reste tirable pour toutes', () => {
  fresh();
  const gid = submitCoachGage('gage très refusé');
  ['p1', 'p2', 'p3'].forEach(pid => { const d = assignDraw(pid); d.gageId = gid; d.status = 'skipped'; d.completedAt = now(); });
  ['p1', 'p2', 'p3'].forEach(pid => assert.ok(_drawPoolFor(pid).some(g => g.id === gid), 'tirable pour ' + pid));
  assert.strictEqual(_gageById(gid).completedAt, null); // jamais retiré du pool global
});
t('un gage ACCEPTÉ, lui, n\'est PAS re-tiré à la même joueuse (anti-répétition conservée)', () => {
  fresh();
  submitCoachGage('gage A'); submitCoachGage('gage B'); // 2 gages pour laisser un « fresh »
  assignDraw('p1'); const d = drawAndAccept('p1'); // accepte le 1er piochable
  assert.ok(!_drawPoolFor('p1').some(g => g.id === d.gageId), 'le gage accepté sort du pool fresh de p1');
});

console.log(`\n✅ ${pass} assertions OK — cycle de vie complet, remise au pool, invalidation neutre, skip re-tirable.`);
