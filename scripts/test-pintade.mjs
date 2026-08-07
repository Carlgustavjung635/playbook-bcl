// Test LA PINTADE DU MOIS (cf. migration 20260807_001_pintade_and_notif_permission).
//
// Une joueuse porte une peluche géante. N'importe qui peut lui réclamer une
// preuve photo ; elle a 30 secondes, appareil photo obligatoire.
//
// CHOIX STRUCTURANTS verrouillés ici — ce sont eux qui cassent en silence :
//   • RIEN n'est compté en base. Ratés consécutifs, date de fin effective et
//     prochaine fenêtre de demande se DÉRIVENT des demandes de preuve. Une
//     prolongation écrite par « le client qui constate » serait appliquée
//     autant de fois qu'il y a d'appareils ;
//   • une demande dont le délai est écoulé est un raté POUR TOUT LE MONDE,
//     immédiatement, sans qu'aucune écriture n'ait eu lieu — sinon il suffirait
//     de ne pas ouvrir l'app pour ne jamais rater ;
//   • le rate limit est GLOBAL à la porteuse, pas par demandeur ;
//   • au-delà du plafond de ratés consécutifs, plus AUCUNE sanction
//     automatique : le système attend l'arbitrage du coach ;
//   • cet arbitrage éteint l'alerte, mais un raté PLUS RÉCENT la rallume ;
//   • un transfert clôt la garde précédente sans la détruire, et la nouvelle
//     porteuse n'hérite PAS de la série de ratés de l'ancienne ;
//   • la porteuse ne peut pas se demander une preuve à elle-même ;
//   • suppression = soft-delete (un hard delete d'un id 'x…' est repoussé).
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\n;globalThis.PINTADE_RULES_DEFAULT = PINTADE_RULES_DEFAULT;';

