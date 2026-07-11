// Test DRILL RÉACTION — logique pure (extraits fidèles d'index.html).
//   • _drillExpandPool : développe une spec multi-catégories en un pool de cues ;
//   • _drillCleanStimuli : bornes/normalisation (swap min/max, ids valides) ;
//   • _drillLaunchConfig : overrides éphémères (joueuse) vs drill de base ;
//   • round-trip dump/apply (drills) ;
//   • permission : seul un coach peut muter (create/edit/delete), la joueuse non.
import assert from 'node:assert';

const DRILL_COLORS = [
  { id: 'red', hex: '#e5352b' }, { id: 'blue', hex: '#2f7bf5' }, { id: 'green', hex: '#22a63a' },
  { id: 'yellow', hex: '#f4c020' }, { id: 'purple', hex: '#8b3fd6' }, { id: 'orange', hex: '#ec6a17' },
  { id: 'black', hex: '#111111' }, { id: 'gray', hex: '#8a8f98' }
];
const DRILL_ARROW_DEG = { up: 0, upright: 45, right: 90, downright: 135, down: 180, downleft: 225, left: 270, upleft: 315 };
const DRILL_SHAPES = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star'];

// ---- SUJETS (copies fidèles) ----
function _drillExpandPool(stimuli, images) {
  const s = stimuli || {}, imgs = images || [];
  const pool = [];
  (s.colors || []).forEach(c => { const col = DRILL_COLORS.find(x => x.id === c); if (col) pool.push({ type: 'color', value: col.id, hex: col.hex }); });
  (s.arrows || []).forEach(a => { if (DRILL_ARROW_DEG[a] != null) pool.push({ type: 'arrow', value: a }); });
  if (s.numbers && Number.isFinite(s.numbers.min) && Number.isFinite(s.numbers.max)) {
    const lo = Math.min(s.numbers.min, s.numbers.max), hi = Math.max(s.numbers.min, s.numbers.max);
    for (let n = lo; n <= hi && pool.length < 3000; n++) pool.push({ type: 'number', value: n });
  }
  if (s.letters && s.letters.min && s.letters.max) {
    let lo = String(s.letters.min).toUpperCase().charCodeAt(0), hi = String(s.letters.max).toUpperCase().charCodeAt(0);
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    for (let c = lo; c <= hi; c++) if (c >= 65 && c <= 90) pool.push({ type: 'letter', value: String.fromCharCode(c) });
  }
  (s.shapes || []).forEach(sh => { if (DRILL_SHAPES.includes(sh)) pool.push({ type: 'shape', value: sh }); });
  (s.imageIds || []).forEach(id => { const img = imgs.find(m => m.id === id && !m.deletedAt); if (img) pool.push({ type: 'image', value: id, url: img.url }); });
  return pool;
}
function _drillCleanStimuli(s, drillImages) {
  s = s || {}; const out = {}; const imgs = drillImages || [];
  const cols = (s.colors || []).filter(c => DRILL_COLORS.some(x => x.id === c)); if (cols.length) out.colors = cols;
  const arr = (s.arrows || []).filter(a => DRILL_ARROW_DEG[a] != null); if (arr.length) out.arrows = arr;
  if (s.numbers && Number.isFinite(s.numbers.min) && Number.isFinite(s.numbers.max)) {
    out.numbers = { min: Math.max(0, Math.min(999, Math.min(s.numbers.min, s.numbers.max))), max: Math.max(0, Math.min(999, Math.max(s.numbers.min, s.numbers.max))) };
  }
  if (s.letters && s.letters.min && s.letters.max) {
    let a = String(s.letters.min).toUpperCase().charAt(0), b = String(s.letters.max).toUpperCase().charAt(0);
    if (/[A-Z]/.test(a) && /[A-Z]/.test(b)) { if (a > b) { const t = a; a = b; b = t; } out.letters = { min: a, max: b }; }
  }
  const sh = (s.shapes || []).filter(x => DRILL_SHAPES.includes(x)); if (sh.length) out.shapes = sh;
  const im = (s.imageIds || []).filter(id => imgs.some(m => m.id === id && !m.deletedAt)); if (im.length) out.imageIds = im;
  return out;
}
function _drillLaunchConfig(d, o) {
  o = o || {};
  return {
    stimuli: o.stimuli || d.stimuli,
    lengthMs: Number.isFinite(o.lengthMs) ? o.lengthMs : d.lengthMs,
    delayMs: Number.isFinite(o.delayMs) ? o.delayMs : d.delayMs,
    audioBeep: (typeof o.audioBeep === 'boolean') ? o.audioBeep : d.audioBeep,
    durationMode: o.durationMode || d.durationMode,
    durationValue: Number.isFinite(o.durationValue) ? o.durationValue : d.durationValue
  };
}
function _dumpDrillRow(d) {
  return {
    id: d.id, name: d.name || '', created_by: d.createdBy || null,
    stimuli_json: (d.stimuli && typeof d.stimuli === 'object' && !Array.isArray(d.stimuli)) ? d.stimuli : {},
    length_ms: Number.isFinite(d.lengthMs) ? d.lengthMs : 7000,
    delay_ms: Number.isFinite(d.delayMs) ? d.delayMs : 500,
    audio_beep: d.audioBeep !== false,
    duration_mode: d.durationMode === 'countdown' ? 'countdown' : 'rounds',
    duration_value: Number.isFinite(d.durationValue) ? d.durationValue : 10
  };
}
function _drillFromRow(r) {
  return {
    id: r.id, name: r.name || '', createdBy: r.created_by || null,
    stimuli: (r.stimuli_json && typeof r.stimuli_json === 'object' && !Array.isArray(r.stimuli_json)) ? r.stimuli_json : {},
    lengthMs: Number.isFinite(r.length_ms) ? r.length_ms : 7000,
    delayMs: Number.isFinite(r.delay_ms) ? r.delay_ms : 500,
    audioBeep: r.audio_beep !== false,
    durationMode: r.duration_mode === 'countdown' ? 'countdown' : 'rounds',
    durationValue: Number.isFinite(r.duration_value) ? r.duration_value : 10
  };
}
// Permission : seul un coach mute la bibliothèque commune.
function canMutateDrill(role) { return role === 'coach'; }

