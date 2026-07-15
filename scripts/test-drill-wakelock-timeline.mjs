// Test FIX veille iOS — timeline absolue + horloge Date.now() résiliente.
// Extrait FIDÈLE de _intervalTimelineOffsets / _currentPhaseAt / _intervalElapsedMs
// (index.html). Objectif : après un gel du tick (écran éteint), on retombe sur la
// BONNE phase au BON instant, car tout est recalculé depuis l'horloge absolue.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

// ---- COPIE FIDÈLE ----
function _intervalTimelineOffsets(phases) {
  let acc = 0;
  return (phases || []).map(p => {
    const start = acc, dur = Math.max(0, Number(p.duration_ms) || 0);
    acc += dur;
    return Object.assign({}, p, { start_ms: start, end_ms: acc });
  });
}
function _currentPhaseAt(elapsedMs, timeline) {
  const t = timeline || [];
  const e = Math.max(0, Number(elapsedMs) || 0);
  for (let i = 0; i < t.length; i++) {
    if (e < t[i].end_ms) return { index: i, phase: t[i], phaseElapsedMs: e - t[i].start_ms, phaseRemainingMs: t[i].end_ms - e };
  }
  return null;
}
// elapsed = now - startEpoch - pausedAccum - (pause en cours)
function _elapsedMs(c, now) {
  const pausedNow = (c.paused && c.pauseStartedAt) ? (now - c.pauseStartedAt) : 0;
  return Math.max(0, now - c.startEpoch - c.pausedAccumMs - pausedNow);
}

// Tabata simplifié : 3 cycles de 20s work / 10s rest = 90s
const PHASES = [
  { type: 'work', label: 'WORK', duration_ms: 20000, cycleIndex: 1, cycleTotal: 3 },
  { type: 'rest', label: 'REST', duration_ms: 10000, cycleIndex: 1, cycleTotal: 3 },
  { type: 'work', label: 'WORK', duration_ms: 20000, cycleIndex: 2, cycleTotal: 3 },
  { type: 'rest', label: 'REST', duration_ms: 10000, cycleIndex: 2, cycleTotal: 3 },
  { type: 'work', label: 'WORK', duration_ms: 20000, cycleIndex: 3, cycleTotal: 3 },
  { type: 'rest', label: 'REST', duration_ms: 10000, cycleIndex: 3, cycleTotal: 3 }
];
const TL = _intervalTimelineOffsets(PHASES);

// ---- 1. Offsets absolus ----
eq('phase 0 start=0', TL[0].start_ms, 0);
eq('phase 0 end=20000', TL[0].end_ms, 20000);
eq('phase 1 start=20000 (enchaîne)', TL[1].start_ms, 20000);
eq('phase 1 end=30000', TL[1].end_ms, 30000);
eq('phase 5 end = total 90000', TL[5].end_ms, 90000);
eq('timeline garde les métadonnées (label)', TL[2].label, 'WORK');
eq('timeline garde cycleIndex', TL[4].cycleIndex, 3);

// ---- 2. _currentPhaseAt : la phase à tout instant ----
eq('t=0 → phase 0 (work c1)', _currentPhaseAt(0, TL).index, 0);
eq('t=19999 → encore phase 0', _currentPhaseAt(19999, TL).index, 0);
eq('t=20000 → bascule phase 1 (rest, borne exclusive)', _currentPhaseAt(20000, TL).index, 1);
eq('t=29999 → encore phase 1', _currentPhaseAt(29999, TL).index, 1);
eq('t=30000 → phase 2 (work c2)', _currentPhaseAt(30000, TL).index, 2);
eq('t=85000 → phase 5 (rest c3)', _currentPhaseAt(85000, TL).index, 5);
eq('t=89999 → encore phase 5', _currentPhaseAt(89999, TL).index, 5);
eq('t=90000 → null (terminé)', _currentPhaseAt(90000, TL), null);
eq('t=999999 → null (bien terminé)', _currentPhaseAt(999999, TL), null);
eq('elapsed négatif clampé → phase 0', _currentPhaseAt(-500, TL).index, 0);

