// Test LA PINTADE DU MOIS — modèle à DEUX CHRONOS (migrations 20260807_001 + _002).
//
// Une joueuse porte une peluche géante. N'importe qui peut lui réclamer une
// preuve photo. Deux fenêtres s'enchaînent :
//   1. CONNEXION (2 h) — elle doit OUVRIR L'APP ;
//   2. PHOTO (30 s)    — le chrono démarre quand l'écran s'affiche chez elle.
//
// La v.106 comptait les 30 s depuis la DEMANDE : une demande de nuit était
// perdue avant qu'elle n'ouvre les yeux. Le premier bloc de ce fichier
// verrouille précisément ce correctif.
//
// CHOIX STRUCTURANTS verrouillés ici — ce sont eux qui cassent en silence :
//   • RIEN n'est compté en base. Ratés consécutifs, fin de garde effective et
//     prochaine fenêtre de demande se DÉRIVENT des demandes de preuve. Une
//     prolongation écrite par « le client qui constate » serait appliquée
//     autant de fois qu'il y a d'appareils ;
//   •  est posé UNE SEULE FOIS. Sinon il suffirait de tuer l'app à
//     la 25e seconde et de la rouvrir pour repartir de 30 : le chrono ne se
//     terminerait jamais et la preuve ne vaudrait plus rien ;
//   • seule la PORTEUSE pose ce tampon — jamais le coach, jamais une autre
//     joueuse qui ouvre son app au même moment ;
//   • une échéance dépassée est un échec POUR TOUT LE MONDE, immédiatement,
//     sans qu'aucune écriture n'ait eu lieu — sinon il suffirait de ne pas
//     ouvrir l'app pour ne jamais rater ;
//   • DEUX échecs distincts, et deux tons distincts :  peut
//     arriver honnêtement (la nuit, un tunnel),  non. Les deux
//     comptent pour la série ;
//   • le rate limit est GLOBAL à la porteuse, pas par demandeur ;
//   • au-delà du plafond de ratés consécutifs, plus AUCUNE sanction
//     automatique : le système attend l'arbitrage du coach ;
//   • cet arbitrage éteint l'alerte, mais un raté PLUS RÉCENT la rallume ;
//   • un transfert clôt la garde précédente sans la détruire, et la nouvelle
//     porteuse n'hérite PAS de la série de ratés de l'ancienne ;
//   • les données v.106 (base ET localStorage) se relisent sans inventer de raté.
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