// Le bloc <script type="module"> (client Supabase, ENTITIES, PbSync) est chargé
// À PART, après le bloc classique : c'est là que vivent le dump/apply des
// entités, et les tester pour de vrai vaut mieux que les réécrire dans le test.
// Seul l'import ESM est retiré (createClient est stubé côté ctx).
const moduleBlock = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && /type\s*=\s*["']module["']/.test(m[1]))
  .map(m => m[2])[0]
  .replace(/^\s*import\s[^\n]*\n/m, '')
  + '\n;globalThis.ENTITIES = ENTITIES;';

const store = {};
const fields = {};
const els = {};                        // éléments adressables par id (innerHTML persistant)
let openPopup = false;
const mkEl = (id) => ({ id: id || '', style: {}, className: '', innerHTML: '', textContent: '', value: '',
  checked: false, disabled: false, files: [],
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const el = (id) => (els[id] || (els[id] = mkEl(id)));
const doc = {
  getElementById: (id) => {
    if (id === 'modal-root') return null;
    if (id in fields) return { value: fields[id], textContent: '', checked: !!fields[id] };
    if (id === 'pintade-overlay') return el(id);
    return mkEl(id);
  },
  createElement: () => mkEl(),
  querySelector: (sel) => (openPopup && /modal|gage|pintade/.test(sel) ? mkEl() : null),
  querySelectorAll: () => [],
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
// Client Supabase stubé : chaînable et muet. Aucun test ici ne parle au réseau.
const sbStub = () => {
  const q = new Proxy({}, { get: (o, k) => (k === 'then' ? undefined : () => q) });
  return {
    from: () => q, storage: { from: () => q }, channel: () => ({ on: () => ({ on: () => ({ subscribe() {} }), subscribe() {} }), subscribe() {} }),
    removeChannel() {}, auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }
  };
};
ctx.createClient = sbStub;
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try { vm.runInContext(code, ctx, { filename: 'index.inline.js' }); }
catch (e) { console.log('✗ ÉVALUATION: ' + e.message); process.exit(1); }
try { vm.runInContext(moduleBlock, ctx, { filename: 'index.module.js' }); }
catch (e) { console.log('✗ ÉVALUATION MODULE: ' + e.message); process.exit(1); }

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

const S = ctx.state;
ctx.render = () => {}; ctx.showToast = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = null; };
const pushes = [];
ctx.notifyPush = (keys, payload) => { pushes.push({ keys, payload }); };

// --- horloge maîtrisée -------------------------------------------------------
const RealDate = Date;
let NOW = RealDate.parse('2026-08-10T10:00:00Z');
class D extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
ctx.Date = D;
const advance = ms => { NOW += ms; };
const H = 3600000;

function seed(role, pid) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(els)) delete els[k];
  pushes.length = 0; openPopup = false; ctx.__lastModal = null;
  // L'overlay est un état de SESSION (window), pas de state : sans ce reset il
  // traverserait les scénarios — exactement le piège que doLogout doit éviter.
  try { ctx._pintadeCloseOverlay(); } catch (e) {}
  ctx._pintadeWatch = null;
  NOW = RealDate.parse('2026-08-10T10:00:00Z');
  S.auth = (role === 'coach') ? { role: 'coach', coachId: 'admin' } : { role: 'player', playerId: pid || 'pA' };
  S.coaches = [{ id: 'admin', name: 'Sonia', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.currentSeasonId = '2026-2027';
  S.players = [
    { id: 'pA', name: 'Emma Petit', num: 14 },
    { id: 'pB', name: 'Lea Dubois', num: 7 },
    { id: 'pC', name: 'Nina Roux', num: 5 },
  ];
  S.seasonPlayers = ['pA', 'pB', 'pC'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.pintadeRules = null;
  S.pintadeHolders = []; S.pintadeRequests = []; S.pintadeIncidents = [];
  S.convocations = []; S.matches = []; S.gages = []; S.gageDraws = [];
  S.playerLicences = []; S.playerUnavailabilities = []; S.birthdayMessages = [];
  S.trainingCompletions = []; S.trainingPrograms = []; S.trainingPlans = [];
  S.plays = []; S.challenges = []; S.broadcasts = [];
}
// Lance une garde en se faisant passer pour le coach, puis rend la main au rôle voulu.
function startGarde(holderId, days, thenRole, thenPid) {
  const prev = S.auth;
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.pintadeAssign(holderId, days || 30, {});
  S.auth = (thenRole === 'coach') ? { role: 'coach', coachId: 'admin' } : (thenRole ? { role: 'player', playerId: thenPid } : prev);
  return ctx.pintadeActivePeriod();
}
// Une demande de preuve depuis l'identité courante, puis on la résout.
function demande() { return ctx.requestPintadeProof(); }
function lastReq() { const l = S.pintadeRequests.filter(q => !q.deletedAt); return l[l.length - 1]; }
// Réussite : on simule ce que fait submitPintadeProof après un upload OK.
function reussite(q) { q.photoUrl = 'https://cdn/x.jpg'; q.status = 'ok'; q.resolvedAt = NOW; q.updatedAt = NOW; }
// Raté : on laisse simplement filer le chrono (AUCUNE écriture — c'est le test).
function laisseFiler() { advance(60000); }

// =============================================================================
// 1) LE RATE LIMIT EST GLOBAL À LA PORTEUSE
// =============================================================================
t('une demande ouvre une fenêtre de 2 h — même pour un AUTRE demandeur', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  ok(ctx.pintadeCanRequest(), 'premier créneau fermé : ' + ctx.pintadeRequestBlockedReason());
  ok(demande(), 'demande refusée');
  ok(!ctx.pintadeCanRequest(), 'seconde demande acceptée dans la foulée');
  // Changement de demandeuse : la fenêtre doit RESTER fermée (sinon la porteuse
  // serait bombardée par onze personnes à la suite).
  S.auth = { role: 'player', playerId: 'pC' };
  ok(!ctx.pintadeCanRequest(), 'une autre joueuse contourne le rate limit');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(!ctx.pintadeCanRequest(), 'le coach contourne le rate limit');
  ok(ctx.pintadeNextSlotAt(p.id) === lastReq().requestedAt + 2 * H, 'créneau suivant mal calculé');
  // Une fois le chrono retombé, ce n'est plus « demande en cours » qui bloque
  // mais bien le rate limit — et la raison affichée doit le dire.
  laisseFiler();
  ok(!ctx.pintadeCanRequest(), 'la fenêtre s\'est rouverte dès la fin du chrono');
  ok(/dans .*(min|h)/.test(ctx.pintadeRequestBlockedReason()), 'raison illisible : ' + ctx.pintadeRequestBlockedReason());
});
t('la fenêtre se rouvre pile après le rate limit', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  laisseFiler();                       // le chrono expire, la demande devient un raté
  advance(2 * H - 60000 - 1000);
  ok(!ctx.pintadeCanRequest(), 'rouvert une seconde trop tôt');
  advance(2000);
  ok(ctx.pintadeCanRequest(), 'toujours fermé après 2 h : ' + ctx.pintadeRequestBlockedReason());
});
t('la porteuse ne peut pas se piéger elle-même', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pA');
  ok(!ctx.pintadeCanRequest(), 'la porteuse peut se demander une preuve');
  ok(/toi/i.test(ctx.pintadeRequestBlockedReason()), ctx.pintadeRequestBlockedReason());
});
t('une demande déjà en cours en bloque une seconde', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  ok(/déjà en cours/.test(ctx.pintadeRequestBlockedReason()), ctx.pintadeRequestBlockedReason());
});

