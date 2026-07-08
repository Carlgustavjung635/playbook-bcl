// Test des FLOWS COACH de la boîte à gages (PR gate + refus auto + coach flows) :
//   - le coach ajoute un gage DIRECTEMENT au pool (auto-validé, sans modération) ;
//   - gestion des dettes de tirage par le coach : +1 / −1 / reset via lignes
//     'adjust' (delta), avec gageDebt recompute-on-read incluant les corrections.
// Extrait fidèle d'index.html (mécanique dette + ajustements).
import assert from 'node:assert';

let state;
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extrait fidèle d'index.html) ---
function _seasonGageDraws(pid) { const active = getActiveSeasonId(); return (state.gageDraws || []).filter(d => d.playerId === pid && (!_seasonsLoaded() || !active || (d.seasonId ? d.seasonId === active : true))); }
function gageDebt(pid) { // solde courant chronologique par lot, borné à 0 (extrait fidèle)
  const draws = _seasonGageDraws(pid); const events = []; const batches = {};
  draws.forEach(d => { if (d.status === 'adjust' || !d.assignedAt) return; (batches[d.assignedAt] = batches[d.assignedAt] || []).push(d); });
  Object.values(batches).forEach(arr => {
    const at = Math.max(0, ...arr.map(d => d.completedAt || 0));
    const skips = arr.filter(d => d.status === 'skipped').length;
    if (skips) { events.push({ at, v: skips }); return; }
    if (arr.some(d => d.status === 'owed')) return;
    const engaged = arr.filter(d => d.status === 'accepted' || d.status === 'player_done' || d.status === 'coach_confirmed').length;
    if (engaged) events.push({ at, v: -engaged });
  });
  draws.filter(d => d.status === 'adjust').forEach(d => events.push({ at: d.completedAt || 0, v: Number.isFinite(d.delta) ? d.delta : 0 }));
  events.sort((a, b) => a.at - b.at);
  let bal = 0; events.forEach(e => { bal += e.v; if (bal < 0) bal = 0; });
  return bal;
}
function pendingDraws(pid) { return _seasonGageDraws(pid).filter(d => d.status === 'owed').sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0)); }
function assignDrawsToPlayer(pid) { const t = now(); const sid = getActiveSeasonId() || null; const count = 1 + gageDebt(pid); for (let i = 0; i < count; i++) state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'owed', delta: 0, assignedAt: t, drawnAt: null, completedAt: null, seasonId: sid, createdAt: t + i, updatedAt: t }); return count; }
function drawFirst(pid) { const pool = (state.gages || []).filter(g => g.status === 'approved'); const d = pendingDraws(pid)[0]; if (d && !d.gageId && pool.length) { d.gageId = pool[0].id; d.drawnAt = now(); } return d; }
function skipDraw(d) { d.status = 'skipped'; d.completedAt = now(); }
function acceptDraw(d) { d.status = 'accepted'; d.completedAt = now(); }

// Coach : ajoute un gage DIRECTEMENT au pool (auto-validé).
function submitCoachGage(text) { text = (text || '').trim(); if (!text) return false; state.gages.unshift({ id: uid(), text, authorId: 'coach', status: 'approved', seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() }); return true; }
// Coach : correction manuelle de dette.
function _pushDebtAdjust(pid, delta) { if (!delta) return; const t = now(); state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'adjust', delta, assignedAt: null, drawnAt: null, completedAt: t, seasonId: getActiveSeasonId() || null, createdAt: t, updatedAt: t }); }
function adjustPlayerDebt(pid, delta) { if (delta < 0 && gageDebt(pid) <= 0) return; _pushDebtAdjust(pid, delta); }
function resetPlayerDebt(pid) { const d = gageDebt(pid); if (d <= 0) return; _pushDebtAdjust(pid, -d); }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  state = {
    seasons: [{ id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }],
    players: [{ id: 'p1', num: 4, name: 'Alice' }],
    gages: [], gageDraws: [],
  };
  _uid = 0; CLOCK = 1000;
}

console.log('SCÉNARIO A — le coach ajoute un gage AUTO-VALIDÉ (entre direct au pool)');
fresh();
t('submitCoachGage → status approved (pas pending)', () => {
  submitCoachGage('porter le maillot à l\'envers');
  assert.strictEqual(state.gages.length, 1);
  assert.strictEqual(state.gages[0].status, 'approved');
  assert.strictEqual(state.gages[0].authorId, 'coach');
});
t('le gage coach est immédiatement tirable (dans le pool approuvé)', () => {
  assignDrawsToPlayer('p1'); const d = drawFirst('p1');
  assert.ok(d.gageId && state.gages.some(g => g.id === d.gageId && g.status === 'approved'));
});

console.log('SCÉNARIO B — gestion des dettes : +1 / −1 / reset');
fresh();
t('+1 dette (correction manuelle)', () => { adjustPlayerDebt('p1', 1); assert.strictEqual(gageDebt('p1'), 1); });
t('+1 encore → dette 2', () => { adjustPlayerDebt('p1', 1); assert.strictEqual(gageDebt('p1'), 2); });
t('−1 → dette 1', () => { adjustPlayerDebt('p1', -1); assert.strictEqual(gageDebt('p1'), 1); });
t('−1 sous 0 est clampé (pas de dette négative)', () => { adjustPlayerDebt('p1', -1); assert.strictEqual(gageDebt('p1'), 0); adjustPlayerDebt('p1', -1); assert.strictEqual(gageDebt('p1'), 0); });

console.log('SCÉNARIO C — reset ramène à 0 même une dette issue de skips');
fresh(); submitCoachGage('g');
t('skip → dette 1 puis +1 manuel → dette 2', () => {
  assignDrawsToPlayer('p1'); const d = drawFirst('p1'); skipDraw(d);
  assert.strictEqual(gageDebt('p1'), 1);
  adjustPlayerDebt('p1', 1);
  assert.strictEqual(gageDebt('p1'), 2);
});
t('resetPlayerDebt → dette 0', () => { resetPlayerDebt('p1'); assert.strictEqual(gageDebt('p1'), 0); });
t('après reset, un nouvel assign ne réintroduit pas l\'ancienne dette', () => {
  assert.strictEqual(assignDrawsToPlayer('p1'), 1); // 1 + dette(0)
});

console.log('SCÉNARIO D — un batch propre postérieur périme les corrections manuelles');
fresh(); submitCoachGage('g');
t('+2 manuel puis batch entièrement accepté → dette 0', () => {
  adjustPlayerDebt('p1', 2);
  assert.strictEqual(gageDebt('p1'), 2);
  const n = assignDrawsToPlayer('p1'); // 1 + 2 = 3 tirages
  assert.strictEqual(n, 3);
  pendingDraws('p1').slice().forEach(d => { drawFirst('p1'); acceptDraw(d); });
  assert.strictEqual(gageDebt('p1'), 0, 'batch propre → reset, y compris des ajustements antérieurs');
});

console.log('SCÉNARIO E — les lignes adjust sont INERTES (pas de tirage à faire)');
fresh();
t('adjust ne crée pas de tirage owed', () => {
  adjustPlayerDebt('p1', 3);
  assert.strictEqual(pendingDraws('p1').length, 0);
  assert.strictEqual(gageDebt('p1'), 3);
});

console.log(`\n✅ ${pass} assertions OK — coach auto-validé + gestion dette (+1/−1/reset), inertie des ajustements.`);
