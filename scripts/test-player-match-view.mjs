// Test de l'accès joueuse au détail match + section Composition.
// Reproduit fidèlement getMatchRoster / getMatchComposition + le routage
// openMatch de index.html. Vérifie le scope joueuse vs coach (info d'équipe
// partagée, AUCUNE donnée privée coach exposée).
import assert from 'node:assert';

let state;

// --- helpers copiés conformes ---
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function teamTagMatches(tag, want) { if (!want || want === 'all') return true; const t = tag || 'e1'; return t === want || t === 'both'; }
function getSeasonPlayers(seasonId, { team = 'all' } = {}) {
  if (!seasonId) return state.players || [];
  const links = (state.seasonPlayers || []).filter(sp => sp.seasonId === seasonId);
  return links.map(link => {
    const p = (state.players || []).find(p => p.id === link.playerId);
    if (!p || link.leftAt) return null;
    if (!teamTagMatches(link.teamTag, team)) return null;
    return { ...p };
  }).filter(Boolean);
}
function getMatchRoster(m) {
  if (m.roster && Array.isArray(m.roster.included)) {
    return (state.players || []).filter(p => m.roster.included.includes(p.id));
  }
  const _matchSeasonId = m.seasonId || state.currentSeasonId;
  const _matchTeam = m.teamTag === 'e2' ? 'e2' : 'e1';
  const _seasonPool = _seasonsLoaded() && _matchSeasonId ? getSeasonPlayers(_matchSeasonId, { team: _matchTeam }) : (state.players || []);
  const sameDayConvoc = (state.convocations || []).find(c => c.type === 'match' && c.date === m.date);
  if (sameDayConvoc) {
    const responses = sameDayConvoc.responses || {};
    return _seasonPool.filter(p => !responses[p.id] || responses[p.id].status === 'present');
  }
  return _seasonPool;
}
// SUJET DU TEST
function getMatchComposition(m, viewerId) {
  if (!m) return [];
  const roster = getMatchRoster(m) || [];
  const stats = m.playerStats || {};
  return roster.map(p => {
    const s = stats[p.id];
    return { id: p.id, num: p.num || 0, name: p.name || '', hasStats: !!s, pts: (s && s.pts) || 0, isMe: !!viewerId && p.id === viewerId };
  }).sort((a, b) => (a.num || 0) - (b.num || 0));
}
// routage openMatch (extrait fidèle) : la joueuse A ACCÈS au détail.
function matchDetailRouteFor(role, section) {
  if (role === 'player') return (section === 'match' || section === 'calendrier') ? section : 'match';
  return 'matches';
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshState() {
  return {
    currentSeasonId: '2026-2027',
    seasons: [{ id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }],
    players: [
      { id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' },
      { id: 'p3', num: 10, name: 'Chloé' }, { id: 'p4', num: 12, name: 'Dana' },
    ],
    seasonPlayers: [
      { seasonId: '2026-2027', playerId: 'p1', teamTag: 'e1' }, { seasonId: '2026-2027', playerId: 'p2', teamTag: 'e1' },
      { seasonId: '2026-2027', playerId: 'p3', teamTag: 'e1' }, { seasonId: '2026-2027', playerId: 'p4', teamTag: 'e2' },
    ],
    convocations: [],
    matches: [],
  };
}

console.log('SCÉNARIO 1 — la joueuse A ACCÈS au détail match (routage)');
t('player → section match (détail accessible)', () => {
  assert.strictEqual(matchDetailRouteFor('player', 'home'), 'match');
  assert.strictEqual(matchDetailRouteFor('player', 'calendrier'), 'calendrier');
});
t('coach → section matches', () => assert.strictEqual(matchDetailRouteFor('coach', 'home'), 'matches'));

console.log('SCÉNARIO 2 — Composition résolue depuis le roster figé + annotations');
state = freshState();
const m = { id: 'm1', date: '2026-11-02', teamTag: 'e1', seasonId: '2026-2027',
  roster: { included: ['p1', 'p2', 'p3'] },
  playerStats: { p1: { pts: 12, min: 25 }, p3: { pts: 4, min: 10 } },
  // champs PRIVÉS coach (ne doivent jamais fuiter dans la composition) :
  prepComment: 'Stratégie secrète', playerReviews: { p1: { rating: 5, comment: 'privé' } }, negatives: ['à corriger'] };
state.matches.push(m);
t('roster figé (3 joueuses), trié par numéro', () => {
  const comp = getMatchComposition(m, 'p1');
  assert.deepStrictEqual(comp.map(c => c.id), ['p1', 'p2', 'p3']);
  assert.deepStrictEqual(comp.map(c => c.num), [4, 7, 10]);
});
t('hasStats / pts annotés (qui a joué)', () => {
  const comp = getMatchComposition(m, 'p1');
  const byId = Object.fromEntries(comp.map(c => [c.id, c]));
  assert.strictEqual(byId.p1.hasStats, true); assert.strictEqual(byId.p1.pts, 12);
  assert.strictEqual(byId.p2.hasStats, false); assert.strictEqual(byId.p2.pts, 0);
});
t('isMe = la joueuse connectée', () => {
  const comp = getMatchComposition(m, 'p2');
  assert.strictEqual(comp.find(c => c.id === 'p2').isMe, true);
  assert.strictEqual(comp.find(c => c.id === 'p1').isMe, false);
});

console.log('SCÉNARIO 3 — scope : composition identique coach/joueuse, AUCUN champ privé');
t('même roster pour coach (viewerId null) et joueuse', () => {
  const coachComp = getMatchComposition(m, null);
  const playerComp = getMatchComposition(m, 'p1');
  assert.deepStrictEqual(coachComp.map(c => c.id), playerComp.map(c => c.id));
});
t('la composition n\'expose que id/num/name/hasStats/pts/isMe (rien de privé)', () => {
  const keys = Object.keys(getMatchComposition(m, 'p1')[0]).sort();
  assert.deepStrictEqual(keys, ['hasStats', 'id', 'isMe', 'name', 'num', 'pts']);
  // aucune trace de prepComment / playerReviews / negatives dans la sortie
  const json = JSON.stringify(getMatchComposition(m, 'p1'));
  assert.ok(!json.includes('Stratégie'), 'pas de prépa');
  assert.ok(!json.includes('privé'), 'pas de ressenti');
  assert.ok(!json.includes('corriger'), 'pas de points négatifs coach');
});

console.log('SCÉNARIO 4 — fallback roster : convocation du jour, puis effectif saison');
state = freshState();
state.convocations.push({ id: 'cv', type: 'match', date: '2026-11-09', teamTag: 'e1', responses: { p2: { status: 'absent' } } });
const m2 = { id: 'm2', date: '2026-11-09', teamTag: 'e1', seasonId: '2026-2027', playerStats: {} };
state.matches.push(m2);
t('sans roster figé → convocation (absente exclue)', () => {
  const comp = getMatchComposition(m2, 'p1');
  // p1,p3 e1 présentes ; p2 absente exclue ; p4 est e2 (hors équipe e1)
  assert.deepStrictEqual(comp.map(c => c.id), ['p1', 'p3']);
});
t('sans roster ni convocation → effectif saison de l\'équipe', () => {
  const m3 = { id: 'm3', date: '2026-12-01', teamTag: 'e1', seasonId: '2026-2027', playerStats: {} };
  const comp = getMatchComposition(m3, null);
  assert.deepStrictEqual(comp.map(c => c.id), ['p1', 'p2', 'p3']); // e1 uniquement
});

console.log(`\n✅ ${pass} assertions OK — joueuse a accès au détail + composition (sans fuite coach).`);
