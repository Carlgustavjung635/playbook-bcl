// Test BONUS COURSE DE LA PRÉPA (v.115) — +distance renseignée, +progression.
//
// Extrait FIDÈLE des fonctions pures d'index.html. Toute modif du cœur pur
// (_trainingConfig / _computePoints / _trainingPrevDistanceKm /
// _trainingIsImprovement / _trainingBreakdown) doit être reportée ICI DANS LE
// MÊME COMMIT.
//
// CE QUE CE TEST VERROUILLE, ET POURQUOI :
//
//   1. La NON-RÉTROACTIVITÉ. Les deux bonus sont OPTIONNELS dans _computePoints
//      (faux par défaut) : tout appelant d'avant v.115 rend le même total qu'à
//      l'époque. Et comme points_total est figé dans la ligne à la validation,
//      aucune séance déjà validée ne change de valeur. Le test rejoue la formule
//      v.113 sur 12 combinaisons pour le prouver, au lieu de l'affirmer.
//
//   2. La COMPARAISON L→L, JAMAIS L→M. Le repère de progression se prend à
//      session_id égal. Une session appartient à un seul programme et à un seul
//      jour de la semaine : c'est ce qui fait que lundi se compare à lundi. Le
//      test le vérifie AVEC une séance du mercredi plus longue dans le jeu de
//      données — si le filtre sautait, elle deviendrait le repère du lundi et
//      volerait le bonus.
//
//   3. L'INVARIANT DE DÉCOMPOSITION :
//         base×squad + post + distance + improvement + adjust === points_total
//      TOUJOURS. C'est lui qui permet d'afficher un détail au coach sans stocker
//      deux colonnes de plus (donc sans migration, donc sans le risque qu'un
//      déploiement précède la migration et bloque toute la table
//      training_completions au flush — un échec qui ne se voit qu'en console).
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

// ============================================================================
// COPIE FIDÈLE — cœur pur (doit rester identique à index.html)
// ============================================================================
const TRAINING_DEFAULT_CONFIG = {
  points: { min: 10, med: 20, ultra: 30 },
  squad_multiplier: 2,
  post_bonus: 10,
  distance_bonus: 20,
  improvement_bonus: 40,
  remind_hour: 9
};
const TRAINING_LEVELS = ['min', 'med', 'ultra'];

function _trainingConfig(program) {
  const raw = (program && program.scoringConfig && typeof program.scoringConfig === 'object') ? program.scoringConfig : {};
  const pts = (raw.points && typeof raw.points === 'object') ? raw.points : {};
  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  return {
    points: {
      min: num(pts.min, TRAINING_DEFAULT_CONFIG.points.min),
      med: num(pts.med, TRAINING_DEFAULT_CONFIG.points.med),
      ultra: num(pts.ultra, TRAINING_DEFAULT_CONFIG.points.ultra)
    },
    squad_multiplier: num(raw.squad_multiplier, TRAINING_DEFAULT_CONFIG.squad_multiplier),
    post_bonus: num(raw.post_bonus, TRAINING_DEFAULT_CONFIG.post_bonus),
    distance_bonus: num(raw.distance_bonus, TRAINING_DEFAULT_CONFIG.distance_bonus),
    improvement_bonus: num(raw.improvement_bonus, TRAINING_DEFAULT_CONFIG.improvement_bonus),
    remind_hour: num(raw.remind_hour, TRAINING_DEFAULT_CONFIG.remind_hour)
  };
}
function _computePoints({ level, hasSquad, hasPost, hasDistance, hasImprovement, config } = {}) {
  const cfg = _trainingConfig({ scoringConfig: config || {} });
  const lvl = TRAINING_LEVELS.includes(level) ? level : 'min';
  const base = cfg.points[lvl];
  const distance = hasDistance ? cfg.distance_bonus : 0;
  const improvement = hasImprovement ? cfg.improvement_bonus : 0;
  const total = (base * (hasSquad ? cfg.squad_multiplier : 1))
    + (hasPost ? cfg.post_bonus : 0) + distance + improvement;
  return { base, distance, improvement, total: Math.round(total) };
}
// `state` est une closure dans index.html (jamais window.state) — on la simule.
const state = { trainingCompletions: [] };