// =============================================================================
// -1) LA FRONTIÈRE DES BLOCS <script>
// =============================================================================
// CE TEST EXISTE À CAUSE D'UN VRAI BUG, attrapé en navigateur et pas ici :
// `_pintadeStatus` (bloc classique) appelait `_pintadeNormStatus` défini dans le
// bloc <script type="module">. Les deux blocs ne partagent AUCUNE portée à
// l'exécution — l'app plantait dès le premier rendu de l'écran pintade.
//
// Le harnais de ces tests concatène tous les blocs dans une seule portée : il
// est structurellement incapable de voir ce genre d'erreur. D'où cette
// vérification STATIQUE, faite sur le texte du fichier : tout helper pintade
// appelé depuis le bloc module doit être défini DANS le bloc module.
{
  const blocs = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/\bsrc=/.test(m[1]));
  // On retire les COMMENTAIRES DE LIGNE, et rien d'autre : sans ça, « la
  // pintade (cf. migration…) » dans un commentaire français passerait pour un
  // appel de fonction. Volontairement minimal — une première version retirait
  // aussi les blocs /* */ et les chaînes, et un `/*` isolé dans une chaîne
  // avalait des pans entiers de fichier, définitions comprises. Le `\s` avant
  // `//` épargne les `https://`.
  const codeOnly = src => src
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/[ \t]+\/\/[^\n]*$/gm, '');
  const moduleSrc = codeOnly(blocs.filter(m => /type\s*=\s*["']module["']/.test(m[1])).map(m => m[2]).join('\n'));
  const classicSrc = codeOnly(blocs.filter(m => !/type\s*=\s*["']module["']/.test(m[1])).map(m => m[2]).join('\n'));
  const defs = src => new Set([...src.matchAll(/function\s+(_?[A-Za-z0-9_$]*[Pp]intade[A-Za-z0-9_$]*)\s*\(/g)].map(m => m[1]));
  // PAS d'espace toléré avant la parenthèse : un appel s'écrit `foo(`, alors
  // que la prose des libellés dit « la pintade (transfert, libération) ».
  const calls = src => new Set([...src.matchAll(/\b(_?[A-Za-z0-9_$]*[Pp]intade[A-Za-z0-9_$]*)\(/g)].map(m => m[1]));
  const modDefs = defs(moduleSrc), classicDefs = defs(classicSrc);
  t('aucun helper pintade du bloc module n\'appelle le bloc classique', () => {
    const fuites = [...calls(moduleSrc)].filter(n => !modDefs.has(n));
    ok(fuites.length === 0, 'appels hors portée depuis le bloc module : ' + fuites.join(', '));
  });
  t('aucun helper pintade du bloc classique n\'appelle le bloc module', () => {
    const fuites = [...calls(classicSrc)].filter(n => !classicDefs.has(n));
    ok(fuites.length === 0, 'appels hors portée depuis le bloc classique : ' + fuites.join(', '));
  });
}

// --- HELPERS DU PARCOURS À DEUX CHRONOS -------------------------------------
function demande() { return ctx.requestPintadeProof(); }
function lastReq() { const l = S.pintadeRequests.filter(q => !q.deletedAt); return l[l.length - 1]; }
// La porteuse OUVRE l'app : c'est cet instant, et lui seul, qui arme les 30 s.
function ouvrir(q) { return ctx._pintadeMarkOpened(q || ctx.pintadeActiveRequest()); }
// Réussite : on simule ce que fait submitPintadeProof après un upload OK.
function reussite(q) { q.photoUrl = 'https://cdn/x.jpg'; q.status = 'ok'; q.resolvedAt = NOW; q.updatedAt = NOW; }
// Les DEUX façons de rater, chacune laissant le créneau de demande rouvert
// derrière elle (pour pouvoir en enchaîner plusieurs).
function ratePasVue()  { demande(); advance(2 * H + 60000); }                    // jamais ouverte
function rateTropLente() { demande(); ouvrir(); advance(31000); advance(2 * H); } // ouverte, chrono filé

// =============================================================================
// 0) LE BUG DE LA v.106 — LE JEU PUNISSAIT LE SOMMEIL
// =============================================================================
t('une demande de nuit n\'est PAS ratée : le chrono de la photo n\'a pas démarré', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();                                   // 3 h du matin, elle dort
  const q = lastReq();
  advance(90 * 60000);                         // 1 h 30 plus tard, elle se réveille
  ok(ctx._pintadeStatus(q) === 'pending', 'statut = ' + ctx._pintadeStatus(q));
  ok(ctx.pintadeFailTotal(p.id) === 0, 'un raté a été compté pendant son sommeil');
  ok(q.openedAt === null, 'le tampon d\'ouverture a été posé sans qu\'elle ouvre rien');
  ok(q.photoDeadlineAt === null, 'le chrono de la photo a démarré tout seul');
  // Elle ouvre l'app : LÀ seulement les 30 s démarrent.
  ok(ouvrir(q) === true, 'le tampon n\'a pas été posé à l\'ouverture');
  ok(ctx._pintadeStatus(q) === 'awaiting_photo', 'statut après ouverture = ' + ctx._pintadeStatus(q));
  ok(q.photoDeadlineAt - q.openedAt === 30000, 'chrono photo = ' + (q.photoDeadlineAt - q.openedAt));
});
t('les deux échéances sont indépendantes et figées à leur propre instant', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  ok(q.connectDeadlineAt - q.requestedAt === 2 * H, 'fenêtre connexion = ' + (q.connectDeadlineAt - q.requestedAt));
  advance(45 * 60000);
  const tOuv = NOW;
  ouvrir(q);
  ok(q.openedAt === tOuv, 'openedAt mal posé');
  ok(q.photoDeadlineAt === tOuv + 30000, 'le chrono photo ne part pas de l\'ouverture');
  ok(q.connectDeadlineAt === q.requestedAt + 2 * H, 'la fenêtre de connexion a bougé');
});

// =============================================================================
// 1) L'EXPLOIT À NE JAMAIS ROUVRIR : TUER L'APP POUR RELANCER LES 30 s
// =============================================================================
t('rouvrir l\'app NE REMET PAS le chrono à zéro', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  const q = ctx.pintadeActiveRequest();
  ouvrir(q);
  const echeance = q.photoDeadlineAt;
  advance(25000);                              // elle tue l'app à la 25e seconde
  ok(ouvrir(q) === false, 'un second tampon a été posé');
  ok(q.photoDeadlineAt === echeance, 'l\'échéance a été repoussée : le chrono serait infini');
  ok(Math.ceil(ctx._pintadeRemainingMs() / 1000) === 5, 'reste ' + ctx._pintadeRemainingMs() + ' ms');
  advance(6000);
  ok(ctx._pintadeStatus(q) === 'failed_timeout', 'statut = ' + ctx._pintadeStatus(q));
  ok(ouvrir(q) === false, 'une demande déjà ratée peut être rouverte');
});
t('passer par l\'écran bloquant pose le tampon UNE fois, pas à chaque affichage', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.maybeShowPintadeProof() === true, 'écran non ouvert');
  const q = ctx.pintadeActiveRequest();
  const echeance = q.photoDeadlineAt;
  ok(echeance > 0, 'le chrono n\'a pas démarré à l\'affichage');
  advance(10000);
  ctx._pintadeCloseOverlay();
  ok(ctx.maybeShowPintadeProof() === true, 'réouverture refusée');
  ok(q.photoDeadlineAt === echeance, 'le réaffichage a relancé le chrono');
});
t('ouvrir APRÈS la fenêtre de connexion ne rattrape rien', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  S.auth = { role: 'player', playerId: 'pA' };
  advance(2 * H + 60000);                      // elle ouvre trop tard
  ok(ctx._pintadeStatus(q) === 'failed_not_seen', ctx._pintadeStatus(q));
  ok(ouvrir(q) === false, 'un tampon a été posé sur une demande déjà perdue');
  ok(q.openedAt === null, 'openedAt posé après coup');
  ok(ctx.maybeShowPintadeProof() === false, 'l\'écran s\'ouvre sur une demande périmée');
});
t('un TIERS ne pose jamais le tampon d\'ouverture de la porteuse', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  // pB (la demandeuse) et le coach ouvrent l'app : rien ne doit démarrer.
  ok(ctx.maybeShowPintadeProof() === false, 'écran ouvert chez la demandeuse');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.maybeShowPintadeProof() === false, 'écran ouvert chez le coach');
  ok(q.openedAt === null, 'le chrono de la porteuse a démarré depuis un autre appareil');
  ok(ctx._pintadeStatus(q) === 'pending', ctx._pintadeStatus(q));
});

