// Test ONGLET MATCHS (coach) — « à venir » / « joués » + filtres de période.
//
// ORIGINE : la liste s'intitulait « Historique » et contenait… les matchs À
// VENIR. Deux onglets, plus un sous-filtre de période sur « à venir » seulement
// (c'est là que le coach se projette : « qu'est-ce que j'ai cette semaine ? »).
//
// RÈGLE DE RÉPARTITION — un match est « à venir » s'il n'a PAS de score ET que
// sa date n'est pas passée. Tout le reste va dans « joués », Y COMPRIS un match
// passé dont le score n'a jamais été saisi : il doit rester visible pour être
// complété, jamais disparaître entre deux onglets.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.MATCH_RANGES = MATCH_RANGES;';

const store = {};
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = { getElementById: () => mkEl(), createElement: mkEl, querySelector: () => null,
  querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible' };
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol,
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
ctx.render = () => {}; ctx.showToast = () => {}; ctx.notifyPush = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };

// Mercredi 2026-07-29 (semaine du lundi 27/07 au dimanche 02/08).
const TODAY = '2026-07-29';
const M = (id, date, us, opp) => ({ id, date, opponent: 'Adv ' + id, home: true,
  scoreUs: us || 0, scoreOpp: opp || 0, seasonId: '2026-2027', teamTag: 'e1' });

function seed(matches) {
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.activeSeasonId = '2026-2027'; S.currentSeasonId = '2026-2027';
  S.players = []; S.seasonPlayers = []; S.convocations = [];
  S.matches = matches || [];
  S.view = null; S._matchTab = null; S._matchRange = 'all';
}

// --- 1) découpage à venir / joués -------------------------------------------
t('un match futur sans score est « à venir »', () => {
  ok(ctx._matchIsUpcoming(M('a', '2026-09-09'), TODAY) === true);
});
t('un match avec un score n\'est jamais « à venir »', () => {
  ok(ctx._matchIsUpcoming(M('a', '2026-09-09', 55, 48), TODAY) === false);
});
t('un match passé sans score n\'est PAS « à venir » (il reste à compléter)', () => {
  ok(ctx._matchIsUpcoming(M('a', '2026-05-12'), TODAY) === false);
});
t('le match du jour est « à venir » (il n\'est pas encore joué)', () => {
  ok(ctx._matchIsUpcoming(M('a', TODAY), TODAY) === true);
});

// --- 2) bornes de période (semaine à la française, lundi → dimanche) --------
t('« cette semaine » va d\'aujourd\'hui au dimanche', () => {
  const r = ctx._matchRangeFor('week', TODAY);
  ok(r.from === TODAY, 'from = ' + r.from);
  ok(r.to === '2026-08-02', 'to = ' + r.to);       // dimanche
});
t('« semaine prochaine » va du lundi au dimanche suivants', () => {
  const r = ctx._matchRangeFor('next', TODAY);
  ok(r.from === '2026-08-03', 'from = ' + r.from);  // lundi
  ok(r.to === '2026-08-09', 'to = ' + r.to);        // dimanche
});
t('un DIMANCHE, « cette semaine » se termine le jour même', () => {
  const r = ctx._matchRangeFor('week', '2026-08-02');
  ok(r.from === '2026-08-02' && r.to === '2026-08-02', JSON.stringify(r));
});
t('un DIMANCHE, « semaine prochaine » démarre bien le lendemain', () => {
  const r = ctx._matchRangeFor('next', '2026-08-02');
  ok(r.from === '2026-08-03' && r.to === '2026-08-09', JSON.stringify(r));
});
t('« ce mois-ci » va d\'aujourd\'hui au dernier jour du mois', () => {
  const r = ctx._matchRangeFor('month', TODAY);
  ok(r.from === TODAY && r.to === '2026-07-31', JSON.stringify(r));
});
t('« ce mois-ci » gère un mois de 28/29 jours', () => {
  ok(ctx._matchRangeFor('month', '2027-02-10').to === '2027-02-28', 'février KO');
});
t('« toute la saison » = aucune borne', () => {
  ok(ctx._matchRangeFor('all', TODAY) === null);
});
t('_matchInRange filtre bien sur les bornes (inclusives)', () => {
  ok(ctx._matchInRange(M('a', '2026-08-02'), 'week', TODAY) === true, 'borne haute exclue à tort');
  ok(ctx._matchInRange(M('a', '2026-08-03'), 'week', TODAY) === false, 'hors semaine inclus');
  ok(ctx._matchInRange(M('a', '2026-09-09'), 'all', TODAY) === true, '« toute la saison » filtre à tort');
});