// =============================================================================
// 2) LE CHRONO — ET L'ANTI-TRICHE « JE N'OUVRE PAS L'APP »
// =============================================================================
t('le délai est figé À LA DEMANDE (30 s par défaut)', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  ok(q.deadlineAt - q.requestedAt === 30000, 'délai = ' + (q.deadlineAt - q.requestedAt));
  // Le coach durcit la règle pendant que le chrono tourne : la demande déjà
  // partie garde le contrat annoncé à la porteuse.
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { proofTimeoutSeconds: 10, updatedAt: NOW });
  ok(lastReq().deadlineAt - lastReq().requestedAt === 30000, 'délai réécrit rétroactivement');
});
t('délai écoulé = RATÉ pour tout le monde, SANS la moindre écriture', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  const before = JSON.stringify(S.pintadeRequests);
  laisseFiler();
  ok(q.status === 'pending', 'le test triche : la ligne a été modifiée');
  ok(JSON.stringify(S.pintadeRequests) === before, 'une écriture a eu lieu');
  ok(ctx._pintadeStatus(q) === 'expired', 'statut effectif = ' + ctx._pintadeStatus(q));
  ok(ctx.pintadeFailTotal(p.id) === 1, 'raté non compté');
  ok(ctx.pintadeStreak(p.id) === 1, 'série non incrémentée');
  ok(ctx.pintadeActiveRequest(p.id) === null, 'la demande périmée passe encore pour active');
});
t('le rangement en base est opportuniste et idempotent', () => {
  seed('player', 'pA');                        // la PORTEUSE constate
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  laisseFiler();
  ok(ctx._pintadePersistStale(), 'rien rangé');
  ok(lastReq().status === 'failed', 'la porteuse devrait poser « failed », a posé ' + lastReq().status);
  ok(ctx._pintadePersistStale() === false, 'second passage : écrit à nouveau');
  ok(ctx.pintadeFailTotal(p.id) === 1, 'le raté a été compté deux fois');
});
t('un TIERS qui constate pose « expired » — même conséquence', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande(); laisseFiler();
  ctx._pintadePersistStale();
  ok(lastReq().status === 'expired', lastReq().status);
  ok(ctx.pintadeFailTotal(p.id) === 1, 'raté non compté');
});