// =============================================================================
// 2) LES DEUX ÉCHECS — DÉRIVÉS, SANS ÉCRITURE
// =============================================================================
t('2 h sans ouvrir = failed_not_seen, constaté sans la moindre écriture', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  const before = JSON.stringify(S.pintadeRequests);
  advance(2 * H + 1000);
  ok(q.status === 'pending', 'le test triche : la ligne a été modifiée');
  ok(JSON.stringify(S.pintadeRequests) === before, 'une écriture a eu lieu');
  ok(ctx._pintadeStatus(q) === 'failed_not_seen', ctx._pintadeStatus(q));
  ok(ctx.pintadeFailTotal(p.id) === 1, 'raté non compté');
  ok(ctx.pintadeStreak(p.id) === 1, 'série non incrémentée');
  ok(ctx.pintadeActiveRequest(p.id) === null, 'la demande périmée passe encore pour vivante');
});
t('30 s après ouverture = failed_timeout, également sans écriture', () => {
  seed('player', 'pA');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  const q = ctx.pintadeActiveRequest();
  ouvrir(q);
  const before = JSON.stringify(S.pintadeRequests);
  advance(31000);
  ok(JSON.stringify(S.pintadeRequests) === before, 'une écriture a eu lieu');
  ok(ctx._pintadeStatus(q) === 'failed_timeout', ctx._pintadeStatus(q));
  ok(ctx.pintadeFailTotal(p.id) === 1, 'raté non compté');
});
t('les DEUX natures comptent pour la série et les prolongations', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  ratePasVue();
  S.auth = { role: 'player', playerId: 'pB' };
  rateTropLente();
  ok(ctx.pintadeStreak(p.id) === 2, 'série = ' + ctx.pintadeStreak(p.id));
  ok(ctx.pintadePeriodEnd(p) === base + 48 * H, 'prolongation = ' + (ctx.pintadePeriodEnd(p) - base) / H + ' h');
  ok(ctx.pintadeFailKind(p.id, 'failed_not_seen') === 1, 'ventilation pas-vue');
  ok(ctx.pintadeFailKind(p.id, 'failed_timeout') === 1, 'ventilation trop-lente');
});
t('le rangement en base pose le statut DÉRIVÉ, et il est idempotent', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  ratePasVue();
  ok(ctx._pintadePersistStale(), 'rien rangé');
  ok(lastReq().status === 'failed_not_seen', lastReq().status);
  ok(lastReq().resolvedAt === lastReq().connectDeadlineAt, 'le raté est daté de sa constatation, pas de son échéance');
  ok(ctx._pintadePersistStale() === false, 'second passage : écrit à nouveau');
  ok(ctx.pintadeFailTotal(p.id) === 1, 'le raté a été compté deux fois');
});
t('n\'importe quel appareil range le même statut (aucune course)', () => {
  seed('player', 'pA');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  ouvrir();
  advance(31000);
  // La porteuse range…
  ctx._pintadePersistStale();
  const parLaPorteuse = lastReq().status;
  // …puis on rejoue depuis le coach : le statut ne doit pas changer de nature.
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx._pintadePersistStale();
  ok(lastReq().status === parLaPorteuse, 'deux appareils écrivent deux statuts différents');
  ok(parLaPorteuse === 'failed_timeout', parLaPorteuse);
});

