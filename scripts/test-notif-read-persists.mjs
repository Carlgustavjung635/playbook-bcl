// Test « je marque la notif comme lue, elle revient à la sync suivante ».
//
// LE BUG (signalé sur un désistement) n'était PAS un id instable : les ids du
// flux sont déterministes depuis toujours (`rsvp-<convoc>-<joueuse>-<date>-<statut>`).
// C'est l'HORODATAGE qui bougeait.
//
//   • `convocation_responses` n'a pas de colonne pour `at` : l'apply le
//     reconstruit depuis `updated_at`, la colonne serveur.
//   • le cache de deltas de PbSync (`_lastSeen`) est EN MÉMOIRE et repart vide à
//     chaque ouverture de l'app → le premier flush ré-upserte TOUTES les lignes.
//   • le trigger `cr_set_updated_at` les réhorodate alors en bloc à now().
//     (Constaté en base : deux désistements de dates différentes portaient le
//     même `updated_at` à la microseconde près.)
//   • `at` sautait donc à « maintenant », `ts > filigrane` redevenait vrai, et
//     la notif déjà lue remontait en non-lu. À chaque sync. Indéfiniment.
//
// Deux verrous sont posés, et ce fichier verrouille les deux :
//   1. l'apply ne retient `updated_at` que si le CONTENU du RSVP a changé ;
//   2. un registre des notifs ONE-SHOT lues, qui survit même si un ts est réécrit.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n') + '\n;globalThis.state = state;';

// L'apply de `convocationResponses` vit dans le bloc <script type="module">,
// hors de portée du bloc classique. On l'extrait du source et on le reconstruit
// dans une portée qui lui donne son `_lastConvocResponses` — même approche que
// test-convoc-responses-survive-realtime.
function extractApply(key) {
  const anchor = html.indexOf("key: '" + key + "'");
  if (anchor < 0) throw new Error('entité introuvable : ' + key);
  const ai = html.indexOf('apply:', anchor);
  const open = html.indexOf('{', html.indexOf('=>', ai));
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(ai + 'apply:'.length, j + 1).trim(); }
  }
  throw new Error('accolades non équilibrées : ' + key);
}
const applyResponses = new Function(`
  const _lastConvocResponses = {};
  return ${extractApply('convocationResponses')};
`)();

