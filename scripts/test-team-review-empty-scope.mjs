// Test CARTE « ÉTAT D'ESPRIT ÉQUIPE » (accueil coach) — PÉRIMÈTRE ET ÉTAT VIDE.
//
// ORIGINE : « 0/21 JOUEUSES · AUCUN RESSENTI CETTE SAISON » affiché alors que
// la table team_reviews contient des lignes. Diagnostic (2026-08-15, base de
// prod) : les seuls ressentis présents dataient de mai/juin 2026 — donc de la
// saison 2025-2026 — et avaient de surcroît été supprimés par l'admin le
// 2026-08-09. La carte disait donc vrai POUR SON PÉRIMÈTRE, mais son message
// se lisait comme une panne : le coach voit des lignes côté base, l'app
// affirme qu'il n'y a rien, et rien à l'écran ne dit sous quel périmètre.
//
// CE TEST VERROUILLE :
//   1. le périmètre : l'effectif de la saison, comme le tableau de bord —
//      le ressenti d'une joueuse hors effectif ne gonfle pas le « X/N » ;
//   2. l'état vide qui NOMME ce qui existe ailleurs (autre saison, hors
//      effectif) au lieu d'un « aucun » sec ;
//   3. les ressentis supprimés par l'admin : jamais comptés, ni dans le
//      « X/N », ni dans le décompte « ailleurs » ;
//   4. le point d'entrée vers le tableau de bord, présent dans les DEUX
//      branches (cf. v.109 : un état vide ne supprime jamais le seul accès).
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.TEAM_REVIEW_FIELDS = TEAM_REVIEW_FIELDS;';

const store = {};
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = { getElementById: () => mkEl(), createElement: mkEl, querySelector: () => null,
  querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible' };
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol, Intl,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, document: doc,
  navigator: { userAgent: 'probe', onLine: true, serviceWorker: { getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}), ready: Promise.resolve({ showNotification() {} }), addEventListener() {} } },
  location: { hash: '', href: 'http://localhost/', replace() {}, reload() {} },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
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
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

const S = ctx.state;
ctx.render = () => {}; ctx.showToast = () => {}; ctx.openModal = () => {}; ctx.closeModal = () => {};

// Deux saisons qui PAVENT le calendrier (cf. seasonDateWindow) : l'été 2026
// appartient à la saison qui COMMENCE (2026-2027).
S.seasons = [
  { id: '2025-2026', name: 'Saison 2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' },
  { id: '2026-2027', name: 'Saison 2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' },
];
// pl1/pl2 dans l'effectif 2026-2027 ; pl9 seulement sur l'ancienne saison.
S.players = [
  { id: 'pl1', name: 'Alice' }, { id: 'pl2', name: 'Bea' }, { id: 'pl9', name: 'Partie' },
];
S.seasonPlayers = [
  { seasonId: '2026-2027', playerId: 'pl1', teamTag: 'e1' },
  { seasonId: '2026-2027', playerId: 'pl2', teamTag: 'e1' },
  { seasonId: '2025-2026', playerId: 'pl9', teamTag: 'e1' },
];
S.currentSeasonId = '2026-2027';
S.auth = { role: 'coach', coachId: null };
ctx.isAdminCoach = () => true;

const rv = (id, pid, date, extra) => Object.assign({
  id, pid, date, ambiance: 4, roleClarity: 4, playtime: 4, physique: 4,
  comment: '', deletedAt: null, deletedBy: null, updatedAt: Date.parse(date + 'T12:00:00Z'),
}, extra || {});

const homeHtml = () => { const out = ctx.renderHomeCoach(); ok(typeof out === 'string' && out.length > 0, 'render vide'); return out; };
const eyebrow = (h) => { const m = h.match(/<div class="eyebrow">(\d+)\/(\d+) joueuse/); return m ? m[1] + '/' + m[2] : null; };