// =============================================================================
// 3) LE RATE LIMIT (inchangé, mais il ne doit pas avoir été cassé)
// =============================================================================
t('une demande ouvre une fenêtre de 2 h — même pour un AUTRE demandeur', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  ok(ctx.pintadeCanRequest(), 'premier créneau fermé : ' + ctx.pintadeRequestBlockedReason());
  ok(demande(), 'demande refusée');
  ok(!ctx.pintadeCanRequest(), 'seconde demande acceptée dans la foulée');
  S.auth = { role: 'player', playerId: 'pC' };
  ok(!ctx.pintadeCanRequest(), 'une autre joueuse contourne le rate limit');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(!ctx.pintadeCanRequest(), 'le coach contourne le rate limit');
  ok(ctx.pintadeNextSlotAt(p.id) === lastReq().requestedAt + 2 * H, 'créneau suivant mal calculé');
});
t('la fenêtre se rouvre pile après le rate limit', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  advance(2 * H - 1000);
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
t('une demande en cours en bloque une seconde, VUE ou PAS ENCORE VUE', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  // Étape 1 : pas encore vue → bloquée au titre de la demande en cours (et non
  // du seul rate limit, qui la bloquerait de toute façon).
  ok(/déjà en cours/.test(ctx.pintadeRequestBlockedReason()), ctx.pintadeRequestBlockedReason());
  // Étape 2 : elle a ouvert, les 30 s tournent → toujours bloquée, même motif.
  S.auth = { role: 'player', playerId: 'pA' }; ouvrir();
  S.auth = { role: 'player', playerId: 'pB' };
  advance(10000);
  ok(ctx._pintadeStatus(ctx.pintadeActiveRequest(p.id)) === 'awaiting_photo', 'le chrono photo ne tourne pas');
  ok(/déjà en cours/.test(ctx.pintadeRequestBlockedReason()), ctx.pintadeRequestBlockedReason());
  // Étape 3 : une fois le chrono photo résolu, plus rien n'est « en cours » —
  // seul le rate limit tient encore la porte.
  advance(25000);
  ok(ctx.pintadeActiveRequest(p.id) === null, 'la demande résolue passe encore pour vivante');
  ok(/dans .*(min|h)/.test(ctx.pintadeRequestBlockedReason()), 'le rate limit devrait prendre le relais : ' + ctx.pintadeRequestBlockedReason());
});

