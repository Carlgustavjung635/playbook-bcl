// Test isolé : résolution robuste de la saison du portail public (sans auth).
// Mirror fidèle de publicPortalSeasonId/Label/Matches (now injectable pour la date).
import assert from 'node:assert';

let state;
function _sportSeasonIdForDate(d) {
  const y = d.getFullYear();
  const startYear = (d.getMonth() >= 8) ? y : (y - 1);
  return startYear + '-' + (startYear + 1);
}
function publicPortalSeasonId(now) {
  const seasons = state.seasons || [];
  if (state.currentSeasonId && seasons.some(s => s.id === state.currentSeasonId)) return state.currentSeasonId;
  const derived = _sportSeasonIdForDate(now);
  if (seasons.some(s => s.id === derived)) return derived;
  if (!seasons.length && (state.matches || []).some(m => m.seasonId === derived)) return derived;
  if (seasons.length) return [...seasons].sort((a, b) => (b.startDate || b.id || '').localeCompare(a.startDate || a.id || ''))[0].id;
  return null;
}
function publicPortalSeasonLabel(seasonId) {
  if (!seasonId) return 'Toutes saisons';
  const s = (state.seasons || []).find(x => x.id === seasonId);
  if (s && s.name) return s.name;
  return 'Saison ' + seasonId;
}
function publicPortalSeasonMatches(seasonId) {
  if (!seasonId) return state.matches || [];
  return (state.matches || []).filter(m => m.seasonId === seasonId);
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

const seasonsFull = [
  { id: '2024-2025', name: 'Saison 2024-2025', startDate: '2024-09-01', status: 'archived' },
  { id: '2025-2026', name: 'Saison 2025-2026', startDate: '2025-09-01', status: 'archived' },
  { id: '2026-2027', name: 'Saison 2026-2027', startDate: '2026-09-01', status: 'active' },
];
const matchesFull = [
  { id: 'a', seasonId: '2025-2026', scoreUs: 70, scoreOpp: 50 },
  { id: 'b', seasonId: '2025-2026', scoreUs: 40, scoreOpp: 60 },
  { id: 'c', seasonId: '2026-2027', scoreUs: 55, scoreOpp: 52 },
];

console.log('SCÉNARIO — fallback hiérarchique de la saison du portail public');

t('1) currentSeasonId défini et valide → prioritaire', () => {
  state = { currentSeasonId: '2026-2027', seasons: seasonsFull, matches: matchesFull };
  const sid = publicPortalSeasonId(new Date('2026-06-27T12:00:00'));
  assert.strictEqual(sid, '2026-2027');
  assert.strictEqual(publicPortalSeasonLabel(sid), 'Saison 2026-2027');
  assert.deepStrictEqual(publicPortalSeasonMatches(sid).map(m => m.id), ['c']);
});

t('2) pas de currentSeasonId → saison sportive dérivée de la date (juin 2026 → 2025-2026)', () => {
  state = { currentSeasonId: null, seasons: seasonsFull, matches: matchesFull };
  const sid = publicPortalSeasonId(new Date('2026-06-27T12:00:00'));
  assert.strictEqual(sid, '2025-2026', 'juin = saison N-1/N');
  assert.deepStrictEqual(publicPortalSeasonMatches(sid).map(m => m.id), ['a', 'b']);
});

t('2bis) septembre bascule la saison sportive (sept 2026 → 2026-2027)', () => {
  state = { currentSeasonId: null, seasons: seasonsFull, matches: matchesFull };
  assert.strictEqual(publicPortalSeasonId(new Date('2026-09-02T12:00:00')), '2026-2027');
});

t('3) currentSeasonId absent + dérivée non présente dans seasons → la plus récente', () => {
  // date 2030 → derived 2030-2031 absent ; seasons connues → plus récente (2026-2027)
  state = { currentSeasonId: null, seasons: seasonsFull, matches: matchesFull };
  const sid = publicPortalSeasonId(new Date('2030-03-01T12:00:00'));
  assert.strictEqual(sid, '2026-2027', 'startDate la plus récente');
});

t('4) worst case state.seasons vide et pas de match dérivé → null → toutes saisons', () => {
  state = { currentSeasonId: null, seasons: [], matches: matchesFull };
  const sid = publicPortalSeasonId(new Date('2030-03-01T12:00:00'));
  assert.strictEqual(sid, null);
  assert.strictEqual(publicPortalSeasonLabel(sid), 'Toutes saisons');
  assert.strictEqual(publicPortalSeasonMatches(sid).length, 3, 'fallback toutes-saisons (ne vide pas le bilan)');
});

t('4bis) seasons vide MAIS matchs portent l\'id dérivé → on l\'utilise', () => {
  state = { currentSeasonId: null, seasons: [], matches: matchesFull };
  // juin 2026 → derived 2025-2026, présent sur a/b
  const sid = publicPortalSeasonId(new Date('2026-06-27T12:00:00'));
  assert.strictEqual(sid, '2025-2026');
  assert.deepStrictEqual(publicPortalSeasonMatches(sid).map(m => m.id), ['a', 'b']);
});

console.log(`\n✅ ${pass} assertions OK — portail public scopé saison + fallback robuste.`);
