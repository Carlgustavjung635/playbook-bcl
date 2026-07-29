// Test INVALIDATION DE GAGE — les 3 issues (retirage / garder / annuler).
//
// ORIGINE : une joueuse clique « j'ai fait le gage » par erreur. Le coach veut
// annuler cette validation. Avant, « ❌ Invalider » était un CUL-DE-SAC : le
// tirage passait à 'invalidated', la joueuse ne devait plus rien, ne repiochait
// rien, et n'était même pas prévenue. Le coach devait deviner quoi faire ensuite.
//
// Évalue les <script> classiques du VRAI index.html dans un vm à DOM stubé (même
// harnais que test-training-wizard.mjs) : une copie fidèle ne prouverait pas que
// la modale rend ni que le câblage tient.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n') + '\n;globalThis.state = state; globalThis.K = K;';

const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {},
});
// `checked` pilote le choix radio ; `fields` pilote les inputs par id.
const ui = { checked: null, fields: {} };
const doc = {
  getElementById: (id) => (id in ui.fields ? { value: ui.fields[id] } : mkEl()),
  createElement: mkEl,
  querySelector: (sel) => (sel.includes('ginv-choice') && ui.checked ? { value: ui.checked } : null),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible',
};
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  document: doc,
  navigator: { userAgent: 'probe', onLine: true, serviceWorker: { getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}), ready: Promise.resolve({ showNotification() {} }), addEventListener() {} } },
  location: { hash: '', href: 'http://localhost/', replace() {}, reload() {} },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
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
try { vm.runInContext(code, ctx, { filename: 'index.inline.js' }); }
catch (e) { console.log('✗ ÉVALUATION: ' + e.message); process.exit(1); }

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

const S = ctx.state;
let pushed = [];
ctx.render = () => {}; ctx.showToast = () => {};
ctx.notifyPush = (keys, payload) => { pushed.push({ keys, payload }); };
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => {};

function seed(drawStatus) {
  pushed = []; ui.checked = null; ui.fields = {};
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }];
  S.activeSeasonId = '2026-2027'; S.currentSeasonId = '2026-2027';
  S.players = [{ id: 'pA', name: 'Candice', num: 13 }];
  S.seasonPlayers = [{ seasonId: '2026-2027', playerId: 'pA', teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }];
  S.gages = [{ id: 'g1', text: 'Chanter devant le groupe', status: 'approved', authorId: 'pA',
    seasonId: '2026-2027', completedAt: null, deletedAt: null, updatedAt: 1 }];
  S.gageDraws = [{ id: 'd1', playerId: 'pA', gageId: 'g1', status: drawStatus || 'player_done',
    assignedAt: 1000, drawnAt: 1100, completedAt: 1200, playerDoneAt: 1300,
    invalidatedAt: null, invalidationReason: null, seasonId: '2026-2027', createdAt: 1000, updatedAt: 1300 }];
  S.trainingCompletions = []; S.trainingPrograms = []; S.convocations = []; S.matches = [];
}
const draw = () => S.gageDraws.find(d => d.id === 'd1');
const owed = () => S.gageDraws.filter(d => d.status === 'owed' && d.playerId === 'pA');
const gage = () => S.gages.find(g => g.id === 'g1');

// --- 0) la modale ------------------------------------------------------------
t('la modale propose les 3 issues et le texte du gage', () => {
  seed();
  ctx.invalidateGage('d1');
  const m = ctx.__lastModal || '';
  assert(/Nouveau tirage/.test(m), 'option retirage absente');
  assert(/Garder le m.me gage/.test(m), 'option garder absente');
  assert(/Annuler d.finitivement/.test(m), 'option annuler absente');
  assert(m.includes('Chanter devant le groupe'), 'texte du gage absent');
  assert(m.includes('#13 Candice'), 'joueuse absente');
  assert(/confirmInvalidateGage\('d1'\)/.test(m), 'bouton de confirmation non câblé');
});
t('rien ne bouge tant que le coach n\'a pas confirmé', () => {
  assert(draw().status === 'player_done', 'statut modifié à l\'ouverture de la modale');
});