// =============================================================================
// 4) LES SANCTIONS DÉRIVÉES (inchangées)
// =============================================================================
function nRates(n) { for (let i = 0; i < n; i++) ratePasVue(); }
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
  demande(); ouvrir(); reussite(ctx.pintadeActiveRequest() || lastReq()); advance(2 * H);
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
  nRates(2);
  ok(ctx.pintadeStreak(p.id) === 5, 'la série doit continuer à compter');
  ok(ctx.pintadePeriodEnd(p) === base + 72 * H, 'la peine a continué à grossir toute seule');
});
t('interrupteur « prolongation » coupé → aucune prolongation, la série compte', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const base = p.endAt;
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { sanctionExtension: false, updatedAt: NOW });
  nRates(2);
  ok(ctx.pintadePeriodEnd(p) === base, 'prolongé alors que la sanction est coupée');
  ok(ctx.pintadeStreak(p.id) === 2, 'la série doit rester comptée');
});

// =============================================================================
// 5) L'ARBITRAGE DU COACH (inchangé)
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
  startGarde('pA', 30, 'coach');
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
// 6) LE TRANSFERT (inchangé)
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
// 7) LES DOUBLONS DE DEMANDES
// =============================================================================
t('deux demandes concurrentes → UNE survivante déterministe, les autres soft-deletées', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const mk = id => ({ id, periodId: p.id, holderId: 'pA', requesterId: 'pB', requesterLabel: 'x',
    requestedAt: NOW, connectDeadlineAt: NOW + 2 * H, openedAt: null, photoDeadlineAt: null,
    photoUrl: '', status: 'pending', resolvedAt: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null });
  S.pintadeRequests.push(mk('x2'), mk('x1'));
  ok(ctx.pintadeActiveRequest(p.id).id === 'x1', 'survivante non déterministe');
  ctx._pintadePersistStale();
  const dead = S.pintadeRequests.filter(q => q.deletedAt);
  ok(dead.length === 1 && dead[0].id === 'x2', 'doublon mal résolu : ' + JSON.stringify(dead.map(d => d.id)));
  ok(S.pintadeRequests.length === 2, 'une ligne a été DÉTRUITE au lieu d\'être soft-deletée');
  ok(ctx.pintadeFailTotal(p.id) === 0, 'un oubli unique a produit plusieurs ratés');
});

// =============================================================================
// 8) LE FEED — DEUX TONS POUR DEUX ÉCHECS
// =============================================================================
t('« pas vue » est dit sans railler, et distingué de « trop lente »', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  ratePasVue();
  const row = ctx._pintadeFeedRow(ctx.pintadeRequestsOf(p.id)[0]);
  ok(/n&#39;a pas vu la demande à temps|n'a pas vu la demande à temps/.test(row), 'libellé : ' + row.slice(0, 220));
  ok(/sans connexion/.test(row), 'la cause n\'est pas expliquée');
  ok(!/trop lente/.test(row), 'les deux échecs sont confondus');
  ok(!/💀/.test(row), 'la tête de mort est réservée à « trop lente »');
});
t('« trop lente » est nettement plus dur', () => {
  seed('player', 'pA');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  ouvrir(); advance(31000);
  const row = ctx._pintadeFeedRow(ctx.pintadeRequestsOf(p.id)[0]);
  ok(/trop lente/.test(row), 'libellé : ' + row.slice(0, 220));
  ok(/💀/.test(row), 'pas de marque visuelle forte');
  ok(/Écran ouvert à \d{2}:\d{2}/.test(row), 'l\'heure d\'ouverture manque : ' + row.slice(0, 260));
});
t('les deux états d\'attente sont distincts à l\'écran', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  const avant = ctx._pintadeFeedRow(q);
  ok(/Demande envoyée/.test(avant) && /Pas encore vue/.test(avant), 'état « pas encore vue » : ' + avant.slice(0, 200));
  S.auth = { role: 'player', playerId: 'pA' }; ouvrir(q);
  const pendant = ctx._pintadeFeedRow(q);
  ok(/Chrono en cours/.test(pendant), 'état « chrono » : ' + pendant.slice(0, 200));
  ok(/Elle a ouvert à/.test(pendant), 'l\'heure d\'ouverture manque');
});
t('le feed montre la photo des preuves réussies', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande(); ouvrir(); reussite(lastReq());
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
  ratePasVue();
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { feedPublic: false, updatedAt: NOW });
  ctx.openPintadeScreen();
  ok(/privé/i.test(ctx.__lastModal), 'feed exposé à une joueuse');
  ok(!/pas vu la demande/.test(ctx.__lastModal), 'le raté fuite malgré le feed privé');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openPintadeScreen();
  ok(/pas vu la demande/.test(ctx.__lastModal), 'le coach ne voit plus le feed');
});

