// Test SAISIE COACH RÉTROACTIVE — « elle a fait la séance, elle a oublié de la
// valider » : le coach l'enregistre à sa place (v.122).
//
// POURQUOI SUR LE VRAI index.html : même raison que test-coach-training-detail —
// c'est du rendu et de la mutation d'état. Une copie des helpers ne verrait ni un
// template literal cassé, ni une garde de portée oubliée, ni le fait que la
// nouvelle colonne manque à la sérialisation (le bug le plus coûteux du projet :
// une colonne absente de _dumpTrainingCompletionRow fait taire TOUTE la table).
//
// MAINTENANCE — si ce test casse après un changement sans rapport avec la prépa,
// c'est probablement le boot d'index.html qui touche une API pas encore stubée
// (cf. `ctx`) : ajouter le stub, ne pas supprimer le test.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\nglobalThis.TRAINING_LEVELS = TRAINING_LEVELS;';

const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {}, click() {},
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
  prompt: () => '',
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 360, innerHeight: 740,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
};
ctx.__alerts = [];
ctx.alert = m => { ctx.__alerts.push(String(m)); };
ctx.confirm = () => true;
ctx.Blob = class { constructor(p) { ctx.__blob = (p || []).join(''); } };
ctx.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('✓ script évalué');

// PbSync : identique au test frère — truthy pour réveiller les gardes, no-op partout.
ctx.__flushes = 0;
ctx.PbSync = new Proxy({ flushNow: async () => { ctx.__flushes++; } }, {
  get: (target, key) => {
    if (key in target) return target[key];
    if (typeof key === 'symbol' || key === 'then') return undefined;
    return () => {};
  }
});

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