// --- 1) 🎲 nouveau tirage ----------------------------------------------------
t('redraw : le tirage est invalidé ET un nouveau tirage est créé', () => {
  seed();
  ui.checked = 'redraw';
  assert(ctx.confirmInvalidateGage('d1') === true, 'refusé');
  assert(draw().status === 'invalidated', 'statut = ' + draw().status);
  assert(owed().length === 1, 'attendu 1 tirage à faire, reçu ' + owed().length);
  assert(owed()[0].gageId === null, 'le nouveau tirage ne doit pas être pré-rempli');
});
t('redraw : SANS dette (invalider n\'est pas une sanction)', () => {
  assert(ctx.gageDebt('pA') === 0, 'dette = ' + ctx.gageDebt('pA'));
});
t('redraw : le gage reste dans le pool (retirable)', () => {
  assert(!gage().deletedAt, 'gage supprimé du pool à tort');
  assert(ctx._gageTirable(gage()) === true, 'gage plus tirable');
});
t('redraw : la joueuse est prévenue', () => {
  const p = pushed.find(x => x.payload && x.payload.type === 'gage_invalidated');
  assert(p, 'aucun push à la joueuse');
  assert(/nouveau tirage/i.test(p.payload.body), 'message = ' + p.payload.body);
});
t('redraw : IDEMPOTENT — re-cliquer n\'empile pas un 2e tirage', () => {
  const before = owed().length;
  assert(ctx.confirmInvalidateGage('d1') === false, 'second appel accepté');
  assert(owed().length === before, 'tirage dupliqué : ' + owed().length);
});

// --- 2) 🔁 garder le même gage ----------------------------------------------
t('keep : le gage repasse « à réaliser », même gage', () => {
  seed();
  ui.checked = 'keep';
  ctx.confirmInvalidateGage('d1');
  assert(draw().status === 'accepted', 'statut = ' + draw().status);
  assert(draw().gageId === 'g1', 'gage changé');
  assert(draw().playerDoneAt === null, 'playerDoneAt pas remis à zéro');
  assert(draw().invalidatedAt === null, 'invalidatedAt résiduel');
});
t('keep : aucun nouveau tirage, gage toujours dans le pool', () => {
  assert(owed().length === 0, 'tirage parasite créé');
  assert(!gage().deletedAt && !gage().completedAt, 'gage sorti du pool à tort');
});
t('keep : l\'horloge des gages à durée limitée REPART', () => {
  // Sans completedAt = maintenant, _sweepExpiredGages ré-invaliderait aussitôt
  // un gage dont la deadline était déjà passée.
  seed();
  S.gages[0].gageType = 'time_limited'; S.gages[0].timeLimitHours = 2;
  S.gageDraws[0].completedAt = Date.now() - 5 * 3600000;   // déjà expiré
  ui.checked = 'keep';
  ctx.confirmInvalidateGage('d1');
  const dl = ctx._drawDeadline(draw());
  assert(dl && dl > Date.now(), 'deadline pas relancée (dl=' + dl + ')');
  ctx._sweepExpiredGages();
  assert(draw().status === 'accepted', 'ré-invalidé aussitôt par le sweep');
});
t('keep : la joueuse est prévenue que le gage reste à faire', () => {
  const p = pushed.find(x => x.payload && x.payload.type === 'gage_invalidated');
  assert(p && /toujours . faire/i.test(p.payload.body), 'message = ' + (p && p.payload.body));
});