// =============================================================================
// 3) LES SANCTIONS SONT DÉRIVÉES — DONC IDEMPOTENTES
// =============================================================================
// Enchaîne n ratés (en respectant le rate limit), depuis pB.
function nRates(n) {
  for (let i = 0; i < n; i++) { demande(); laisseFiler(); advance(2 * H); }
}
t('chaque raté prolonge la garde de 24 h', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  ok(ctx.pintadePeriodEnd(p) === base, 'fin de base déjà décalée');
  nRates(1);
  ok(ctx.pintadePeriodEnd(p) === base + 24 * H, 'après 1 raté : ' + (ctx.pintadePeriodEnd(p) - base) / H + ' h');
  nRates(1);
  ok(ctx.pintadePeriodEnd(p) === base + 48 * H, 'après 2 ratés');
});
t('recalculer dix fois ne prolonge pas dix fois (idempotence)', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  nRates(2);
  const vals = [];
  for (let i = 0; i < 10; i++) vals.push(ctx.pintadePeriodEnd(p));
  ok(new Set(vals).size === 1, 'la fin bouge à chaque lecture : ' + vals.join(','));
  ok(vals[0] === base + 48 * H, 'valeur = ' + (vals[0] - base) / H + ' h');
});
t('une réussite remet la SÉRIE à zéro, sans effacer les prolongations acquises', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  nRates(2);
  demande(); reussite(lastReq()); advance(2 * H);
  ok(ctx.pintadeStreak(p.id) === 0, 'série = ' + ctx.pintadeStreak(p.id));
  ok(ctx.pintadePeriodEnd(p) === base + 48 * H, 'les 48 h acquises ont sauté');
  ok(ctx.pintadeOkTotal(p.id) === 1 && ctx.pintadeFailTotal(p.id) === 2, 'compteurs faux');
});
t('AU-DELÀ DU PLAFOND, plus aucune sanction automatique', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  nRates(3);
  ok(ctx.pintadeStreak(p.id) === 3, 'série = ' + ctx.pintadeStreak(p.id));
  ok(ctx.pintadePeriodEnd(p) === base + 72 * H, '3 ratés → ' + (ctx.pintadePeriodEnd(p) - base) / H + ' h');
  nRates(2);                                    // 4e et 5e raté consécutifs
  ok(ctx.pintadeStreak(p.id) === 5, 'la série doit continuer à compter');
  ok(ctx.pintadePeriodEnd(p) === base + 72 * H, 'la peine a continué à grossir toute seule');
});
t('interrupteur « prolongation » coupé → aucune prolongation, la série compte quand même', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { sanctionExtension: false, updatedAt: NOW });
  nRates(2);
  ok(ctx.pintadePeriodEnd(p) === base, 'prolongé alors que la sanction est coupée');
  ok(ctx.pintadeStreak(p.id) === 2, 'la série doit rester comptée');
});

