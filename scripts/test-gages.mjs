// Test de la BOÎTE À GAGES — modèle TIRAGE (le coach assigne le DEVOIR de tirer,
// pas un gage précis ; la joueuse pioche au sort dans le pool). Reproduit
// fidèlement index.html : proposer → modérer → faire tirer (1+dette) → tirage
// aléatoire (anti-répétition) → accepter/passer (dette +1/skip).
import assert from 'node:assert';

let state;
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function getSeasonIdForDate(dateStr) { if (!dateStr || !_seasonsLoaded()) return null; const hit = (state.seasons || []).find(s => s.startDate && dateStr >= s.startDate && (!s.endDate || dateStr <= s.endDate)); return hit ? hit.id : null; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extrait fidèle) ---
function _gageInSeason(g, seasonId) { if (!_seasonsLoaded()) return true; if (g.seasonId) return g.seasonId === seasonId; return seasonId === getActiveSeasonId(); }
function currentSeasonGages() { const active = getActiveSeasonId(); if (!_seasonsLoaded() || !active) return state.gages || []; return (state.gages || []).filter(g => _gageInSeason(g, active)); }
function _seasonGageDraws(pid) { const active = getActiveSeasonId(); return (state.gageDraws || []).filter(d => d.playerId === pid && (!_seasonsLoaded() || !active || (d.seasonId ? d.seasonId === active : true))); }
function gageDebt(pid) {
  const mine = _seasonGageDraws(pid).filter(d => d.assignedAt);
  const batches = {}; mine.forEach(d => { (batches[d.assignedAt] = batches[d.assignedAt] || []).push(d); });
  let resetTime = 0;
  Object.values(batches).forEach(arr => { const allDone = arr.every(d => d.completedAt); const clean = allDone && arr.every(d => d.status === 'accepted'); if (clean) { const c = Math.max(...arr.map(d => d.completedAt || 0)); if (c > resetTime) resetTime = c; } });
  return mine.filter(d => d.status === 'skipped' && (d.completedAt || 0) > resetTime).length;
}
function pendingDraws(pid) { return _seasonGageDraws(pid).filter(d => d.status === 'owed').sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0)); }
function _drawPoolFor(pid) {
  const approved = currentSeasonGages().filter(g => g.status === 'approved');
  const drawn = new Set((state.gageDraws || []).filter(d => d.playerId === pid && d.gageId).map(d => d.gageId));
  const fresh = approved.filter(g => !drawn.has(g.id));
  return fresh.length ? fresh : approved;
}
function submitGageProposal(text, role, pid) { state.gages.unshift({ id: uid(), text, authorId: role === 'player' ? pid : 'coach', status: 'pending', rejectedReason: null, seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() }); return true; }
function approveGage(id) { const g = state.gages.find(x => x.id === id); if (!g || g.status !== 'pending') return; g.status = 'approved'; }
function rejectGage(id, reason) { const g = state.gages.find(x => x.id === id); if (!g || g.status !== 'pending') return; g.status = 'rejected'; g.rejectedReason = reason || null; }
function assignDrawsToPlayer(pid) {
  const t = now(); const sid = getSeasonIdForDate(isoDate(new Date(2026, 10, 10))) || getActiveSeasonId() || null;
  const count = 1 + gageDebt(pid);
  for (let i = 0; i < count; i++) state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'owed', assignedAt: t, drawnAt: null, completedAt: null, seasonId: sid, createdAt: t + i, updatedAt: t });
  return count;
}
function cancelOwedDraws(pid) { state.gageDraws = state.gageDraws.filter(d => !(d.playerId === pid && d.status === 'owed')); }
// tirage : pioche (déterministe pour le test : 1er du pool éligible) + fige gageId
function drawOne(pid, draw) { if (!draw.gageId) { const pool = _drawPoolFor(pid); if (!pool.length) return null; draw.gageId = pool[0].id; draw.drawnAt = now(); } return draw.gageId; }
function acceptDraw(pid, draw) { if (draw.playerId !== pid || draw.status !== 'owed') return false; draw.status = 'accepted'; draw.completedAt = now(); return true; }
function skipDraw(pid, draw) { if (draw.playerId !== pid || draw.status !== 'owed') return false; draw.status = 'skipped'; draw.completedAt = now(); return true; }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  state = {
    currentSeasonId: '2026-2027',
    seasons: [ { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' }, { id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' } ],
    players: [{ id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' }],
    gages: [], gageDraws: [],
  };
  _uid = 0; CLOCK = 1000;
}
function seedApproved(n) { const ids = []; for (let i = 0; i < n; i++) { const id = uid(); state.gages.push({ id, text: 'g' + i, authorId: 'coach', status: 'approved', seasonId: '2026-2027', createdAt: now() }); ids.push(id); } return ids; }

console.log('SCÉNARIO 1 — le coach assigne un TIRAGE (pas un gage), la joueuse pioche');
fresh(); seedApproved(4);
t('assign 1 tirage owed (gageId null au départ)', () => {
  assert.strictEqual(assignDrawsToPlayer('p1'), 1);
  const d = pendingDraws('p1')[0];
  assert.strictEqual(d.gageId, null);
  assert.strictEqual(d.status, 'owed');
});
t('le coach ne choisit PAS le gage : la joueuse pioche dans le pool', () => {
  const d = pendingDraws('p1')[0];
  const gid = drawOne('p1', d);
  assert.ok(gid && state.gages.some(g => g.id === gid && g.status === 'approved'));
});
t('accepter → plus de tirage dû', () => { acceptDraw('p1', pendingDraws('p1')[0] || state.gageDraws.find(x=>x.playerId==='p1')); assert.strictEqual(pendingDraws('p1').length, 0); });

console.log('SCÉNARIO 2 — DETTE : skip toujours possible, +1 tirage au prochain assign');
fresh(); seedApproved(8);
t('assign → skip → dette 1', () => {
  assignDrawsToPlayer('p1'); const d = pendingDraws('p1')[0]; drawOne('p1', d); skipDraw('p1', d);
  assert.strictEqual(gageDebt('p1'), 1);
});
t('prochain assign = 1 + dette = 2 tirages', () => { assert.strictEqual(assignDrawsToPlayer('p1'), 2); });
t('accepter les 2 du batch → dette reset 0', () => {
  pendingDraws('p1').slice().forEach(d => { drawOne('p1', d); acceptDraw('p1', d); });
  assert.strictEqual(gageDebt('p1'), 0);
});
t('skip 1 + accept 1 d\'un batch de 2 → dette 2 → prochain assign = 3', () => {
  assignDrawsToPlayer('p1'); let d = pendingDraws('p1')[0]; drawOne('p1', d); skipDraw('p1', d); // dette 1
  assert.strictEqual(assignDrawsToPlayer('p1'), 2);                                              // batch de 2
  const q = pendingDraws('p1'); drawOne('p1', q[0]); skipDraw('p1', q[0]); drawOne('p1', q[1]); acceptDraw('p1', q[1]);
  assert.strictEqual(gageDebt('p1'), 2);
  assert.strictEqual(assignDrawsToPlayer('p1'), 3);
});

console.log('SCÉNARIO 3 — anti-répétition : ne re-tire pas un gage déjà tiré');
fresh(); const ids3 = seedApproved(3);
t('3 tirages → 3 gages DISTINCTS', () => {
  const got = [];
  for (let i = 0; i < 3; i++) { assignDrawsToPlayer('p1'); const d = pendingDraws('p1')[0]; got.push(drawOne('p1', d)); acceptDraw('p1', d); }
  assert.strictEqual(new Set(got).size, 3, 'aucune répétition tant que le pool a des gages neufs');
});
t('pool épuisé → repli autorise une répétition (pas de blocage)', () => {
  assignDrawsToPlayer('p1'); const d = pendingDraws('p1')[0]; const gid = drawOne('p1', d);
  assert.ok(ids3.includes(gid), 'repli sur le pool complet quand tout déjà tiré');
});

console.log('SCÉNARIO 4 — pool vide : pas de tirage possible (non bloquant)');
fresh();
t('assign sans pool → owed mais _drawPoolFor vide', () => {
  assignDrawsToPlayer('p1');
  assert.strictEqual(pendingDraws('p1').length, 1);
  assert.strictEqual(_drawPoolFor('p1').length, 0); // rien à tirer → l'UI ne bloque pas
});

console.log('SCÉNARIO 5 — annulation des tirages dûs par le coach');
fresh(); seedApproved(2);
t('cancelOwedDraws supprime les owed', () => {
  assignDrawsToPlayer('p1'); assignDrawsToPlayer('p1');
  assert.ok(pendingDraws('p1').length >= 1);
  cancelOwedDraws('p1');
  assert.strictEqual(pendingDraws('p1').length, 0);
});

console.log('SCÉNARIO 6 — cloisonnement saison');
fresh(); seedApproved(2);
t('tirage owed 2026-2027 invisible quand active = 2025-2026', () => {
  assignDrawsToPlayer('p1');
  assert.strictEqual(pendingDraws('p1').length, 1);
  state.seasons = state.seasons.map(s => ({ ...s, status: s.id === '2025-2026' ? 'active' : 'archived' }));
  state.currentSeasonId = '2025-2026';
  assert.strictEqual(pendingDraws('p1').length, 0);
  assert.strictEqual(gageDebt('p1'), 0);
});

console.log('SCÉNARIO 7 — proposition + modération + anonymat (inchangé)');
fresh();
t('joueuse propose → pending ; approuve → entre au pool ; rejette → rejected', () => {
  submitGageProposal('idée', 'player', 'p1');
  const id = state.gages[0].id;
  approveGage(id); assert.strictEqual(state.gages[0].status, 'approved');
  submitGageProposal('nope', 'player', 'p2'); const id2 = state.gages[0].id;
  rejectGage(id2, 'pas ok'); assert.strictEqual(state.gages[0].status, 'rejected');
});
t('anonymat : on ne retrouve ses propres propositions que via son propre id', () => {
  assert.strictEqual(state.gages.filter(g => g.authorId === 'p2').length, 1);
});

console.log(`\n✅ ${pass} assertions OK — modèle TIRAGE (assign-draws), dette, anti-répétition, pool vide, saison, modération.`);