// --- LA SÉRIALISATION VIT DANS LE BLOC <script type="module"> ----------------
// Ce bloc est EXCLU du harnais ci-dessus (il n'est pas exécutable hors module) :
// c'est le piège documenté du projet — un `grep` y ment et un test naïf y est
// aveugle. Les deux fonctions de sérialisation sont PURES : on les extrait du
// source et on les évalue à part, pour tester le vrai round-trip plutôt que de
// se contenter de vérifier qu'un mot-clé apparaît quelque part.
const moduleSrc = [...html.matchAll(/<script([^>]*type\s*=\s*["']module["'][^>]*)>([\s\S]*?)<\/script>/g)]
  .map(m => m[2]).join('\n');
function extractFn(name) {
  const i = moduleSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' introuvable dans le bloc module');
  // Équilibrage d'accolades depuis la première `{` : ces deux fonctions ne
  // contiennent ni chaîne ni commentaire portant une accolade orpheline.
  const start = moduleSrc.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < moduleSrc.length; j++) {
    if (moduleSrc[j] === '{') depth++;
    else if (moduleSrc[j] === '}' && --depth === 0) return moduleSrc.slice(i, j + 1);
  }
  throw new Error(name + ' : accolades non équilibrées');
}
const serCtx = { Number, Date, Object, Array, String, JSON, Math, console };
vm.createContext(serCtx);
vm.runInContext(
  extractFn('_dumpTrainingCompletionRow') + '\n' + extractFn('_trainingCompletionFromRow')
  + '\nthis.dump = _dumpTrainingCompletionRow; this.fromRow = _trainingCompletionFromRow;',
  serCtx, { filename: 'index.module.js' });

const S = ctx.state;
const DAY = 86400000;
const iso = d => ctx.isoDate(new Date(d));
const NOW = Date.now();
const back = n => iso(NOW - n * DAY);

ctx.render = () => {};
ctx.__toasts = [];
ctx.showToast = m => { ctx.__toasts.push(String(m)); };
ctx.__pushes = [];
ctx.notifyPush = (keys, payload) => { ctx.__pushes.push({ keys, payload }); };
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = '(closed)'; };
const M = () => String(ctx.__lastModal || '');

let seq = 0;
function comp(o) {
  seq++;
  const dp = o.datePlanned;
  return Object.assign({
    id: 'c' + seq, programId: 'prog1', sessionId: 's' + ctx._trainingDayOfWeek(dp), playerId: 'pA',
    datePlanned: dp, dateCompleted: Date.parse(dp + 'T18:00:00Z'), contractLevel: 'med',
    basePoints: 20, squadTeammateId: null, squadPhotoUrl: null, postPhotoUrl: null, postMessage: '',
    runningDistanceKm: null, pointsTotal: 20, notes: '',
    updatedBy: null, editedAt: null, coachNote: '', coachNoteAt: null,
    createdBy: null, createdByCoach: false,
    createdAt: Date.parse(dp + 'T18:00:00Z'), updatedAt: Date.parse(dp + 'T18:00:00Z'), deletedAt: null,
  }, o);
}

function seed() {
  seq = 0;
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [
    { id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] },
    { id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e2'] },
  ];
  S.seasons = [{ id: 'S1', name: 'Saison test', startDate: back(300), endDate: iso(NOW + 300 * DAY), status: 'active' }];
  S.activeSeasonId = 'S1';
  S.currentSeasonId = 'S1';
  S.players = [
    { id: 'pA', name: 'Alice', num: 7, photo: '' },
    { id: 'pB', name: 'Bea', num: 8, photo: '' },
    { id: 'pC', name: 'Chloe', num: 9, photo: '' },   // E2 seulement
  ];
  S.seasonPlayers = [
    { seasonId: 'S1', playerId: 'pA', teamTag: 'e1', joinedAt: back(300), leftAt: null },
    { seasonId: 'S1', playerId: 'pB', teamTag: 'e1', joinedAt: back(300), leftAt: null },
    { seasonId: 'S1', playerId: 'pC', teamTag: 'e2', joinedAt: back(300), leftAt: null },
  ];
  S.trainingPrograms = [{
    id: 'prog1', name: 'Prépa estivale', startDate: back(40), endDate: iso(NOW + 20 * DAY),
    daysActive: [1, 2, 3, 4, 5, 6, 7],
    scoringConfig: { points: { min: 10, med: 20, ultra: 30 }, post_bonus: 10, squad_multiplier: 2,
      distance_bonus: 20, improvement_bonus: 40, remind_hour: 9 },
    isActive: true, teamTag: 'both', deletedAt: null, updatedAt: NOW,
  }];
  S.trainingSessions = [1, 2, 3, 4, 5, 6, 7].map(d => ({
    id: 's' + d, programId: 'prog1', dayOfWeek: d, name: 'Séance J' + d,
    blocks: [], isTemplate: false, position: d, deletedAt: null, updatedAt: NOW,
  }));
  S.trainingCompletions = [];
  S.gageDraws = []; S.matches = []; S.broadcasts = []; S.challenges = [];
  S._trainingDash = null; S._trainingAdd = null; S._trainingEdit = null; S._trainingView = null;
  ctx.__toasts = []; ctx.__pushes = []; ctx.__alerts = []; ctx.__flushes = 0;
  store['pb8_coach_note_drafts'] = '{}';
}
seed();

// Jour ISO d'une date passée de n jours → sa séance. Le décor a une séance par
// jour de la semaine, donc toute date passée est saisissable.
const sessOf = dateISO => 's' + ctx._trainingDayOfWeek(dateISO);

// ============================================================================
// 1) SÉRIALISATION — la faute la plus coûteuse du projet
// ============================================================================
// Une colonne oubliée dans _dumpTrainingCompletionRow ne casse RIEN visiblement :
// l'upsert part sans le champ et la valeur ne persiste jamais. Pire, une colonne
// ABSENTE EN BASE fait échouer _flushEntity sur toute la table (un console.warn,
// puis plus rien ne se synchronise). D'où le test du round-trip complet.
t('SÉRIALISATION : les deux colonnes de traçabilité font l\'aller-retour', () => {
  const src = comp({ id: 'z1', datePlanned: back(5), createdBy: 'admin', createdByCoach: true });
  const row = serCtx.dump(src);
  assert(row.created_by === 'admin', 'created_by absent de la ligne : ' + JSON.stringify(row.created_by));
  assert(row.created_on_behalf_by_coach === true, 'created_on_behalf_by_coach absent');
  const back2 = serCtx.fromRow(Object.assign({ created_at: null, updated_at: null }, row));
  assert(back2.createdBy === 'admin', 'createdBy perdu au retour');
  assert(back2.createdByCoach === true, 'createdByCoach perdu au retour');
});

t('SÉRIALISATION : une validation joueuse reste explicitement « pas coach »', () => {
  const row = serCtx.dump(comp({ id: 'z2', datePlanned: back(5) }));
  assert(row.created_by === null, 'created_by devrait être null');
  assert(row.created_on_behalf_by_coach === false, 'le booléen doit être false, pas undefined/null');
});

t('SÉRIALISATION : une ligne serveur ANCIENNE (colonnes absentes) ne devient pas « coach »', () => {
  // Le cas réel du jour du déploiement : une ligne lue avant que la migration ne
  // soit visible du cache PostgREST. `undefined` ne doit jamais valoir true.
  const old = serCtx.fromRow({ id: 'z3', player_id: 'pA', date_planned: back(9) });
  assert(old.createdByCoach === false, 'createdByCoach = ' + old.createdByCoach);
  assert(old.createdBy === null, 'createdBy = ' + old.createdBy);
});

// ============================================================================
// 2) PORTÉE — un coach d'équipe ne saisit que pour SES joueuses
// ============================================================================
t('PORTÉE : l\'admin peut saisir pour n\'importe quelle joueuse', () => {
  seed();
  assert(ctx._trainingCanAddCompletion('pA') === true, 'pA refusée');
  assert(ctx._trainingCanAddCompletion('pC') === true, 'pC (E2) refusée à l\'admin');
});

t('PORTÉE : un coach E2 ne peut pas saisir pour une joueuse E1', () => {
  seed();
  S.auth = { role: 'coach', coachId: 'c2' };
  assert(ctx._trainingCanAddCompletion('pC') === true, 'sa propre joueuse refusée');
  assert(ctx._trainingCanAddCompletion('pA') === false, 'joueuse E1 acceptée par un coach E2 !');
});

t('ÉTANCHÉITÉ : une JOUEUSE ne peut pas s\'auto-créditer une séance', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  assert(ctx._trainingCanAddCompletion('pA') === false, 'la joueuse a passé la garde');
  ctx.openAddCompletionModal('prog1', 'pA');
  assert(!S._trainingAdd, 'la modale s\'est ouverte pour une joueuse');
});