// --- 3) rendu ----------------------------------------------------------------
t('le titre « Historique » a disparu', () => {
  seed([M('a', '2026-09-09'), M('b', '2026-08-29')]);
  ok(!/Historique/.test(ctx.renderMatches()), 'la section s\'appelle encore Historique');
});
t('le compteur distingue à venir et joués', () => {
  seed([M('a', '2026-09-09'), M('b', '2026-08-29'), M('c', '2026-05-12', 60, 55)]);
  const h = ctx.renderMatches();
  ok(/2 à venir · 1 joué/.test(h), 'compteur = ' + (h.match(/\d+ à venir[^<]*/) || [''])[0]);
});
t('les 2 onglets sont rendus avec leur compte', () => {
  seed([M('a', '2026-09-09'), M('b', '2026-08-29'), M('c', '2026-05-12', 60, 55)]);
  const h = ctx.renderMatches();
  ok(h.includes("setMatchTab('upcoming')") && h.includes("setMatchTab('played')"), 'onglets absents');
  ok(/À venir · 2/.test(h), 'compte à venir absent');
  ok(/Joués · 1/.test(h), 'compte joués absent');
});
t('par défaut on ouvre sur « à venir »', () => {
  seed([M('a', '2026-09-09'), M('c', '2026-05-12', 60, 55)]);
  const h = ctx.renderMatches();
  ok(h.includes('Adv a'), 'le match à venir n\'est pas listé');
  ok(!h.includes('Adv c'), 'un match joué est listé dans « à venir »');
});
t('...mais sur « joués » s\'il n\'y a rien à venir', () => {
  seed([M('c', '2026-05-12', 60, 55)]);
  const h = ctx.renderMatches();
  ok(h.includes('Adv c'), 'le match joué n\'est pas listé alors que c\'est tout ce qu\'il y a');
});
t('les sous-filtres n\'apparaissent QUE sur « à venir »', () => {
  seed([M('a', '2026-09-09'), M('c', '2026-05-12', 60, 55)]);
  ok(/setMatchRange\('week'\)/.test(ctx.renderMatches()), 'filtres absents sur « à venir »');
  ctx.setMatchTab('played');
  ok(!/setMatchRange\(/.test(ctx.renderMatches()), 'filtres affichés sur « joués »');
  ctx.setMatchTab('upcoming');
});
t('les 4 périodes sont proposées', () => {
  seed([M('a', '2026-09-09')]);
  const h = ctx.renderMatches();
  ['all', 'week', 'next', 'month'].forEach(k => ok(h.includes("setMatchRange('" + k + "')"), 'période ' + k + ' absente'));
});
t('« à venir » est trié du plus proche au plus lointain', () => {
  seed([M('loin', '2026-09-09'), M('proche', '2026-08-29')]);
  const h = ctx.renderMatches();
  ok(h.indexOf('Adv proche') < h.indexOf('Adv loin'), 'tri chronologique inversé');
});
t('« joués » reste du plus récent au plus ancien', () => {
  seed([M('vieux', '2026-05-12', 60, 55), M('recent', '2026-05-23', 70, 65)]);
  ctx.setMatchTab('played');
  const h = ctx.renderMatches();
  ok(h.indexOf('Adv recent') < h.indexOf('Adv vieux'), 'tri antichronologique cassé');
});
t('un match passé SANS score reste visible dans « joués »', () => {
  seed([M('oubli', '2026-05-12')]);
  ctx.setMatchTab('played');
  ok(ctx.renderMatches().includes('Adv oubli'), 'match passé sans score escamoté');
});

// --- 4) états vides ----------------------------------------------------------
t('aucun match du tout → état vide générique', () => {
  seed([]);
  const h = ctx.renderMatches();
  ok(/Aucun match</.test(h), 'état vide absent');
  ok(!h.includes('setMatchTab'), 'onglets affichés sans aucun match');
});
t('« à venir » vide sur une période → message qui oriente', () => {
  seed([M('a', '2026-09-09')]);
  ctx.setMatchRange('week');
  const h = ctx.renderMatches();
  ok(/Aucun match à venir/.test(h), 'message absent');
  ok(/Toute la saison/.test(h), 'aucune piste pour élargir');
  ctx.setMatchRange('all');
});
t('« joués » vide → message dédié', () => {
  seed([M('a', '2026-09-09')]);
  ctx.setMatchTab('played');
  ok(/Aucun match joué/.test(ctx.renderMatches()), 'message absent');
  ctx.setMatchTab('upcoming');
});

// --- 5) pas de régression ----------------------------------------------------
t('le bilan ne compte que les matchs avec score', () => {
  seed([M('a', '2026-09-09'), M('v', '2026-05-12', 60, 55), M('d', '2026-05-23', 50, 70)]);
  const h = ctx.renderMatches();
  ok(/Bilan[\s\S]{0,200}>1</.test(h), 'bilan victoires KO');
});
t('les boutons Dashboard et + MATCH restent là', () => {
  seed([M('a', '2026-09-09')]);
  const h = ctx.renderMatches();
  ok(h.includes('openDashboard()') && h.includes('editMatch()'), 'actions d\'en-tête perdues');
});
t('la vue JOUEUSE n\'est pas touchée', () => {
  seed([M('a', '2026-09-09'), M('c', '2026-05-12', 60, 55)]);
  S.auth = { role: 'player', playerId: 'pX' };
  S.players = [{ id: 'pX', name: 'Lea', num: 7 }];
  S.seasonPlayers = [{ seasonId: '2026-2027', playerId: 'pX', teamTag: 'e1', joinedAt: '2026-07-01', leftAt: null }];
  const h = ctx.renderPlayerMatches();
  ok(typeof h === 'string' && h.length > 0, 'la vue joueuse ne rend plus');
  ok(!h.includes('setMatchTab'), 'les onglets coach ont fuité côté joueuse');
});
t('ouvrir un match affiche toujours le détail', () => {
  seed([M('a', '2026-09-09')]);
  S.view = { type: 'match', id: 'a' };
  ok(typeof ctx.renderMatches() === 'string', 'le routage vers le détail est cassé');
  S.view = null;
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