t('base réelle : 2 ressentis d\'août rattachés à la saison qui commence → 2/2', () => {
  S.teamReviews = [rv('r1', 'pl1', '2026-08-10'), rv('r2', 'pl2', '2026-08-14')];
  ok(ctx.currentSeasonTeamReviews().length === 2, 'la fenêtre de saison doit couvrir l\'intersaison');
  ok(eyebrow(homeHtml()) === '2/2', 'attendu 2/2, obtenu ' + eyebrow(homeHtml()));
});

t('ressenti d\'une joueuse HORS effectif : ne compte pas dans le X/N', () => {
  S.teamReviews = [rv('r1', 'pl1', '2026-08-10'), rv('r9', 'pl9', '2026-08-11')];
  ok(eyebrow(homeHtml()) === '1/2', 'attendu 1/2, obtenu ' + eyebrow(homeHtml()));
});

t('état vide alors que la base contient des ressentis AILLEURS : il le dit', () => {
  // Trois ressentis de la saison précédente : hors de la fenêtre courante.
  S.teamReviews = [rv('a', 'pl1', '2026-05-19'), rv('b', 'pl2', '2026-06-02'), rv('c', 'pl2', '2026-06-25')];
  const h = homeHtml();
  ok(eyebrow(h) === '0/2', 'attendu 0/2, obtenu ' + eyebrow(h));
  ok(/Aucun ressenti sur cette saison/.test(h), 'le titre doit borner son périmètre');
  ok(/3 ressentis hors de cette saison ou hors effectif/.test(h),
    'l\'état vide doit annoncer ce qui existe ailleurs — sinon il se lit comme une panne');
});

t('ressentis supprimés par l\'admin : ni comptés, ni annoncés comme « ailleurs »', () => {
  S.teamReviews = [
    rv('a', 'pl1', '2026-05-19', { deletedAt: Date.parse('2026-08-09T12:22:24Z'), deletedBy: 'admin' }),
    rv('b', 'pl2', '2026-06-02', { deletedAt: Date.parse('2026-08-09T12:22:31Z'), deletedBy: 'admin' }),
  ];
  const h = homeHtml();
  ok(eyebrow(h) === '0/2', 'attendu 0/2, obtenu ' + eyebrow(h));
  ok(!/ressenti(s)? hors de cette saison/.test(h),
    'un ressenti supprimé n\'existe plus pour l\'application : il ne doit rien annoncer');
  ok(/Ambiance · rôle · temps de jeu · physique/.test(h), 'accroche par défaut attendue');
});

t('base totalement vide : état vide neutre, sans décompte fantôme', () => {
  S.teamReviews = [];
  const h = homeHtml();
  ok(eyebrow(h) === '0/2', 'attendu 0/2, obtenu ' + eyebrow(h));
  ok(!/hors de cette saison/.test(h), 'rien en base → rien à annoncer ailleurs');
});

t('le point d\'entrée vers le tableau de bord survit dans les DEUX branches', () => {
  S.teamReviews = [];
  ok(/openTeamReviewsDashboard\(\)/.test(homeHtml()), 'accès perdu sur l\'état vide (cf. v.109)');
  S.teamReviews = [rv('r1', 'pl1', '2026-08-10')];
  ok(/openTeamReviewsDashboard\(\)/.test(homeHtml()), 'accès perdu sur l\'état plein');
});

t('la carte et le tableau de bord comptent le MÊME groupe', () => {
  S.teamReviews = [rv('r1', 'pl1', '2026-08-10'), rv('r9', 'pl9', '2026-08-11')];
  const ids = new Set(ctx.currentSeasonPlayers().map(p => p.id));
  const latest = ctx.latestTeamReviewByPlayer(ctx.activeTeamReviews(), { playerIds: ids });
  ok(Object.keys(latest).length === 1, 'le tableau de bord scope déjà par effectif');
  ok(eyebrow(homeHtml()) === '1/2', 'la carte doit donner le même numérateur que le tableau de bord');
});

console.log(R.join('\n'));
process.exit(R.some(l => l.startsWith('✗')) ? 1 : 0);