function _trainingPrevDistanceKm(sessionId, playerId, datePlanned, excludeId) {
  if (!sessionId || !playerId || typeof datePlanned !== 'string' || !datePlanned) return null;
  const prev = (state.trainingCompletions || []).filter(c =>
    !c.deletedAt && c.sessionId === sessionId && c.playerId === playerId &&
    c.id !== excludeId &&
    typeof c.datePlanned === 'string' &&
    c.datePlanned < datePlanned &&
    Number.isFinite(Number(c.runningDistanceKm)) && Number(c.runningDistanceKm) > 0
  ).sort((a, b) => (a.datePlanned < b.datePlanned ? 1 : (a.datePlanned > b.datePlanned ? -1 : 0)));
  return prev.length ? Number(prev[0].runningDistanceKm) : null;
}
function _trainingIsImprovement(sessionId, playerId, datePlanned, km, excludeId) {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return false;
  const prev = _trainingPrevDistanceKm(sessionId, playerId, datePlanned, excludeId);
  return prev !== null && n > prev;
}
function _trainingBreakdown(c, program) {
  const cfg = _trainingConfig(program);
  const base = Number(c.basePoints) || 0;
  const squadOn = !!c.squadTeammateId;
  const postOn = !!(c.postPhotoUrl || (c.postMessage || '').trim());
  const legacy = Math.round(base * (squadOn ? cfg.squad_multiplier : 1) + (postOn ? cfg.post_bonus : 0));
  const total = Number(c.pointsTotal) || 0;
  const gap = total - legacy;
  const km = Number.isFinite(Number(c.runningDistanceKm)) ? Number(c.runningDistanceKm) : null;
  const hasKm = !!(km && km > 0);
  const prevKm = _trainingPrevDistanceKm(c.sessionId, c.playerId, c.datePlanned, c.id);
  const improved = !!(hasKm && prevKm !== null && km > prevKm);
  let distance = hasKm ? cfg.distance_bonus : 0;
  let improvement = improved ? cfg.improvement_bonus : 0;
  let adjust = 0;
  if (distance + improvement !== gap) {
    const hit = [[distance, improvement], [distance, 0], [0, improvement], [0, 0]]
      .find(([d, i]) => d + i === gap);
    if (hit) { distance = hit[0]; improvement = hit[1]; }
    else { distance = 0; improvement = 0; adjust = gap; }
  }
  return {
    base, squadMult: squadOn ? cfg.squad_multiplier : 1, squadOn,
    post: postOn ? cfg.post_bonus : 0, postOn,
    distance, improvement, adjust, total, km, prevKm
  };
}
function _trainingBreakdownLine(b) {
  let s = String(b.base);
  if (b.squadOn) s += ' × ' + b.squadMult;
  if (b.post) s += ' + ' + b.post;
  if (b.distance) s += ' + ' + b.distance;
  if (b.improvement) s += ' + ' + b.improvement;
  if (b.adjust) s += (b.adjust > 0 ? ' + ' : ' − ') + Math.abs(b.adjust);
  return s + ' = ' + b.total;
}

// ============================================================================
// 1) _computePoints — les deux bonus sont ADDITIFS et JAMAIS multipliés
// ============================================================================
const D = TRAINING_DEFAULT_CONFIG;

eq('med + distance → 40 (20 + 20)', _computePoints({ level: 'med', hasDistance: true, config: D }).total, 40);
eq('med + progression → 60 (20 + 40)', _computePoints({ level: 'med', hasImprovement: true, config: D }).total, 60);
eq('med + distance + progression → 80', _computePoints({ level: 'med', hasDistance: true, hasImprovement: true, config: D }).total, 80);

// Le cas de référence de la demande : squad ×2, post +10, distance +20, record +40.
eq('med + squad + post + distance + progression → 110 (20×2 +10 +20 +40) — CAS DE RÉFÉRENCE',
  _computePoints({ level: 'med', hasSquad: true, hasPost: true, hasDistance: true, hasImprovement: true, config: D }).total, 110);
eq('ultra tout coché → 130 (30×2 +10 +20 +40) — PLAFOND',
  _computePoints({ level: 'ultra', hasSquad: true, hasPost: true, hasDistance: true, hasImprovement: true, config: D }).total, 130);