t('ÉTANCHÉITÉ : la garde tient aussi à l\'ENREGISTREMENT, pas seulement à l\'ouverture', () => {
  // Défense en profondeur : le rôle peut changer entre l'ouverture et le clic
  // (déconnexion/reconnexion), et l'état de modale survit dans `state`.
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  assert(S._trainingAdd, 'modale non ouverte');
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.saveNewCompletion();
  assert((S.trainingCompletions || []).length === 0, 'une ligne a été écrite malgré la garde');
});

// ============================================================================
// 3) LES JOURS PROPOSÉS
// ============================================================================
t('JOURS : seules les occurrences PASSÉES sont proposées (jamais le futur)', () => {
  seed();
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(back(7)));
  const dates = ctx._tcaOpenDates(p, s, 'pA');
  assert(dates.length > 0, 'aucune date');
  const today = iso(NOW);
  assert(dates.every(d => d <= today), 'une date future est proposée : ' + dates.filter(d => d > today).join(','));
});

t('JOURS : plus récent en tête (un oubli se rattrape sur les jours proches)', () => {
  seed();
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(back(7)));
  const dates = ctx._tcaOpenDates(p, s, 'pA');
  const sorted = dates.slice().sort((a, b) => b.localeCompare(a));
  assert(JSON.stringify(dates) === JSON.stringify(sorted), 'ordre non décroissant');
});

t('JOURS : un jour DÉJÀ validé par la joueuse disparaît de la liste', () => {
  seed();
  const day = back(7);
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(day));
  assert(ctx._tcaOpenDates(p, s, 'pA').includes(day), 'jour absent au départ');
  S.trainingCompletions.push(comp({ id: 'cX', playerId: 'pA', datePlanned: day }));
  assert(!ctx._tcaOpenDates(p, s, 'pA').includes(day), 'jour toujours proposé alors qu\'il est validé');
});

