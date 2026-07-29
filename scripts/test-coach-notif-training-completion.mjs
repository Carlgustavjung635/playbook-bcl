// Test NOTIF COACH — validation de séance de prépa dans le feed (cloche 🔔).
//
// ORIGINE (incident 2026-07-29) : une joueuse valide sa séance → le push part
// (_trainingNotifyCoachCompletion) → le coach reçoit bien « 💪 Séance validée ·
// 20 pts · 2.92 km » sur son téléphone → il ouvre l'app et ne trouve RIEN. La row
// training_completions était pourtant parfaitement enregistrée et bien affichée
// dans Prépa physique → 📊 Suivi. Le trou : notifFeed(), branche coach, ne
// dérivait rien de training_completions — cloche vide, badge à 0, la notif
// menait à une impasse.
//
// Comme test-training-wizard.mjs, ce test évalue les <script> classiques du VRAI
// index.html dans un vm à DOM stubé : une copie fidèle des fonctions ne pourrait
// pas prouver que le feed est câblé. Les <script type="module"> (PbSync) sont
// hors de portée.
//
// MAINTENANCE — si ce test casse après un changement SANS RAPPORT avec les
// notifs, c'est probablement le boot d'index.html qui touche une API navigateur
// pas encore stubée (cf. `ctx`) : ajouter le stub, ne pas supprimer le test.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;';

// --- stubs DOM minimalistes -------------------------------------------------
const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {},
});
const doc = {
  getElementById: () => mkEl(), createElement: mkEl,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible',
};
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  document: doc,
  navigator: {
    userAgent: 'probe', onLine: true,
    serviceWorker: {
      getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}),
      ready: Promise.resolve({ showNotification() {} }), addEventListener() {},
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
  alert: () => {}, confirm: () => true, prompt: () => '',
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 390, innerHeight: 844,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

// --- décor : la donnée RÉELLE de l'incident ---------------------------------
const S = ctx.state;
const DONE_AT = Date.parse('2026-07-29T06:27:20.438Z');
function seed() {
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'Saison 2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }];
  S.activeSeasonId = '2026-2027';
  S.players = [{ id: 'pA', name: 'Joueuse A', num: 7 }, { id: 'pB', name: 'Joueuse B', num: 8 }];
  S.seasonPlayers = [
    { seasonId: '2026-2027', playerId: 'pA', teamTag: 'both', joinedAt: '2026-07-10', leftAt: null },
    { seasonId: '2026-2027', playerId: 'pB', teamTag: 'both', joinedAt: '2026-07-10', leftAt: null },
  ];
  S.trainingPrograms = [{
    id: 'prog1', name: 'Préparation estivale', startDate: '2026-07-28', endDate: '2026-08-17',
    daysActive: [1, 3, 5],
    scoringConfig: { points: { min: 10, med: 20, ultra: 30 }, post_bonus: 10, squad_multiplier: 2, remind_hour: 9 },
    isActive: true, teamTag: 'both', deletedAt: null, updatedAt: Date.parse('2026-07-28T00:00:00Z'),
  }];
  S.trainingSessions = [
    { id: 'sLun', programId: 'prog1', dayOfWeek: 1, name: 'Format Capacité', blocks: [], isTemplate: false, position: 0, deletedAt: null },
    { id: 'sMer', programId: 'prog1', dayOfWeek: 3, name: 'Format Intermittent', blocks: [], isTemplate: false, position: 1, deletedAt: null },
  ];
  S.trainingCompletions = [{
    id: 'comp1', programId: 'prog1', sessionId: 'sMer', playerId: 'pA',
    datePlanned: '2026-07-29', dateCompleted: DONE_AT, contractLevel: 'med',
    basePoints: 20, squadTeammateId: null, squadPhotoUrl: null, postPhotoUrl: null, postMessage: '',
    runningDistanceKm: 2.92, pointsTotal: 20, notes: '',
    createdAt: DONE_AT, updatedAt: DONE_AT, deletedAt: null,
  }];
  S.gageDraws = []; S.matches = []; S.broadcasts = [];
  ctx.setNotifSeenAt(DONE_AT - 60000); // filigrane AVANT la validation → non lue
}
seed();
ctx.render = () => {}; ctx.showToast = () => {}; ctx.notifyPush = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };

const trItems = () => ctx.notifFeed().filter(i => String(i.id).startsWith('trdone-'));

// --- 1) LE BUG D'ORIGINE ----------------------------------------------------
t('la validation apparaît dans le feed coach (cloche non vide)', () => {
  const it = trItems();
  assert(it.length === 1, 'attendu 1 entrée prépa, reçu ' + it.length);
});
t('le badge compte la validation non lue', () => {
  assert(ctx.appBadgeCount() >= 1, 'badge à 0 alors que la séance est non lue');
});
t('le détail porte joueuse + points + distance (comme le push)', () => {
  const d = trItems()[0].detail;
  assert(d.includes('#7 Joueuse A'), 'joueuse absente : ' + d);
  assert(d.includes('20 pts'), 'points absents : ' + d);
  assert(d.includes('2.92'), 'distance absente : ' + d);
});
t('l\'entrée est actionnable → ouvre le suivi du bon programme', () => {
  assert(trItems()[0].action === "openTrainingDashboard('prog1')", 'action = ' + trItems()[0].action);
});
t('l\'action pointe une fonction qui existe et rend sans throw', () => {
  assert(typeof ctx.openTrainingDashboard === 'function', 'openTrainingDashboard absent');
  ctx.openTrainingDashboard('prog1');
  assert(ctx.__lastModal && ctx.__lastModal.includes('2.9km'), 'le suivi ne montre pas la distance');
});

