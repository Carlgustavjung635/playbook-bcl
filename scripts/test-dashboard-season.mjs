// Test isolé : le Dashboard coach « saison » agrège la SEULE saison courante.
// Reproduit la source du dashboard (currentSeasonMatches) + les calculs bilan.
import assert from 'node:assert';

let state;
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function teamTagMatches(tag, want) { if (!want || want === 'all') return true; const t = tag || 'e1'; return t === want || t === 'both'; }
function effectiveTeamFilter() { return state.teamFilter || 'all'; }
function _filterEventsByTeam(list) {
  const want = effectiveTeamFilter();
  if (!want || want === 'all') return list;
  return list.filter(x => teamTagMatches(x.teamTag, want));
}
function _matchesSeasonId(seasonId) {
  if (!_seasonsLoaded()) return state.matches || [];
  const activeId = getActiveSeasonId();
  return (state.matches || []).filter(m => {
    if (m.seasonId) return m.seasonId === seasonId;
    return seasonId === activeId; // legacy → saison active
  });
}
function currentSeasonMatches() { return _filterEventsByTeam(_matchesSeasonId(state.currentSeasonId)); }

// reproduit le coeur de renderDashboard + renderDashTeam (bilan)
function dashboardBilan() {
  const matches = [...currentSeasonMatches()].sort((a, b) => a.date.localeCompare(b.date));
  const played = matches.filter(m => (m.scoreUs || 0) > 0 || (m.scoreOpp || 0) > 0);
  const wins = played.filter(m => m.scoreUs > m.scoreOpp).length;
  const losses = played.filter(m => m.scoreUs < m.scoreOpp).length;
  const avgFor = played.length ? played.reduce((a, m) => a + (m.scoreUs || 0), 0) / played.length : 0;
  return { count: played.length, wins, losses, avgFor };
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

state = {
  currentSeasonId: '2026-2027',
  teamFilter: 'all',
  seasons: [
    { id: '2025-2026', status: 'archived' },
    { id: '2026-2027', status: 'active' },
  ],
  players: [],
  matches: [
    // saison passée (ne doit PAS compter)
    { id: 'm1', date: '2025-11-01', seasonId: '2025-2026', scoreUs: 80, scoreOpp: 50, home: true },
    { id: 'm2', date: '2026-01-10', seasonId: '2025-2026', scoreUs: 40, scoreOpp: 70, home: false },
    { id: 'm3', date: '2026-03-10', seasonId: '2025-2026', scoreUs: 60, scoreOpp: 55, home: true },
    // saison courante (doit compter)
    { id: 'm4', date: '2026-10-05', seasonId: '2026-2027', scoreUs: 55, scoreOpp: 50, home: true },
    { id: 'm5', date: '2026-10-19', seasonId: '2026-2027', scoreUs: 45, scoreOpp: 60, home: false },
    { id: 'm6', date: '2026-11-02', seasonId: '2026-2027', scoreUs: 0, scoreOpp: 0, home: true }, // pas joué
  ],
};

console.log('SCÉNARIO — bilan dashboard = saison courante uniquement');
t('ne compte que les matchs joués de 2026-2027', () => {
  const b = dashboardBilan();
  assert.strictEqual(b.count, 2, '2 matchs joués en 2026-2027 (m6 non joué exclu)');
  assert.strictEqual(b.wins, 1);
  assert.strictEqual(b.losses, 1);
  assert.strictEqual(b.avgFor, (55 + 45) / 2);
});
t('les matchs de la saison passée sont exclus', () => {
  const ids = currentSeasonMatches().map(m => m.id).sort();
  assert.deepStrictEqual(ids, ['m4', 'm5', 'm6']);
  assert.ok(!ids.includes('m1'), 'm1 (saison passée) exclu');
});
t('si on bascule la saison courante → l\'autre bilan', () => {
  state.currentSeasonId = '2025-2026';
  const b = dashboardBilan();
  assert.strictEqual(b.count, 3, '3 matchs joués en 2025-2026');
  assert.strictEqual(b.wins, 2);
  assert.strictEqual(b.losses, 1);
  state.currentSeasonId = '2026-2027';
});
t('filtre équipe (pillule) appliqué', () => {
  state.matches.push({ id: 'm7', date: '2026-10-26', seasonId: '2026-2027', teamTag: 'e2', scoreUs: 30, scoreOpp: 20, home: true });
  state.teamFilter = 'e1';
  let b = dashboardBilan();
  assert.strictEqual(b.count, 2, 'E1 : m7 (e2) exclu');
  state.teamFilter = 'all';
  b = dashboardBilan();
  assert.strictEqual(b.count, 3, 'Toutes : m7 inclus');
  state.matches.pop();
  state.teamFilter = 'all';
});

console.log(`\n✅ ${pass} assertions OK — dashboard scopé saison courante.`);
