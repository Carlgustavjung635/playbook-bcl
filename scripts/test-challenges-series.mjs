// Test DÉFIS — modes series / timed : recompute d'agrégat + soft-delete + compat.
// Extrait FIDÈLE de _recomputeChallengeAggregate / _challengeSeriesOf (index.html).
import assert from 'node:assert';

function _challengeSeriesOf(c, pid) {
  return ((((c || {}).series || {})[pid]) || []).filter(s => !s.deletedAt)
    .slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function _recomputeChallengeAggregate(c, pid) {
  if (!c) return 0;
  const arr = _challengeSeriesOf(c, pid);
  if (!arr.length) return 0;
  const agg = ['average', 'best', 'sum', 'last'].includes(c.aggregate) ? c.aggregate : 'average';
  if (c.mode === 'timed') {
    const durs = arr.map(s => Number(s.durationMs) || 0).filter(v => v > 0);
    if (!durs.length) return 0;
    if (agg === 'average') return Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
    if (agg === 'sum') return durs.reduce((a, b) => a + b, 0);
    if (agg === 'last') return durs[durs.length - 1];
    return Math.min(...durs);
  }
  const size = Number.isFinite(c.seriesSize) && c.seriesSize > 0 ? c.seriesSize : null;
  const vals = arr.map(s => {
    const made = Number(s.made) || 0;
    const att = Number.isFinite(s.attempts) && s.attempts > 0 ? s.attempts : size;
    if (size && att && att !== size) return (made / att) * size;
    return made;
  });
  if (agg === 'best') return Math.max(...vals);
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'last') return vals[vals.length - 1];
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}
// Backward compat : un défi sans `mode` est traité comme 'single' (scalaire c.scores intact).
function effectiveScore(c, pid) {
  if (c.mode === 'series' || c.mode === 'timed') return _recomputeChallengeAggregate(c, pid);
  return (c.scores || {})[pid] || 0; // single
}

let passed = 0;
function ok(l, cnd) { assert.ok(cnd, '✗ ' + l); passed++; }

// ---- SERIES ----
const series = { mode: 'series', seriesSize: 25, aggregate: 'average', series: { p1: [
  { id: 'x1', made: 12, attempts: 25, createdAt: 1 },
  { id: 'x2', made: 15, attempts: 25, createdAt: 2 },
  { id: 'x3', made: 18, attempts: 25, createdAt: 3 }
] } };
ok('series average = (12+15+18)/3 = 15', _recomputeChallengeAggregate(series, 'p1') === 15);
series.aggregate = 'best'; ok('series best = 18', _recomputeChallengeAggregate(series, 'p1') === 18);
series.aggregate = 'sum'; ok('series sum = 45', _recomputeChallengeAggregate(series, 'p1') === 45);
series.aggregate = 'last'; ok('series last = 18 (dernière par date)', _recomputeChallengeAggregate(series, 'p1') === 18);

// average à 1 décimale
series.aggregate = 'average';
series.series.p2 = [{ id: 'y1', made: 10, attempts: 25, createdAt: 1 }, { id: 'y2', made: 13, attempts: 25, createdAt: 2 }];
ok('series average 1 décimale = 11.5', _recomputeChallengeAggregate(series, 'p2') === 11.5);

// normalisation attempts ≠ series_size (10/20 sur base 25 → 12.5)
const norm = { mode: 'series', seriesSize: 25, aggregate: 'average', series: { p1: [{ id: 'n1', made: 10, attempts: 20, createdAt: 1 }] } };
ok('normalisation 10/20 → 12.5 /25', _recomputeChallengeAggregate(norm, 'p1') === 12.5);

// ---- SOFT-DELETE ----
const del = { mode: 'series', seriesSize: 25, aggregate: 'average', series: { p1: [
  { id: 'd1', made: 10, attempts: 25, createdAt: 1 },
  { id: 'd2', made: 20, attempts: 25, createdAt: 2, deletedAt: 999 }
] } };
ok('soft-delete exclut la série (moyenne = 10, pas 15)', _recomputeChallengeAggregate(del, 'p1') === 10);
ok('_challengeSeriesOf ignore les supprimées (1 active)', _challengeSeriesOf(del, 'p1').length === 1);

// ---- TIMED ----
const timed = { mode: 'timed', aggregate: 'best', series: { p1: [
  { id: 't1', durationMs: 22300, createdAt: 1 },
  { id: 't2', durationMs: 19800, createdAt: 2 },
  { id: 't3', durationMs: 21000, createdAt: 3 }
] } };
ok('timed best = min = 19800ms', _recomputeChallengeAggregate(timed, 'p1') === 19800);
timed.aggregate = 'average'; ok('timed average = round((22300+19800+21000)/3) = 21033', _recomputeChallengeAggregate(timed, 'p1') === 21033);
timed.aggregate = 'last'; ok('timed last = 21000 (dernier run)', _recomputeChallengeAggregate(timed, 'p1') === 21000);