t('JOURS : une validation SUPPRIMÉE rouvre le jour (soft-delete ≠ ligne vivante)', () => {
  seed();
  const day = back(7);
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(day));
  S.trainingCompletions.push(comp({ id: 'cY', playerId: 'pA', datePlanned: day, deletedAt: NOW }));
  assert(ctx._tcaOpenDates(p, s, 'pA').includes(day), 'jour resté fermé malgré le soft-delete');
});

t('JOURS : la liste est PAR JOUEUSE (le jour validé par Bea reste ouvert pour Alice)', () => {
  seed();
  const day = back(7);
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(day));
  S.trainingCompletions.push(comp({ id: 'cZ', playerId: 'pB', datePlanned: day }));
  assert(ctx._tcaOpenDates(p, s, 'pA').includes(day), 'le jour d\'Alice a été fermé par la validation de Bea');
});

t('JOURS : la fenêtre de 48 h NE s\'applique PAS au coach (c\'est tout l\'intérêt)', () => {
  seed();
  const old = back(30);   // très au-delà du rattrapage joueuse
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === sessOf(old));
  assert(ctx._trainingCanValidate(p, old, NOW) === false, 'le décor n\'est pas hors fenêtre');
  assert(ctx._tcaOpenDates(p, s, 'pA').includes(old), 'un jour hors fenêtre devrait rester saisissable par le coach');
});

// ============================================================================
// 4) LE CALCUL DES POINTS
// ============================================================================
t('POINTS : base du niveau, comme une validation joueuse', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('level', 'ultra');
  assert(ctx._tcaComputed().total === 30, 'total = ' + ctx._tcaComputed().total);
});

t('POINTS : squad multiplie, post ajoute, distance ajoute', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('level', 'med');            // 20
  ctx._tcaSet('squadTeammateId', 'pB');   // ×2 → 40
  ctx._tcaSet('postOn', true);
  ctx._tcaSet('postMessage', 'sa story'); // +10 → 50
  ctx._tcaSet('distanceKm', '5');         // +20 → 70
  assert(ctx._tcaComputed().total === 70, 'total = ' + ctx._tcaComputed().total);
});

t('POINTS : un post COCHÉ mais VIDE ne donne pas le bonus (et bloque l\'enregistrement)', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('postOn', true);
  assert(ctx._tcaComputed().total === 20, 'bonus accordé sans message : ' + ctx._tcaComputed().total);
  ctx.__alerts = [];
  ctx.saveNewCompletion();
  assert((S.trainingCompletions || []).length === 0, 'ligne écrite malgré le post vide');
  assert(ctx.__alerts.some(a => /post/i.test(a)), 'aucune explication donnée au coach');
});

t('POINTS : bonus progression sur le repère de la MÊME séance récurrente', () => {
  seed();
  const day = back(7);
  const sid = sessOf(day);
  // Un repère à 4 km sur la même séance, 7 jours plus tôt.
  S.trainingCompletions.push(comp({ id: 'cRef', playerId: 'pA', datePlanned: back(14), sessionId: sid, runningDistanceKm: 4 }));
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sid);
  ctx._tcaSet('datePlanned', day);
  ctx._tcaSet('distanceKm', '3');
  assert(ctx._tcaComputed().improvement === 0, 'progression accordée en dessous du repère');
  ctx._tcaSet('distanceKm', '5');
  assert(ctx._tcaComputed().improvement === 40, 'progression non accordée au-dessus du repère');
});

t('POINTS : le coach peut FORCER un total, et revenir au calcul auto', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaPoints(77);
  assert(ctx._tca().pointsTouched === true && ctx._tca().points === 77, 'valeur non retenue');
  ctx._tcaSet('level', 'ultra');
  assert(ctx._tca().points === 77, 'la valeur forcée a sauté sur un changement de niveau');
  ctx._tcaAuto();
  assert(ctx._tca().pointsTouched === false, 'retour auto raté');
});