// --- 3) ❌ annuler définitivement -------------------------------------------
t('cancel : tirage invalidé et gage sorti du pool', () => {
  seed();
  ui.checked = 'cancel';
  ctx.confirmInvalidateGage('d1');
  assert(draw().status === 'invalidated', 'statut = ' + draw().status);
  assert(gage().deletedAt, 'gage toujours dans le pool');
  assert(ctx._gageTirable(gage()) === false, 'gage encore tirable');
});
t('cancel : aucun nouveau tirage, aucune dette', () => {
  assert(owed().length === 0, 'tirage créé à tort');
  assert(ctx.gageDebt('pA') === 0, 'dette = ' + ctx.gageDebt('pA'));
});
t('cancel : soft-delete (jamais un hard delete — il serait repoussé au flush)', () => {
  assert(S.gages.some(g => g.id === 'g1'), 'la ligne a été retirée du state');
  assert(typeof gage().deletedAt === 'number', 'deletedAt non horodaté');
});

// --- 4) garde-fous -----------------------------------------------------------
t('un tirage déjà confirmé ne peut pas être invalidé', () => {
  seed('coach_confirmed');
  assert(ctx.confirmInvalidateGage('d1') === false, 'invalidation acceptée sur coach_confirmed');
  assert(draw().status === 'coach_confirmed', 'statut modifié');
});
t('un tirage « owed » (pas encore pioché) non plus', () => {
  seed('owed');
  assert(ctx.confirmInvalidateGage('d1') === false, 'invalidation acceptée sur owed');
});
t('un drawId inconnu ne casse rien', () => {
  seed();
  assert(ctx.confirmInvalidateGage('nope') === false, 'accepté');
});
t('un choix inconnu retombe sur « nouveau tirage »', () => {
  seed();
  ctx.confirmInvalidateGage('d1', 'n_importe_quoi');
  assert(draw().status === 'invalidated' && owed().length === 1, 'fallback KO');
});
t('la raison saisie est conservée', () => {
  seed();
  ctx.confirmInvalidateGage('d1', 'cancel', 'clic par erreur');
  assert(draw().invalidationReason === 'clic par erreur', 'raison = ' + draw().invalidationReason);
});
t('sans raison, une raison par défaut explicite est posée', () => {
  seed();
  ctx.confirmInvalidateGage('d1', 'redraw', '');
  assert(draw().invalidationReason === 'Nouveau tirage', 'raison = ' + draw().invalidationReason);
});

// --- 5) feed de notifs -------------------------------------------------------
t('le coach voit l\'invalidation dans sa cloche', () => {
  seed();
  ctx.setNotifSeenAt(1);  // pas 0 : setNotifSeenAt fait `ts || Date.now()`
  ctx.confirmInvalidateGage('d1', 'cancel', 'clic par erreur');
  const it = ctx.notifFeed().filter(i => String(i.id).startsWith('ginval-'));
  assert(it.length === 1, 'attendu 1, reçu ' + it.length);
  assert(it[0].detail.includes('#13 Candice'), 'joueuse absente : ' + it[0].detail);
  assert(it[0].detail.includes('clic par erreur'), 'raison absente : ' + it[0].detail);
});
t('la joueuse voit SON invalidation', () => {
  S.auth = { role: 'player', playerId: 'pA' };
  const it = ctx.notifFeed().filter(i => String(i.id).startsWith('ginval-'));
  assert(it.length === 1, 'attendu 1, reçu ' + it.length);
  assert(it[0].detail.includes('Chanter'), 'texte du gage absent : ' + it[0].detail);
});
t('une autre joueuse ne voit PAS cette invalidation', () => {
  S.auth = { role: 'player', playerId: 'pB' };
  const it = ctx.notifFeed({ showRead: true }).filter(i => String(i.id).startsWith('ginval-'));
  assert(it.length === 0, 'fuite : ' + it.length);
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('après un redraw, la joueuse a bien son tirage à faire dans la cloche', () => {
  seed();
  ctx.setNotifSeenAt(1);  // pas 0 : setNotifSeenAt fait `ts || Date.now()`
  ctx.confirmInvalidateGage('d1', 'redraw', '');
  S.auth = { role: 'player', playerId: 'pA' };
  const it = ctx.notifFeed().filter(i => i.id === 'gages');
  assert(it.length === 1, 'le tirage à faire ne remonte pas');
  S.auth = { role: 'coach', coachId: 'admin' };
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