// ---- VIDE / BACKWARD COMPAT ----
ok('aucune série → agrégat 0', _recomputeChallengeAggregate({ mode: 'series', series: {} }, 'p1') === 0);
const single = { scores: { p1: 42 } }; // pas de mode → single
ok('défi sans mode = single, garde le scalaire (42)', effectiveScore(single, 'p1') === 42);
ok('défi mode single explicite garde le scalaire', effectiveScore({ mode: 'single', scores: { p1: 7 } }, 'p1') === 7);
// un défi series recompute (ignore un ancien scalaire résiduel)
ok('défi series recompute (ignore scalaire résiduel)', effectiveScore({ mode: 'series', seriesSize: 25, aggregate: 'best', scores: { p1: 999 }, series: { p1: [{ id: 'z', made: 5, attempts: 25, createdAt: 1 }] } }, 'p1') === 5);

// === 9. countdown_score : agrégat sur `made` (comme series sans normalisation) ===
const cd = { mode: 'countdown_score', aggregate: 'best', series: { p1: [
  { id: 'q1', made: 18, createdAt: 1 }, { id: 'q2', made: 22, createdAt: 2 }, { id: 'q3', made: 20, createdAt: 3 }
] } };
ok('countdown best = 22', _recomputeChallengeAggregate(cd, 'p1') === 22);
cd.aggregate = 'average'; ok('countdown average = 20', _recomputeChallengeAggregate(cd, 'p1') === 20);
cd.aggregate = 'sum'; ok('countdown sum = 60', _recomputeChallengeAggregate(cd, 'p1') === 60);
cd.aggregate = 'last'; ok('countdown last = 20', _recomputeChallengeAggregate(cd, 'p1') === 20);

// === 10. Paliers (tiers) — direction dérivée de lowerIsBetter ===
function _challengeTierFor(tiers, value, lowerIsBetter) {
  const t = (Array.isArray(tiers) ? tiers : []).filter(x => x && typeof x.threshold === 'number');
  if (!t.length || value == null) return null;
  if (lowerIsBetter) { const asc = t.slice().sort((a, b) => a.threshold - b.threshold); for (const tier of asc) if (value <= tier.threshold) return tier; return null; }
  const desc = t.slice().sort((a, b) => b.threshold - a.threshold); for (const tier of desc) if (value >= tier.threshold) return tier; return null;
}
function _challengeNextTier(tiers, value, lowerIsBetter) {
  const t = (Array.isArray(tiers) ? tiers : []).filter(x => x && typeof x.threshold === 'number');
  if (!t.length) return null;
  const v = (value == null) ? (lowerIsBetter ? Infinity : -Infinity) : value;
  if (lowerIsBetter) return t.filter(x => v > x.threshold).sort((a, b) => b.threshold - a.threshold)[0] || null;
  return t.filter(x => v < x.threshold).sort((a, b) => a.threshold - b.threshold)[0] || null;
}
const tiersHigh = [{ name: 'Bronze', threshold: 10 }, { name: 'Argent', threshold: 15 }, { name: 'Or', threshold: 20 }];
ok('higher : 17 → Argent (≥15, pas Or)', _challengeTierFor(tiersHigh, 17, false).name === 'Argent');
ok('higher : 20 → Or', _challengeTierFor(tiersHigh, 20, false).name === 'Or');
ok('higher : 8 → aucun palier', _challengeTierFor(tiersHigh, 8, false) === null);
ok('higher : prochain après 17 = Or (20)', _challengeNextTier(tiersHigh, 17, false).name === 'Or');
const tiersLow = [{ name: 'Or', threshold: 20000 }, { name: 'Argent', threshold: 25000 }, { name: 'Bronze', threshold: 30000 }];
ok('lower : 22000ms → Argent (≤25000, pas Or)', _challengeTierFor(tiersLow, 22000, true).name === 'Argent');
ok('lower : 19000ms → Or (≤20000)', _challengeTierFor(tiersLow, 19000, true).name === 'Or');
ok('lower : 31000ms → aucun palier', _challengeTierFor(tiersLow, 31000, true) === null);
ok('lower : prochain après 22000 = Or (20000)', _challengeNextTier(tiersLow, 22000, true).name === 'Or');

// === 11. Peer entry — entered_by (null si soi, sinon acteur) ===
function _entryEnteredBy(auth, targetPid) {
  const actor = auth.role === 'player' ? auth.playerId : (auth.role === 'coach' ? (auth.coachId || 'coach') : null);
  return (auth.role === 'player' && actor === targetPid) ? null : actor;
}
ok('joueuse pour elle-même → entered_by null', _entryEnteredBy({ role: 'player', playerId: 'pa' }, 'pa') === null);
ok('joueuse A pour joueuse B → entered_by = A', _entryEnteredBy({ role: 'player', playerId: 'pa' }, 'pb') === 'pa');
ok('coach pour joueuse → entered_by = coach id (tracé)', _entryEnteredBy({ role: 'coach', coachId: 'admin' }, 'pb') === 'admin');

console.log(`\n✓ ${passed} assertions passées — défis series/timed/countdown + paliers + peer entry OK`);