// Aucun bonus n'entre dans le multiplicateur squad : (20+20+40)×2 = 160 ≠ 110.
ok('bonus course NON multipliés par squad',
  _computePoints({ level: 'med', hasSquad: true, hasPost: true, hasDistance: true, hasImprovement: true, config: D }).total !== 160);
eq('base inchangée par les bonus course',
  _computePoints({ level: 'med', hasDistance: true, hasImprovement: true, config: D }).base, 20);

// Détail rendu par la fonction (utilisé tel quel par l'UI).
eq('detail.distance rendu', _computePoints({ level: 'med', hasDistance: true, config: D }).distance, 20);
eq('detail.improvement rendu', _computePoints({ level: 'med', hasImprovement: true, config: D }).improvement, 40);
eq('detail.distance = 0 si non acquis', _computePoints({ level: 'med', config: D }).distance, 0);

// ============================================================================
// 2) CONFIGURATION COACH — paramétrable, désactivable, et à défaut héritée
// ============================================================================
eq('distance_bonus à 0 → désactivé', _computePoints({ level: 'med', hasDistance: true, config: { distance_bonus: 0 } }).total, 20);
eq('improvement_bonus à 0 → désactivé', _computePoints({ level: 'med', hasImprovement: true, config: { improvement_bonus: 0 } }).total, 20);
eq('les deux à 0 → barème v.113 pur',
  _computePoints({ level: 'med', hasSquad: true, hasPost: true, hasDistance: true, hasImprovement: true, config: { distance_bonus: 0, improvement_bonus: 0 } }).total, 50);
eq('valeurs custom 5/15', _computePoints({ level: 'med', hasDistance: true, hasImprovement: true, config: { distance_bonus: 5, improvement_bonus: 15 } }).total, 40);

// AUCUNE MIGRATION : un programme publié AVANT v.115 a un scoring_config sans
// ces clés. _trainingConfig doit retomber sur les défauts, clé par clé.
const legacyCfg = { points: { min: 10, med: 20, ultra: 30 }, squad_multiplier: 2, post_bonus: 10, remind_hour: 9 };
eq('programme d\'avant v.115 → distance_bonus hérité à 20', _trainingConfig({ scoringConfig: legacyCfg }).distance_bonus, 20);
eq('programme d\'avant v.115 → improvement_bonus hérité à 40', _trainingConfig({ scoringConfig: legacyCfg }).improvement_bonus, 40);
eq('scoring_config vide → défauts', _trainingConfig({ scoringConfig: {} }).distance_bonus, 20);
eq('surcharge partielle : distance seule → improvement reste 40', _trainingConfig({ scoringConfig: { distance_bonus: 7 } }).improvement_bonus, 40);
eq('surcharge partielle : distance seule → distance = 7', _trainingConfig({ scoringConfig: { distance_bonus: 7 } }).distance_bonus, 7);
eq('valeur illisible → défaut', _trainingConfig({ scoringConfig: { distance_bonus: 'beaucoup' } }).distance_bonus, 20);

// ============================================================================
// 3) NON-RÉTROACTIVITÉ — la formule v.113 rejouée à l'identique
// ============================================================================
// Le v.113 exact, recopié depuis le commit 6f83ba5.
function _computePointsV113({ level, hasSquad, hasPost, config } = {}) {
  const cfg = _trainingConfig({ scoringConfig: config || {} });
  const lvl = TRAINING_LEVELS.includes(level) ? level : 'min';
  const base = cfg.points[lvl];
  const total = (base * (hasSquad ? cfg.squad_multiplier : 1)) + (hasPost ? cfg.post_bonus : 0);
  return { base, total: Math.round(total) };
}
let combos = 0;
for (const level of ['min', 'med', 'ultra']) {
  for (const hasSquad of [false, true]) {
    for (const hasPost of [false, true]) {
      const a = _computePointsV113({ level, hasSquad, hasPost, config: D }).total;
      const b = _computePoints({ level, hasSquad, hasPost, config: D }).total;
      assert.strictEqual(b, a, `✗ régression v.113 sur ${level}/${hasSquad}/${hasPost} (${a} → ${b})`);
      combos++;
    }
  }
}
passed++;
eq('12 combinaisons v.113 rejouées', combos, 12);
ok('appel sans les nouveaux flags = comportement v.113 (aucun bonus fantôme)',
  _computePoints({ level: 'ultra', hasSquad: true, hasPost: true, config: D }).total === 70);