// ============================================================================
// 5) L'ÉCRITURE
// ============================================================================
t('ÉCRITURE : la ligne créée porte la traçabilité et FIGE son total', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day));
  ctx._tcaSet('datePlanned', day);
  ctx._tcaSet('level', 'ultra');
  ctx._tcaSet('distanceKm', '6.2');
  ctx._tcaSet('notes', 'capture Strava');
  const expected = ctx._tcaComputed().total;
  ctx.saveNewCompletion();
  const c = (S.trainingCompletions || []).find(x => x.playerId === 'pA' && x.datePlanned === day);
  assert(c, 'aucune ligne créée');
  assert(c.createdByCoach === true, 'createdByCoach absent');
  assert(c.createdBy === 'admin', 'createdBy = ' + c.createdBy);
  assert(c.pointsTotal === expected && expected === 50, 'total = ' + c.pointsTotal + ' (attendu 50)');
  assert(c.basePoints === 30, 'basePoints = ' + c.basePoints);
  assert(c.runningDistanceKm === 6.2, 'distance perdue');
  assert(c.notes === 'capture Strava', 'notes perdues');
  assert(c.deletedAt === null, 'ligne créée déjà supprimée');
});

t('ÉCRITURE : `editedAt` reste NULL — une création n\'est pas une correction', () => {
  // Sinon la joueuse lit « le coach a corrigé cette validation » sur une séance
  // qu'elle n'a jamais validée, et notifFeed lui pousse un événement `tredit-`.
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  assert(c.editedAt === null, 'editedAt posé sur une création');
});

t('ÉCRITURE : le coach n\'attache JAMAIS de photo à la place de la joueuse', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx._tcaSet('squadTeammateId', 'pB');
  ctx._tcaSet('postOn', true); ctx._tcaSet('postMessage', 'sa story');
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  assert(c.squadPhotoUrl === null && c.postPhotoUrl === null, 'une URL de photo a été inventée');
  assert(c.squadTeammateId === 'pB' && c.postMessage === 'sa story', 'squad/post perdus');
});

t('ÉCRITURE : la séance saisie entre dans le total de points de la joueuse', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  const pts = ctx._trainingCompletionsOf('prog1', 'pA').reduce((a, c) => a + (Number(c.pointsTotal) || 0), 0);
  assert(pts === 20, 'points comptés = ' + pts);
});

t('ÉCRITURE : la ligne est poussée (persist + flush), pas gardée en local', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.__flushes = 0;
  ctx.saveNewCompletion();
  assert(ctx.__flushes >= 1, 'aucun flush déclenché');
});

t('ANTI-DOUBLON : impossible de doubler une validation existante', () => {
  seed();
  const day = back(10);
  S.trainingCompletions.push(comp({ id: 'cDup', playerId: 'pA', datePlanned: day, sessionId: sessOf(day) }));
  ctx.openAddCompletionModal('prog1', 'pA');
  // On force l'état à viser le jour occupé : c'est exactement ce qui arrive si la
  // joueuse valide depuis son téléphone pendant que la modale est ouverte.
  ctx._tca().sessionId = sessOf(day);
  ctx._tca().datePlanned = day;
  ctx.__toasts = [];
  ctx.saveNewCompletion();
  const n = S.trainingCompletions.filter(x => x.playerId === 'pA' && x.datePlanned === day && !x.deletedAt).length;
  assert(n === 1, n + ' lignes pour le même jour');
  assert(ctx.__toasts.some(x => /déjà/i.test(x)), 'aucun retour au coach');
});

// ============================================================================
// 6) LA JOUEUSE EST PRÉVENUE — et sa notif mène quelque part
// ============================================================================
t('NOTIF : un push part vers LA joueuse concernée, et elle seule', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.__pushes = [];
  ctx.saveNewCompletion();
  assert(ctx.__pushes.length === 1, ctx.__pushes.length + ' pushes');
  const p = ctx.__pushes[0];
  assert(JSON.stringify(p.keys) === JSON.stringify(['player:pA']), 'destinataires = ' + JSON.stringify(p.keys));
  assert(p.payload.type === 'training_added_by_coach', 'type = ' + p.payload.type);
});

t('NOTIF : le push a bien son entrée de feed (règle du projet : pas de cul-de-sac)', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  S.auth = { role: 'player', playerId: 'pA' };
  const feed = ctx.notifFeed();
  const e = feed.find(x => x.title === 'Séance ajoutée par ton coach');
  assert(e, 'aucune entrée de feed : ' + feed.map(x => x.title).join(' | '));
  assert(/openTrainingSession/.test(e.action || ''), 'l\'entrée ne mène nulle part : ' + e.action);
});