// =============================================================================
// 9) L'ÉCRAN DE PREUVE
// =============================================================================
t('l\'écran bloquant ne s\'ouvre QUE pour la porteuse, et impose l\'appareil photo', () => {
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
  ok(/">30</.test(h), 'le décompte ne part pas de 30 : ' + h.slice(0, 400));
});
t('le décompte se lit sur l\'horloge absolue (app en arrière-plan)', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  ouvrir();
  advance(18000);
  ok(Math.ceil(ctx._pintadeRemainingMs() / 1000) === 12, 'reste ' + ctx._pintadeRemainingMs() + ' ms');
  advance(20000);
  ok(ctx._pintadeRemainingMs() === 0, 'le chrono ne peut pas être négatif');
});
t('avant ouverture, le chrono affiché reste entier', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  advance(45 * 60000);                        // 45 min se sont écoulées SANS ouverture
  ok(ctx._pintadeRemainingMs() === 30000, 'reste ' + ctx._pintadeRemainingMs() + ' ms au lieu de 30 000');
});

// =============================================================================
// 10) LES PUSH
// =============================================================================
t('la demande annonce les DEUX fenêtres à la porteuse', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  pushes.length = 0;
  demande();
  const p = pushes.find(x => (x.payload || {}).type === 'pintade_proof');
  ok(p, 'aucun push de demande');
  ok(p.keys.includes('player:pA'), 'mauvaise destinataire : ' + JSON.stringify(p.keys));
  ok(/2 h/.test(p.payload.body), 'la fenêtre de connexion n\'est pas annoncée : ' + p.payload.body);
  ok(/30 s/.test(p.payload.body), 'le chrono photo n\'est pas annoncé : ' + p.payload.body);
});
t('l\'assignation prévient la nouvelle porteuse', () => {
  seed('coach');
  pushes.length = 0;
  startGarde('pA', 30, 'coach');
  const p = pushes.find(x => (x.payload || {}).type === 'pintade_assign');
  ok(p && p.keys.includes('player:pA'), JSON.stringify(pushes));
});