// =============================================================================
// 4) L'ARBITRAGE DU COACH
// =============================================================================
t('l\'alerte s\'arme au plafond, et pas avant', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  nRates(2);
  ok(!ctx.pintadeAlertPending(p), 'alerte armée à 2 ratés');
  nRates(1);
  ok(ctx.pintadeAlertPending(p), 'alerte non armée à 3 ratés');
});
t('l\'arbitrage éteint l\'alerte — et elle ne se rallume pas au render suivant', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  nRates(3);
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.pintadeAddSanction('pompes samedi'), 'sanction refusée');
  ok(!ctx.pintadeAlertPending(p), 'alerte toujours armée après arbitrage');
  for (let i = 0; i < 5; i++) ok(!ctx.pintadeAlertPending(p), 'alerte rallumée à la lecture ' + i);
  const inc = S.pintadeIncidents[S.pintadeIncidents.length - 1];
  ok(inc.coachDecision === 'sanction_added' && inc.notes === 'pompes samedi', JSON.stringify(inc));
  ok(inc.streakCount === 3, 'série non tracée : ' + inc.streakCount);
});
t('un raté PLUS RÉCENT rallume l\'alerte', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  nRates(3);
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.pintadeAddSanction('');
  ok(!ctx.pintadeAlertPending(p), 'éteinte ?');
  S.auth = { role: 'player', playerId: 'pB' };
  nRates(1);
  ok(ctx.pintadeAlertPending(p), 'alerte muette sur un nouveau raté');
});
t('la prolongation cumulée du coach s\'AJOUTE aux prolongations automatiques', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  nRates(3);
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.pintadeExtend(24), 'prolongation refusée');
  ok(ctx.pintadePeriodEnd(p) === base + 96 * H, 'total = ' + (ctx.pintadePeriodEnd(p) - base) / H + ' h');
  ok(!ctx.pintadeAlertPending(p), 'l\'alerte devrait être éteinte par cet arbitrage');
});
t('libérer met fin à la garde, sans détruire l\'historique', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  ok(ctx.pintadeRelease('release'), 'libération refusée');
  ok(ctx.pintadeActivePeriod() === null, 'garde encore active');
  ok(S.pintadeHolders.length === 1 && !S.pintadeHolders[0].deletedAt, 'la ligne a été supprimée');
  ok(S.pintadeHolders[0].ended === true, 'ended non posé');
});
t('une joueuse ne peut ni libérer ni transférer', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  ok(ctx.pintadeRelease('release') === false, 'une joueuse a pu libérer');
  ok(ctx.pintadeExtend(24) === false, 'une joueuse a pu prolonger');
  ok(ctx.pintadeAssign('pC', 30, { transfer: true }) === false, 'une joueuse a pu transférer');
  ok(ctx.pintadeActivePeriod().holderId === 'pA', 'la porteuse a changé');
});

// =============================================================================
// 5) LE TRANSFERT
// =============================================================================
t('un transfert clôt l\'ancienne garde, en ouvre une neuve, garde le lien', () => {
  seed('player', 'pB');
  const old = startGarde('pA', 30, 'player', 'pB');
  nRates(2);
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.pintadeAssign('pC', 15, { transfer: true, notes: 'ras-le-bol' }), 'transfert refusé');
  const cur = ctx.pintadeActivePeriod();
  ok(cur && cur.holderId === 'pC', 'nouvelle porteuse = ' + (cur && cur.holderId));
  ok(cur.transferredFromId === 'pA', 'lien de transfert perdu');
  ok(S.pintadeHolders.length === 2, 'historique perdu : ' + S.pintadeHolders.length);
  ok(S.pintadeHolders.find(h => h.id === old.id).ended === true, 'ancienne garde pas close');
  ok(Math.round((cur.endAt - cur.startAt) / 86400000) === 15, 'durée = ' + (cur.endAt - cur.startAt) / 86400000);
});
t('la nouvelle porteuse n\'hérite PAS de la série de ratés de l\'ancienne', () => {
  seed('player', 'pB');
  const old = startGarde('pA', 30, 'player', 'pB');
  nRates(3);
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.pintadeAssign('pC', 15, { transfer: true });
  const cur = ctx.pintadeActivePeriod();
  ok(ctx.pintadeStreak(cur.id) === 0, 'série héritée : ' + ctx.pintadeStreak(cur.id));
  ok(ctx.pintadeFailTotal(cur.id) === 0, 'ratés hérités');
  ok(ctx.pintadePeriodEnd(cur) === cur.endAt, 'prolongations héritées');
  ok(!ctx.pintadeAlertPending(cur), 'alerte héritée');
  ok(ctx.pintadeFailTotal(old.id) === 3, 'l\'historique de l\'ancienne garde a été perdu');
});
t('assigner sans transfert ne laisse jamais DEUX gardes actives', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  ctx.pintadeAssign('pB', 30, {});
  const actives = S.pintadeHolders.filter(h => !h.ended && !h.deletedAt && ctx.pintadePeriodEnd(h) > NOW);
  ok(actives.length === 1, actives.length + ' gardes actives');
  ok(ctx.pintadeActivePeriod().holderId === 'pB', 'mauvaise porteuse');
});
t('une garde arrivée à son terme s\'éteint toute seule, sans écriture', () => {
  seed('coach');
  const p = startGarde('pA', 1, 'coach');
  const before = JSON.stringify(S.pintadeHolders);
  advance(25 * H);
  ok(ctx.pintadeActivePeriod() === null, 'garde encore active après échéance');
  ok(JSON.stringify(S.pintadeHolders) === before, 'une écriture a eu lieu');
  ok(p.ended === false, 'ended posé alors que la garde est simplement arrivée au bout');
});

