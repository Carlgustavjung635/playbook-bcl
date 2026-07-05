// Test du SCOUTING adversaires championnat (feature FFBB) : agrégation PM/M (points
// marqués par match) et PE/M (encaissés) par équipe à partir des matchs joués,
// seuil « stats suffisantes » (≥ 3 matchs), tri, et lookup adversaire par nom
// (exact + normalisé) pour l'injection en prépa. Extrait fidèle d'index.html.
import assert from 'node:assert';

const FFBB_SCOUT_MIN_GAMES = 3;

// --- SUJET (extrait fidèle d'index.html) ---
function ffbbComputeStandings(matches) {
  const t = {};
  const get = n => t[n] || (t[n] = { team: n, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, pts: 0 });
  (matches || []).forEach(m => {
    if (!m.played) return;
    const a = get(m.home), b = get(m.away);
    a.played++; b.played++;
    a.pf += m.homeScore; a.pa += m.awayScore;
    b.pf += m.awayScore; b.pa += m.homeScore;
    if (m.homeScore > m.awayScore) { a.wins++; b.losses++; }
    else if (m.awayScore > m.homeScore) { b.wins++; a.losses++; }
  });
  Object.values(t).forEach(x => x.pts = x.wins * 2 + x.losses);
  return Object.values(t).sort((x, y) => y.pts - x.pts || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf);
}
function ffbbTeamAggFromMatches(matches) {
  return ffbbComputeStandings(matches || []).map(s => ({
    team: s.team, played: s.played, wins: s.wins, losses: s.losses, pf: s.pf, pa: s.pa,
    pmPerG: s.played ? s.pf / s.played : 0,
    pePerG: s.played ? s.pa / s.played : 0,
    diffPerG: s.played ? (s.pf - s.pa) / s.played : 0,
    enough: s.played >= FFBB_SCOUT_MIN_GAMES
  }));
}
function ffbbOpponentScout(opponentName, matches) {
  if (!opponentName) return null;
  const rows = ffbbTeamAggFromMatches(matches);
  const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(opponentName);
  return rows.find(r => norm(r.team) === target) || null;
}
function sortRows(rows, col, dir) {
  const k = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    if (col === 'team') return k * (a.team || '').localeCompare(b.team || '');
    return k * (((a[col] || 0) - (b[col] || 0)) || (b.played - a.played));
  });
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

// Poule : ALPHA (fort en attaque), BRAVO (fort en défense), CHARLIE (peu de matchs).
// Matchs (home vs away) joués :
//  A vs B 80-60, A vs C 90-70, B vs A 55-50, C vs B 40-70  (B a joué 3, A a joué 3, C a joué 2)
const matches = [
  { id: 'm1', home: 'ALPHA', away: 'BRAVO', homeScore: 80, awayScore: 60, played: true },
  { id: 'm2', home: 'ALPHA', away: 'CHARLIE', homeScore: 90, awayScore: 70, played: true },
  { id: 'm3', home: 'BRAVO', away: 'ALPHA', homeScore: 55, awayScore: 50, played: true },
  { id: 'm4', home: 'CHARLIE', away: 'BRAVO', homeScore: 40, awayScore: 70, played: true },
  { id: 'm5', home: 'ALPHA', away: 'BRAVO', homeScore: 0, awayScore: 0, played: false }, // pas joué → ignoré
];

console.log('SCÉNARIO 1 — agrégats PM/M et PE/M corrects');
t('ALPHA : 3 matchs, PF=80+90+50=220, PA=60+70+55=185 → PM/M≈73.3, PE/M≈61.7', () => {
  const a = ffbbTeamAggFromMatches(matches).find(r => r.team === 'ALPHA');
  assert.strictEqual(a.played, 3);
  assert.strictEqual(a.pf, 220); assert.strictEqual(a.pa, 185);
  assert.ok(Math.abs(a.pmPerG - 73.333) < 0.01);
  assert.ok(Math.abs(a.pePerG - 61.666) < 0.01);
});
t('BRAVO : 3 matchs joués (enough=true)', () => {
  const b = ffbbTeamAggFromMatches(matches).find(r => r.team === 'BRAVO');
  assert.strictEqual(b.played, 3);
  assert.strictEqual(b.enough, true);
});
t('match non joué exclu du calcul', () => {
  const a = ffbbTeamAggFromMatches(matches).find(r => r.team === 'ALPHA');
  assert.strictEqual(a.played, 3); // m5 ignoré (sinon 4)
});

console.log('SCÉNARIO 2 — seuil « stats suffisantes » (≥ 3 matchs)');
t('CHARLIE : 2 matchs → enough=false', () => {
  const c = ffbbTeamAggFromMatches(matches).find(r => r.team === 'CHARLIE');
  assert.strictEqual(c.played, 2);
  assert.strictEqual(c.enough, false);
});
t('filtre enoughOnly retire CHARLIE', () => {
  const kept = ffbbTeamAggFromMatches(matches).filter(r => r.enough).map(r => r.team);
  assert.deepStrictEqual(kept.sort(), ['ALPHA', 'BRAVO']);
});

console.log('SCÉNARIO 3 — tri triable sur chaque colonne');
t('tri PM/M desc → ALPHA en tête (meilleure attaque)', () => {
  const rows = sortRows(ffbbTeamAggFromMatches(matches), 'pmPerG', 'desc');
  assert.strictEqual(rows[0].team, 'ALPHA');
});
t('tri PE/M asc → meilleure défense en tête', () => {
  const rows = sortRows(ffbbTeamAggFromMatches(matches).filter(r => r.enough), 'pePerG', 'asc');
  // BRAVO PA=60+70+50=... vs ALPHA PA=185 ; BRAVO encaisse moins par match ?
  const bravo = ffbbTeamAggFromMatches(matches).find(r => r.team === 'BRAVO');
  const alpha = ffbbTeamAggFromMatches(matches).find(r => r.team === 'ALPHA');
  const best = bravo.pePerG <= alpha.pePerG ? 'BRAVO' : 'ALPHA';
  assert.strictEqual(rows[0].team, best);
});
t('tri team asc = ordre alphabétique', () => {
  const rows = sortRows(ffbbTeamAggFromMatches(matches), 'team', 'asc');
  assert.deepStrictEqual(rows.map(r => r.team), ['ALPHA', 'BRAVO', 'CHARLIE']);
});

console.log('SCÉNARIO 4 — lookup adversaire (injection prépa) par nom exact + normalisé');
t('nom exact', () => {
  const sc = ffbbOpponentScout('BRAVO', matches);
  assert.ok(sc && sc.team === 'BRAVO' && sc.played === 3);
});
t('normalisation casse + espaces multiples', () => {
  const sc = ffbbOpponentScout('  bravo ', matches);
  assert.ok(sc && sc.team === 'BRAVO');
});
t('adversaire inconnu → null (pas de bloc en prépa)', () => {
  assert.strictEqual(ffbbOpponentScout('DELTA', matches), null);
});
t('opponent vide → null', () => {
  assert.strictEqual(ffbbOpponentScout('', matches), null);
});

console.log(`\n✅ ${pass} assertions OK — agrégats PM/M / PE/M, seuil ${FFBB_SCOUT_MIN_GAMES} matchs, tri, lookup adversaire normalisé.`);