// =============================================================================
// 11) LES RÈGLES
// =============================================================================
t('les défauts couvrent les DEUX chronos', () => {
  seed('coach');
  const r = ctx.pintadeRules();
  ok(r.rateLimitHours === 2 && r.connectWindowHours === 2 && r.proofTimeoutSeconds === 30
    && r.extensionHoursPerFail === 24 && r.maxConsecutiveFails === 3, JSON.stringify(r));
  ok(S.pintadeRules === null, 'des défauts front ont été matérialisés (ils écraseraient le serveur)');
});
t('les réglages sont bornés à l\'enregistrement, fenêtre de connexion comprise', () => {
  seed('coach');
  fields['pr-days'] = '9999'; fields['pr-rate'] = '0'; fields['pr-connect'] = '999';
  fields['pr-timeout'] = '1'; fields['pr-ext'] = '-5'; fields['pr-max'] = '99';
  fields['pr-s-feed'] = true; fields['pr-s-ext'] = true; fields['pr-s-alert'] = true; fields['pr-public'] = true;
  ctx._pintadeSaveRules();
  const r = ctx.pintadeRules();
  ok(r.defaultDurationDays === 365, 'jours = ' + r.defaultDurationDays);
  ok(r.rateLimitHours === 1, 'rate limit = ' + r.rateLimitHours);
  ok(r.connectWindowHours === 168, 'fenêtre connexion = ' + r.connectWindowHours);
  ok(r.proofTimeoutSeconds === 10, 'timeout = ' + r.proofTimeoutSeconds);
  ok(r.extensionHoursPerFail === 0, 'extension = ' + r.extensionHoursPerFail);
  ok(r.maxConsecutiveFails === 10, 'plafond = ' + r.maxConsecutiveFails);
});
t('la fenêtre de connexion réglée est bien celle appliquée', () => {
  seed('player', 'pB');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, { connectWindowHours: 8, updatedAt: NOW });
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  ok(q.connectDeadlineAt - q.requestedAt === 8 * H, 'fenêtre = ' + (q.connectDeadlineAt - q.requestedAt) / H + ' h');
  advance(7 * H);
  ok(ctx._pintadeStatus(q) === 'pending', 'ratée avant l\'heure : ' + ctx._pintadeStatus(q));
  advance(2 * H);
  ok(ctx._pintadeStatus(q) === 'failed_not_seen', ctx._pintadeStatus(q));
});
t('une joueuse ne peut pas modifier les règles', () => {
  seed('player', 'pB');
  fields['pr-rate'] = '1';
  ctx._pintadeSaveRules();
  ok(S.pintadeRules === null, 'une joueuse a écrit les règles');
});
t('les écrans coach se rendent, avec la ventilation des ratés', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  ratePasVue();
  S.auth = { role: 'player', playerId: 'pB' };
  rateTropLente();
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openPintadeRules();
  ok(/Règles de la pintade/.test(ctx.__lastModal) && /Fenêtre de connexion/.test(ctx.__lastModal), 'écran des règles incomplet');
  ctx.openPintadeAdmin();
  ok(/Gérer la pintade/.test(ctx.__lastModal) && /Emma Petit/.test(ctx.__lastModal), 'écran admin incomplet');
  ok(/pas vue\(s\)/.test(ctx.__lastModal) && /trop lente\(s\)/.test(ctx.__lastModal), 'ventilation absente de l\'écran admin');
  ok(/Emma Petit/.test(ctx.renderPintadeHomeCard()), 'carte accueil sans porteuse');
});
t('la carte d\'accueil reste MUETTE pour une joueuse quand personne ne la porte', () => {
  seed('player', 'pB');
  ok(ctx.renderPintadeHomeCard() === '', 'carte affichée dans le vide');
  seed('coach');
  ok(/désigne une joueuse/i.test(ctx.renderPintadeHomeCard()), 'le coach devrait être invité à lancer le jeu');
});