// ---- 3. Restant / écoulé dans la phase ----
eq('t=5000 : restant phase 0 = 15000', _currentPhaseAt(5000, TL).phaseRemainingMs, 15000);
eq('t=5000 : écoulé phase 0 = 5000', _currentPhaseAt(5000, TL).phaseElapsedMs, 5000);
eq('t=25000 : restant phase 1 = 5000', _currentPhaseAt(25000, TL).phaseRemainingMs, 5000);
eq('t=25000 : écoulé phase 1 = 5000', _currentPhaseAt(25000, TL).phaseElapsedMs, 5000);

// ---- 4. RÉSILIENCE VEILLE : le tick gèle 45s, au réveil on est à la bonne phase ----
// Scénario : départ t0, écran éteint à t0+5s, rallumé à t0+50s (45s de gel).
// L'ancien compteur incrémental afficherait encore la phase 0 ; l'horloge absolue
// donne t=50000 → phase 3 (rest c2).
const t0 = 1_000_000;
const sess = { startEpoch: t0, pausedAccumMs: 0, pauseStartedAt: null, paused: false };
eq('avant veille (t0+5s) → phase 0', _currentPhaseAt(_elapsedMs(sess, t0 + 5000), TL).index, 0);
eq('APRÈS 45s de gel (t0+50s) → phase 3 (rest c2), pas phase 0', _currentPhaseAt(_elapsedMs(sess, t0 + 50000), TL).index, 3);
eq('après gel : restant phase 3 correct (60000-50000=10000)', _currentPhaseAt(_elapsedMs(sess, t0 + 50000), TL).phaseRemainingMs, 10000);
eq('gel au-delà de la fin (t0+120s) → terminé', _currentPhaseAt(_elapsedMs(sess, t0 + 120000), TL), null);

// ---- 5. Pause : le temps est bien gelé pendant la pause ----
const p = { startEpoch: t0, pausedAccumMs: 0, pauseStartedAt: t0 + 10000, paused: true };
eq('en pause depuis t0+10s, à t0+30s → elapsed reste 10000', _elapsedMs(p, t0 + 30000), 10000);
eq('en pause, phase figée sur phase 0', _currentPhaseAt(_elapsedMs(p, t0 + 30000), TL).index, 0);
// reprise après 20s de pause → pausedAccum=20000
const r = { startEpoch: t0, pausedAccumMs: 20000, pauseStartedAt: null, paused: false };
eq('après 20s de pause, à t0+30s → elapsed = 10000', _elapsedMs(r, t0 + 30000), 10000);
eq('après reprise, à t0+55s → elapsed = 35000 → phase 2', _currentPhaseAt(_elapsedMs(r, t0 + 55000), TL).index, 2);

// ---- 6. Seek (skip) : décale l'origine pour atterrir sur une phase ----
function _seek(c, ms, now) { const pn = (c.paused && c.pauseStartedAt) ? (now - c.pauseStartedAt) : 0; c.startEpoch = now - Math.max(0, ms) - c.pausedAccumMs - pn; }
const s = { startEpoch: t0, pausedAccumMs: 0, pauseStartedAt: null, paused: false };
_seek(s, TL[2].start_ms, t0 + 3000); // skip vers phase 2
eq('après seek vers phase 2 → elapsed = 30000', _elapsedMs(s, t0 + 3000), 30000);
eq('après seek → phase courante = 2', _currentPhaseAt(_elapsedMs(s, t0 + 3000), TL).index, 2);

// ---- 7. Phases de durée 0 ignorées (start==end) ----
const withZero = _intervalTimelineOffsets([
  { type: 'warmup', duration_ms: 0 }, { type: 'work', duration_ms: 5000 }
]);
eq('phase durée 0 → jamais courante, t=0 donne la work', _currentPhaseAt(0, withZero).phase.type, 'work');

// ---- 8. Garde-fous ----
eq('timeline vide → null', _currentPhaseAt(0, []), null);
eq('timeline null → null', _currentPhaseAt(0, null), null);
eq('phases null → []', _intervalTimelineOffsets(null).length, 0);

console.log(`\n✓ ${passed} assertions passées — timeline absolue + horloge Date.now() résiliente (veille iOS) OK`);
