// Test : le coach peut MODIFIER et SUPPRIMER (soft-delete) les gages du pool.
//   - édition du texte → persiste ;
//   - suppression → deleted_at posé, gage exclu du pool tirable (_drawPoolFor) ;
//   - un gage supprimé reste résolvable par id (historique des tirages passés).
// Extrait fidèle d'index.html.
import assert from 'node:assert';

let state;
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }
const GAGE_TEXT_MAX = 140;

// --- SUJET (extrait fidèle d'index.html) ---
function _gageById(id) { return (state.gages || []).find(g => g.id === id); }
function _gageTouch(g) { g.updatedAt = now(); }
function _gageInSeason(g, seasonId) { if (!_seasonsLoaded()) return true; if (g.seasonId) return g.seasonId === seasonId; return seasonId === getActiveSeasonId(); }
function currentSeasonGages() { const active = getActiveSeasonId(); if (!_seasonsLoaded() || !active) return state.gages || []; return (state.gages || []).filter(g => _gageInSeason(g, active)); }
function _drawPoolFor(pid) {
  const approved = currentSeasonGages().filter(g => g.status === 'approved' && !g.deletedAt);
  const drawn = new Set((state.gageDraws || []).filter(d => d.playerId === pid && d.gageId).map(d => d.gageId));
  const fresh = approved.filter(g => !drawn.has(g.id));
  return fresh.length ? fresh : approved;
}
// résolveur texte utilisé par l'historique coach (via state.gages, deleted inclus)
function gText(gid) { const g = (state.gages || []).find(x => x.id === gid); return g ? g.text : '(gage supprimé)'; }

function submitCoachGage(text) { text = (text || '').trim().slice(0, GAGE_TEXT_MAX); if (!text) return false; const g = { id: uid(), text, authorId: 'coach', status: 'approved', deletedAt: null, seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() }; state.gages.unshift(g); return g.id; }
function saveGageEdit(id, raw) { const g = _gageById(id); if (!g) return false; const text = (raw || '').trim().slice(0, GAGE_TEXT_MAX); if (!text) return false; g.text = text; _gageTouch(g); return true; }
function deleteGage(id) { const g = _gageById(id); if (!g || g.deletedAt) return false; g.deletedAt = now(); _gageTouch(g); return true; }

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

console.log('SCÉNARIO 1 — édition du texte d\'un gage');
fresh();
t('créer → éditer → texte persiste', () => {
  const id = submitCoachGage('chante l hymne');
  assert.strictEqual(_gageById(id).text, 'chante l hymne');
  saveGageEdit(id, 'Chante l\'hymne du club à l\'échauffement');
  assert.strictEqual(_gageById(id).text, 'Chante l\'hymne du club à l\'échauffement');
});
t('édition vide refusée (texte inchangé)', () => {
  const id = state.gages[0].id; const before = _gageById(id).text;
  assert.strictEqual(saveGageEdit(id, '   '), false);
  assert.strictEqual(_gageById(id).text, before);
});
t('édition tronquée à GAGE_TEXT_MAX', () => {
  const id = submitCoachGage('x');
  saveGageEdit(id, 'a'.repeat(300));
  assert.strictEqual(_gageById(id).text.length, GAGE_TEXT_MAX);
});

console.log('SCÉNARIO 2 — suppression douce : deleted_at posé + exclu du pool tirable');
fresh();
t('supprimer → deletedAt posé', () => {
  const id = submitCoachGage('gage à retirer');
  assert.strictEqual(_gageById(id).deletedAt, null);
  assert.ok(deleteGage(id));
  assert.ok(_gageById(id).deletedAt > 0);
});
t('gage supprimé absent de _drawPoolFor', () => {
  const a = submitCoachGage('actif A');
  const b = submitCoachGage('à supprimer B');
  deleteGage(b);
  const poolIds = _drawPoolFor('p1').map(g => g.id);
  assert.ok(poolIds.includes(a));
  assert.ok(!poolIds.includes(b));
});
t('double suppression sans effet (idempotent, retourne false)', () => {
  const id = submitCoachGage('c');
  assert.ok(deleteGage(id));
  const t1 = _gageById(id).deletedAt;
  assert.strictEqual(deleteGage(id), false);
  assert.strictEqual(_gageById(id).deletedAt, t1);
});
t('pool entièrement supprimé → _drawPoolFor vide (pas de repli sur supprimés)', () => {
  fresh();
  const id = submitCoachGage('seul');
  deleteGage(id);
  assert.strictEqual(_drawPoolFor('p1').length, 0);
});

console.log('SCÉNARIO 3 — l\'historique d\'un gage supprimé reste consultable');
fresh();
t('un gage tiré puis supprimé : son texte reste résolvable', () => {
  const id = submitCoachGage('gage tiré puis supprimé');
  // simulate un tirage passé référencant ce gage
  state.gageDraws.push({ id: uid(), playerId: 'p1', gageId: id, status: 'accepted', assignedAt: now(), completedAt: now() });
  deleteGage(id);
  // exclu du pool…
  assert.ok(!_drawPoolFor('p1').map(g => g.id).includes(id));
  // …mais toujours affichable dans l'historique
  assert.strictEqual(gText(id), 'gage tiré puis supprimé');
});
t('édition d\'un gage supprimé se reflète dans l\'historique', () => {
  const id = state.gages.find(g => g.deletedAt).id;
  saveGageEdit(id, 'texte corrigé a posteriori');
  assert.strictEqual(gText(id), 'texte corrigé a posteriori');
});

console.log(`\n✅ ${pass} assertions OK — édition, soft-delete (deleted_at), exclusion pool, historique préservé.`);
