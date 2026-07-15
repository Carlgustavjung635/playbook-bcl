// Test PRÉPA « FULL PACKAGE » — wizard coach, bout en bout, sur le VRAI code.
//
// Contrairement aux autres test-*.mjs (qui recopient les fonctions pures), celui-ci
// évalue les blocs <script> classiques d'index.html dans un vm avec un DOM stubé,
// puis pilote le wizard comme le ferait un coach : création → blocs → modèle →
// publication → édition → dépublication. C'est le seul test qui prouve que le
// wizard TOURNE (les copies fidèles ne peuvent pas attraper un render qui throw,
// une classe CSS inexistante ou un helper mal nommé).
//
// MAINTENANCE — si ce fichier casse après un changement SANS RAPPORT avec la
// prépa, c'est probablement le boot d'index.html qui touche une API navigateur
// pas encore stubée (cf. l'objet `ctx` ci-dessous) : ajouter le stub, ne pas
// supprimer le test. Les blocs <script type="module"> (PbSync/ENTITIES) sont hors
// de portée — leur round-trip est couvert par test-training-programs.mjs §8.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
// `state`/`K` sont des `const` de haut niveau : ils vivent dans la portée
// lexicale du contexte, pas sur son objet global — d'où le pont explicite.
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.SECTIONS_PLAYER = SECTIONS_PLAYER;'
  + '\nglobalThis.TRAINING_LEVELS = TRAINING_LEVELS; globalThis.TRAINING_DAY_LABELS = TRAINING_DAY_LABELS;';

