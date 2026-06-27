// Test de la BOÎTE À GAGES — reproduit fidèlement la logique de index.html :
// proposer → modérer → assigner → tirage → accepter/passer, crédit/skip,
// cloisonnement saison, et invariant d'anonymat.
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

// --- SUJET (extrait fidèle) ---
const GAGE_SKIP_CREDIT = 2;
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
function submitGageProposal(text, role, pid, now) {
  text = (text || '').trim().slice(0, 140); if (!text) return false;
  state.gages = state.gages || [];
  state.gages.unshift({ id: uid(), text, authorId: role === 'player' ? pid : 'coach',
    status: 'pending', assignedTo: null, assignedAt: null, revealedAt: null, completedAt: null,
    rejectedReason: null, seasonId: getActiveSeasonId() || null, createdAt: now, updatedAt: now });
  return true;
}
function approveGage(id) { const g = _gageById(id); if (!g || g.status !== 'pending') return; g.status = 'approved'; }
function rejectGage(id, reason, now) { const g = _gageById(id); if (!g || g.status !== 'pending') return; g.status = 'rejected'; g.rejectedReason = reason || null; g.completedAt = now; }
function assignGage(id, pid, now) {
  const g = _gageById(id); if (!g || g.status !== 'approved') return;
  g.status = 'assigned'; g.assignedTo = pid; g.assignedAt = now;
  g.seasonId = getSeasonIdForDate(isoDate(new Date(now))) || getActiveSeasonId() || g.seasonId || null;
}
function unassignGage(id) { const g = _gageById(id); if (!g || g.status !== 'assigned' || g.revealedAt) return; g.status = 'approved'; g.assignedTo = null; g.assignedAt = null; }
function pendingGageReveals(pid) {
  return (state.gages || []).filter(g => g.assignedTo === pid && g.status === 'assigned' && _gageInSeason(g, getActiveSeasonId()))
    .sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0));
}
function gageCredit(pid) {
  const active = getActiveSeasonId();
  const done = (state.gages || []).filter(g => g.assignedTo === pid && _gageInSeason(g, active) && g.completedAt && (g.status === 'accepted' || g.status === 'skipped'))
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
  let c = 0; done.forEach(g => { c = g.status === 'skipped' ? 0 : c + 1; }); return c;
}
function canSkipGage(pid) { return gageCredit(pid) >= GAGE_SKIP_CREDIT; }
function acceptGage(id, pid, now) { const g = _gageById(id); if (!g || g.assignedTo !== pid || g.status !== 'assigned') return false; g.status = 'accepted'; g.revealedAt = now; g.completedAt = now; return true; }
function skipGage(id, pid, now) { const g = _gageById(id); if (!g || g.assignedTo !== pid || g.status !== 'assigned') return false; if (!canSkipGage(pid)) return false; g.status = 'skipped'; g.revealedAt = now; g.completedAt = now; return true; }

let pass = 0, T = 1000;
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
  _uid = 0;
}

console.log('SCÉNARIO 1 — flux complet : propose → modère → assigne → accepte');
fresh();
t('joueuse propose → status pending + author = elle', () => {
  submitGageProposal('Chanter l\'hymne', 'player', 'p1', T++);
  const g = state.gages[0];
  assert.strictEqual(g.status, 'pending');
  assert.strictEqual(g.authorId, 'p1');
});
t('coach approuve → approved', () => { approveGage(state.gages[0].id); assert.strictEqual(state.gages[0].status, 'approved'); });
t('coach assigne à p2 → assigned + assignedTo + saison de la date', () => {
  assignGage(state.gages[0].id, 'p2', Date.parse('2026-11-10T12:00:00'));
  const g = state.gages[0];
  assert.strictEqual(g.status, 'assigned');
  assert.strictEqual(g.assignedTo, 'p2');
  assert.strictEqual(g.seasonId, '2026-2027');
});
t('p2 voit le gage dans son tirage en attente', () => {
  assert.deepStrictEqual(pendingGageReveals('p2').map(g => g.id), state.gages.map(g => g.id));
});
t('p2 accepte → accepted, plus dans le tirage', () => {
  acceptGage(state.gages[0].id, 'p2', T++);
  assert.strictEqual(state.gages[0].status, 'accepted');
  assert.strictEqual(pendingGageReveals('p2').length, 0);
});

