// Test de la BOÎTE À GAGES — reproduit fidèlement la logique de index.html :
// proposer → modérer → assigner (1 + dette) → tirage → accepter/passer.
// Mécanique DETTE (Option A) : skip TOUJOURS autorisé, +1 gage à la prochaine
// assignation ; reset à 0 quand un batch est entièrement accepté sans skip.
import assert from 'node:assert';

let state;
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function getSeasonIdForDate(dateStr) {
  if (!dateStr || !_seasonsLoaded()) return null;
  const hit = (state.seasons || []).find(s => s.startDate && dateStr >= s.startDate && (!s.endDate || dateStr <= s.endDate));
  return hit ? hit.id : null;
}
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extrait fidèle) ---
function _gageById(id) { return (state.gages || []).find(g => g.id === id); }
function _gageInSeason(g, seasonId) {
  if (!_seasonsLoaded()) return true;
  if (g.seasonId) return g.seasonId === seasonId;
  return seasonId === getActiveSeasonId();
}
function currentSeasonGages() {
  const active = getActiveSeasonId();
  if (!_seasonsLoaded() || !active) return state.gages || [];
  return (state.gages || []).filter(g => _gageInSeason(g, active));
}
function submitGageProposal(text, role, pid) {
  text = (text || '').trim().slice(0, 140); if (!text) return false;
  state.gages.unshift({ id: uid(), text, authorId: role === 'player' ? pid : 'coach',
    status: 'pending', assignedTo: null, assignedAt: null, revealedAt: null, completedAt: null,
    rejectedReason: null, seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() });
  return true;
}
function approveGage(id) { const g = _gageById(id); if (!g || g.status !== 'pending') return; g.status = 'approved'; }
function rejectGage(id, reason) { const g = _gageById(id); if (!g || g.status !== 'pending') return; g.status = 'rejected'; g.rejectedReason = reason || null; g.completedAt = now(); }
function unassignGage(id) { const g = _gageById(id); if (!g || g.status !== 'assigned' || g.revealedAt) return; g.status = 'approved'; g.assignedTo = null; g.assignedAt = null; }
function gageDebt(pid) {
  const active = getActiveSeasonId();
  const mine = (state.gages || []).filter(g => g.assignedTo === pid && g.assignedAt && _gageInSeason(g, active));
  const batches = {};
  mine.forEach(g => { (batches[g.assignedAt] = batches[g.assignedAt] || []).push(g); });
  let resetTime = 0;
  Object.values(batches).forEach(arr => {
    const allDone = arr.every(g => g.completedAt);
    const clean = allDone && arr.every(g => g.status === 'accepted');
    if (clean) { const c = Math.max(...arr.map(g => g.completedAt || 0)); if (c > resetTime) resetTime = c; }
  });
  return mine.filter(g => g.status === 'skipped' && (g.completedAt || 0) > resetTime).length;
}
function _assignOne(g, pid, t, sid) { g.status = 'assigned'; g.assignedTo = pid; g.assignedAt = t; g.seasonId = sid; }
function assignGage(id, pid) {
  const g = _gageById(id); if (!g || g.status !== 'approved') return 0;
  const t = now();
  const sid = getSeasonIdForDate(isoDate(new Date(2026, 10, 10))) || getActiveSeasonId() || g.seasonId || null;
  const debt = gageDebt(pid);
  _assignOne(g, pid, t, sid);
  let extras = 0;
  if (debt > 0) {
    currentSeasonGages().filter(x => x.status === 'approved' && x.id !== g.id)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, debt)
      .forEach(x => { _assignOne(x, pid, t, sid); extras++; });
  }
  return 1 + extras; // nb de gages assignés ce batch
}
function pendingGageReveals(pid) {
  return (state.gages || []).filter(g => g.assignedTo === pid && g.status === 'assigned' && _gageInSeason(g, getActiveSeasonId()))
    .sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0));
}
function acceptGage(id, pid) { const g = _gageById(id); if (!g || g.assignedTo !== pid || g.status !== 'assigned') return false; const t = now(); g.status = 'accepted'; g.revealedAt = t; g.completedAt = t; return true; }
function skipGage(id, pid) { const g = _gageById(id); if (!g || g.assignedTo !== pid || g.status !== 'assigned') return false; const t = now(); g.status = 'skipped'; g.revealedAt = t; g.completedAt = t; return true; } // toujours autorisé

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  state = {
    auth: { role: 'coach', playerId: null },
    currentSeasonId: '2026-2027',
    seasons: [
      { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' },
      { id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' },
    ],
    players: [{ id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' }],
    gages: [],
  };
  _uid = 0; CLOCK = 1000;
}
function seedApproved(n) { const ids = []; for (let i = 0; i < n; i++) { const id = uid(); state.gages.push({ id, text: 'g' + i, authorId: 'coach', status: 'approved', assignedTo: null, assignedAt: null, revealedAt: null, completedAt: null, seasonId: '2026-2027', createdAt: now() }); ids.push(id); } return ids; }

console.log('SCÉNARIO 1 — flux complet : propose → modère → assigne → accepte');
fresh();
t('joueuse propose → pending + author = elle', () => { submitGageProposal('Chanter', 'player', 'p1'); assert.strictEqual(state.gages[0].status, 'pending'); assert.strictEqual(state.gages[0].authorId, 'p1'); });
t('approuve → approved ; assigne → assigned (dette 0 = 1 gage)', () => {
  const id = state.gages[0].id; approveGage(id);
  assert.strictEqual(assignGage(id, 'p2'), 1);
  assert.strictEqual(state.gages[0].status, 'assigned');
  assert.strictEqual(pendingGageReveals('p2').length, 1);
});
t('p2 accepte → accepted, file vide, dette 0', () => {
  acceptGage(state.gages[0].id, 'p2');
  assert.strictEqual(pendingGageReveals('p2').length, 0);
  assert.strictEqual(gageDebt('p2'), 0);
});

console.log('SCÉNARIO 2 — DETTE : skip toujours possible, +1 gage au prochain assign');
fresh();
const ids = seedApproved(6); // pool de 6 gages approuvés
t('assign A → 1 gage (dette 0)', () => { assert.strictEqual(assignGage(ids[0], 'p1'), 1); });
t('skip A → dette 1', () => { assert.strictEqual(skipGage(ids[0], 'p1'), true); assert.strictEqual(gageDebt('p1'), 1); });
t('assign B → 2 gages (B + 1 extra dette, même batch)', () => {
  const n = assignGage(ids[1], 'p1');
  assert.strictEqual(n, 2);
  assert.strictEqual(pendingGageReveals('p1').length, 2);
});
t('accepter les 2 du batch → dette reset à 0', () => {
  pendingGageReveals('p1').slice().forEach(g => acceptGage(g.id, 'p1'));
  assert.strictEqual(gageDebt('p1'), 0);
});
t('re-skip plus tard : assign C → skip → dette 1 ; assign D(+1)=2 ; skip 1 accepte 1 → dette 2', () => {
  assignGage(ids[3], 'p1'); skipGage(ids[3], 'p1');          // dette 1
  assert.strictEqual(gageDebt('p1'), 1);
  assignGage(ids[4], 'p1');                                   // D + 1 extra = 2
  const q = pendingGageReveals('p1');
  assert.strictEqual(q.length, 2);
  skipGage(q[0].id, 'p1'); acceptGage(q[1].id, 'p1');        // 1 skip + 1 accept
  assert.strictEqual(gageDebt('p1'), 2, 'dette cumulée = 2 skips depuis le dernier reset');
});
t('prochain assign matérialise 1 + dette(2) = 3 gages', () => {
  // il reste assez d'approuvés ? on en rajoute pour être sûr
  seedApproved(3);
  const next = state.gages.find(g => g.status === 'approved');
  assert.strictEqual(assignGage(next.id, 'p1'), 3);
});

console.log('SCÉNARIO 3 — désassignation avant tirage');
fresh(); seedApproved(1);
t('désassigne un gage assigné non révélé → retour approved', () => {
  const id = state.gages[0].id; assignGage(id, 'p1'); unassignGage(id);
  assert.strictEqual(_gageById(id).status, 'approved');
  assert.strictEqual(pendingGageReveals('p1').length, 0);
});

console.log('SCÉNARIO 4 — cloisonnement saison');
fresh();
t('gage assigné en 2026-2027 invisible quand l\'active devient 2025-2026', () => {
  state.gages.push({ id: uid(), text: 'g', status: 'assigned', assignedTo: 'p1', assignedAt: now(), seasonId: '2026-2027' });
  assert.strictEqual(pendingGageReveals('p1').length, 1);
  state.seasons = state.seasons.map(s => ({ ...s, status: s.id === '2025-2026' ? 'active' : 'archived' }));
  state.currentSeasonId = '2025-2026';
  assert.strictEqual(pendingGageReveals('p1').length, 0);
  assert.strictEqual(gageDebt('p1'), 0);
});

console.log('SCÉNARIO 5 — anonymat : une autre joueuse n\'apprend pas l\'auteur');
fresh();
t('filtrer "mes propositions" par son propre id seulement', () => {
  submitGageProposal('secret', 'player', 'p1');
  assert.strictEqual(state.gages.filter(x => x.authorId === 'p2').length, 0);
  assert.strictEqual(state.gages.filter(x => x.authorId === 'p1').length, 1);
});

console.log('SCÉNARIO 6 — rejet');
fresh();
t('coach rejette → rejected + raison, pas dans le tirage', () => {
  submitGageProposal('nope', 'player', 'p1'); rejectGage(state.gages[0].id, 'pas adapté');
  assert.strictEqual(state.gages[0].status, 'rejected');
  assert.strictEqual(state.gages[0].rejectedReason, 'pas adapté');
  assert.strictEqual(pendingGageReveals('p1').length, 0);
});

console.log(`\n✅ ${pass} assertions OK — boîte à gages (flux, DETTE +1/skip, reset, désassign, saison, anonymat, rejet).`);
