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

const trItems = (o) => ctx.notifFeed(o).filter(i => String(i.id).startsWith('trdone-'));
const allItems = () => ctx.notifFeed({ showRead: true });

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
// Depuis le suivi coach détaillé (v.95), l'action atterrit directement sur
// l'onglet « Suivi détaillé » : le coach qui touche « séance validée » veut la
// photo et la distance, pas le classement.
t('l\'entrée est actionnable → ouvre le suivi détaillé du bon programme', () => {
  assert(trItems()[0].action === "openTrainingDashboard('prog1','detail')", 'action = ' + trItems()[0].action);
});
t('l\'action pointe une fonction qui existe et rend sans throw', () => {
  assert(typeof ctx.openTrainingDashboard === 'function', 'openTrainingDashboard absent');
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(ctx.__lastModal && ctx.__lastModal.includes('2.92'), 'le suivi ne montre pas la distance');
});
t('l\'onglet classement montre toujours le cumul km', () => {
  ctx.openTrainingDashboard('prog1');
  assert(ctx.__lastModal && ctx.__lastModal.includes('2.9km'), 'le classement ne montre pas la distance');
});

// --- 2) filigrane : marquer lu → DISPARAÎT (demande explicite du coach) -----
t('marquée lue, l\'entrée disparaît du flux par défaut', () => {
  ctx.setNotifSeenAt(DONE_AT + 60000);
  assert(trItems().length === 0, 'entrée lue encore affichée');
});
t('...mais reste consultable via showRead (historique non détruit)', () => {
  const it = trItems({ showRead: true });
  assert(it.length === 1, 'historique perdu');
  assert(it[0].unread === false, 'devrait être marquée lue');
  ctx.setNotifSeenAt(DONE_AT - 60000);
});
t('les items ACTIONNABLES survivent au « tout marquer lu »', () => {
  // Un gage à modérer reste tant qu'il n'est PAS modéré : le filigrane ne doit
  // pas escamoter une tâche en attente.
  S.gages = [{ id: 'g1', text: 'Chanter', status: 'pending', seasonId: '2026-2027' }];
  ctx.setNotifSeenAt(Date.now() + 60000);
  const todos = ctx.notifFeed().filter(i => i.id === 'gage-mod');
  assert(todos.length === 1, 'la tâche « gages à modérer » a disparu une fois lue');
  S.gages = [];
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
  const it = trItems({ showRead: true });
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
  assert(trItems({ showRead: true }).length === 30, 'borne non respectée : ' + trItems({ showRead: true }).length);
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

// --- 6) ISOLATION DES SOURCES ----------------------------------------------
// Le mode de panne d'origine : tout le feed dans UN seul try → la 1re source qui
// throw fait disparaître en silence toutes les suivantes. Le coach ne voyait
// plus que les gages (source #3) parce que tout ce qui suivait mourait avec.
t('une source qui throw ne tue PAS les autres sources', () => {
  seed();
  S.trainingCompletions[0].deletedAt = null;
  const boom = () => { throw new Error('source cassée'); };
  const saved = ctx.currentSeasonMatches;
  ctx.currentSeasonMatches = boom;              // casse « stats-match » (avant prépa)
  const it = trItems();
  ctx.currentSeasonMatches = saved;
  assert(it.length === 1, 'la source prépa est morte avec la source cassée');
});
t('une source qui throw ne vide pas non plus les gages', () => {
  seed();
  S.gageDraws = [{ id: 'd1', playerId: 'pA', gageId: 'g1', status: 'accepted', completedAt: DONE_AT }];
  S.gages = [{ id: 'g1', text: 'Chanter', status: 'approved', seasonId: '2026-2027' }];
  const saved = ctx._coachTrainingPrograms;
  ctx._coachTrainingPrograms = () => { throw new Error('boom'); };
  const draws = ctx.notifFeed().filter(i => String(i.id).startsWith('draw-'));
  ctx._coachTrainingPrograms = saved;
  assert(draws.length === 1, 'les gages ont disparu à cause d\'une autre source');
});

// --- 7) DÉSISTEMENTS (coach only) ------------------------------------------
// Postérieur au filigrane posé par seed() (DONE_AT − 60 s) : sans ça les RSVP
// seraient « déjà lus » et donc masqués par défaut — le test testerait le vide.
const RSVP_AT = DONE_AT + 3600000;
function seedRsvp() {
  seed();
  S.trainingCompletions = [];
  S.currentSeasonId = '2026-2027';
  S.convocations = [
    { id: 'cv1', type: 'training', title: 'Entraînement', date: '2026-07-30', time: '19:30',
      seasonId: '2026-2027', teamTag: 'both', recurrence: null, instanceOverrides: {},
      responses: { pA: { status: 'absent', reason: 'Blessure', at: RSVP_AT } } },
    { id: 'cv2', type: 'match', title: 'vs Untel', date: '2026-08-01',
      seasonId: '2026-2027', teamTag: 'both', recurrence: null, instanceOverrides: {},
      responses: { pB: { status: 'present', reason: '', at: RSVP_AT + 1000 } } },
  ];
}
const rsvpItems = (o) => ctx.notifFeed(o).filter(i => String(i.id).startsWith('rsvp-'));

t('un désistement entraînement apparaît chez le coach', () => {
  seedRsvp();
  const it = rsvpItems().filter(i => i.id.includes('pA'));
  assert(it.length === 1, 'désistement absent (' + it.length + ')');
  assert(it[0].title === 'Désistement entraînement', 'titre = ' + it[0].title);
  assert(it[0].detail.includes('#7 Joueuse A'), 'joueuse absente : ' + it[0].detail);
  assert(it[0].detail.includes('Blessure'), 'motif absent : ' + it[0].detail);
});
t('un désistement match est titré comme tel', () => {
  seedRsvp();
  S.convocations[1].responses = { pB: { status: 'absent', reason: 'Vacances', at: RSVP_AT } };
  const it = rsvpItems().filter(i => i.id.includes('pB'));
  assert(it.length === 1, 'désistement match absent');
  assert(it[0].title === 'Désistement match', 'titre = ' + it[0].title);
});
t('un retour de présence est notifié séparément', () => {
  seedRsvp();
  const it = rsvpItems().filter(i => i.id.includes('pB'));
  assert(it.length === 1 && it[0].title === 'Retour de présence', 'retour absent : ' + JSON.stringify(it));
});
t('un désistement sur une OCCURRENCE récurrente remonte aussi', () => {
  seedRsvp();
  S.convocations[0].responses = {};
  S.convocations[0].recurrence = { freq: 'weekly', days: [4] };
  S.convocations[0].instanceOverrides = { '2026-07-30': { responses: { pA: { status: 'absent', reason: 'Boulot', at: RSVP_AT } } } };
  const it = rsvpItems().filter(i => i.id.includes('pA'));
  assert(it.length === 1, 'désistement sur occurrence récurrente ignoré');
  assert(it[0].detail.includes('Boulot'), 'motif absent');
});
t('pas de doublon quand instanceOverrides recopie c.responses', () => {
  seedRsvp();
  S.convocations[0].recurrence = { freq: 'weekly', days: [4] };
  // saveInstanceAbsence initialise l'override PAR COPIE de c.responses
  S.convocations[0].instanceOverrides = { '2026-07-30': { responses: { pA: { status: 'absent', reason: 'Blessure', at: RSVP_AT } } } };
  const it = rsvpItems().filter(i => i.id.includes('pA') && i.id.includes('2026-07-30'));
  assert(it.length === 1, 'doublon : ' + it.length + ' entrées pour le même RSVP');
});
t('un RSVP SANS horodatage est ignoré (legacy, pas de place dans un flux trié)', () => {
  seedRsvp();
  S.convocations[0].responses = { pA: { status: 'absent', reason: 'Blessure' } };
  assert(rsvpItems({ showRead: true }).filter(i => i.id.includes('pA')).length === 0, 'legacy sans date listé');
});
t('AUDIENCE : la joueuse ne voit AUCUN désistement (ni le sien, ni celui des autres)', () => {
  seedRsvp();
  S.auth = { role: 'player', playerId: 'pA' };
  const leak = ctx.notifFeed({ showRead: true }).filter(i => String(i.id).startsWith('rsvp-'));
  assert(leak.length === 0, 'fuite de ' + leak.length + ' désistement(s) côté joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('toute entrée porte une audience valide', () => {
  seedRsvp();
  const bad = allItems().filter(i => !['coach', 'player', 'all'].includes(i.audience));
  assert(bad.length === 0, 'audience manquante sur : ' + JSON.stringify(bad.map(i => i.id)));
});
t('le feed coach ne contient QUE du coach/all', () => {
  seedRsvp();
  assert(allItems().every(i => i.audience !== 'player'), 'entrée joueuse dans le feed coach');
});

// --- 8) joueuse : ses propres validations de prépa --------------------------
t('la joueuse voit SA validation, pas celle des autres', () => {
  seed();
  S.trainingCompletions.push({
    id: 'compB', programId: 'prog1', sessionId: 'sMer', playerId: 'pB',
    datePlanned: '2026-07-29', dateCompleted: DONE_AT, contractLevel: 'med',
    basePoints: 20, pointsTotal: 20, runningDistanceKm: 5, postMessage: '', notes: '',
    createdAt: DONE_AT, updatedAt: DONE_AT, deletedAt: null,
  });
  S.auth = { role: 'player', playerId: 'pA' };
  const mine = ctx.notifFeed({ showRead: true }).filter(i => String(i.id).startsWith('trmine-'));
  assert(mine.length === 1, 'attendu 1 validation perso, reçu ' + mine.length);
  assert(mine[0].id === 'trmine-comp1', 'mauvaise validation : ' + mine[0].id);
  assert(mine[0].detail.includes('2.92'), 'distance absente : ' + mine[0].detail);
  S.auth = { role: 'coach', coachId: 'admin' };
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