// =============================================================================
// 12) LA SYNCHRO
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
  ok(typeof qRow.connect_deadline_at === 'string', 'connect_deadline_at absent : ' + JSON.stringify(qRow));
  ok(qRow.opened_at === null && qRow.photo_deadline_at === null, 'le chrono photo est poussé avant ouverture');
  ok(!('deadline_at' in qRow), 'la colonne v.106 est encore poussée : ' + JSON.stringify(qRow));
  const back = { ...S };
  ent('pintadeHolders').apply(back, [hRow]);
  ok(back.pintadeHolders[0].holderId === 'pA' && back.pintadeHolders[0].endAt === p.endAt, JSON.stringify(back.pintadeHolders[0]));
});
t('les deux chronos survivent à l\'aller-retour base', () => {
  seed('player', 'pA');
  const p = startGarde('pA', 30, 'player', 'pB');
  demande();
  S.auth = { role: 'player', playerId: 'pA' };
  const q = ctx.pintadeActiveRequest();
  ouvrir(q);
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  const row = ent.dump(S)[q.id];
  ok(row.status === 'awaiting_photo', row.status);
  ok(typeof row.opened_at === 'string' && typeof row.photo_deadline_at === 'string', JSON.stringify(row));
  const back = { ...S, pintadeRequests: [] };
  ent.apply(back, [row]);
  const r2 = back.pintadeRequests[0];
  ok(r2.openedAt === q.openedAt && r2.photoDeadlineAt === q.photoDeadlineAt, JSON.stringify(r2));
  ok(r2.connectDeadlineAt === q.connectDeadlineAt, 'fenêtre de connexion perdue');
});
t('une ligne au format v.106 se relit sans inventer de raté', () => {
  seed('player', 'pB');
  const p = startGarde('pA', 30, 'player', 'pB');
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  // Exactement ce qu'une base pas encore migrée renvoie : deadline_at, et les
  // anciens statuts.
  const legacy = { id: 'x106', period_id: p.id, holder_id: 'pA', requester_id: 'pB',
    requester_label: '#7 Lea Dubois', requested_at: new Date(NOW).toISOString(),
    deadline_at: new Date(NOW + 2 * H).toISOString(), photo_url: null, status: 'pending',
    resolved_at: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), deleted_at: null };
  const back = { ...S, pintadeRequests: [] };
  ent.apply(back, [legacy]);
  const r2 = back.pintadeRequests[0];
  ok(r2.connectDeadlineAt === NOW + 2 * H, 'deadline_at v.106 non repris : ' + r2.connectDeadlineAt);
  ok(r2.openedAt === null && r2.photoDeadlineAt === null, JSON.stringify(r2));
  S.pintadeRequests = back.pintadeRequests;
  ok(ctx._pintadeStatus(r2) === 'pending', 'un raté a été inventé : ' + ctx._pintadeStatus(r2));
  // Et les anciens statuts se traduisent.
  ent.apply(back, [Object.assign({}, legacy, { status: 'failed' })]);
  ok(back.pintadeRequests[0].status === 'failed_timeout', back.pintadeRequests[0].status);
  ent.apply(back, [Object.assign({}, legacy, { status: 'expired' })]);
  ok(back.pintadeRequests[0].status === 'failed_not_seen', back.pintadeRequests[0].status);
});
t('les demandes gardées en localStorage par la v.106 sont reprises au chargement', () => {
  const up = ctx._pintadeUpgradeLocalRequests([
    { id: 'x1', requestedAt: 1000, deadlineAt: 1000 + 30000, status: 'pending' },
    { id: 'x2', requestedAt: 2000, deadlineAt: 2000 + 30000, status: 'failed' },
    { id: 'x3', requestedAt: 3000, deadlineAt: 3000 + 30000, status: 'expired' },
    { id: 'x4', requestedAt: 4000, connectDeadlineAt: 4000 + 2 * H, status: 'ok' },   // déjà v.107
  ]);
  ok(up[0].connectDeadlineAt === 1000 + 2 * H, 'fenêtre de connexion non recalculée : ' + up[0].connectDeadlineAt);
  ok(!('deadlineAt' in up[0]), 'l\'ancien champ traîne encore');
  ok(up[0].openedAt === null && up[0].photoDeadlineAt === null, JSON.stringify(up[0]));
  ok(up[1].status === 'failed_timeout', up[1].status);
  ok(up[2].status === 'failed_not_seen', up[2].status);
  ok(up[3].connectDeadlineAt === 4000 + 2 * H && up[3].status === 'ok', 'une ligne déjà v.107 a été abîmée');
});
t('last-writer-wins : un écho realtime ne ramène pas une preuve à « pending »', () => {
  seed('player', 'pA');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const q = lastReq();
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  const stale = ent.dump(S)[q.id];
  S.auth = { role: 'player', playerId: 'pA' };
  ouvrir(q); reussite(q); q.updatedAt = NOW + 1000;
  ent.apply(S, [stale]);
  ok(S.pintadeRequests.find(x => x.id === q.id).status === 'ok', 'la preuve a été annulée par un écho');
});
t('anti-wipe : une demande locale pas encore synchronisée survit à un apply', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  demande();
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRequests');
  ent.apply(S, []);
  ok(S.pintadeRequests.length === 1, 'la demande locale a été effacée');
});

// =============================================================================
// 13) CLOISONNEMENT SAISON
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
