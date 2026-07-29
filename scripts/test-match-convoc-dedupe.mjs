// Test MATCHS EN DOUBLE côté joueuse — sur le VRAI code d'index.html (vm + DOM stubé).
//
// Bug d'origine (constaté en prod le 2026-07-28 : 3 convocations pour le match du
// 29/08, 2 pour celui du 09/09) : le lien match ⇄ convocation (m.convocId /
// c.matchId) n'a AUCUNE colonne en base. Tout appareil qui repart d'un fetch le
// perd, l'ancien cleanup en déduisait « convocation orpheline » et en recréait
// une neuve — poussée en base à chaque fois.
//
// Ce test rejoue exactement ce scénario : convocations venues du serveur SANS
// lien local, plus les doublons déjà créés. Il vérifie qu'on adopte au lieu de
// recréer, qu'on ne perd pas les RSVP, et que l'affichage ne montre qu'une ligne.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n') + '\n;globalThis.state = state; globalThis.K = K;';

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
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message);
  process.exit(1);
}

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

ctx.render = () => {};
ctx.showToast = () => {};

// --- état de départ : la photo EXACTE de la prod (1 match ↔ 3 convocs) -------
const SEASON = '2026-2027';
function reset() {
  ctx.state.seasons = [{ id: SEASON, name: 'Saison 2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }];
  ctx.state.currentSeasonId = SEASON;
  ctx.state.players = [{ id: 'pl11', name: 'Noellie M', num: 15, pin: '0000' }];
  ctx.state.seasonPlayers = [{ seasonId: SEASON, playerId: 'pl11', teamTag: 'both' }];
  ctx.state.matches = [
    { id: 'mCOH', date: '2026-08-29', opponent: 'Match week-end de cohésion', home: true, time: '16:30', seasonId: SEASON, teamTag: 'e1', scoreUs: 0, scoreOpp: 0 },
    { id: 'mREJ', date: '2026-09-09', opponent: 'Rejaumont (amical)', home: false, time: '19:30', seasonId: SEASON, teamTag: 'e1', scoreUs: 0, scoreOpp: 0 },
  ];
  // Convocations telles qu'elles reviennent du serveur : AUCUN matchId (le lien
  // n'est pas persisté). Ids volontairement dans le désordre.
  ctx.state.convocations = [
    { id: 'xC', type: 'match', title: 'vs Match week-end de cohésion', date: '2026-08-29', time: '16:30', seasonId: SEASON, teamTag: 'e1', responses: {} },
    { id: 'xA', type: 'match', title: 'vs Match week-end de cohésion', date: '2026-08-29', time: '16:30', seasonId: SEASON, teamTag: 'e1', responses: { pl11: { status: 'yes' } } },
    { id: 'xB', type: 'match', title: 'vs Match week-end de cohésion', date: '2026-08-29', time: '16:30', seasonId: SEASON, teamTag: 'e1', responses: {} },
    { id: 'xE', type: 'match', title: 'vs Rejaumont (amical)', date: '2026-09-09', time: '19:30', seasonId: SEASON, teamTag: 'e1', responses: {} },
    { id: 'xD', type: 'match', title: 'vs Rejaumont (amical)', date: '2026-09-09', time: '19:30', seasonId: SEASON, teamTag: 'e1', responses: { pl11: { status: 'no', reason: 'blessée' } } },
    { id: 'xT1', type: 'training', title: 'Entraînement', date: '2026-08-25', time: '19:00', seasonId: SEASON, teamTag: 'e1', responses: {} },
    { id: 'xT2', type: 'training', title: 'Entraînement', date: '2026-08-25', time: '19:00', seasonId: SEASON, teamTag: 'e2', responses: {} },
  ];
  ctx.state.auth = { role: 'player', playerId: 'pl11' };
}
const matchConvocs = () => ctx.state.convocations.filter(c => c.type === 'match');

// --- 1) l'affichage ne montre JAMAIS un match deux fois ----------------------
t('getAllEventsBetween dédoublonne les convocations match (5 → 2)', () => {
  reset();
  const up = ctx.getAllEventsBetween('2026-07-28', '2026-12-31').filter(e => e.type === 'match');
  assert(up.length === 2, 'attendu 2 matchs à venir, reçu ' + up.length);
  assert(up[0].date === '2026-08-29' && up[1].date === '2026-09-09', 'ordre/dates inattendus');
});
t('la survivante affichée est la même partout (id le plus petit)', () => {
  reset();
  const up = ctx.getAllEventsBetween('2026-07-28', '2026-12-31').filter(e => e.type === 'match');
  assert(up[0].id === 'xA', 'survivante = ' + up[0].id + ' (attendu xA, le plus petit id)');
  assert(up[1].id === 'xD', 'survivante = ' + up[1].id + ' (attendu xD)');
});
t('les convocations d\'ENTRAÎNEMENT ne sont pas dédoublonnées', () => {
  reset();
  const tr = ctx.getAllEventsBetween('2026-08-01', '2026-09-01').filter(e => e.type === 'training');
  assert(tr.length === 2, 'entraînements E1/E2 fusionnés à tort : ' + tr.length);
});

// --- 2) le cleanup converge : adoption, pas recréation -----------------------
t('cleanupOrphanMatchConvocs : 5 convocs match → 1 par match', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  assert(matchConvocs().length === 2, 'attendu 2 convocs match, reçu ' + matchConvocs().length);
});
t('aucune convocation NEUVE créée (le bug d\'origine)', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  const ids = matchConvocs().map(c => c.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['xA', 'xD']), 'ids conservés = ' + ids.join(','));
});
t('les matchs sont reliés aux survivantes', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  const byId = Object.fromEntries(ctx.state.matches.map(m => [m.id, m]));
  assert(byId.mCOH.convocId === 'xA', 'mCOH lié à ' + byId.mCOH.convocId);
  assert(byId.mREJ.convocId === 'xD', 'mREJ lié à ' + byId.mREJ.convocId);
});
t('les RSVP posés sur un doublon sont FUSIONNÉS, pas perdus', () => {
  reset();
  // La réponse « oui » vit sur xA (survivante) ; on en pose une autre sur un
  // doublon pour prouver la fusion.
  ctx.state.convocations.find(c => c.id === 'xC').responses = { pl11: { status: 'late' } };
  ctx.state.convocations.find(c => c.id === 'xA').responses = {};
  ctx.cleanupOrphanMatchConvocs();
  const surv = ctx.state.convocations.find(c => c.id === 'xA');
  assert(surv && surv.responses && surv.responses.pl11, 'RSVP perdu avec le doublon supprimé');
  assert(surv.responses.pl11.status === 'late', 'mauvais RSVP repris');
});
t('cleanup IDEMPOTENT : un 2e passage ne change plus rien', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  const snap = JSON.stringify(matchConvocs().map(c => c.id).sort());
  ctx.cleanupOrphanMatchConvocs();
  ctx.cleanupOrphanMatchConvocs();
  assert(JSON.stringify(matchConvocs().map(c => c.id).sort()) === snap, 'le cleanup rebouge à chaque passage');
});
t('un match SANS convocation en reçoit une APRÈS la 1re sync', () => {
  reset();
  ctx.window._pbFirstSyncDone = true;   // v.85 : la création est gardée par ce drapeau
  ctx.state.convocations = ctx.state.convocations.filter(c => c.type !== 'match');
  ctx.cleanupOrphanMatchConvocs();
  assert(matchConvocs().length === 2, 'attendu 2 convocs créées, reçu ' + matchConvocs().length);
  assert(ctx.state.matches.every(m => m.convocId), 'match sans convocId après création');
});
t('...mais AVANT la 1re sync, rien n\'est créé (anti-prolifération v.85)', () => {
  // Un appareil au cache vide créait une convoc neuve par match, poussée au
  // flush : 9 convocs pour 4 matchs en production. On adopte et on dédoublonne
  // avant la sync, on ne crée qu'après.
  reset();
  ctx.window._pbFirstSyncDone = false;
  ctx.state.convocations = ctx.state.convocations.filter(c => c.type !== 'match');
  ctx.cleanupOrphanMatchConvocs();
  assert(matchConvocs().length === 0, 'doublons fabriqués avant la sync : ' + matchConvocs().length);
  ctx.window._pbFirstSyncDone = true;
});
t('une convocation match ORPHELINE (match supprimé) est supprimée', () => {
  reset();
  ctx.state.matches = ctx.state.matches.filter(m => m.id !== 'mREJ');
  ctx.cleanupOrphanMatchConvocs();
  assert(!matchConvocs().some(c => c.title.includes('Rejaumont')), 'convoc orpheline conservée');
  assert(matchConvocs().length === 1, 'reste ' + matchConvocs().length + ' convocs match');
});
t('les convocations d\'entraînement ne sont jamais touchées', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  assert(ctx.state.convocations.filter(c => c.type === 'training').length === 2, 'entraînements supprimés par le cleanup');
});