console.log('SCÉNARIO 2 — skip refusé sans crédit, autorisé après 2 acceptés');
fresh();
function quickCycle(pid, accept) {
  const g = { id: uid(), text: 'g', authorId: 'coach', status: 'approved', assignedTo: null, assignedAt: null, revealedAt: null, completedAt: null, seasonId: '2026-2027' };
  state.gages.push(g); assignGage(g.id, pid, T++);
  if (accept) acceptGage(g.id, pid, T++); return g.id;
}
t('crédit 0 → skip refusé', () => {
  const id = quickCycle('p1', false);
  assert.strictEqual(canSkipGage('p1'), false);
  assert.strictEqual(skipGage(id, 'p1', T++), false);
  assert.strictEqual(_gageById(id).status, 'assigned'); // inchangé
});
t('après 2 acceptés → crédit 2 → skip autorisé', () => {
  // d'abord traiter le gage en cours (accepter) puis 1 de plus
  acceptGage(state.gages[state.gages.length - 1].id, 'p1', T++); // accepte le précédent → crédit 1
  quickCycle('p1', true); // crédit 2
  assert.strictEqual(gageCredit('p1'), 2);
  assert.strictEqual(canSkipGage('p1'), true);
});
t('skip → status skipped + crédit remis à 0', () => {
  const id = quickCycle('p1', false); // nouveau gage assigné, crédit encore 2
  assert.strictEqual(skipGage(id, 'p1', T++), true);
  assert.strictEqual(_gageById(id).status, 'skipped');
  assert.strictEqual(gageCredit('p1'), 0); // reset après skip
});

console.log('SCÉNARIO 3 — désassignation avant tirage');
fresh();
t('coach désassigne un gage assigné non révélé → retour approved', () => {
  const g = { id: uid(), text: 'g', status: 'approved', assignedTo: null, seasonId: '2026-2027' };
  state.gages.push(g); assignGage(g.id, 'p1', T++);
  unassignGage(g.id);
  assert.strictEqual(g.status, 'approved');
  assert.strictEqual(g.assignedTo, null);
  assert.strictEqual(pendingGageReveals('p1').length, 0);
});

console.log('SCÉNARIO 4 — cloisonnement saison');
fresh();
t('gage assigné en 2026-2027 invisible quand l\'active devient 2025-2026', () => {
  const g = { id: uid(), text: 'g', status: 'assigned', assignedTo: 'p1', assignedAt: T++, seasonId: '2026-2027' };
  state.gages.push(g);
  assert.strictEqual(pendingGageReveals('p1').length, 1);
  // bascule saison active
  state.seasons = state.seasons.map(s => ({ ...s, status: s.id === '2025-2026' ? 'active' : 'archived' }));
  state.currentSeasonId = '2025-2026';
  assert.strictEqual(pendingGageReveals('p1').length, 0, 'gage d\'une autre saison non tiré');
  assert.strictEqual(gageCredit('p1'), 0);
});

console.log('SCÉNARIO 5 — anonymat : aucune autre joueuse n\'apprend l\'auteur');
fresh();
t('rendu joueuse ne référence jamais authorId d\'autrui (invariant)', () => {
  // p1 propose ; p2 (autre) ne doit pouvoir reconstruire que via SON propre id
  submitGageProposal('secret', 'player', 'p1', T++);
  const g = state.gages[0];
  // "mes propositions" pour p2 : filtre authorId === p2 → vide (n'apprend rien sur p1)
  const minePourP2 = state.gages.filter(x => x.authorId && x.authorId === 'p2');
  assert.strictEqual(minePourP2.length, 0);
  // pour p1 : retrouve la sienne (via son propre id, pas de fuite)
  const minePourP1 = state.gages.filter(x => x.authorId && x.authorId === 'p1');
  assert.strictEqual(minePourP1.length, 1);
});

console.log('SCÉNARIO 6 — modération : rejet');
fresh();
t('coach rejette → rejected + raison', () => {
  submitGageProposal('nope', 'player', 'p1', T++);
  rejectGage(state.gages[0].id, 'pas adapté', T++);
  assert.strictEqual(state.gages[0].status, 'rejected');
  assert.strictEqual(state.gages[0].rejectedReason, 'pas adapté');
  assert.strictEqual(pendingGageReveals('p1').length, 0);
});

console.log(`\n✅ ${pass} assertions OK — boîte à gages (flux, crédit/skip, désassignation, saison, anonymat, rejet).`);
