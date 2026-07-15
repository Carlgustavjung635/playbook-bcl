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

console.log('\n' + R.join('\n'));
const fails = R.filter(r => r.startsWith('✗'));
console.log('\n' + (fails.length ? '✗ ' + fails.length + ' échec(s) / ' + R.length : '✓ ' + R.length + '/' + R.length + ' checks OK'));
if (ctx.__alerts.length) console.log('alerts: ' + JSON.stringify(ctx.__alerts));
process.exit(fails.length ? 1 : 0);
