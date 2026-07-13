// Test DRILL CIRCUIT — moteur de compteur (step modes) + advance rules + TTS toggles + backward-compat.
// Extrait FIDÈLE de la logique circuit d'index.html (_circuitStepAt / _circuitValueAfter /
// _circuitAdvanceReached / _ttsShouldSpeak). Logique pure = testable hors navigateur.
import assert from 'node:assert';

let passed = 0;
function ok(l, cnd) { assert.ok(cnd, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

// ============================================================================
// COPIE FIDÈLE — moteur de pas compteur (doit rester identique à index.html)
// ============================================================================

// Pas appliqué au tick `tickIndex` (1 = premier incrément), survenant à `elapsedMs`.
function _circuitStepAt(counter, tickIndex, elapsedMs) {
  const mode = counter.step_mode || 'fixed';
  if (mode === 'fixed') return Number(counter.step_fixed) || 0;
  if (mode === 'tiers') {
    const tiers = Array.isArray(counter.step_tiers) ? counter.step_tiers : [];
    const es = elapsedMs / 1000;
    for (const t of tiers) {
      if (t.until_s == null || es <= t.until_s) return Number(t.step) || 0;
    }
    return tiers.length ? (Number(tiers[tiers.length - 1].step) || 0) : 0;
  }
  if (mode === 'multiplier') {
    const m = counter.step_multiplier || {};
    const init = Number(m.initial_step) || 0;
    const factor = Number(m.factor) || 1;
    const every = Math.max(1, Number(m.every_ticks) || 1);
    const exp = Math.floor((tickIndex - 1) / every);
    return init * Math.pow(factor, exp);
  }
  if (mode === 'interpolate') {
    const ip = counter.step_interp || {};
    const s0 = Number(ip.start_step) || 0;
    const s1 = Number(ip.end_step) || 0;
    const over = Math.max(0.001, Number(ip.over_s) || 1);
    const frac = Math.min(1, (elapsedMs / 1000) / over);
    return s0 + (s1 - s0) * frac;
  }
  return 0;
}

// Valeur affichée après `ticks` incréments (départ `start`, clampée à `cap`).
function _circuitValueAfter(counter, ticks) {
  const start = Number(counter.start) || 0;
  const cap = Number(counter.cap);
  const interval = Number(counter.interval_ms) || 1000;
  const down = counter.direction === 'down';
  let v = start;
  for (let k = 1; k <= ticks; k++) {
    const step = _circuitStepAt(counter, k, k * interval);
    v += (down ? -1 : 1) * step;
  }
  v = Math.round(v);
  if (Number.isFinite(cap)) v = down ? Math.max(cap, v) : Math.min(cap, v);
  return v;
}

// Le compteur a-t-il atteint son cap ? (arrêt du tick en mode advance='auto_cap')
function _circuitCapReached(counter, ticks) {
  const cap = Number(counter.cap);
  if (!Number.isFinite(cap)) return false;
  return _circuitValueAfter(counter, ticks) === cap;
}

// Règle d'avancement d'étape : true = on passe à l'étape suivante.
// advanceMode='manual' (circuit-level) force tap_next partout (jamais d'auto).
// advance='auto_cap' → dès cap atteint ; 'auto_time' → elapsed >= advance_after_ms ;
// 'tap_next' → jamais auto (skip manuel seulement).
function _circuitAdvanceReached(stage, ctx, advanceMode) {
  if (advanceMode === 'manual') return false;
  const adv = stage.advance || 'tap_next';
  if (adv === 'auto_time') return ctx.elapsedMs >= (Number(stage.advance_after_ms) || 0);
  if (adv === 'auto_cap') {
    if (stage.type === 'counter') return _circuitCapReached(stage.counter || {}, ctx.ticks || 0);
    if (stage.type === 'countdown') return ctx.elapsedMs >= (Number((stage.countdown || {}).duration_ms) || 0);
    return false; // stimulus : pas de cap → skip manuel / auto_time
  }
  return false; // tap_next
}
// Faut-il une phase de repos après l'étape curIdx ? (repos > 0 ET pas la dernière)
function _circuitShouldRest(stage, curIdx, total) {
  return (Number(stage && stage.rest_after_ms) || 0) > 0 && (curIdx + 1) < total;
}

// TTS : doit-on parler ? Respecte les toggles + support navigateur (simulé).
function _ttsShouldSpeak(cfg, event, hasSpeech) {
  if (!hasSpeech) return false;
  if (event === 'start') return !!cfg.tts_on_start;
  if (event === 'tick') return !!cfg.tts_on_tick;
  return false;
}

// Backward-compat : un drill sans `mode` est traité comme 'stimulus'.
function _drillMode(d) { return (d && d.mode === 'circuit') ? 'circuit' : 'stimulus'; }

// ============================================================================
// 1. FIXED
// ============================================================================
const cFixed = { start: 5, cap: 30, direction: 'up', interval_ms: 8000, step_mode: 'fixed', step_fixed: 3 };
eq('fixed t0 : valeur = start 5', _circuitValueAfter(cFixed, 0), 5);
eq('fixed 1 tick : 5+3 = 8', _circuitValueAfter(cFixed, 1), 8);
eq('fixed 3 ticks : 5+9 = 14', _circuitValueAfter(cFixed, 3), 14);
eq('fixed clamp au cap 30 (jamais au-delà)', _circuitValueAfter(cFixed, 100), 30);
ok('fixed cap atteint à 9 ticks (5+27=32→30)', _circuitCapReached(cFixed, 9));
ok('fixed cap pas atteint à 2 ticks', !_circuitCapReached(cFixed, 2));

// ============================================================================
// 2. TIERS — [{until_s:10,step:1},{until_s:30,step:2},{step:5}]
// ============================================================================
const cTiers = { start: 0, cap: 999, direction: 'up', interval_ms: 5000,
  step_mode: 'tiers', step_tiers: [{ until_s: 10, step: 1 }, { until_s: 30, step: 2 }, { step: 5 }] };
eq('tiers step à t=0s → +1', _circuitStepAt(cTiers, 1, 0), 1);
eq('tiers step à t=10s → +1 (borne incluse)', _circuitStepAt(cTiers, 1, 10000), 1);
eq('tiers step à t=15s → +2', _circuitStepAt(cTiers, 1, 15000), 2);
eq('tiers step à t=30s → +2 (borne incluse)', _circuitStepAt(cTiers, 1, 30000), 2);
eq('tiers step à t=31s → +5 (palier final)', _circuitStepAt(cTiers, 1, 31000), 5);
// valeur cumulée : ticks à 5s,10s,15s,20s → steps 1,1,2,2 = 6
eq('tiers 4 ticks (5,10,15,20s) = 0+1+1+2+2 = 6', _circuitValueAfter(cTiers, 4), 6);

// ============================================================================
// 3. MULTIPLIER — initial 1, factor 1.5, every 3 ticks (exponent stepwise)
// ============================================================================
const cMul = { start: 0, cap: 9999, direction: 'up', interval_ms: 1000,
  step_mode: 'multiplier', step_multiplier: { initial_step: 1, factor: 1.5, every_ticks: 3 } };
eq('mult tick1 exp0 → 1', _circuitStepAt(cMul, 1, 1000), 1);
eq('mult tick3 exp0 → 1', _circuitStepAt(cMul, 3, 3000), 1);
eq('mult tick4 exp1 → 1.5', _circuitStepAt(cMul, 4, 4000), 1.5);
eq('mult tick7 exp2 → 2.25', _circuitStepAt(cMul, 7, 7000), 2.25);
// cumul 6 ticks : 1+1+1+1.5+1.5+1.5 = 7.5 → round 8
eq('mult 6 ticks cumul arrondi = 8', _circuitValueAfter(cMul, 6), 8);

// ============================================================================
// 4. INTERPOLATE — start_step 1 → end_step 5 sur 60s (linéaire)
// ============================================================================
const cInt = { start: 0, cap: 9999, direction: 'up', interval_ms: 1000,
  step_mode: 'interpolate', step_interp: { start_step: 1, end_step: 5, over_s: 60 } };
eq('interp t=0s → 1', _circuitStepAt(cInt, 1, 0), 1);
eq('interp t=30s → 3 (mi-parcours)', _circuitStepAt(cInt, 1, 30000), 3);
eq('interp t=60s → 5 (fin)', _circuitStepAt(cInt, 1, 60000), 5);
eq('interp t=120s → 5 (clamp frac=1)', _circuitStepAt(cInt, 1, 120000), 5);

// ============================================================================
// 5. DIRECTION down + cap plancher
// ============================================================================
const cDown = { start: 20, cap: 0, direction: 'down', interval_ms: 1000, step_mode: 'fixed', step_fixed: 4 };
eq('down 1 tick : 20-4 = 16', _circuitValueAfter(cDown, 1), 16);
eq('down clamp au plancher 0', _circuitValueAfter(cDown, 100), 0);
ok('down cap(0) atteint à 5 ticks', _circuitCapReached(cDown, 5));

// ============================================================================
// 6. ADVANCE RULES
// ============================================================================
const stCap = { type: 'counter', advance: 'auto_cap', counter: cFixed };
ok('advance auto_cap : true quand cap atteint (9 ticks)', _circuitAdvanceReached(stCap, { ticks: 9, elapsedMs: 0 }));
ok('advance auto_cap : false avant le cap (2 ticks)', !_circuitAdvanceReached(stCap, { ticks: 2, elapsedMs: 0 }));
const stTime = { type: 'counter', advance: 'auto_time', advance_after_ms: 30000, counter: cFixed };
ok('advance auto_time : true à elapsed >= 30000', _circuitAdvanceReached(stTime, { ticks: 0, elapsedMs: 30000 }));
ok('advance auto_time : false avant 30000', !_circuitAdvanceReached(stTime, { ticks: 99, elapsedMs: 29999 }));
const stTap = { type: 'counter', advance: 'tap_next', counter: cFixed };
ok('advance tap_next : jamais auto (skip manuel seulement)', !_circuitAdvanceReached(stTap, { ticks: 999, elapsedMs: 999999 }));
const stCd = { type: 'countdown', advance: 'auto_cap', countdown: { duration_ms: 30000 } };
ok('countdown auto_cap : true à fin de durée', _circuitAdvanceReached(stCd, { elapsedMs: 30000 }));
ok('countdown auto_cap : false avant fin', !_circuitAdvanceReached(stCd, { elapsedMs: 15000 }));
const stStim = { type: 'stimulus', advance: 'auto_cap', stimulus: {} };
ok('stimulus auto_cap : false (pas de cap → skip/temps)', !_circuitAdvanceReached(stStim, { elapsedMs: 999999 }));

// ============================================================================
// 7. TTS toggles + support navigateur
// ============================================================================
ok('tts start : parle si tts_on_start + support', _ttsShouldSpeak({ tts_on_start: true }, 'start', true));
ok('tts start : muet si toggle off', !_ttsShouldSpeak({ tts_on_start: false }, 'start', true));
ok('tts start : muet si pas de support navigateur', !_ttsShouldSpeak({ tts_on_start: true }, 'start', false));
ok('tts tick : parle si tts_on_tick + support', _ttsShouldSpeak({ tts_on_tick: true }, 'tick', true));
ok('tts tick : muet si toggle off', !_ttsShouldSpeak({ tts_on_tick: false }, 'tick', true));

// ============================================================================
// 8. BACKWARD-COMPAT
// ============================================================================
eq('drill sans mode → stimulus', _drillMode({ name: 'vieux drill' }), 'stimulus');
eq('drill mode stimulus explicite → stimulus', _drillMode({ mode: 'stimulus' }), 'stimulus');
eq('drill mode circuit → circuit', _drillMode({ mode: 'circuit', stages: [] }), 'circuit');
eq('drill null → stimulus (garde-fou)', _drillMode(null), 'stimulus');

// ============================================================================
// 9. ADVANCE MODE MANUAL (circuit-level) — force tap_next partout
// ============================================================================
// Une étape qui avancerait en auto (cap atteint / temps écoulé) NE doit PAS
// avancer quand le circuit est en mode manuel.
ok('manual : counter cap atteint → PAS d\'avancement auto', _circuitAdvanceReached(stCap, { ticks: 9, elapsedMs: 0 }, 'manual') === false);
ok('manual : auto_time échu → PAS d\'avancement auto', _circuitAdvanceReached(stTime, { ticks: 0, elapsedMs: 999999 }, 'manual') === false);
ok('manual : countdown fini → PAS d\'avancement auto', _circuitAdvanceReached(stCd, { elapsedMs: 999999 }, 'manual') === false);
ok('auto (défaut) : counter cap atteint → avance', _circuitAdvanceReached(stCap, { ticks: 9, elapsedMs: 0 }, 'auto') === true);
ok('auto explicite : auto_time échu → avance', _circuitAdvanceReached(stTime, { ticks: 0, elapsedMs: 30000 }, 'auto') === true);
ok('advanceMode undefined = auto (backward-compat)', _circuitAdvanceReached(stCap, { ticks: 9, elapsedMs: 0 }) === true);

// ============================================================================
// 10. REPOS entre étapes — _circuitShouldRest
// ============================================================================
ok('repos 10s après étape 0 sur 3 → true', _circuitShouldRest({ rest_after_ms: 10000 }, 0, 3) === true);
ok('repos 0 → pas de repos', _circuitShouldRest({ rest_after_ms: 0 }, 0, 3) === false);
ok('repos absent (undefined) → pas de repos (backward-compat)', _circuitShouldRest({}, 0, 3) === false);
ok('repos après la DERNIÈRE étape → jamais (idx 2 sur 3)', _circuitShouldRest({ rest_after_ms: 10000 }, 2, 3) === false);
ok('repos après avant-dernière (idx 1 sur 3) → true', _circuitShouldRest({ rest_after_ms: 5000 }, 1, 3) === true);
ok('repos négatif traité comme 0', _circuitShouldRest({ rest_after_ms: -5 }, 0, 3) === false);

console.log(`\n✓ ${passed} assertions passées — drill circuit (step modes + advance + manual + repos + TTS + backward-compat) OK`);