// ============================================================================
// 4) LE REPÈRE DE PROGRESSION — lundi vs lundi, jamais lundi vs mercredi
// ============================================================================
const LUN = 'sess-lundi', MER = 'sess-mercredi';
const ME = 'p1', AUTRE = 'p2';
state.trainingCompletions = [
  // Mes lundis : 5 km, puis 6 km.
  { id: 'c1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-03', runningDistanceKm: 5 },
  { id: 'c2', sessionId: LUN, playerId: ME, datePlanned: '2026-08-10', runningDistanceKm: 6 },
  // Un mercredi BEAUCOUP plus long : ne doit JAMAIS servir de repère au lundi.
  { id: 'c3', sessionId: MER, playerId: ME, datePlanned: '2026-08-12', runningDistanceKm: 30 },
  // Un lundi d'une COÉQUIPIÈRE, énorme : le repère est personnel.
  { id: 'c4', sessionId: LUN, playerId: AUTRE, datePlanned: '2026-08-10', runningDistanceKm: 42 },
  // Un lundi validé SANS distance : ne dit rien, doit être sauté.
  { id: 'c5', sessionId: LUN, playerId: ME, datePlanned: '2026-08-17', runningDistanceKm: null },
  // Un lundi supprimé par le coach (soft-delete) : sorti du calcul.
  { id: 'c6', sessionId: LUN, playerId: ME, datePlanned: '2026-08-18', runningDistanceKm: 99, deletedAt: 1 }
];