// =============================================================================
// 6) LES DOUBLONS DE DEMANDES (deux appareils, même fenêtre)
// =============================================================================
t('deux demandes concurrentes → UNE survivante déterministe, les autres soft-deletées', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const mk = id => ({ id, periodId: p.id, holderId: 'pA', requesterId: 'pB', requesterLabel: 'x',
    requestedAt: NOW, deadlineAt: NOW + 30000, photoUrl: '', status: 'pending', resolvedAt: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null });
  S.pintadeRequests.push(mk('x2'), mk('x1'));      // insérées dans le désordre
  ok(ctx.pintadeActiveRequest(p.id).id === 'x1', 'survivante non déterministe');
  ctx._pintadePersistStale();
  const dead = S.pintadeRequests.filter(q => q.deletedAt);
  ok(dead.length === 1 && dead[0].id === 'x2', 'doublon mal résolu : ' + JSON.stringify(dead.map(d => d.id)));
  ok(S.pintadeRequests.length === 2, 'une ligne a été DÉTRUITE au lieu d\'être soft-deletée');
  ok(ctx.pintadeFailTotal(p.id) === 0, 'un oubli unique a produit plusieurs ratés');
});

// =============================================================================
// 7) LE FEED
// =============================================================================
t('le feed porte le post de raté « 🕊 [Nom] a raté à HH:MM »', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  nRates(1);
  const row = ctx._pintadeFeedRow(ctx.pintadeRequestsOf(p.id)[0]);
  ok(/a raté à \d{2}:\d{2}/.test(row), 'format du post : ' + row.slice(0, 200));
  ok(/Emma Petit/.test(row), 'le nom de la porteuse manque');
  ok(/Lea Dubois/.test(row), 'le nom de la demandeuse manque');
});
t('le feed montre la photo des preuves réussies', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande(); reussite(lastReq());
  const row = ctx._pintadeFeedRow(ctx.pintadeRequestsOf(p.id)[0]);
  ok(/https:\/\/cdn\/x\.jpg/.test(row), 'photo absente');
  ok(/validée/i.test(row), 'libellé de réussite absent');
});
t('le libellé du demandeur est FIGÉ (un renommage ne casse pas le feed)', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.players.find(x => x.id === 'pB').name = 'Autre Nom';
  ok(/Lea Dubois/.test(ctx._pintadeFeedRow(ctx.pintadeRequestsOf(p.id)[0])), 'libellé recalculé après coup');
});
t('feed privé : masqué aux joueuses, visible du coach', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  nRates(1);
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { feedPublic: false, updatedAt: NOW });
  ctx.openPintadeScreen();
  ok(/privé/i.test(ctx.__lastModal), 'feed exposé à une joueuse');
  ok(!/a raté à/.test(ctx.__lastModal), 'le raté fuite malgré le feed privé');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openPintadeScreen();
  ok(/a raté à/.test(ctx.__lastModal), 'le coach ne voit plus le feed');
});