// --- stubs DOM minimalistes -------------------------------------------------
const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {},
});
const doc = {
  getElementById: () => mkEl(),
  createElement: mkEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(),
  visibilityState: 'visible',
};
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  document: doc,
  navigator: {
    userAgent: 'probe', onLine: true,
    serviceWorker: {
      getRegistrations: () => Promise.resolve([]),
      register: () => Promise.resolve({}),
      ready: Promise.resolve({ showNotification() {} }),
      addEventListener() {},
    },
  },
  location: { hash: '', href: 'http://localhost/', replace() {}, reload() {} },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  alert: msg => { ctx.__alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => 'Modèle test',
  __alerts: [],
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 390, innerHeight: 844,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined,
  Notification: undefined, screen: { orientation: null },
  indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('✓ script évalué');

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

// --- scénario coach ---------------------------------------------------------
ctx.state.auth = { role: 'coach' };
ctx.state.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
ctx.state.auth.coachId = 'admin';
ctx.showToast = () => {};
ctx.render = () => {};
ctx.notifyPush = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => {};

t('_trainingIsCoach() vrai pour un coach', () => assert(ctx._trainingIsCoach() === true));

t('openTrainingWizard() initialise l\'état', () => {
  ctx.openTrainingWizard();
  const w = ctx._tw();
  assert(w, 'wizard absent');
  assert(w.step === 1, 'step != 1');
  assert(JSON.stringify(w.daysActive) === '[1,3,5]', 'jours par défaut != lun/mer/ven');
  assert(w.config.points.med === 20, 'barème med != 20');
  assert(w.config.squad_multiplier === 2, 'mult != 2');
  assert(w.config.post_bonus === 10, 'bonus != 10');
});

t('étape 1 rend sans throw', () => { ctx._twGo(1); assert(ctx.__lastModal.includes('Jours actifs')); });
t('étape 2 (barème) rend et montre le calcul 20×2 + 10 = 50', () => {
  ctx._twGo(2);
  assert(ctx.__lastModal.includes('20×2 + 10 = <b>50 pts</b>'), 'exemple de calcul absent/faux');
});
t('étape 3 (séances) liste les 3 jours actifs', () => {
  ctx._twGo(3);
  ['LUNDI', 'MERCREDI', 'VENDREDI'].forEach(d => assert(ctx.__lastModal.toUpperCase().includes(d), d + ' absent'));
});

t('nom + dates', () => {
  ctx._twSet('name', 'Prépa test');
  ctx._twSet('startDate', '2026-07-13');
  ctx._twSet('endDate', '2026-08-23');
  assert(ctx._tw().name === 'Prépa test');
});

t('ouvrir lundi crée la session', () => {
  ctx._twOpenDay(1);
  const w = ctx._tw();
  assert(w.openDay === 1, 'openDay != 1');
  assert(w.sessions[1], 'session lundi absente');
});

t('ajouter 2 blocs (dont un course avec distance)', () => {
  ctx._twAddBlock();
  const b1 = ctx._twBlock();
  ctx._twBlockField('name', 'Échauffement');
  ctx._twBlockType('warmup');
  ctx._twBlockLevelText('min', '5 min');
  ctx._twBlockLevelText('med', '8 min');
  ctx._twBlockLevelText('ultra', '12 min');
  ctx._twCloseBlock();

  ctx._twAddBlock();
  ctx._twBlockField('name', 'Course');
  ctx._twBlockType('course');
  ctx._twBlockTrack(true);
  ctx._twBlockLevelText('min', '2 km');
  ctx._twBlockLevelText('med', '4 km');
  ctx._twBlockLevelText('ultra', '6 km');
  ctx._twCloseBlock();

  const s = ctx._tw().sessions[1];
  assert(s.blocks.length === 2, 'attendu 2 blocs, reçu ' + s.blocks.length);
  assert(s.blocks[1].track_distance === true, 'track_distance non posé');
  assert(b1.id !== s.blocks[1].id, 'ids de blocs non uniques');
});

t('réordonnancement ▲▼', () => {
  const s = ctx._tw().sessions[1];
  const [a, b] = [s.blocks[0].id, s.blocks[1].id];
  ctx._twMoveBlock(b, -1);
  assert(ctx._tw().sessions[1].blocks[0].id === b, 'move up sans effet');
  ctx._twMoveBlock(b, 1);
  assert(ctx._tw().sessions[1].blocks[0].id === a, 'move down sans effet');
});

t('validation bloque tant que mer/ven sont vides', () => {
  const pb = ctx._twValidate();
  assert(pb.some(p => p.includes('Mercredi')), 'mercredi vide non signalé');
  assert(pb.some(p => p.includes('Vendredi')), 'vendredi vide non signalé');
});

t('remplir mer + ven', () => {
  [3, 5].forEach(d => {
    ctx._twOpenDay(d);
    ctx._twAddBlock();
    ctx._twBlockField('name', 'Gainage');
    ctx._twBlockType('gainage');
    ctx._twBlockLevelText('min', '3×30s');
    ctx._twBlockLevelText('med', '4×45s');
    ctx._twBlockLevelText('ultra', '5×60s');
    ctx._twCloseBlock();
  });
  ctx._twCloseDay();
  const pb = ctx._twValidate();
  assert(pb.length === 0, 'problèmes restants: ' + JSON.stringify(pb));
});

t('modèle : enregistrer puis appliquer', () => {
  ctx._twOpenDay(1);
  ctx._twSaveAsTemplate();
  assert(ctx._trainingTemplates().length === 1, 'modèle non enregistré');
  const tpl = ctx._trainingTemplates()[0];
  assert(tpl.dayOfWeek === null && tpl.programId === null, 'modèle rattaché à un jour/programme');
  ctx._twOpenDay(3);
  ctx._twApplyTemplate(tpl.id);
  const s3 = ctx._tw().sessions[3];
  assert(s3.blocks.length === 2, 'modèle non appliqué (attendu 2 blocs)');
  assert(s3.blocks[0].id !== tpl.blocks[0].id, 'ids de blocs partagés avec le modèle (clone superficiel !)');
  ctx._twCloseDay();
});

t('étape 4 : récap prêt à publier', () => {
  ctx._twGo(4);
  assert(ctx.__lastModal.includes('Prêt à publier'), 'récap ne dit pas « prêt »');
});

t('saveTrainingProgram() publie', () => {
  ctx.saveTrainingProgram();
  assert(ctx._tw() === null, 'wizard non refermé');
  const progs = ctx.activeTrainingPrograms();
  assert(progs.length === 1, 'attendu 1 programme, reçu ' + progs.length);
  const p = progs[0];
  assert(p.name === 'Prépa test', 'nom perdu');
  assert(JSON.stringify(p.daysActive) === '[1,3,5]', 'jours perdus');
  const sess = ctx._trainingSessionsOf(p.id);
  assert(sess.length === 3, 'attendu 3 sessions, reçu ' + sess.length);
  assert(sess.every(s => !s.isTemplate), 'une session publiée est marquée modèle');
  assert(sess.map(s => s.dayOfWeek).join(',') === '1,3,5', 'jours de session faux');
});

t('_dateRangeForProgram sur le programme publié', () => {
  const p = ctx.activeTrainingPrograms()[0];
  const dates = ctx._dateRangeForProgram(p.startDate, p.endDate, p.daysActive);
  assert(dates.length === 18, 'attendu 18 dates (6 sem × 3j), reçu ' + dates.length);
  assert(dates[0] === '2026-07-13', 'première date != lundi 13/07');
});

t('_programSessionForDay retrouve la séance du lundi', () => {
  const p = ctx.activeTrainingPrograms()[0];
  const s = ctx._programSessionForDay(p, 1);
  assert(s, 'aucune session lundi');
  assert(s.blocks.length === 2, 'blocs du lundi perdus');
});

// (Le round-trip PbSync n'est pas testable ici : les sérialiseurs vivent dans le
// bloc <script type="module">, hors de ce contexte. Couvert par
// scripts/test-training-programs.mjs §8.)

t('édition : ré-ouvrir le programme recharge les séances', () => {
  const p = ctx.activeTrainingPrograms()[0];
  ctx.openTrainingWizard(p.id);
  const w = ctx._tw();
  assert(w.editingId === p.id, 'editingId absent');
  assert(Object.keys(w.sessions).length === 3, 'sessions non rechargées');
  assert(w.sessions[1].blocks.length === 2, 'blocs du lundi non rechargés');
  assert(w.name === 'Prépa test', 'nom non rechargé');
});

t('retirer vendredi soft-delete sa session (jamais de hard delete: FK completions)', () => {
  ctx._twToggleDay(5);
  assert(!ctx._tw().daysActive.includes(5), 'vendredi toujours actif');
  ctx.saveTrainingProgram();
  const p = ctx.activeTrainingPrograms()[0];
  assert(ctx._trainingSessionsOf(p.id).length === 2, 'session vendredi non retirée');
  const dead = ctx.state.trainingSessions.find(s => s.programId === p.id && s.dayOfWeek === 5);
  assert(dead && dead.deletedAt, 'vendredi hard-deleted au lieu de soft-deleted');
});

t('classement : effectif vide → pas de crash', () => {
  const p = ctx.activeTrainingPrograms()[0];
  const lb = ctx._trainingLeaderboard(p.id);
  assert(Array.isArray(lb), 'classement non-array');
});

t('_trainingPlannedToDate borné à aujourd\'hui', () => {
  const p = ctx.activeTrainingPrograms()[0];
  const n = ctx._trainingPlannedToDate(p, '2026-07-15');
  assert(n === 2, 'attendu 2 séances prévues au 15/07 (lun 13 + mer 15), reçu ' + n);
});

t('dépublier / republier', () => {
  const p = ctx.activeTrainingPrograms()[0];
  ctx.toggleTrainingProgramActive(p.id);
  assert(ctx.activeTrainingPrograms()[0].isActive === false, 'non dépublié');
  assert(!ctx._trainingProgramRunning(p, '2026-07-15'), 'dépublié mais toujours « en cours »');
  ctx.toggleTrainingProgramActive(p.id);
  assert(ctx.activeTrainingPrograms()[0].isActive === true, 'non republié');
});

t('openTrainingPrograms() rend sans throw', () => { ctx.openTrainingPrograms(); assert(ctx.__lastModal.includes('Prépa physique')); });
t('openTrainingDashboard() rend sans throw', () => {
  const p = ctx.activeTrainingPrograms()[0];
  ctx.openTrainingDashboard(p.id);
  assert(ctx.__lastModal.includes('Classement'), 'classement absent du dashboard');
});
t('renderTrainingCoachCard() rend sans throw', () => {
  const h = ctx.renderTrainingCoachCard();
  assert(h.includes('Prépa physique'), 'carte coach vide');
});
t('renderHomeCoach() rend sans throw (offseason retiré)', () => {
  const h = ctx.renderHomeCoach();
  assert(!h.includes('openOffseasonConfig'), 'CTA offseason encore rendu sur la home coach');
  assert(!h.includes('openOffseasonDashboard'), 'dashboard offseason encore rendu sur la home coach');
  assert(!h.includes('Configurer la prépa'), 'carte offseason encore rendue');
  assert(h.includes('Prépa physique'), 'nouvelle carte absente de la home');
});
t('module offseason toujours présent (audit/restauration)', () => {
  assert(typeof ctx.renderPlayerProgramme === 'function', 'renderPlayerProgramme supprimée');
  assert(typeof ctx.openOffseasonConfig === 'function', 'openOffseasonConfig supprimée');
  assert(typeof ctx.renderProgramSelector === 'function', 'renderProgramSelector supprimée');
});
t('« Forme » retirée de la nav joueuse', () => {
  assert(!ctx.SECTIONS_PLAYER.some(s => s.id === 'programme'), 'entrée nav « programme » toujours là');
});
t('route #/programme toujours routable (audit)', () => {
  assert(ctx._pbIsValidSection('programme'), 'route programme cassée');
});

// ============================================================================
// PARCOURS JOUEUSE — séance du jour, niveaux, validation, points, rattrapage.
// ============================================================================
// Un effectif minimal + une saison, sinon _trainingPoolFor renvoie [] et il n'y
// a ni coéquipière de squad ni classement à vérifier.
ctx.state.players = [
  { id: 'p1', name: 'Alice', num: 7 },
  { id: 'p2', name: 'Delph', num: 6 },
  { id: 'p3', name: 'Zoé', num: 12 },
];
ctx._seasonsLoaded = () => false; // → _trainingPoolFor retombe sur state.players
ctx.currentPlayer = () => ctx.state.players.find(p => p.id === (ctx.state.auth && ctx.state.auth.playerId));

// Programme déterministe : lundi 13/07/2026, med+squad+post doit donner 50.
const PROG = ctx.activeTrainingPrograms()[0];
ctx.state.trainingPrograms = [{ ...PROG, startDate: '2026-07-13', endDate: '2026-08-23', daysActive: [1, 3], isActive: true, teamTag: 'both' }];
const LUN = '2026-07-13';
const MIDI_LUN = Date.parse('2026-07-13T12:00:00Z');
const MIDI_MAR = Date.parse('2026-07-14T12:00:00Z');
const MIDI_MER = Date.parse('2026-07-15T12:00:00Z');

ctx.state.auth = { role: 'player', playerId: 'p1' };

// Horloge gelée : le parcours joueuse est daté (fenêtre de 48 h), donc il doit
// être joué à une date fixe — sinon la suite passerait ou casserait selon le jour
// où on la lance. `Date` est partagé avec l'hôte : toujours restaurer.
const REAL_NOW = Date.now;
const freeze = ms => { Date.now = () => ms; };
const unfreeze = () => { Date.now = REAL_NOW; };

t('joueuse : le programme est visible', () => {
  const mine = ctx._myTrainingPrograms(LUN);
  assert(mine.length === 1, 'attendu 1 programme visible, reçu ' + mine.length);
});
t('joueuse : programme dépublié invisible', () => {
  ctx.state.trainingPrograms[0].isActive = false;
  assert(ctx._myTrainingPrograms(LUN).length === 0, 'programme dépublié encore visible');
  ctx.state.trainingPrograms[0].isActive = true;
});
t('joueuse : hors période → invisible', () => {
  assert(ctx._myTrainingPrograms('2026-09-01').length === 0, 'programme visible après sa fin');
});

const P = () => ctx.activeTrainingPrograms()[0];
t('_trainingDueFor : lundi midi → séance du jour, pas un rattrapage', () => {
  const due = ctx._trainingDueFor(P(), 'p1', MIDI_LUN);
  assert(due.length === 1, 'attendu 1 séance due, reçu ' + due.length);
  assert(due[0].datePlanned === LUN, 'mauvais jour prévu');
  assert(due[0].isRattrapage === false, 'la séance du jour ne doit pas être un rattrapage');
  assert(!due[0].done, 'séance déjà marquée faite');
});
t('_trainingDueFor : mardi midi → lundi en RATTRAPAGE (mardi non actif)', () => {
  const due = ctx._trainingDueFor(P(), 'p1', MIDI_MAR);
  assert(due.length === 1, 'attendu 1 séance due, reçu ' + due.length);
  assert(due[0].datePlanned === LUN, 'le rattrapage doit porter sur lundi');
  assert(due[0].isRattrapage === true, 'non marqué rattrapage');
});
t('_trainingDueFor : mercredi midi → séance de mercredi seule (lundi périmé)', () => {
  const due = ctx._trainingDueFor(P(), 'p1', MIDI_MER);
  assert(due.length === 1, 'attendu 1 séance due, reçu ' + due.length);
  assert(due[0].datePlanned === '2026-07-15', 'lundi périmé encore proposé !');
});
t('_trainingHoursLeft décroît correctement', () => {
  assert(ctx._trainingHoursLeft(LUN, MIDI_LUN) === 36, 'attendu 36h lundi midi, reçu ' + ctx._trainingHoursLeft(LUN, MIDI_LUN));
  assert(ctx._trainingHoursLeft(LUN, MIDI_MAR) === 12, 'attendu 12h mardi midi');
  assert(ctx._trainingHoursLeft(LUN, MIDI_MER) === 0, 'attendu 0h mercredi midi');
});

freeze(MIDI_LUN); // ↓ tout le parcours de validation se joue le lundi à midi

t('openTrainingSession() rend la séance du lundi', () => {
  const s = ctx._programSessionForDay(P(), 1);
  ctx.openTrainingSession(P().id, s.id, LUN);
  assert(ctx.state._trainingView, 'vue non initialisée');
  assert(ctx.state._trainingView.level === 'med', 'niveau par défaut != med');
  assert(ctx.__lastModal.includes('Ton contrat du jour'), 'sélecteur de niveau absent');
  assert(ctx.__lastModal.includes('J\'ai fait la séance'), 'CTA de validation absent');
});
t('les 3 niveaux sont proposés et le texte suit le niveau', () => {
  ctx._tvLevel('min');
  assert(ctx.__lastModal.includes('5 min'), 'texte du niveau min absent');
  ctx._tvLevel('ultra');
  assert(ctx.__lastModal.includes('12 min'), 'texte du niveau ultra absent');
  assert(ctx.__lastModal.includes('6 km'), 'texte course ultra absent');
  ctx._tvLevel('med');
});

t('openTrainingValidate() ouvre la validation à 20 pts (med nu)', () => {
  ctx.openTrainingValidate();
  assert(ctx._tva(), 'état de validation absent');
  assert(ctx._tvaPoints().total === 20, 'attendu 20, reçu ' + ctx._tvaPoints().total);
});
t('squad coché SANS photo/coéquipière → toujours 20 (l\'aperçu ne ment pas)', () => {
  ctx._tvaToggle('squadOn');
  assert(ctx._tvaPoints().total === 20, 'le multiplicateur s\'applique sans justificatif !');
});
t('squad complet → 40', () => {
  ctx._tvaSet('squadTeammateId', 'p2');
  ctx._tvaSet('squadPhotoUrl', 'https://s/squad.jpg');
  assert(ctx._tvaSquadOk(), 'squad non validé');
  assert(ctx._tvaPoints().total === 40, 'attendu 40, reçu ' + ctx._tvaPoints().total);
});
t('post complet → 50 — CAS DE RÉFÉRENCE (20×2 + 10)', () => {
  ctx._tvaToggle('postOn');
  ctx._tvaSet('postPhotoUrl', 'https://s/post.jpg');
  ctx._tvaSet('postMessage', 'Séance faite 💪');
  assert(ctx._tvaPostOk(), 'post non validé');
  assert(ctx._tvaPoints().total === 50, 'attendu 50, reçu ' + ctx._tvaPoints().total);
});
t('la coéquipière proposée n\'est jamais soi-même', () => {
  ctx.renderTrainingValidate();
  assert(!ctx.__lastModal.includes('#7 Alice'), 'la joueuse se voit proposée comme sa propre coéquipière');
  assert(ctx.__lastModal.includes('#6 Delph'), 'coéquipière absente du sélecteur');
});
t('distance demandée (un bloc course a track_distance)', () => {
  assert(ctx.__lastModal.includes('Distance parcourue'), 'input distance absent alors qu\'un bloc course le demande');
  ctx._tvaSet('distanceKm', '5.2');
});

t('confirmTrainingCompletion() écrit la validation à 50 pts', () => {
  ctx.confirmTrainingCompletion();
  const comps = ctx.state.trainingCompletions;
  assert(comps.length === 1, 'attendu 1 validation, reçu ' + comps.length);
  const c = comps[0];
  assert(c.pointsTotal === 50, 'points_total = ' + c.pointsTotal + ' (attendu 50)');
  assert(c.basePoints === 20, 'base_points = ' + c.basePoints + ' (attendu 20, figé)');
  assert(c.contractLevel === 'med', 'niveau non figé');
  assert(c.datePlanned === LUN, 'date_planned fausse');
  assert(c.squadTeammateId === 'p2', 'coéquipière perdue');
  assert(c.runningDistanceKm === 5.2, 'distance perdue: ' + c.runningDistanceKm);
  assert(ctx.state._trainingValidate === null, 'état de validation non nettoyé');
});
t('anti double-validation', () => {
  const s = ctx._programSessionForDay(P(), 1);
  assert(ctx._trainingCompletionFor(s.id, 'p1', LUN), 'validation introuvable');
  ctx.openTrainingSession(P().id, s.id, LUN);
  assert(ctx.__lastModal.includes('Séance validée'), 'séance validée non signalée');
  assert(!ctx.__lastModal.includes('J\'ai fait la séance'), 'CTA de validation encore proposé après coup');
});
t('barème changé APRÈS coup → l\'historique n\'est pas réécrit', () => {
  ctx.state.trainingPrograms[0].scoringConfig = { points: { min: 1, med: 1, ultra: 1 }, squad_multiplier: 1, post_bonus: 0 };
  const lb = ctx._trainingLeaderboard(P().id);
  const me = lb.find(r => r.id === 'p1');
  assert(me.points === 50, 'points recalculés depuis le barème courant (' + me.points + ') — doivent rester figés à 50');
  ctx.state.trainingPrograms[0].scoringConfig = { points: { min: 10, med: 20, ultra: 30 }, squad_multiplier: 2, post_bonus: 10 };
});
t('classement : effectif entier, joueuses à 0 incluses', () => {
  const lb = ctx._trainingLeaderboard(P().id);
  assert(lb.length === 3, 'attendu 3 joueuses, reçu ' + lb.length);
  assert(lb[0].id === 'p1' && lb[0].points === 50, 'tête de classement fausse');
  assert(lb[1].points === 0 && lb[2].points === 0, 'joueuses à 0 absentes');
  assert(lb[0].km === 5.2, 'km non agrégés');
  assert(lb[0].squads === 1 && lb[0].posts === 1, 'compteurs squad/post faux');
});
t('validation hors délai refusée (mercredi pour lundi)', () => {
  const s = ctx._programSessionForDay(P(), 1);
  ctx.state.trainingCompletions = [];
  ctx.state._trainingView = { programId: P().id, sessionId: s.id, datePlanned: LUN, level: 'med' };
  ctx.__alerts.length = 0;
  freeze(MIDI_MER);
  ctx.openTrainingValidate();
  assert(!ctx._tva(), 'validation ouverte alors que le délai est dépassé');
  assert(ctx.__alerts.some(a => a.includes('48')), 'aucune alerte de délai');
});
t('séance périmée : l\'écran le dit et retire le CTA', () => {
  const s = ctx._programSessionForDay(P(), 1);
  freeze(MIDI_MER);
  ctx.openTrainingSession(P().id, s.id, LUN);
  assert(ctx.__lastModal.includes('Délai dépassé'), 'péremption non signalée');
  assert(!ctx.__lastModal.includes('J\'ai fait la séance'), 'CTA proposé sur une séance périmée');
});
t('renderTrainingPlayerCard() : séance du jour cliquable', () => {
  freeze(MIDI_LUN);
  const h = ctx.renderTrainingPlayerCard();
  assert(h.includes('Ma prépa'), 'carte joueuse absente');
  assert(h.includes('openTrainingSession'), 'séance non cliquable');
  assert(!h.includes('Rattrapage possible'), 'la séance du jour est présentée comme un rattrapage');
});
t('renderTrainingPlayerCard() : badge « Rattrapage possible » le lendemain', () => {
  freeze(MIDI_MAR);
  const h = ctx.renderTrainingPlayerCard();
  assert(h.includes('Rattrapage possible'), 'badge de rattrapage absent');
  assert(h.includes('12 h pour la valider'), 'heures restantes fausses/absentes');
});
t('renderTrainingPlayerCard() : jour de repos', () => {
  freeze(Date.parse('2026-07-14T12:00:00Z'));
  ctx.state.trainingPrograms[0].daysActive = [3]; // mercredi seul → mardi = repos
  try {
    const h = ctx.renderTrainingPlayerCard();
    assert(h.includes('Repos'), 'jour de repos non affiché');
  } finally { ctx.state.trainingPrograms[0].daysActive = [1, 3]; }
});
t('renderTrainingPlayerCard() vide si aucun programme', () => {
  const keep = ctx.state.trainingPrograms;
  ctx.state.trainingPrograms = [];
  try { assert(ctx.renderTrainingPlayerCard() === '', 'carte rendue sans programme'); }
  finally { ctx.state.trainingPrograms = keep; }
});
t('renderHomePlayer() rend sans throw', () => {
  freeze(MIDI_LUN);
  const h = ctx.renderHomePlayer();
  assert(typeof h === 'string' && h.length > 0, 'home joueuse vide');
});
t('launchTrainingDrill : drill absent → pas de crash', () => {
  ctx.launchTrainingDrill('inexistant');
  assert(true);
});
t('_trainingMaybeResume : sans drill lancé → no-op', () => {
  ctx.window._trainingResume = null;
  ctx._trainingMaybeResume();
  assert(true);
});

unfreeze();

console.log('\n' + R.join('\n'));
const fails = R.filter(r => r.startsWith('✗'));
console.log('\n' + (fails.length ? '✗ ' + fails.length + ' échec(s) / ' + R.length : '✓ ' + R.length + '/' + R.length + ' checks OK'));
if (ctx.__alerts.length) console.log('alerts: ' + JSON.stringify(ctx.__alerts));
process.exit(fails.length ? 1 : 0);
