// Test DRILL INTERVAL (fractionné) — presets + génération de cycles + timeline + backward-compat.
// Extrait FIDÈLE des fonctions pures d'index.html.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }
function deq(l, a, b) { assert.deepStrictEqual(a, b, '✗ ' + l); passed++; }

// ============================================================================
// COPIE FIDÈLE — logique pure interval (doit rester identique à index.html)
// ============================================================================
function _intervalDefaultConfig() {
  return {
    preset_name: 'Custom',
    warmup: { enabled: false, duration_ms: 180000 },
    cycles: { work_ms: 45000, rest_ms: 30000, count_mode: 'n_cycles', n_cycles: 10, total_duration_ms: 1200000, work_label: 'WORK', rest_label: 'REST' },
    cooldown: { enabled: false, duration_ms: 120000 },
    progression: { mode: 'none', linear: { work_delta_ms: 5000, rest_delta_ms: -5000 }, pyramid: { work_start_ms: 30000, work_peak_ms: 60000, rest_start_ms: 60000, rest_peak_ms: 15000 }, custom_cycles: [] },
    audio: { bip_start: true, bip_end_countdown: true, tts_enabled: false, tts_lang: 'fr' },
    next_preview: true
  };
}
function _intervalMakePreset(name, warmup, work_ms, rest_ms, n_cycles, cooldown) {
  const c = _intervalDefaultConfig();
  c.preset_name = name;
  c.warmup = { enabled: warmup > 0, duration_ms: warmup };
  c.cycles.work_ms = work_ms; c.cycles.rest_ms = rest_ms; c.cycles.count_mode = 'n_cycles'; c.cycles.n_cycles = n_cycles;
  c.cooldown = { enabled: cooldown > 0, duration_ms: cooldown };
  return c;
}
const INTERVAL_PRESETS = [
  { key: 'tabata', config: _intervalMakePreset('Tabata', 0, 20000, 10000, 8, 0) },
  { key: 'hiit_court', config: _intervalMakePreset('HIIT_court', 180000, 30000, 30000, 10, 120000) },
  { key: 'hiit_long', config: _intervalMakePreset('HIIT_long', 300000, 60000, 60000, 8, 180000) },
  { key: 'sprint_basket', config: _intervalMakePreset('Sprint_basket', 300000, 15000, 45000, 12, 180000) },
  { key: 'fractionne_long', config: _intervalMakePreset('Fractionne_long', 300000, 90000, 30000, 10, 300000) },
  { key: 'custom', config: _intervalDefaultConfig() }
];
function _intervalCycleCount(config) {
  const cy = (config && config.cycles) || {};
  const prog = (config && config.progression) || {};
  if ((prog.mode || 'none') === 'custom') return (Array.isArray(prog.custom_cycles) ? prog.custom_cycles : []).length;
  if (cy.count_mode === 'total_duration') {
    const total = Number(cy.total_duration_ms) || 0;
    const per = (Number(cy.work_ms) || 0) + (Number(cy.rest_ms) || 0);
    return per > 0 ? Math.max(1, Math.floor(total / per)) : 1;
  }
  return Math.max(1, Number(cy.n_cycles) || 1);
}
function _intervalPyramidVal(start, peak, i, N) {
  if (N <= 1) return peak;
  const mid = (N - 1) / 2;
  const frac = mid > 0 ? (1 - Math.abs(i - mid) / mid) : 1;
  return start + (peak - start) * frac;
}
function _intervalGenerateCycles(config) {
  const cy = (config && config.cycles) || {};
  const prog = (config && config.progression) || {};
  const mode = prog.mode || 'none';
  if (mode === 'custom') {
    return (Array.isArray(prog.custom_cycles) ? prog.custom_cycles : []).map(c => ({ work_ms: Math.max(0, Number(c.work_ms) || 0), rest_ms: Math.max(0, Number(c.rest_ms) || 0) }));
  }
  const N = _intervalCycleCount(config);
  const workBase = Number(cy.work_ms) || 0, restBase = Number(cy.rest_ms) || 0;
  const out = [];
  for (let i = 0; i < N; i++) {
    let w = workBase, r = restBase;
    if (mode === 'linear') {
      const l = prog.linear || {};
      w = workBase + i * (Number(l.work_delta_ms) || 0);
      r = restBase + i * (Number(l.rest_delta_ms) || 0);
    } else if (mode === 'pyramid') {
      const p = prog.pyramid || {};
      w = _intervalPyramidVal(Number(p.work_start_ms) || 0, Number(p.work_peak_ms) || 0, i, N);
      r = _intervalPyramidVal(Number(p.rest_start_ms) || 0, Number(p.rest_peak_ms) || 0, i, N);
    }
    out.push({ work_ms: Math.max(0, Math.round(w)), rest_ms: Math.max(0, Math.round(r)) });
  }
  return out;
}
function _intervalBuildTimeline(config) {
  const phases = [];
  const w = (config && config.warmup) || {}, cd = (config && config.cooldown) || {}, cy = (config && config.cycles) || {};
  if (w.enabled && (Number(w.duration_ms) || 0) > 0) phases.push({ type: 'warmup', label: 'ÉCHAUFFEMENT', duration_ms: Number(w.duration_ms) });
  const cycles = _intervalGenerateCycles(config);
  const total = cycles.length;
  cycles.forEach((c, i) => {
    if ((Number(c.work_ms) || 0) > 0) phases.push({ type: 'work', label: cy.work_label || 'WORK', duration_ms: c.work_ms, cycleIndex: i + 1, cycleTotal: total });
    if ((Number(c.rest_ms) || 0) > 0) phases.push({ type: 'rest', label: cy.rest_label || 'REST', duration_ms: c.rest_ms, cycleIndex: i + 1, cycleTotal: total });
  });
  if (cd.enabled && (Number(cd.duration_ms) || 0) > 0) phases.push({ type: 'cooldown', label: 'RETOUR AU CALME', duration_ms: Number(cd.duration_ms) });
  return phases;
}
function _intervalTotalMs(config) { return _intervalBuildTimeline(config).reduce((a, p) => a + (Number(p.duration_ms) || 0), 0); }
function _intervalPhaseBg(type) { return type === 'work' ? '#FF6B35' : type === 'rest' ? '#0074D9' : '#5a6472'; }
function _intervalTimelineSvg(config) {
  const phases = _intervalBuildTimeline(config);
  const total = phases.reduce((a, p) => a + (Number(p.duration_ms) || 0), 0) || 1;
  const W = 300, H = 16; let x = 0, rects = '';
  phases.forEach(p => {
    const w = (Number(p.duration_ms) || 0) / total * W;
    rects += `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0.5, w).toFixed(2)}" height="${H}" fill="${_intervalPhaseBg(p.type)}"/>`;
    x += w;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px;overflow:hidden">${rects}</svg>`;
}
function _drillMode(d) { return (d && (d.mode === 'circuit' || d.mode === 'interval')) ? d.mode : 'stimulus'; }

// ============================================================================
// 1. Presets built-in — durées totales conformes à la spec
// ============================================================================
const byKey = k => INTERVAL_PRESETS.find(p => p.key === k).config;
eq('Tabata = 8×(20+10) = 240s (4 min)', _intervalTotalMs(byKey('tabata')), 240000);
eq('HIIT court = 180 + 10×60 + 120 = 900s (15 min)', _intervalTotalMs(byKey('hiit_court')), 900000);
eq('HIIT long = 300 + 8×120 + 180 = 1440s (24 min)', _intervalTotalMs(byKey('hiit_long')), 1440000);
eq('Sprint basket = 300 + 12×60 + 180 = 1200s (20 min)', _intervalTotalMs(byKey('sprint_basket')), 1200000);
eq('Fractionné long = 300 + 10×120 + 300 = 1800s (30 min)', _intervalTotalMs(byKey('fractionne_long')), 1800000);
eq('Tabata : 8 cycles', _intervalCycleCount(byKey('tabata')), 8);
ok('Tabata sans warmup ni cooldown', byKey('tabata').warmup.enabled === false && byKey('tabata').cooldown.enabled === false);

// ============================================================================
// 2. _intervalGenerateCycles — none / linear / pyramid / custom
// ============================================================================
// none : cycles identiques
const cfgNone = _intervalMakePreset('X', 0, 45000, 30000, 3, 0);
deq('none : 3 cycles identiques', _intervalGenerateCycles(cfgNone), [{ work_ms: 45000, rest_ms: 30000 }, { work_ms: 45000, rest_ms: 30000 }, { work_ms: 45000, rest_ms: 30000 }]);

// linear : work +5s / rest -5s par cycle
const cfgLin = _intervalMakePreset('X', 0, 30000, 30000, 3, 0);
cfgLin.progression = { mode: 'linear', linear: { work_delta_ms: 5000, rest_delta_ms: -5000 } };
deq('linear : work 30/35/40, rest 30/25/20', _intervalGenerateCycles(cfgLin),
  [{ work_ms: 30000, rest_ms: 30000 }, { work_ms: 35000, rest_ms: 25000 }, { work_ms: 40000, rest_ms: 20000 }]);

// pyramid : work 30→60→30, rest 60→15→60 sur 3 cycles (peak au milieu i=1)
const cfgPyr = _intervalMakePreset('X', 0, 0, 0, 3, 0);
cfgPyr.progression = { mode: 'pyramid', pyramid: { work_start_ms: 30000, work_peak_ms: 60000, rest_start_ms: 60000, rest_peak_ms: 15000 } };
deq('pyramid 3 cycles : work 30/60/30, rest 60/15/60', _intervalGenerateCycles(cfgPyr),
  [{ work_ms: 30000, rest_ms: 60000 }, { work_ms: 60000, rest_ms: 15000 }, { work_ms: 30000, rest_ms: 60000 }]);
// pyramid 5 cycles : work monte 30→45→60→45→30
const cfgPyr5 = _intervalMakePreset('X', 0, 0, 0, 5, 0);
cfgPyr5.progression = { mode: 'pyramid', pyramid: { work_start_ms: 30000, work_peak_ms: 60000, rest_start_ms: 0, rest_peak_ms: 0 } };
deq('pyramid 5 cycles : work 30/45/60/45/30', _intervalGenerateCycles(cfgPyr5).map(c => c.work_ms), [30000, 45000, 60000, 45000, 30000]);

// custom : lit directement custom_cycles
const cfgCustom = _intervalDefaultConfig();
cfgCustom.progression = { mode: 'custom', custom_cycles: [{ work_ms: 60000, rest_ms: 45000 }, { work_ms: 45000, rest_ms: 30000 }, { work_ms: 30000, rest_ms: 15000 }] };
deq('custom : 3 cycles lus directement', _intervalGenerateCycles(cfgCustom),
  [{ work_ms: 60000, rest_ms: 45000 }, { work_ms: 45000, rest_ms: 30000 }, { work_ms: 30000, rest_ms: 15000 }]);
eq('custom : count = longueur custom_cycles', _intervalCycleCount(cfgCustom), 3);

// ============================================================================
// 3. count_mode = total_duration
// ============================================================================
const cfgTot = _intervalMakePreset('X', 0, 40000, 20000, 0, 0);
cfgTot.cycles.count_mode = 'total_duration'; cfgTot.cycles.total_duration_ms = 300000; // 5min / (60s/cycle) = 5 cycles
eq('total_duration 300s / 60s = 5 cycles', _intervalCycleCount(cfgTot), 5);
eq('total_duration génère 5 cycles', _intervalGenerateCycles(cfgTot).length, 5);
const cfgTot2 = _intervalMakePreset('X', 0, 45000, 25000, 0, 0);
cfgTot2.cycles.count_mode = 'total_duration'; cfgTot2.cycles.total_duration_ms = 200000; // /70000 = 2.85 → 2
eq('total_duration 200s / 70s = floor 2 cycles', _intervalCycleCount(cfgTot2), 2);

// ============================================================================
// 4. Timeline — ordre des phases + labels
// ============================================================================
const tl = _intervalBuildTimeline(byKey('hiit_court'));
eq('HIIT court : 1 warmup + 20 (10 work+10 rest) + 1 cooldown = 22 phases', tl.length, 22);
eq('1ère phase = warmup', tl[0].type, 'warmup');
eq('2e phase = work', tl[1].type, 'work');
eq('3e phase = rest', tl[2].type, 'rest');
eq('dernière phase = cooldown', tl[tl.length - 1].type, 'cooldown');
eq('work porte cycleIndex/cycleTotal', tl[1].cycleTotal, 10);
// Tabata : pas de warmup/cooldown → 16 phases (8 work + 8 rest)
eq('Tabata timeline = 16 phases', _intervalBuildTimeline(byKey('tabata')).length, 16);
// labels custom work/rest
const cfgLabels = _intervalMakePreset('X', 0, 20000, 10000, 2, 0);
cfgLabels.cycles.work_label = 'SPRINT'; cfgLabels.cycles.rest_label = 'RÉCUP';
eq('label work custom = SPRINT', _intervalBuildTimeline(cfgLabels)[0].label, 'SPRINT');
eq('label rest custom = RÉCUP', _intervalBuildTimeline(cfgLabels)[1].label, 'RÉCUP');

// ============================================================================
// 5. Timeline SVG mini-viz
// ============================================================================
const svg = _intervalTimelineSvg(byKey('tabata'));
ok('SVG commence par <svg', svg.startsWith('<svg'));
ok('SVG contient des <rect>', /<rect /.test(svg));
eq('SVG Tabata = 16 rects (8 work + 8 rest)', (svg.match(/<rect /g) || []).length, 16);
ok('SVG work en rouge #FF6B35', svg.includes('#FF6B35'));
ok('SVG rest en bleu #0074D9', svg.includes('#0074D9'));
ok('SVG warmup/cooldown gris présents (HIIT court)', _intervalTimelineSvg(byKey('hiit_court')).includes('#5a6472'));

// ============================================================================
// 6. Backward-compat
// ============================================================================
eq('drill sans mode → stimulus', _drillMode({ name: 'x' }), 'stimulus');
eq('drill mode circuit → circuit (inchangé)', _drillMode({ mode: 'circuit' }), 'circuit');
eq('drill mode interval → interval', _drillMode({ mode: 'interval' }), 'interval');
eq('drill null → stimulus (garde-fou)', _drillMode(null), 'stimulus');
// cycles vides (work=0 rest=0) → aucune phase de cycle
const cfgEmpty = _intervalMakePreset('X', 60000, 0, 0, 3, 60000);
deq('cycles à 0 → seulement warmup + cooldown', _intervalBuildTimeline(cfgEmpty).map(p => p.type), ['warmup', 'cooldown']);

console.log(`\n✓ ${passed} assertions passées — drill interval (presets + cycles none/linear/pyramid/custom + total_duration + timeline + SVG + backward-compat) OK`);