let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }

// === 1. Pool combiné multi-catégories ===
const stim = { colors: ['red', 'blue'], arrows: ['up', 'left'], numbers: { min: 1, max: 3 }, letters: { min: 'A', max: 'B' }, shapes: ['circle', 'star'], imageIds: [] };
const pool = _drillExpandPool(stim, []);
ok('pool combiné = 2+2+3+2+2 = 11 cues', pool.length === 11);
ok('types présents = 5 catégories', JSON.stringify([...new Set(pool.map(c => c.type))].sort()) === JSON.stringify(['arrow', 'color', 'letter', 'number', 'shape']));
ok('couleur porte son hex', pool.find(c => c.type === 'color').hex === '#e5352b');
ok('chaque tirage appartient au pool', Array.from({ length: 50 }, () => pool[Math.floor(Math.random() * pool.length)]).every(c => pool.includes(c)));
ok('pool vide si aucun stimulus', _drillExpandPool({}, []).length === 0);

// === 2. Images : incluses seulement si présentes et non supprimées ===
const imgs = [{ id: 'i1', url: 'u1' }, { id: 'i2', url: 'u2', deletedAt: 123 }];
const poolImg = _drillExpandPool({ imageIds: ['i1', 'i2', 'ghost'] }, imgs);
ok('image active incluse, supprimée + fantôme exclues', poolImg.length === 1 && poolImg[0].value === 'i1' && poolImg[0].url === 'u1');

// === 3. Nettoyage / bornes ===
const cleanNum = _drillCleanStimuli({ numbers: { min: 9, max: 2 } });
ok('numbers swap min/max (9,2 → 2..9)', cleanNum.numbers.min === 2 && cleanNum.numbers.max === 9);
const cleanNum2 = _drillCleanStimuli({ numbers: { min: -5, max: 1500 } });
ok('numbers bornés 0..999', cleanNum2.numbers.min === 0 && cleanNum2.numbers.max === 999);
const cleanLet = _drillCleanStimuli({ letters: { min: 'z', max: 'c' } });
ok('letters swap + uppercase (z,c → C..Z)', cleanLet.letters.min === 'C' && cleanLet.letters.max === 'Z');
const cleanBad = _drillCleanStimuli({ colors: ['red', 'nope'], arrows: ['up', 'diagonal'], shapes: ['star', 'blob'], imageIds: ['x'] }, []);
ok('ids invalides filtrés', JSON.stringify(cleanBad.colors) === JSON.stringify(['red']) && JSON.stringify(cleanBad.arrows) === JSON.stringify(['up']) && JSON.stringify(cleanBad.shapes) === JSON.stringify(['star']));
ok('catégories vides absentes du clean', cleanBad.imageIds === undefined && cleanBad.numbers === undefined);
ok('extension d\'A à Z = 26 lettres', _drillExpandPool(_drillCleanStimuli({ letters: { min: 'A', max: 'Z' } })).length === 26);

// === 4. Overrides éphémères (joueuse) ===
const base = { stimuli: { colors: ['red'] }, lengthMs: 7000, delayMs: 500, audioBeep: true, durationMode: 'rounds', durationValue: 10 };
const cfg = _drillLaunchConfig(base, { lengthMs: 2000, durationMode: 'countdown', durationValue: 3, audioBeep: false });
ok('override lengthMs', cfg.lengthMs === 2000);
ok('override durationMode + value', cfg.durationMode === 'countdown' && cfg.durationValue === 3);
ok('override audioBeep=false respecté', cfg.audioBeep === false);
ok('champs non-override = valeurs du drill', cfg.delayMs === 500 && JSON.stringify(cfg.stimuli) === JSON.stringify({ colors: ['red'] }));
ok('sans overrides → config = drill', JSON.stringify(_drillLaunchConfig(base)) === JSON.stringify({ stimuli: base.stimuli, lengthMs: 7000, delayMs: 500, audioBeep: true, durationMode: 'rounds', durationValue: 10 }));

