// Test SUIVI DES LICENCES (cf. migration 20260729_001_player_licences).
//
// Le point sensible est le SCOPING PAR SAISON : une licence est un objet par
// saison. C'est pour ça qu'elle vit dans sa propre table et non en colonnes sur
// `players` — sinon le changement de saison écraserait l'historique et
// afficherait silencieusement le statut de l'an dernier (le mode de panne
// « cumul cross-saison » déjà corrigé 4 fois ici). Ce test le verrouille.
//
// Évalue les <script> classiques du VRAI index.html dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.LICENCE_STATUSES = LICENCE_STATUSES;';

const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {},
});
const ui = { checked: null, fields: {} };
const doc = {
  getElementById: (id) => (id in ui.fields ? { value: ui.fields[id] } : mkEl()),
  createElement: mkEl,
  querySelector: (sel) => (sel.includes('lic-status') && ui.checked ? { value: ui.checked } : null),
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

function seed() {
  pushed = []; ui.checked = null; ui.fields = {};
  ctx.window._licenceFilter = 'all';
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [
    { id: '2025-2026', name: 'S1', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' },
    { id: '2026-2027', name: 'S2', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' },
  ];
  S.activeSeasonId = '2026-2027'; S.currentSeasonId = '2026-2027';
  S.players = [
    { id: 'pA', name: 'Candice', num: 13 }, { id: 'pB', name: 'Delph', num: 6 }, { id: 'pC', name: 'Noellie', num: 15 },
  ];
  S.seasonPlayers = ['pA', 'pB', 'pC'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.playerLicences = [];
  S.gages = []; S.gageDraws = []; S.convocations = []; S.matches = []; S.trainingCompletions = []; S.trainingPrograms = [];
}
const lic = (pid, sid) => ctx._licenceFor(pid, sid);

// --- 1) état initial --------------------------------------------------------
t('sans ligne, une joueuse est « pas commencée » (aucune ligne fantôme créée)', () => {
  seed();
  assert(lic('pA') === null, 'ligne créée sans raison');
  const rows = ctx._licenceRows();
  assert(rows.length === 3, 'effectif = ' + rows.length);
  assert(rows.every(r => r.status === 'not_started'), 'statut par défaut KO');
  assert(S.playerLicences.length === 0, 'la table a été pré-remplie');
});
t('les compteurs partent à 0 validée / 3 à faire', () => {
  const st = ctx._licenceStats();
  assert(st.total === 3 && st.not_started === 3 && st.validated === 0, JSON.stringify(st));
});

// --- 2) écriture ------------------------------------------------------------
t('enregistrer un statut crée UNE ligne sur la saison active', () => {
  seed();
  assert(ctx.saveLicence('pA', 'validated', 'reçue le 12/08') === true, 'refusé');
  assert(S.playerLicences.length === 1, 'lignes = ' + S.playerLicences.length);
  const l = lic('pA');
  assert(l.status === 'validated', 'statut = ' + l.status);
  assert(l.seasonId === '2026-2027', 'saison = ' + l.seasonId);
  assert(l.notes === 'reçue le 12/08', 'notes = ' + l.notes);
  assert(typeof l.updatedAt === 'number', 'updatedAt manquant');
});
t('ré-enregistrer MET À JOUR la même ligne (pas de doublon)', () => {
  ctx.saveLicence('pA', 'certif_missing', 'il manque le certif');
  assert(S.playerLicences.length === 1, 'doublon : ' + S.playerLicences.length);
  assert(lic('pA').status === 'certif_missing', 'statut = ' + lic('pA').status);
});
t('un statut inconnu retombe sur « pas commencée »', () => {
  seed();
  ctx.saveLicence('pA', 'n_importe_quoi', '');
  assert(lic('pA').status === 'not_started', 'statut = ' + lic('pA').status);
});
t('le statut vient du radio coché quand il n\'est pas passé en argument', () => {
  seed();
  ui.checked = 'in_progress'; ui.fields['lic-notes'] = 'dossier envoyé';
  ctx.saveLicence('pB');
  assert(lic('pB').status === 'in_progress', 'statut = ' + lic('pB').status);
  assert(lic('pB').notes === 'dossier envoyé', 'notes = ' + lic('pB').notes);
});

// --- 3) SCOPING SAISON (la raison d'être de la table séparée) ---------------
t('la licence de la saison précédente n\'écrase PAS celle de la saison active', () => {
  seed();
  S.playerLicences.push({ id: 'old', playerId: 'pA', seasonId: '2025-2026', status: 'validated',
    notes: 'saison dernière', createdAt: 1, updatedAt: 1, deletedAt: null });
  assert(lic('pA', '2026-2027') === null, 'la licence 2025-2026 fuit sur 2026-2027');
  assert(ctx._licenceRows().find(r => r.player.id === 'pA').status === 'not_started',
    'statut de l\'an dernier affiché sur la saison active');
});
t('l\'historique de la saison précédente est CONSERVÉ', () => {
  ctx.saveLicence('pA', 'in_progress', '');
  assert(lic('pA', '2025-2026').status === 'validated', 'historique écrasé');
  assert(lic('pA', '2026-2027').status === 'in_progress', 'saison active KO');
  assert(S.playerLicences.length === 2, 'lignes = ' + S.playerLicences.length);
});
t('une ligne soft-deleted est ignorée', () => {
  seed();
  ctx.saveLicence('pA', 'validated', '');
  lic('pA').deletedAt = Date.now();
  assert(lic('pA') === null, 'ligne supprimée encore lue');
});

// --- 4) permissions ---------------------------------------------------------
t('une joueuse ne peut PAS écrire de licence', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  assert(ctx.saveLicence('pA', 'validated', 'triche') === false, 'écriture acceptée');
  assert(S.playerLicences.length === 0, 'ligne écrite quand même');
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('openLicences est un no-op côté joueuse', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.__lastModal = null;
  ctx.openLicences();
  assert(!ctx.__lastModal, 'modale coach ouverte pour une joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// --- 5) UI coach ------------------------------------------------------------
t('la modale liste l\'effectif avec les statuts', () => {
  seed();
  ctx.saveLicence('pA', 'validated', '');
  ctx.openLicences('all');
  const m = ctx.__lastModal || '';
  assert(m.includes('#13 Candice') && m.includes('#6 Delph') && m.includes('#15 Noellie'), 'effectif incomplet');
  assert(m.includes('Validée'), 'statut absent');
  assert(/openLicenceEditor\('pA'\)/.test(m), 'bouton Modifier non câblé');
});
t('les joueuses à relancer sont EN TÊTE (tri par urgence)', () => {
  seed();
  ctx.saveLicence('pA', 'validated', '');   // #13 validée
  const rows = ctx._licenceRows();
  assert(rows[0].status === 'not_started', 'tri KO : ' + rows.map(r => r.status).join(','));
  assert(rows[rows.length - 1].player.id === 'pA', 'la validée devrait être en dernier');
});
t('le filtre ne montre que le statut demandé', () => {
  seed();
  ctx.saveLicence('pA', 'validated', '');
  ctx.openLicences('validated');
  const m = ctx.__lastModal || '';
  assert(m.includes('#13 Candice'), 'la validée manque');
  assert(!m.includes('#6 Delph'), 'fuite d\'un autre statut');
});
t('l\'éditeur pré-coche le statut courant et affiche les notes', () => {
  seed();
  ctx.saveLicence('pA', 'certif_missing', 'relancée par SMS');
  ctx.openLicenceEditor('pA');
  const m = ctx.__lastModal || '';
  assert(/value="certif_missing" checked/.test(m), 'statut non pré-coché');
  assert(m.includes('relancée par SMS'), 'notes absentes');
});
t('la modale rend même avec un effectif vide', () => {
  seed();
  S.seasonPlayers = [];
  ctx.openLicences('all');
  assert(/Aucune joueuse/.test(ctx.__lastModal || ''), 'état vide manquant');
});

// --- 6) relance -------------------------------------------------------------
t('la relance ne cible QUE les « pas commencée »', () => {
  seed();
  ctx.saveLicence('pA', 'validated', '');
  ctx.saveLicence('pB', 'in_progress', '');
  const n = ctx.remindLicences();
  assert(n === 1, 'ciblé ' + n + ' joueuse(s) au lieu de 1');
  assert(pushed.length === 1, 'push = ' + pushed.length);
  assert(/licence/i.test(pushed[0].payload.title), 'titre = ' + pushed[0].payload.title);
});
t('rien à relancer → aucun push', () => {
  seed();
  ['pA', 'pB', 'pC'].forEach(id => ctx.saveLicence(id, 'validated', ''));
  pushed = [];
  assert(ctx.remindLicences() === 0, 'relance envoyée à tort');
  assert(pushed.length === 0, 'push parasite');
});

// --- 7) carte joueuse -------------------------------------------------------
t('la joueuse voit SON statut', () => {
  seed();
  ctx.saveLicence('pA', 'certif_missing', '');
  S.auth = { role: 'player', playerId: 'pA' };
  const c = ctx.renderLicencePlayerCard();
  assert(c && c.includes('Ma licence'), 'carte absente');
  assert(c.includes('Certif manquant'), 'statut absent');
  assert(/certificat m.dical/i.test(c), 'consigne absente');
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('la carte ne fuite pas le statut des autres', () => {
  seed();
  ctx.saveLicence('pA', 'validated', 'notes privées coach');
  S.auth = { role: 'player', playerId: 'pB' };
  const c = ctx.renderLicencePlayerCard();
  assert(!c.includes('notes privées coach'), 'notes coach exposées');
  assert(!c.includes('Validée'), 'statut d\'une autre joueuse affiché');
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('aucune carte tant que le coach n\'utilise pas le module', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  assert(ctx.renderLicencePlayerCard() === '', 'carte anxiogène affichée sans donnée');
  S.auth = { role: 'coach', coachId: 'admin' };
});
t('la carte coach est vide côté coach (c\'est une carte joueuse)', () => {
  seed();
  assert(ctx.renderLicencePlayerCard() === '', 'carte joueuse rendue pour le coach');
});

// --- 8) round-trip de sérialisation ----------------------------------------
// _dumpLicenceRow / _licenceFromRow vivent dans le bloc <script type="module">
// (PbSync), que le vm ci-dessus n'évalue PAS. On les extrait du source et on les
// évalue à part — même approche que test-training-programs.mjs §8.
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') { depth++; began = true; }
    else if (html[j] === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}
const ser = new Function(
  extractFn('_dumpLicenceRow') + '\n' + extractFn('_licenceFromRow') +
  '\nreturn { _dumpLicenceRow, _licenceFromRow };')();

t('les sérialiseurs du bloc module sont autonomes (aucune const hors portée)', () => {
  // Le piège cross-<script> : LICENCE_STATUSES est déclaré dans le bloc
  // classique. Si le module y faisait référence, il throwerait en prod.
  assert(typeof ser._dumpLicenceRow === 'function' && typeof ser._licenceFromRow === 'function');
  ser._dumpLicenceRow({ id: 'x', playerId: 'p', seasonId: 's', status: 'validated' });
});
t('dump → row → client conserve tout', () => {
  seed();
  ctx.saveLicence('pA', 'in_progress', 'dossier parti');
  const l = lic('pA');
  const row = ser._dumpLicenceRow(l);
  assert(row.player_id === 'pA' && row.season_id === '2026-2027', JSON.stringify(row));
  assert(row.status === 'in_progress' && row.notes === 'dossier parti', JSON.stringify(row));
  assert(row.deleted_at === null, 'deleted_at KO');
  const back = ser._licenceFromRow(Object.assign({ created_at: new Date().toISOString() }, row));
  assert(back.status === l.status && back.notes === l.notes && back.playerId === l.playerId, JSON.stringify(back));
});
t('un statut hors contrainte SQL est neutralisé au dump', () => {
  seed();
  S.playerLicences = [{ id: 'x1', playerId: 'pA', seasonId: '2026-2027', status: 'bidon', notes: '', updatedAt: 1 }];
  assert(ser._dumpLicenceRow(S.playerLicences[0]).status === 'not_started', 'statut invalide envoyé en base');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