// --- 2) filigrane « tout lu » ----------------------------------------------
t('après markAllNotifsRead, l\'entrée reste mais devient lue', () => {
  ctx.setNotifSeenAt(DONE_AT + 60000);
  const it = trItems();
  assert(it.length === 1, 'entrée disparue une fois lue');
  assert(it[0].unread === false, 'toujours non lue');
  ctx.setNotifSeenAt(DONE_AT - 60000);
});

// --- 3) pas de fuite : soft-delete, programme supprimé, scoping équipe ------
t('une validation soft-deleted ne remonte pas', () => {
  S.trainingCompletions[0].deletedAt = DONE_AT;
  assert(trItems().length === 0, 'validation supprimée encore listée');
  S.trainingCompletions[0].deletedAt = null;
});
t('un programme supprimé ne remonte plus ses validations', () => {
  S.trainingPrograms[0].deletedAt = DONE_AT;
  assert(trItems().length === 0, 'programme supprimé encore listé');
  S.trainingPrograms[0].deletedAt = null;
});
t('un coach scopé sur une autre équipe ne voit pas le programme', () => {
  S.coaches = [{ id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e2'] }];
  S.auth.coachId = 'c2';
  S.trainingPrograms[0].teamTag = 'e1';
  assert(trItems().length === 0, 'fuite cross-équipe dans le feed');
  S.trainingPrograms[0].teamTag = 'both';
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.auth.coachId = 'admin';
});
t('une joueuse hors effectif de la saison active ne remonte pas', () => {
  S.seasonPlayers = S.seasonPlayers.filter(sp => sp.playerId !== 'pA');
  assert(trItems().length === 0, 'joueuse hors effectif encore listée');
  S.seasonPlayers.push({ seasonId: '2026-2027', playerId: 'pA', teamTag: 'both', joinedAt: '2026-07-10', leftAt: null });
});
t('le feed joueuse ne contient pas ces entrées coach', () => {
  S.auth = { role: 'player', playerId: 'pB' };
  assert(ctx.notifFeed().every(i => !String(i.id).startsWith('trdone-')), 'entrée coach visible côté joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// --- 4) volume : deux validations de la MÊME joueuse restent distinctes ------
t('2 validations de la même joueuse = 2 entrées distinctes (jour prévu au détail)', () => {
  S.trainingCompletions.push({
    id: 'comp2', programId: 'prog1', sessionId: 'sLun', playerId: 'pA',
    datePlanned: '2026-07-27', dateCompleted: DONE_AT - 86400000, contractLevel: 'min',
    basePoints: 10, squadTeammateId: null, squadPhotoUrl: null, postPhotoUrl: null, postMessage: '',
    runningDistanceKm: null, pointsTotal: 10, notes: '',
    createdAt: DONE_AT - 86400000, updatedAt: DONE_AT - 86400000, deletedAt: null,
  });
  const it = trItems();
  assert(it.length === 2, 'attendu 2, reçu ' + it.length);
  assert(it[0].detail !== it[1].detail, 'les 2 entrées sont indiscernables : ' + it[0].detail);
});
t('la liste est bornée à 30 par programme (notifFeed tourne à chaque render)', () => {
  for (let i = 0; i < 60; i++) {
    S.trainingCompletions.push({
      id: 'bulk' + i, programId: 'prog1', sessionId: 'sMer', playerId: 'pB',
      datePlanned: '2026-07-29', dateCompleted: DONE_AT - i * 3600000, contractLevel: 'med',
      basePoints: 20, pointsTotal: 20, runningDistanceKm: null, postMessage: '', notes: '',
      createdAt: DONE_AT - i * 3600000, updatedAt: DONE_AT - i * 3600000, deletedAt: null,
    });
  }
  assert(trItems().length === 30, 'borne non respectée : ' + trItems().length);
});

// --- 5) le feed ne throw pas sur une donnée partielle -----------------------
t('une validation sans date ni joueuse connue ne casse pas le feed', () => {
  S.trainingCompletions = [{
    id: 'weird', programId: 'prog1', sessionId: 'sMer', playerId: 'ghost',
    datePlanned: null, dateCompleted: null, createdAt: null, contractLevel: 'med',
    basePoints: 20, pointsTotal: 20, runningDistanceKm: null, deletedAt: null,
  }];
  const feed = ctx.notifFeed();
  assert(Array.isArray(feed), 'feed cassé');
  assert(trItems().length === 0, 'row sans horodatage listée quand même');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