// --- 3) syncConvocFromMatch adopte au lieu de dupliquer ----------------------
t('syncConvocFromMatch : lien perdu → adopte la convocation existante', () => {
  reset();
  const m = ctx.state.matches[0];
  delete m.convocId;                       // lien perdu (fetch sur un autre appareil)
  const before = matchConvocs().length;
  ctx.syncConvocFromMatch(m);
  assert(matchConvocs().length === before, 'une convocation de plus a été créée');
  assert(m.convocId === 'xA', 'adoption ratée : ' + m.convocId);
});
t('syncConvocFromMatch : changement d\'adversaire → pas de doublon (lien conservé)', () => {
  reset();
  ctx.cleanupOrphanMatchConvocs();
  const m = ctx.state.matches[0];
  m.opponent = 'Auch';
  ctx.syncConvocFromMatch(m);
  assert(matchConvocs().length === 2, 'doublon créé au renommage : ' + matchConvocs().length);
  assert(ctx.state.convocations.find(c => c.id === 'xA').title === 'vs Auch', 'titre non synchronisé');
});

// --- 4) vue joueuse : plus aucun doublon ------------------------------------
t('renderPlayerMatches() : chaque match n\'apparaît qu\'une fois', () => {
  reset();
  const h = ctx.renderPlayerMatches();
  const cohesion = (h.match(/Match week-end de cohésion/g) || []).length;
  const rejaumont = (h.match(/Rejaumont/g) || []).length;
  assert(cohesion === 1, 'match de cohésion affiché ' + cohesion + ' fois');
  assert(rejaumont === 1, 'match Rejaumont affiché ' + rejaumont + ' fois');
  assert(h.includes('2 à venir'), 'compteur « à venir » faux (doublons comptés ?)');
});

console.log(R.join('\n'));
const bad = R.filter(l => l.startsWith('✗'));
if (bad.length) { console.log('\n✗ ' + bad.length + ' échec(s) / ' + R.length); process.exit(1); }
console.log('\n✓ ' + R.length + '/' + R.length + ' checks OK — matchs dupliqués (adoption par signature + dédoublonnage à l\'affichage)');