eq('repère du lundi 24/08 = 6 km (dernier lundi AVEC distance)', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', null), 6);
eq('le mercredi à 30 km ne contamine pas le lundi', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', null), 6);
eq('le lundi à 42 km d\'une coéquipière ne contamine pas le mien', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', null), 6);
eq('la séance sans distance (17/08) est sautée, pas traitée comme 0', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', null), 6);
eq('la séance soft-deleted (99 km) est exclue', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', null), 6);
eq('repère du mercredi 12/08 = aucun (c\'est sa 1re occurrence)', _trainingPrevDistanceKm(MER, ME, '2026-08-12', null), null);
eq('repère du mercredi 19/08 = 30 km (son propre mercredi, pas le lundi à 6 km)', _trainingPrevDistanceKm(MER, ME, '2026-08-19', null), 30);
eq('première séance du type → pas de repère', _trainingPrevDistanceKm('sess-vendredi', ME, '2026-08-24', null), null);
eq('repère au 10/08 = 5 km (on ne regarde QUE le passé)', _trainingPrevDistanceKm(LUN, ME, '2026-08-10', null), 5);
eq('repère au 03/08 = aucun (rien avant)', _trainingPrevDistanceKm(LUN, ME, '2026-08-03', null), null);
eq('exclusion de sa propre ligne (correction coach)', _trainingPrevDistanceKm(LUN, ME, '2026-08-24', 'c2'), 5);
eq('sessionId manquant → null', _trainingPrevDistanceKm(null, ME, '2026-08-24', null), null);
eq('joueuse manquante → null (coach en aperçu)', _trainingPrevDistanceKm(LUN, null, '2026-08-24', null), null);

// --- amélioration : strictement supérieur -----------------------------------
ok('7 km > repère 6 km → bonus', _trainingIsImprovement(LUN, ME, '2026-08-24', 7, null));
ok('6 km = repère 6 km → PAS de bonus (égaler ≠ progresser)', !_trainingIsImprovement(LUN, ME, '2026-08-24', 6, null));
ok('5 km < repère 6 km → pas de bonus', !_trainingIsImprovement(LUN, ME, '2026-08-24', 5, null));
ok('6.1 km > 6 km → bonus (décimales prises au sérieux)', _trainingIsImprovement(LUN, ME, '2026-08-24', 6.1, null));
ok('première séance du type → jamais de bonus progression', !_trainingIsImprovement('sess-vendredi', ME, '2026-08-24', 99, null));
ok('distance nulle → pas de bonus', !_trainingIsImprovement(LUN, ME, '2026-08-24', 0, null));
ok('distance illisible → pas de bonus', !_trainingIsImprovement(LUN, ME, '2026-08-24', 'beaucoup', null));
ok('distance négative → pas de bonus', !_trainingIsImprovement(LUN, ME, '2026-08-24', -3, null));
ok('mon mercredi à 30 km ne me prive PAS du bonus du lundi à 7 km',
  _trainingIsImprovement(LUN, ME, '2026-08-24', 7, null));

// ============================================================================
// 5) DÉCOMPOSITION — invariant, et non-rétroactivité prouvée sur la donnée
// ============================================================================
const prog = { scoringConfig: {} };   // barème par défaut
const inv = (label, c) => {
  const b = _trainingBreakdown(c, prog);
  const sum = Math.round(b.base * b.squadMult + b.post) + b.distance + b.improvement + b.adjust;
  eq('INVARIANT ' + label + ' : somme = points_total', sum, b.total);
  return b;
};

// (a) validation v.115 complète : med + squad + post + 7 km battant les 6 km.
const cNew = {
  id: 'n1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, squadTeammateId: 'p3', postPhotoUrl: 'u', postMessage: 'go',
  runningDistanceKm: 7, pointsTotal: 110
};
const bNew = inv('v.115 complète', cNew);
eq('décomposition : distance +20', bNew.distance, 20);
eq('décomposition : progression +40', bNew.improvement, 40);
eq('décomposition : aucun ajustement', bNew.adjust, 0);
eq('décomposition : repère affiché', bNew.prevKm, 6);
eq('ligne lisible', _trainingBreakdownLine(bNew), '20 × 2 + 10 + 20 + 40 = 110');

// (b) LA PREUVE DE NON-RÉTROACTIVITÉ : une validation d'AVANT v.115, avec une
// distance qui bat le repère. Son total figé vaut 50 → la décomposition ne doit
// inventer AUCUN bonus, sinon l'écran mentirait sur ce qu'elle a réellement eu.
const cOld = {
  id: 'o1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, squadTeammateId: 'p3', postPhotoUrl: 'u', postMessage: 'go',
  runningDistanceKm: 7, pointsTotal: 50
};
const bOld = inv('validation d\'avant v.115', cOld);
eq('rétro : aucun bonus distance inventé', bOld.distance, 0);
eq('rétro : aucun bonus progression inventé', bOld.improvement, 0);
eq('rétro : aucun ajustement fantôme', bOld.adjust, 0);
eq('rétro : total intact', bOld.total, 50);
eq('rétro : ligne = formule v.113', _trainingBreakdownLine(bOld), '20 × 2 + 10 = 50');

// (c) distance seule (elle a saisi ses km mais n'a pas battu son repère).
const cDist = {
  id: 'd1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, runningDistanceKm: 4, pointsTotal: 40
};
const bDist = inv('distance seule', cDist);
eq('distance seule : +20', bDist.distance, 20);
eq('distance seule : pas de progression', bDist.improvement, 0);

// (d) total FORCÉ par le coach : l'écart inexplicable tombe dans `adjust`,
// jamais dans un bonus qui n'a pas été attribué.
const cForced = {
  id: 'f1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, runningDistanceKm: 7, pointsTotal: 33
};
const bForced = inv('total forcé', cForced);
eq('forcé : ajustement isolé', bForced.adjust, 13);
eq('forcé : aucun bonus inventé', bForced.distance + bForced.improvement, 0);

// (e) séance sans distance du tout.
const bNone = inv('sans distance', {
  id: 'x1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 10, runningDistanceKm: null, pointsTotal: 10
});
eq('sans distance : rien', bNone.distance + bNone.improvement + bNone.adjust, 0);

// (f) post compté sur le MESSAGE seul (override coach), sans photo.
const bMsg = inv('post par message seul', {
  id: 'm1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, postMessage: 'bravo', runningDistanceKm: null, pointsTotal: 30
});
eq('post par message seul reconnu', bMsg.post, 10);

// (g) barème modifié depuis : le total figé reste roi, l'invariant tient.
const bChanged = inv('barème changé depuis', {
  id: 'g1', sessionId: LUN, playerId: ME, datePlanned: '2026-08-24',
  basePoints: 20, runningDistanceKm: 7, pointsTotal: 999
});
eq('barème changé : le total figé n\'est jamais réécrit', bChanged.total, 999);

console.log(`✓ ${passed} assertions passées — bonus course prépa v.115 ` +
  `(+distance / +progression L→L, non-rétroactivité, invariant de décomposition) OK`);