t('NOTIF : une validation FAITE PAR LA JOUEUSE garde son libellé d\'origine', () => {
  seed();
  S.trainingCompletions.push(comp({ id: 'cOwn', playerId: 'pA', datePlanned: back(3) }));
  S.auth = { role: 'player', playerId: 'pA' };
  const feed = ctx.notifFeed();
  assert(feed.some(x => x.title === 'Séance validée'), 'libellé joueuse perdu');
  assert(!feed.some(x => x.title === 'Séance ajoutée par ton coach'), 'libellé coach appliqué à tort');
});

t('ÉTANCHÉITÉ FEED : Bea ne voit pas la séance ajoutée à Alice', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  S.auth = { role: 'player', playerId: 'pB' };
  const feed = ctx.notifFeed();
  assert(!feed.some(x => x.title === 'Séance ajoutée par ton coach'), 'fuite vers une autre joueuse');
});

// ============================================================================
// 7) CE QUE VOIT LA JOUEUSE SUR SA SÉANCE
// ============================================================================
t('JOUEUSE : sa séance porte le badge « ajoutée par ton coach », pas « validée »', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingSession('prog1', sessOf(day), day);
  assert(/Séance enregistrée par ton coach/.test(M()), 'badge absent');
  assert(!/Le coach a corrigé cette validation/.test(M()), 'message de CORRECTION affiché sur une création');
  assert(/ton coach l'a ajoutée pour toi/i.test(M()), 'explication absente');
});

t('JOUEUSE : une séance qu\'elle a validée elle-même n\'affiche AUCUN badge coach', () => {
  seed();
  const day = back(1);
  S.trainingCompletions.push(comp({ id: 'cSelf', playerId: 'pA', datePlanned: day, sessionId: sessOf(day) }));
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingSession('prog1', sessOf(day), day);
  assert(/Séance validée/.test(M()), 'libellé normal absent');
  assert(!/ton coach/i.test(M()), 'badge coach affiché à tort');
});

// ============================================================================
// 8) CE QUE VOIT LE COACH
// ============================================================================
t('COACH : le drill-down joueuse propose le bouton d\'ajout', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('playerId', 'pA');
  assert(/openAddCompletionModal\('prog1','pA'\)/.test(M()), 'bouton absent du drill-down');
});

t('COACH : la timeline marque la ligne saisie par le coach', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(/ajoutée par le coach/.test(M()), 'marqueur absent de la timeline');
});

t('COACH : le détail nomme l\'auteur de la saisie', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  ctx.openTrainingCompletionDetail(c.id);
  assert(/Séance ajoutée par le coach/.test(M()), 'bandeau absent');
  assert(/Admin/.test(M()), 'nom du coach absent');
  assert(/Enregistrée le/.test(M()), 'libellé de date non adapté');
});

t('COACH : « rien à rattraper » quand elle a tout validé', () => {
  seed();
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === 's3');
  ctx._tcaOpenDates(p, s, 'pA').forEach((d, i) =>
    S.trainingCompletions.push(comp({ id: 'cF' + i, playerId: 'pA', datePlanned: d, sessionId: 's3' })));
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', 's3');
  assert(/Rien à rattraper/.test(M()), 'état vide absent');
});

// ============================================================================
// 9) NON-RÉGRESSION — le reste du dashboard n'a pas bougé
// ============================================================================
t('RÉTROACTIF : une validation historique garde son total au centime', () => {
  seed();
  const c = comp({ id: 'cOld', playerId: 'pA', datePlanned: back(20), pointsTotal: 40, basePoints: 20, runningDistanceKm: 5 });
  S.trainingCompletions.push(c);
  const bd = ctx._trainingBreakdown(c, S.trainingPrograms[0]);
  assert(bd.total === 40, 'total réécrit : ' + bd.total);
  assert(bd.base + bd.distance + bd.improvement + bd.adjust + (bd.post || 0) === 40 || bd.total === 40, 'invariant cassé');
});