// =============================================================================
// 8) L'ÉCRAN DE PREUVE (porteuse)
// =============================================================================
t('l\'écran bloquant ne s\'ouvre QUE pour la porteuse, et seulement s\'il y a une demande', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  ok(ctx.maybeShowPintadeProof() === false, 'ouvert pour une non-porteuse');
  demande();
  ok(ctx.maybeShowPintadeProof() === false, 'ouvert chez la demandeuse');
  S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.maybeShowPintadeProof() === true, 'pas ouvert chez la porteuse');
  const h = els['pintade-overlay'].innerHTML;
  ok(/capture="environment"/.test(h), 'la galerie n\'est pas interdite (capture absent)');
  ok(/accept="image\/\*"/.test(h), 'accept image absent');
  ok(!/modal-close/.test(h), 'un bouton de fermeture est présent : l\'écran doit être bloquant');
  ok(/Lea Dubois/.test(h), 'la demandeuse n\'est pas nommée');
  ok(/30<\/div>/.test(h) || /">30</.test(h), 'le décompte ne part pas de 30 : ' + h.slice(0, 400));
});
t('le décompte se lit sur l\'horloge absolue (app en arrière-plan)', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  advance(18000);                      // 18 s passées, écran verrouillé
  ok(Math.ceil(ctx._pintadeRemainingMs() / 1000) === 12, 'reste ' + ctx._pintadeRemainingMs() + ' ms');
  advance(20000);
  ok(ctx._pintadeRemainingMs() === 0, 'le chrono ne peut pas être négatif');
});
t('une demande arrivée alors que l\'app est ouverte finit par s\'afficher (veilleur)', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.maybeShowPintadeProof() === false, 'ouvert sans demande');
  S.auth = { role: 'player', playerId: 'pB' }; demande();
  S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.maybeShowPintadeProof() === true, 'le veilleur n\'ouvrirait pas l\'écran');
});

// =============================================================================
// 9) LES PUSH (un chrono de 30 s sans push est injouable)
// =============================================================================
t('la demande pousse une notification à la porteuse', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  pushes.length = 0;
  demande();
  const p = pushes.find(x => (x.payload || {}).type === 'pintade_proof');
  ok(p, 'aucun push de demande');
  ok(p.keys.includes('player:pA'), 'mauvaise destinataire : ' + JSON.stringify(p.keys));
  ok(/30 secondes/.test(p.payload.body), p.payload.body);
});
t('l\'assignation prévient la nouvelle porteuse', () => {
  seed('coach');
  pushes.length = 0;
  startGarde('pA', 30, 'coach');
  const p = pushes.find(x => (x.payload || {}).type === 'pintade_assign');
  ok(p && p.keys.includes('player:pA'), JSON.stringify(pushes));
});

// =============================================================================
// 10) LES RÈGLES (écran coach)
// =============================================================================
t('les défauts s\'appliquent tant que rien n\'a été réglé', () => {
  seed('coach');
  const r = ctx.pintadeRules();
  ok(r.rateLimitHours === 2 && r.proofTimeoutSeconds === 30 && r.extensionHoursPerFail === 24 && r.maxConsecutiveFails === 3,
    JSON.stringify(r));
  ok(S.pintadeRules === null, 'des défauts front ont été matérialisés (ils écraseraient le serveur)');
});
t('les réglages sont bornés à l\'enregistrement', () => {
  seed('coach');
  fields['pr-days'] = '9999'; fields['pr-rate'] = '0'; fields['pr-timeout'] = '1';
  fields['pr-ext'] = '-5'; fields['pr-max'] = '99';
  fields['pr-s-feed'] = true; fields['pr-s-ext'] = true; fields['pr-s-alert'] = true; fields['pr-public'] = true;
  ctx._pintadeSaveRules();
  const r = ctx.pintadeRules();
  ok(r.defaultDurationDays === 365, 'jours = ' + r.defaultDurationDays);
  ok(r.rateLimitHours === 1, 'rate limit = ' + r.rateLimitHours);
  ok(r.proofTimeoutSeconds === 10, 'timeout = ' + r.proofTimeoutSeconds);
  ok(r.extensionHoursPerFail === 0, 'extension = ' + r.extensionHoursPerFail);
  ok(r.maxConsecutiveFails === 10, 'plafond = ' + r.maxConsecutiveFails);
});
t('une joueuse ne peut pas modifier les règles', () => {
  seed('player', 'pB');
  fields['pr-rate'] = '1';
  ctx._pintadeSaveRules();
  ok(S.pintadeRules === null, 'une joueuse a écrit les règles');
});
t('l\'écran des règles se rend et l\'accueil coach reste debout', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  ctx.openPintadeRules();
  ok(/Règles de la pintade/.test(ctx.__lastModal), 'écran des règles vide');
  ctx.openPintadeAdmin();
  ok(/Gérer la pintade/.test(ctx.__lastModal) && /Emma Petit/.test(ctx.__lastModal), 'écran admin incomplet');
  const home = ctx.renderPintadeHomeCard();
  ok(/Emma Petit/.test(home), 'carte accueil sans porteuse');
});
t('la carte d\'accueil reste MUETTE pour une joueuse quand personne ne la porte', () => {
  seed('player', 'pB');
  ok(ctx.renderPintadeHomeCard() === '', 'carte affichée dans le vide');
  seed('coach');
  ok(/désigne une joueuse/i.test(ctx.renderPintadeHomeCard()), 'le coach devrait être invité à lancer le jeu');
});

