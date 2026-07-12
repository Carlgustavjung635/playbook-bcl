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

console.log(`\n✓ ${passed} assertions passées — défis series/timed (agrégats, soft-delete, compat) OK`);