t('RÉTROACTIF : la décomposition d\'une ligne SAISIE retombe juste (aucun « ajustement »)', () => {
  // Le piège : si _tcaComputed et _trainingBreakdown ne comptent pas le post de
  // la même façon, l'écart part en `adjust` et le coach lit « ✎ Ajustement coach »
  // sur une ligne qu'il n'a jamais ajustée.
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx._tcaSet('squadTeammateId', 'pB');
  ctx._tcaSet('postOn', true); ctx._tcaSet('postMessage', 'sa story');
  ctx._tcaSet('distanceKm', '5');
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  const bd = ctx._trainingBreakdown(c, S.trainingPrograms[0]);
  assert(bd.adjust === 0, 'ajustement fantôme de ' + bd.adjust);
  assert(bd.distance === 20, 'bonus distance non reconnu : ' + bd.distance);
  assert(bd.postOn === true, 'post non reconnu');
});

t('NON-RÉGRESSION : la correction coach fonctionne toujours sur une ligne saisie', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  ctx.openEditCompletionModal(c.id);
  ctx._tceSet('level', 'ultra');
  ctx.saveCompletionEdit(c.id);
  assert(c.contractLevel === 'ultra', 'correction non appliquée');
  assert(c.editedAt !== null, 'correction non tracée');
  assert(c.createdByCoach === true, 'la trace de saisie a été effacée par la correction');
});

t('NON-RÉGRESSION : la suppression d\'une ligne saisie reste un SOFT-delete', () => {
  seed();
  const day = back(10);
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', sessOf(day)); ctx._tcaSet('datePlanned', day);
  ctx.saveNewCompletion();
  const c = S.trainingCompletions.find(x => x.datePlanned === day);
  ctx.deleteTrainingCompletion(c.id);
  assert(c.deletedAt !== null, 'pas de soft-delete');
  assert(S.trainingCompletions.includes(c), 'la ligne a été retirée du tableau (hard delete)');
});

// ============================================================================
// 10) MOBILE-FIRST / ACCESSIBILITÉ du nouveau rendu
// ============================================================================
t('MOBILE : la modale d\'ajout n\'introduit aucune largeur fixe en px', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  const bad = M().match(/(?:^|[;"\s])width:\s*\d+px/g) || [];
  // Seules les cases à cocher ont une taille fixe assumée (20px) : c'est une
  // CIBLE tactile, pas une colonne de mise en page.
  const real = bad.filter(x => !/2[04]px/.test(x));
  assert(real.length === 0, 'largeurs fixes : ' + real.join(', '));
});

t('MOBILE : les <select> de la modale sont pleine largeur', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  const selects = M().match(/<select[^>]*>/g) || [];
  assert(selects.length >= 2, 'sélecteurs absents');
  assert(selects.every(s => /width:100%/.test(s)), 'un select n\'est pas pleine largeur');
});

t('LISIBILITÉ : aucun texte sous 10px dans la modale d\'ajout', () => {
  seed();
  ctx.openAddCompletionModal('prog1', 'pA');
  const small = (M().match(/font-size:\s*(\d+)px/g) || []).filter(x => Number(x.match(/(\d+)/)[1]) < 10);
  assert(small.length === 0, 'trop petit : ' + small.join(', '));
});

t('LE BOUTON D\'ENREGISTREMENT EST DÉSACTIVÉ tant qu\'il n\'y a pas de jour', () => {
  seed();
  const p = S.trainingPrograms[0];
  const s = S.trainingSessions.find(x => x.id === 's3');
  ctx._tcaOpenDates(p, s, 'pA').forEach((d, i) =>
    S.trainingCompletions.push(comp({ id: 'cG' + i, playerId: 'pA', datePlanned: d, sessionId: 's3' })));
  ctx.openAddCompletionModal('prog1', 'pA');
  ctx._tcaSet('sessionId', 's3');
  assert(/saveNewCompletion\(\)"?\s*disabled/.test(M()), 'bouton actif sans jour saisissable');
});

console.log('\n' + R.join('\n'));
const ko = R.filter(x => x.startsWith('✗'));
console.log('\n' + (ko.length ? `✗ ${ko.length}/${R.length} ÉCHECS` : `✓ ${R.length}/${R.length} checks OK`));
process.exit(ko.length ? 1 : 0);