// === 5. Round-trip dump/apply ===
const drill = { id: 'x1', name: 'Test', createdBy: 'admin', stimuli: { colors: ['red', 'blue'], numbers: { min: 1, max: 10 } }, lengthMs: 3000, delayMs: 0, audioBeep: false, durationMode: 'countdown', durationValue: 5 };
const back = _drillFromRow({ ...(_dumpDrillRow(drill)), created_at: null, updated_at: null });
ok('round-trip préserve stimuli', JSON.stringify(back.stimuli) === JSON.stringify(drill.stimuli));
ok('round-trip préserve timing/mode', back.lengthMs === 3000 && back.delayMs === 0 && back.audioBeep === false && back.durationMode === 'countdown' && back.durationValue === 5);

// === 6. Permissions ===
ok('coach peut muter la bibliothèque', canMutateDrill('coach') === true);
ok('joueuse NE peut PAS muter (read-only + éphémère)', canMutateDrill('player') === false);
ok('stat NE peut PAS muter', canMutateDrill('stat') === false);
// La joueuse peut toutefois LANCER avec overrides sans persister : _drillLaunchConfig
// ne touche jamais l'objet drill (immutabilité).
const snapshot = JSON.stringify(base);
_drillLaunchConfig(base, { lengthMs: 999, stimuli: { colors: ['green'] } });
ok('les overrides ne mutent pas le drill de base', JSON.stringify(base) === snapshot);

// === 7. Intégration sync : create → apparaît ; edit → propagé (LWW) ; delete → disparu ===
// Mirror fidèle de l'apply() drills + activeDrills().
function applyDrills(state, rows) {
  const local = state.drills || [];
  const localById = Object.fromEntries(local.map(d => [d.id, d]));
  const remoteIds = new Set(rows.map(r => r.id));
  const fromRemote = rows.map(r => {
    const mapped = _drillFromRowFull(r);
    const loc = localById[r.id];
    if (loc && (loc.updatedAt || 0) > (mapped.updatedAt || 0)) return loc;
    return mapped;
  });
  const pendingLocal = local.filter(d => !remoteIds.has(d.id) && typeof d.id === 'string' && d.id.startsWith('x'));
  state.drills = [...pendingLocal, ...fromRemote];
}
function _drillFromRowFull(r) { return { ..._drillFromRow(r), createdAt: r.created_at || null, updatedAt: r.updated_at || 0, deletedAt: r.deleted_at || null }; }
function activeDrills(state) { return (state.drills || []).filter(d => !d.deletedAt); }
function rowOf(d) { return { ..._dumpDrillRow(d), created_at: 1000, updated_at: d.updatedAt, deleted_at: d.deletedAt || null }; }

// Coach crée sur son device → dump → l'autre device (joueuse) applique.
const coachDrill = { id: 'x9', name: 'Réaction', createdBy: 'admin', stimuli: { colors: ['red'] }, lengthMs: 5000, delayMs: 500, audioBeep: true, durationMode: 'rounds', durationValue: 8, updatedAt: 100, deletedAt: null };
const playerState = { drills: [] };
applyDrills(playerState, [rowOf(coachDrill)]);
ok('create coach → visible chez la joueuse', activeDrills(playerState).length === 1 && activeDrills(playerState)[0].name === 'Réaction');

// Coach édite (updatedAt plus récent) → propagé.
const edited = { ...coachDrill, name: 'Réaction v2', durationValue: 20, updatedAt: 200 };
applyDrills(playerState, [rowOf(edited)]);
ok('edit coach → propagé chez la joueuse', activeDrills(playerState)[0].name === 'Réaction v2' && activeDrills(playerState)[0].durationValue === 20);

// Coach supprime (soft-delete) → disparaît de la liste active.
const deleted = { ...edited, deletedAt: 300, updatedAt: 300 };
applyDrills(playerState, [rowOf(deleted)]);
ok('delete coach → disparu de la liste active joueuse', activeDrills(playerState).length === 0);

// LWW : un écho remote PLUS ANCIEN n'écrase pas une édition locale plus récente.
const local2 = { drills: [{ ...edited, name: 'Local récent', updatedAt: 500 }] };
applyDrills(local2, [rowOf(edited)]); // remote updatedAt 200 < local 500
ok('LWW : écho remote ancien n\'écrase pas l\'édition locale récente', local2.drills[0].name === 'Local récent');

console.log(`\n✓ ${passed} assertions passées — drill réaction (pool, bornes, overrides, sync, permissions, intégration) OK`);