const store = {};
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = {
  getElementById: (id) => (id === 'modal-root' ? null : mkEl()),
  createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
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
ctx.render = () => {}; ctx.showToast = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => {};

const CID = 'cvMatch';
const DATE = '2026-08-29';
const RSVP_ID = 'rsvp-' + CID + '-pA-' + DATE + '-absent';
const T0 = Date.parse('2026-07-28T10:00:00.000Z');   // heure RÉELLE du désistement

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.currentSeasonId = '2026-2027';
  S.players = [{ id: 'pA', name: 'Ophelie', num: 1 }, { id: 'pB', name: 'Celia', num: 14 }];
  S.seasonPlayers = ['pA', 'pB'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.convocations = [{
    id: CID, type: 'match', title: 'vs Rejaumont', date: DATE, time: '20:00',
    location: '', note: '', recurrence: null, cancelledInstances: [], instanceOverrides: {},
    attachments: [], responses: {}, seasonId: '2026-2027', teamTag: 'e1', closed: false,
  }];
  S.matches = []; S.gages = []; S.gageDraws = []; S.playerLicences = [];
  S.playerUnavailabilities = []; S.trainingCompletions = []; S.trainingPrograms = [];
  S.broadcasts = []; S.challenges = []; S.plays = []; S.trainingPlans = [];
}

// L'apply de l'entité, tel que PbSync l'appellerait avec les lignes du serveur.
function applyRows(rows) { applyResponses(S, rows); }
const row = (updatedAt, extra) => Object.assign({
  convocation_id: CID, player_id: 'pA', instance_date: DATE,
  status: 'absent', reason: 'Blessure', late_minutes: null,
  updated_at: new Date(updatedAt).toISOString(),
}, extra || {});

// ============================================================================
// 1) L'APPLY — `updated_at` n'est pris que si le contenu a bougé
// ============================================================================
t('l\'apply de convocationResponses est extractible et exécutable', () => {
  ok(typeof applyResponses === 'function', 'apply introuvable');
});
t('première réception : `at` vient bien de updated_at', () => {
  seed(); applyRows([row(T0)]);
  ok(S.convocations[0].responses.pA.at === T0, 'at = ' + S.convocations[0].responses.pA.at);
});
t('LE BUG : une resynchro à contenu identique ne réécrit PAS `at`', () => {
  seed(); applyRows([row(T0)]);
  // Réouverture de l'app → _lastSeen vide → ré-upsert de TOUTES les lignes →
  // le trigger réhorodate à now(). Le contenu, lui, n'a pas bougé d'un poil.
  applyRows([row(Date.now())]);
  ok(S.convocations[0].responses.pA.at === T0,
    'horodatage réécrit par une resynchro : ' + S.convocations[0].responses.pA.at);
});
t('…mais un VRAI changement de statut réhorodate (c\'est un autre événement)', () => {
  seed(); applyRows([row(T0)]);
  const T1 = T0 + 3600000;
  applyRows([row(T1, { status: 'present', reason: null })]);
  ok(S.convocations[0].responses.pA.at === T1, 'retour de présence non horodaté');
});
t('un changement de motif seul réhorodate aussi', () => {
  seed(); applyRows([row(T0)]);
  const T1 = T0 + 60000;
  applyRows([row(T1, { reason: 'Travail / études' })]);
  ok(S.convocations[0].responses.pA.at === T1, 'motif modifié sans nouvel horodatage');
});
t('un retard saisi réhorodate', () => {
  seed(); applyRows([row(T0)]);
  const T1 = T0 + 60000;
  applyRows([row(T1, { late_minutes: 7 })]);
  ok(S.convocations[0].responses.pA.at === T1, 'retard saisi sans nouvel horodatage');
});

// ============================================================================
// 2) LE FLUX — marquer lu tient dans la durée
// ============================================================================
t('le désistement remonte au coach avec un id déterministe', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  const n = ctx.notifFeed().find(i => i.id === RSVP_ID);
  ok(n, 'désistement absent du flux');
  ok(n.unread === true, 'devrait être non lu');
  ok(n.oneShot === true, 'un désistement daté est un événement one-shot');
});
t('l\'id ne dépend QUE de la source (deux rendus → même id)', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  const a = ctx.notifFeed().map(i => i.id).join('|');
  const b = ctx.notifFeed().map(i => i.id).join('|');
  ok(a === b, 'ids instables entre deux rendus');
});
t('LE BUG BOUT EN BOUT : marquée lue, elle ne revient plus après une resynchro', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  ok(ctx.notifFeed().some(i => i.id === RSVP_ID), 'décor KO : pas non lue au départ');
  ctx.markAllNotifsRead();
  ok(!ctx.notifFeed().some(i => i.id === RSVP_ID), 'toujours non lue après « tout marquer lu »');
  // …et maintenant la sync qui faisait tout revenir.
  applyRows([row(Date.now())]);
  ok(!ctx.notifFeed().some(i => i.id === RSVP_ID), 'LE BUG : la notif lue est revenue après la sync');
});
t('le registre survit même à un ts réécrit de force (2e verrou seul)', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  ctx.markAllNotifsRead();
  // On force la main : horodatage futur, filigrane dépassé. Seul le registre
  // des one-shot peut encore tenir.
  S.convocations[0].responses.pA.at = Date.now() + 600000;
  ok(!ctx.notifFeed().some(i => i.id === RSVP_ID), 'le registre n\'a pas tenu');
});
t('un NOUVEAU désistement, lui, remonte bien (pas de sur-blocage)', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  ctx.markAllNotifsRead();
  // Celia se désiste à son tour : id différent → doit sonner. Horodatage
  // franchement postérieur au filigrane (le "tout marquer lu" vient de poser
  // Date.now() : un événement de la MÊME milliseconde compte comme déjà vu).
  applyRows([row(T0), Object.assign(row(Date.now() + 5000), { player_id: 'pB' })]);
  const fresh = ctx.notifFeed().filter(i => String(i.id).startsWith('rsvp-'));
  ok(fresh.length === 1, 'attendu 1 nouveau désistement, reçu ' + fresh.length);
  ok(fresh[0].id.includes('pB'), 'mauvais désistement remonté : ' + fresh[0].id);
});
t('un RETOUR de présence après un désistement lu remonte (statut dans l\'id)', () => {
  seed(); applyRows([row(T0)]);
  ctx.setNotifSeenAt(T0 - 1000);
  ctx.markAllNotifsRead();
  applyRows([row(Date.now() + 5000, { status: 'present', reason: null })]);
  ok(ctx.notifFeed().some(i => i.id.endsWith('-present')), 'le retour de présence est resté muet');
});
t('les items INFORMATIONNELS ne sont pas verrouillés (ils doivent resonner)', () => {
  // Une convoc modifiée doit pouvoir resonner : son id ne change pas, seul son
  // ts bouge. L'y mettre en one-shot l'aurait éteinte pour toujours.
  seed();
  const cv = ctx.notifFeed({ showRead: true }).find(i => String(i.id).startsWith('cv-'));
  ok(!cv || cv.oneShot === false, 'une convocation ne doit pas être one-shot');
});
t('le registre est borné (pas de croissance sans fin en localStorage)', () => {
  seed();
  const many = Array.from({ length: 600 }, (_, i) => 'rsvp-fake-' + i);
  ctx.addNotifReadIds(many);
  ok(ctx.getNotifReadIds().length <= 400, 'registre non borné : ' + ctx.getNotifReadIds().length);
  ok(ctx.getNotifReadIds()[0] === 'rsvp-fake-0', 'les plus récents doivent être gardés');
});
t('le registre est cloisonné par identité', () => {
  seed();
  ctx.addNotifReadIds(['rsvp-coach-only']);
  S.auth = { role: 'player', playerId: 'pA' };
  ok(!ctx.getNotifReadIds().includes('rsvp-coach-only'), 'fuite du registre entre identités');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.getNotifReadIds().includes('rsvp-coach-only'), 'registre perdu au retour sur l\'identité');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