// =============================================================================
// 11) LA SYNCHRO (entités PbSync)
// =============================================================================
t('les quatre entités PbSync existent et savent faire l\'aller-retour', () => {
  seed('coach');
  const keys = ctx.ENTITIES.map(e => e.key);
  ['pintadeRules', 'pintadeHolders', 'pintadeRequests', 'pintadeIncidents']
    .forEach(k => ok(keys.includes(k), 'entité manquante : ' + k));
  const p = startGarde('pA', 30, 'coach');
  S.auth = { role: 'player', playerId: 'pB' }; demande();
  const ent = k => ctx.ENTITIES.find(e => e.key === k);
  const hRow = Object.values(ent('pintadeHolders').dump(S))[0];
  ok(hRow.holder_id === 'pA' && typeof hRow.start_at === 'string' && hRow.deleted_at === null, JSON.stringify(hRow));
  const qRow = Object.values(ent('pintadeRequests').dump(S))[0];
  ok(qRow.status === 'pending' && qRow.period_id === p.id, JSON.stringify(qRow));
  // Aller-retour : ce qui sort de la base doit redonner le même objet.
  const back = { ...S };
  ent('pintadeHolders').apply(back, [hRow]);
  ok(back.pintadeHolders[0].holderId === 'pA' && back.pintadeHolders[0].endAt === p.endAt, JSON.stringify(back.pintadeHolders[0]));
});
t('tant que le coach n\'a rien réglé, AUCUNE ligne de règles n\'est poussée', () => {
  seed('coach');
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRules');
  ok(Object.keys(ent.dump(S)).length === 0, 'des défauts front seraient poussés sur le serveur');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { rateLimitHours: 6, updatedAt: NOW });
  const row = ent.dump(S)['default'];
  ok(row && row.id === 'default' && row.rate_limit_hours === 6, JSON.stringify(row));
});
t('last-writer-wins : un écho realtime ne ramène pas une preuve à « pending »', () => {
  seed('player', 'pA');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  const stale = ent.dump(S)[q.id];                       // photo de l'état « pending »
  reussite(q); q.updatedAt = NOW + 1000;                 // la porteuse envoie sa photo
  ent.apply(S, [stale]);                                 // l'écho arrive APRÈS
  ok(S.pintadeRequests.find(x => x.id === q.id).status === 'ok', 'la preuve a été annulée par un écho');
});
t('anti-wipe : une demande locale pas encore synchronisée survit à un apply', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  ent.apply(S, []);                                      // le serveur ne la connaît pas encore
  ok(S.pintadeRequests.length === 1, 'la demande locale a été effacée');
});

// =============================================================================
// 12) CLOISONNEMENT SAISON
// =============================================================================
t('une garde d\'une autre saison n\'est jamais la garde active', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  ok(ctx.pintadeActivePeriod() !== null, 'garde de la saison courante ignorée');
  p.seasonId = '2025-2026';
  ok(ctx.pintadeActivePeriod() === null, 'garde d\'une saison passée encore active');
});

console.log('\n' + R.join('\n'));
const bad = R.filter(r => r.startsWith('✗'));
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' OK');
process.exit(bad.length ? 1 : 0);
