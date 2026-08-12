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

// Storage observable : la suppression physique d'une photo est un effet de bord
// réseau, et c'est justement ce qu'on veut voir partir (ou ne pas partir).
const storageRemovals = [];
let storageShouldFail = false;
ctx.sb.storage = {
  from: (bucket) => ({
    remove: (paths) => {
      storageRemovals.push({ bucket, paths });
      return Promise.resolve(storageShouldFail ? { error: new Error('boom') } : { error: null });
    },
    upload: () => Promise.resolve({ error: null }),
    getPublicUrl: (n) => ({ data: { publicUrl: 'https://x/storage/v1/object/public/pintade-proofs/' + n } })
  })
};

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

// LE REPOS NOCTURNE, neutralise par defaut dans les scenarios.
// Le defaut du jeu est 23h -> 7h ; or les scenarios qui enchainent des
// demandes avancent l'horloge de plusieurs heures et traversent la nuit.
// Sans ca, la moitie du fichier testerait le couvre-feu au lieu de son sujet.
// start === end desactive la mecanique (cf. index.html). Le repos a sa
// propre section de tests, plus bas.
const SANS_REPOS = { restStartHour: 0, restEndHour: 0 };
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
function proofUrl(id) { return 'https://orertxlsvkdqayybgwaq.supabase.co/storage/v1/object/public/pintade-proofs/proof-' + id + '-123.jpg'; }
function reussite(q) { q.photoUrl = proofUrl(q.id); q.status = 'ok'; q.resolvedAt = NOW; q.updatedAt = NOW; }
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
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { sanctionExtension: false, updatedAt: NOW });
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
  ok(/pintade-proofs\/proof-/.test(row), 'photo absente');
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
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { feedPublic: false, updatedAt: NOW });
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
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { connectWindowHours: 8, updatedAt: NOW });
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

// =============================================================================
// 14) AUTO-LIBÉRATION APRÈS N PREUVES CONSÉCUTIVES (v.108)
// =============================================================================
// Six preuves d'affilée et la porteuse est libérée — la peluche passe à CELLE
// QUI A DEMANDÉ LA SIXIÈME. C'est la seule écriture non dérivée du module :
// elle CRÉE une garde, donc elle doit être déclenchée par un seul appareil
// (celui de la porteuse) et rester idempotente.

// Une preuve réussie de bout en bout, demandée par `requesterId`. Rend le
// résultat de la confrontation au seuil, exactement comme submitPintadeProof.
function preuveOk(requesterId) {
  S.auth = String(requesterId).startsWith('coach:')
    ? { role: 'coach', coachId: 'admin' } : { role: 'player', playerId: requesterId };
  const period = ctx.pintadeActivePeriod();
  demande();
  const q = lastReq();
  S.auth = { role: 'player', playerId: q.holderId };
  ouvrir(q); reussite(q);
  const freed = ctx._pintadeMaybeAutoRelease(period, q);
  advance(2 * H);                                  // rate limit levé pour la suite
  return { q, freed };
}
t('6 preuves d\'affilée libèrent la porteuse et transfèrent à la 6e demandeuse', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) {
    const r = preuveOk('pB');
    ok(r.freed === null, 'libérée dès la ' + (i + 1) + 'e preuve');
    ok(ctx.pintadeActivePeriod().id === p.id, 'garde changée trop tôt');
  }
  ok(ctx.pintadeOkStreak(p.id) === 5, 'série = ' + ctx.pintadeOkStreak(p.id));
  ok(ctx.pintadeOkRemaining(p.id) === 1, 'reste ' + ctx.pintadeOkRemaining(p.id));
  const { freed } = preuveOk('pC');               // pC demande la 6e
  ok(freed, 'aucune libération à la 6e preuve');
  ok(freed.releasedId === 'pA' && freed.successorId === 'pC', JSON.stringify(freed));
  const cur = ctx.pintadeActivePeriod();
  ok(cur && cur.holderId === 'pC', 'nouvelle porteuse = ' + (cur && cur.holderId));
  ok(cur.transferredFromId === 'pA', 'lien de transfert perdu');
  ok(S.pintadeHolders.find(h => h.id === p.id).ended === true, 'ancienne garde pas close');
  ok(S.pintadeHolders.find(h => h.id === p.id).endedReason === 'auto_released_streak',
    S.pintadeHolders.find(h => h.id === p.id).endedReason);
  ok(cur.createdBy === 'auto:release_streak', 'la garde doit être attribuée au mécanisme : ' + cur.createdBy);
});
t('la nouvelle porteuse repart d\'une ardoise vierge', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  preuveOk('pC');
  const cur = ctx.pintadeActivePeriod();
  ok(ctx.pintadeOkStreak(cur.id) === 0, 'série de réussites héritée');
  ok(ctx.pintadeFailTotal(cur.id) === 0, 'ratés hérités');
  ok(ctx.pintadeOkRemaining(cur.id) === 6, 'compteur de libération hérité : ' + ctx.pintadeOkRemaining(cur.id));
  ok(ctx.pintadePeriodEnd(cur) === cur.endAt, 'prolongations héritées');
});
t('UN SEUL RATÉ remet la série de réussites à zéro', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { updatedAt: NOW });
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  ok(ctx.pintadeOkStreak(p.id) === 5, 'série = ' + ctx.pintadeOkStreak(p.id));
  S.auth = { role: 'player', playerId: 'pB' };
  ratePasVue();
  ok(ctx.pintadeOkStreak(p.id) === 0, 'la série a survécu au raté');
  ok(ctx.pintadeStreak(p.id) === 1, 'la série de ratés ne démarre pas');
  // …et symétriquement, une réussite efface la série de ratés.
  const r = preuveOk('pB');
  ok(r.freed === null, 'libérée alors que la série était cassée');
  ok(ctx.pintadeStreak(p.id) === 0, 'la série de ratés a survécu à la réussite');
  ok(ctx.pintadeOkStreak(p.id) === 1, 'la série de réussites n\'est pas repartie de 1');
});
t('la libération est IDEMPOTENTE : jamais deux gardes créées', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q } = preuveOk('pC');
  const nb = S.pintadeHolders.length;
  // Rejoué : un double tap, un re-render, une reprise de sync…
  ok(ctx._pintadeMaybeAutoRelease(S.pintadeHolders.find(h => h.id === p.id), q) === null, 'rejoué avec succès');
  ok(ctx._pintadeMaybeAutoRelease(ctx.pintadeActivePeriod(), q) === null, 'rejoué sur la NOUVELLE garde');
  ok(S.pintadeHolders.length === nb, S.pintadeHolders.length + ' gardes au lieu de ' + nb);
  const incs = (S.pintadeIncidents || []).filter(i => i.incidentType === 'auto_release_success_streak');
  ok(incs.length === 1, incs.length + ' incidents de libération');
});
t('la 6e demande venue du COACH ne lui refile pas la peluche', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { freed } = preuveOk('coach:admin');
  ok(freed && freed.pendingCoachPick === true, JSON.stringify(freed));
  ok(freed.successorId === null, 'un successeur a été désigné : ' + freed.successorId);
  ok(ctx.pintadeActivePeriod() === null, 'une garde a été créée quand même');
  ok(S.pintadeHolders.find(h => h.id === p.id).ended === true, 'la porteuse n\'a pas été libérée');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.pintadeCoachPickPending() === true, 'le coach n\'est pas invité à désigner');
});
t('une demandeuse partie de l\'effectif renvoie la décision au coach', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  S.auth = { role: 'player', playerId: 'pC' };
  const period = ctx.pintadeActivePeriod();
  demande();
  const q = lastReq();
  S.auth = { role: 'player', playerId: 'pA' }; ouvrir(q); reussite(q);
  S.players = S.players.filter(x => x.id !== 'pC');        // elle quitte le club
  const freed = ctx._pintadeMaybeAutoRelease(period, q);
  ok(freed && freed.pendingCoachPick === true, JSON.stringify(freed));
  ok(ctx.pintadeActivePeriod() === null, 'une garde a été créée pour une joueuse absente');
});
t('le coach peut couper la mécanique (seuil 0)', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { autoReleaseAfterOk: 0, updatedAt: NOW });
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 8; i++) {
    const r = preuveOk('pB');
    ok(r.freed === null, 'libérée à la ' + (i + 1) + 'e alors que la mécanique est coupée');
  }
  ok(ctx.pintadeActivePeriod().id === p.id, 'la garde a changé');
  ok(ctx.pintadeOkRemaining(p.id) === null, 'un objectif est affiché malgré la coupure');
  ok(ctx._pintadeFreedomBar(p, true) === '', 'la jauge s\'affiche malgré la coupure');
});
t('le seuil est réglable par le coach', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { autoReleaseAfterOk: 3, updatedAt: NOW });
  startGarde('pA', 30, 'coach');
  preuveOk('pB'); preuveOk('pB');
  ok(ctx.pintadeActivePeriod().holderId === 'pA', 'libérée trop tôt');
  const { freed } = preuveOk('pC');
  ok(freed && freed.successorId === 'pC', JSON.stringify(freed));
  ok(freed.goal === 3, 'seuil tracé = ' + freed.goal);
});
t('l\'incident tracé porte tout ce qu\'il faut pour comprendre après coup', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q } = preuveOk('pC');
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'auto_release_success_streak');
  ok(inc, 'aucun incident tracé');
  ok(inc.periodId === p.id && inc.holderId === 'pA', JSON.stringify(inc));
  ok(inc.metadata.releasedHolderId === 'pA' && inc.metadata.newHolderId === 'pC', JSON.stringify(inc.metadata));
  ok(inc.metadata.triggerRequestId === q.id, 'la demande déclenchante n\'est pas tracée');
  ok(inc.metadata.streakCount === 6 && inc.metadata.pendingCoachPick === false, JSON.stringify(inc.metadata));
  ok(inc.metadata.newPeriodId === ctx.pintadeActivePeriod().id, 'la nouvelle garde n\'est pas reliée');
});
t('les trois intéressés sont prévenus', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  pushes.length = 0;
  preuveOk('pC');
  const coach = pushes.find(x => (x.payload || {}).type === 'pintade_auto_release');
  const freed = pushes.find(x => (x.payload || {}).type === 'pintade_freed');
  const next = pushes.find(x => (x.payload || {}).type === 'pintade_assign');
  ok(coach, 'le coach n\'est pas prévenu');
  ok(/lib[ée]r/i.test(coach.payload.body), coach.payload.body);
  ok(freed && freed.keys.includes('player:pA'), 'la libérée n\'est pas prévenue');
  ok(next && next.keys.includes('player:pC'), 'la nouvelle porteuse n\'est pas prévenue');
});
t('le feed raconte la libération en tête de la nouvelle garde', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  preuveOk('pC');
  const row = ctx._pintadeGenesisRow(ctx.pintadeActivePeriod());
  ok(/lib[ée]r/i.test(row), 'la libération n\'est pas racontée : ' + row.slice(0, 200));
  ok(/Emma Petit/.test(row) && /Nina Roux/.test(row), 'les deux joueuses ne sont pas nommées');
  ok(/🎉/.test(row), 'pas de marque de fête');
});
t('la jauge de libération dit la vérité aux deux camps', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const vuePorteuse = ctx._pintadeFreedomBar(p, true);
  const vueAutres = ctx._pintadeFreedomBar(p, false);
  ok(/libre/.test(vuePorteuse), 'la porteuse ne voit pas son objectif : ' + vuePorteuse.slice(0, 200));
  ok(/lib[èe]re/.test(vueAutres), 'les autres ne sont pas prévenues du risque : ' + vueAutres.slice(0, 200));
  ok(/autrice|ira/.test(vueAutres), 'le risque d\'hériter n\'est pas dit');
});
t('la libération est bien CÂBLÉE dans l\'envoi de preuve', () => {
  // Vérification statique : le reste de ce bloc teste la mécanique en direct,
  // mais rien ne garantirait qu'elle soit appelée là où il faut.
  const src = html.slice(html.indexOf('async function submitPintadeProof'));
  const corps = src.slice(0, src.indexOf('\n}\n'));
  ok(/_pintadeMaybeAutoRelease\(/.test(corps), 'submitPintadeProof ne confronte jamais la série au seuil');
  ok(corps.indexOf('_pintadeMaybeAutoRelease(') > corps.indexOf("status = 'ok'"),
    'la confrontation doit venir APRÈS que la preuve soit validée');
});

// =============================================================================
// 15) LES RÈGLES ÉDITABLES (CMS)
// =============================================================================
t('un texte par défaut existe et couvre les règles réellement appliquées', () => {
  seed('player', 'pB');
  const txt = ctx.pintadeRulesText();
  ok(txt && txt.length > 400, 'texte trop court : ' + txt.length);
  ok(/2 h pour ouvrir/.test(txt), 'la fenêtre de connexion n\'est pas expliquée');
  ok(/30 secondes/.test(txt), 'le chrono photo n\'est pas expliqué');
  ok(/6 preuves/.test(txt), 'l\'auto-libération n\'est pas expliquée');
  ok(/3 échecs/.test(txt), 'le plafond de ratés n\'est pas expliqué');
  ok(/\+24 h/.test(txt), 'la prolongation n\'est pas expliquée');
  ok(/toutes les 2 heures/.test(txt), 'le rate limit n\'est pas expliqué');
  ok(ctx.pintadeRulesTextIsCustom() === false, 'le défaut passe pour personnalisé');
});
t('le texte du coach remplace le défaut, partout', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { rulesText: '# Mes règles\n- Sois sympa', updatedAt: NOW });
  ok(ctx.pintadeRulesText() === '# Mes règles\n- Sois sympa', ctx.pintadeRulesText());
  ok(ctx.pintadeRulesTextIsCustom() === true, 'le texte du coach passe pour le défaut');
  startGarde('pA', 30, 'coach');
  S._pintadeRulesOpen = true;
  ctx.openPintadeScreen();
  ok(/Mes règles/.test(ctx.__lastModal), 'le texte du coach n\'est pas affiché');
  ok(!/Que la meilleure gagne/.test(ctx.__lastModal), 'le défaut s\'affiche encore');
});
t('l\'accordéon est FERMÉ par défaut, et s\'ouvre', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  S._pintadeRulesOpen = false;
  ctx.openPintadeScreen();
  ok(/Les règles du jeu/.test(ctx.__lastModal), 'l\'entrée des règles est absente');
  ok(!/Que la meilleure gagne/.test(ctx.__lastModal), 'le contenu est déplié d\'entrée');
  ctx.togglePintadeRules();
  ok(/Que la meilleure gagne/.test(ctx.__lastModal), 'l\'accordéon ne s\'ouvre pas');
  ctx.togglePintadeRules();
  ok(!/Que la meilleure gagne/.test(ctx.__lastModal), 'l\'accordéon ne se referme pas');
});
t('les règles sont lisibles même quand personne ne porte la peluche', () => {
  seed('player', 'pB');
  S._pintadeRulesOpen = true;
  ctx.openPintadeScreen();
  ok(/Les règles du jeu/.test(ctx.__lastModal), 'pas de règles sur l\'écran vide');
  ok(/Que la meilleure gagne/.test(ctx.__lastModal), 'contenu absent');
});
t('le Markdown est rendu, et le HTML collé par le coach est neutralisé', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, {
    rulesText: '# Titre\n- point\n**gras**\n<img src=x onerror="alert(1)">', updatedAt: NOW });
  startGarde('pA', 30, 'coach');
  S._pintadeRulesOpen = true;
  ctx.openPintadeScreen();
  const m = ctx.__lastModal;
  ok(/<h2>Titre<\/h2>/.test(m), 'les titres ne sont pas rendus');
  ok(/<li>point<\/li>/.test(m), 'les listes ne sont pas rendues');
  ok(/<strong>gras<\/strong>/.test(m), 'le gras n\'est pas rendu');
  ok(!/<img/.test(m), 'du HTML brut a traversé le rendu');
  ok(/&lt;img/.test(m), 'le HTML n\'est pas échappé : ' + m.slice(m.indexOf('img') - 60, m.indexOf('img') + 40));
});
t('enregistrer le texte par défaut à l\'identique ne le fige PAS en base', () => {
  seed('coach');
  fields['pr-days'] = '30'; fields['pr-rate'] = '2'; fields['pr-connect'] = '2';
  fields['pr-timeout'] = '30'; fields['pr-ext'] = '24'; fields['pr-max'] = '3'; fields['pr-auto'] = '6';
  fields['pr-text'] = ctx.PINTADE_RULES_TEXT_DEFAULT;
  ctx._pintadeSaveRules();
  ok(S.pintadeRules.rulesText === '', 'une copie du défaut a été enregistrée : ' + (S.pintadeRules.rulesText || '').length + ' car.');
  const ent = ctx.ENTITIES.find(e => e.key === 'pintadeRules');
  ok(ent.dump(S)['default'].rules_text === null, 'le défaut serait poussé en base');
});
t('un texte réellement personnalisé, lui, est bien poussé', () => {
  seed('coach');
  fields['pr-days'] = '30'; fields['pr-rate'] = '2'; fields['pr-connect'] = '2';
  fields['pr-timeout'] = '30'; fields['pr-ext'] = '24'; fields['pr-max'] = '3'; fields['pr-auto'] = '6';
  fields['pr-text'] = '# Version du coach';
  ctx._pintadeSaveRules();
  ok(S.pintadeRules.rulesText === '# Version du coach', S.pintadeRules.rulesText);
  const row = ctx.ENTITIES.find(e => e.key === 'pintadeRules').dump(S)['default'];
  ok(row.rules_text === '# Version du coach', JSON.stringify(row.rules_text));
  ok(row.auto_release_after_ok === 6, 'le seuil de libération n\'est pas poussé');
  // …et il revient identique de la base.
  const back = { ...S, pintadeRules: null };
  ctx.ENTITIES.find(e => e.key === 'pintadeRules').apply(back, [row]);
  ok(back.pintadeRules.rulesText === '# Version du coach', JSON.stringify(back.pintadeRules));
  ok(back.pintadeRules.autoReleaseAfterOk === 6, 'seuil perdu à l\'aller-retour');
});
t('une base sans les colonnes v.108 retombe sur les défauts', () => {
  seed('coach');
  const legacy = { id: 'default', default_duration_days: 30, rate_limit_hours: 2, connect_window_hours: 2,
    proof_timeout_seconds: 30, extension_hours_per_fail: 24, max_consecutive_fails: 3,
    sanction_feed_post: true, sanction_extension: true, sanction_coach_alert: true, feed_public: true,
    updated_by: null, updated_at: new Date(NOW).toISOString() };
  const back = { ...S, pintadeRules: null };
  ctx.ENTITIES.find(e => e.key === 'pintadeRules').apply(back, [legacy]);
  ok(back.pintadeRules.autoReleaseAfterOk === 6, 'seuil = ' + back.pintadeRules.autoReleaseAfterOk);
  ok(back.pintadeRules.rulesText === '', 'texte = ' + JSON.stringify(back.pintadeRules.rulesText));
  S.pintadeRules = back.pintadeRules;
  ok(ctx.pintadeRulesText().length > 400, 'le texte par défaut ne prend pas le relais');
});
t('l\'écran de configuration expose le texte et le seuil', () => {
  seed('coach');
  ctx.openPintadeRules();
  const m = ctx.__lastModal;
  ok(/Texte des règles/.test(m), 'la zone de texte est absente');
  ok(/id="pr-text"/.test(m), 'le champ pr-text est absent');
  ok(/_pintadePreviewRules\(\)/.test(m), 'pas de bouton Prévisualiser');
  ok(/_pintadeResetRulesText\(\)/.test(m), 'pas de bouton Texte par défaut');
  ok(/id="pr-auto"/.test(m), 'le seuil de libération est absent');
  ok(/Que la meilleure gagne/.test(m), 'la zone n\'est pas pré-remplie');
});
t('l\'aperçu rend le brouillon en cours, sans rien enregistrer', () => {
  seed('coach');
  fields['pr-text'] = '# Brouillon pas enregistré';
  ctx._pintadePreviewRules();
  ok(/<h2>Brouillon pas enregistré<\/h2>/.test(ctx.__lastModal), 'aperçu : ' + String(ctx.__lastModal).slice(0, 200));
  ok(S.pintadeRules === null, 'l\'aperçu a enregistré les règles');
});
t('une joueuse ne peut pas toucher au texte', () => {
  seed('player', 'pB');
  fields['pr-text'] = '# Piratage';
  ctx._pintadeSaveRules();
  ok(S.pintadeRules === null, 'une joueuse a écrit les règles');
  ctx.openPintadeRules();
  ok(!ctx.__lastModal, 'l\'écran de configuration s\'ouvre pour une joueuse');
});

// =============================================================================
// INVALIDATION D'UNE PREUVE PAR LE COACH (migration 20260811_002)
// -----------------------------------------------------------------------------
// Le jeu ne sait juger qu'une chose : la photo est-elle arrivée dans les temps.
// Il ne sait pas si la peluche y figure. Une preuve est donc valide PAR DÉFAUT,
// et le coach peut revenir dessus après coup.
//
// CE QUI EST VERROUILLÉ ICI :
//   • une invalidation compte comme un RATÉ partout (série, prolongations,
//     plafond d'arbitrage) — sinon l'acte serait cosmétique ;
//   • le recalcul est RÉTROACTIF et gratuit : il découle du statut, aucun
//     compteur n'est stocké ;
//   • seul le coach peut invalider, et seulement une preuve RÉUSSIE ;
//   • `resolvedAt` n'est jamais réécrit : on annote l'histoire, on ne la
//     réécrit pas ;
//   • la preuve invalidée RESTE dans le feed (un trou serait pire) ;
//   • l'auto-libération déjà déclenchée est le seul cas non dérivé : le coach
//     choisit, et l'annulation rend la garde à la porteuse.
// =============================================================================
function invalider(q, reason, opts) {
  S.auth = { role: 'coach', coachId: 'admin' };
  storageRemovals.length = 0;
  return ctx.pintadeInvalidateProof(q.id, reason || '', opts || {});
}

t('une preuve invalidée compte comme un raté, pas comme une réussite', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  ok(ctx.pintadeOkStreak(p.id) === 1, 'série OK = ' + ctx.pintadeOkStreak(p.id));
  ok(invalider(q, 'la peluche n\'est pas dessus'), 'invalidation refusée');
  ok(ctx._pintadeStatus(q) === 'invalidated_by_coach', 'statut = ' + ctx._pintadeStatus(q));
  ok(ctx.pintadeOkStreak(p.id) === 0, 'la série de réussites n\'est pas repartie de zéro');
  ok(ctx.pintadeStreak(p.id) === 1, 'ratés consécutifs = ' + ctx.pintadeStreak(p.id));
  ok(ctx.pintadeOkTotal(p.id) === 0, 'toujours comptée comme réussite');
  ok(ctx.pintadeFailTotal(p.id) === 1, 'pas comptée comme raté');
});
t('le recalcul de la série est RÉTROACTIF (rien n\'est stocké)', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const a = preuveOk('pB').q, b = preuveOk('pB').q, c = preuveOk('pB').q;
  ok(ctx.pintadeOkStreak(p.id) === 3, 'série = ' + ctx.pintadeOkStreak(p.id));
  // On invalide celle du MILIEU : la série d'après repart de la suivante.
  invalider(b, 'hors sujet');
  ok(ctx.pintadeOkStreak(p.id) === 1, 'série après invalidation du milieu = ' + ctx.pintadeOkStreak(p.id));
  ok(ctx.pintadeOkTotal(p.id) === 2, 'réussites = ' + ctx.pintadeOkTotal(p.id));
  ok(a && c, 'garde-fou');
});
t('une invalidation peut faire franchir le plafond → arbitrage dû', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { maxConsecutiveFails: 3, autoReleaseAfterOk: 0, updatedAt: NOW });
  ratePasVue(); rateTropLente();                    // 2 ratés secs
  ok(ctx.pintadeStreak(p.id) === 2, 'série de ratés = ' + ctx.pintadeStreak(p.id));
  const { q } = preuveOk('pB');                     // une réussite remet à zéro
  ok(ctx.pintadeStreak(p.id) === 0, 'la réussite n\'a pas remis la série à zéro');
  invalider(q, 'photo de la pintade de sa voisine');
  ok(ctx.pintadeStreak(p.id) === 3, 'série après invalidation = ' + ctx.pintadeStreak(p.id));
  ok(ctx.pintadeAlertPending(ctx.pintadeActivePeriod()) === true, 'aucun arbitrage réclamé au coach');
});
t('seul le coach invalide, et seulement une preuve RÉUSSIE', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(ctx.pintadeInvalidateProof(q.id, 'moi je veux', false) === false, 'une joueuse a pu invalider');
  ok(ctx._pintadeStatus(q) === 'ok', 'statut abîmé par la tentative');
  ok(ctx.pintadeCanInvalidate(q) === false, 'le bouton s\'affiche pour une joueuse');
  // Un raté n'est pas invalidable : il n'y a rien à retirer.
  S.auth = { role: 'coach', coachId: 'admin' };
  ratePasVue();
  const bad = lastReq();
  ok(ctx.pintadeCanInvalidate(bad) === false, 'un raté est proposé à l\'invalidation');
  ok(ctx.pintadeInvalidateProof(bad.id, '', false) === false, 'un raté a pu être invalidé');
  // …et invalider deux fois ne fait rien de plus.
  ok(invalider(q) === true, 'invalidation refusée au coach');
  ok(ctx.pintadeInvalidateProof(q.id, '', false) === false, 'double invalidation acceptée');
});
t('l\'histoire est annotée, pas réécrite (resolvedAt intact) + traçabilité', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  const resolved = q.resolvedAt;
  invalider(q, '  peluche absente  ');
  ok(q.resolvedAt === resolved, 'resolvedAt a été réécrit');
  ok(q.invalidatedAt && q.invalidatedAt >= resolved, 'invalidatedAt manquant');
  ok(String(q.invalidatedBy || '').startsWith('coach:'), 'invalidatedBy = ' + q.invalidatedBy);
  ok(q.invalidationReason === 'peluche absente', 'motif non nettoyé : ' + JSON.stringify(q.invalidationReason));
  ok(q.updatedAt >= q.invalidatedAt, 'updatedAt non bumpé → le LWW réécrira la ligne');
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_invalidated_proof');
  ok(inc && inc.metadata.requestId === q.id, 'incident non tracé');
  ok(inc.periodId === p.id && inc.notes === 'peluche absente', JSON.stringify(inc));
});
t('la porteuse est prévenue, motif compris', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  pushes.length = 0;
  invalider(q, 'peluche absente');
  const p = pushes.find(x => (x.payload || {}).type === 'pintade_proof_invalidated');
  ok(p, 'aucune notification à la porteuse');
  ok((p.keys || []).includes('player:pA'), 'destinataire = ' + JSON.stringify(p.keys));
  ok(/peluche absente/.test(p.payload.body), 'motif absent du message : ' + p.payload.body);
});
t('la preuve invalidée RESTE dans le feed, marquée', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'hors sujet');
  const row = ctx._pintadeFeedRow(q);
  ok(/Invalidée par le coach/.test(row), 'la ligne ne dit pas qu\'elle est invalidée');
  ok(/hors sujet/.test(row), 'le motif n\'apparaît pas');
  ok(!/Preuve validée/.test(row), 'elle passe encore pour validée');
  ok(!/trop lente/.test(row), 'elle est présentée comme une lenteur — c\'est faux');
});
t('le bouton d\'invalidation n\'existe que pour le coach', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(/openPintadeInvalidate/.test(ctx._pintadeFeedRow(q)), 'le coach n\'a pas le bouton');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(!/openPintadeInvalidate/.test(ctx._pintadeFeedRow(q)), 'une joueuse voit le bouton');
  S.auth = { role: 'player', playerId: 'pA' };
  ok(!/openPintadeInvalidate/.test(ctx._pintadeFeedRow(q)), 'la porteuse voit le bouton');
});

// --- LE CAS DÉLICAT : l'auto-libération a déjà eu lieu ------------------------
t('la modale ANNONCE l\'annulation de la libération — sans la mettre au vote', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q, freed } = preuveOk('pC');
  ok(freed && freed.successorId === 'pC', 'la libération n\'a pas eu lieu');
  ok(ctx._pintadeAutoReleaseFrom(q.id), 'la libération n\'est pas reliée à la preuve');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openPintadeInvalidate(q.id);
  const m = ctx.__lastModal || '';
  ok(/La libération sera annulée/.test(m), 'la modale ne prévient pas de la conséquence');
  ok(/retournera à/.test(m), 'la modale ne dit pas à qui la garde revient');
  // UN SEUL chemin : laisser le choix permettrait un état incohérent — une
  // porteuse libérée par une preuve que le coach vient lui-même de rejeter.
  ok(!/juste marquer invalide/.test(m), 'le second chemin (incohérent) est toujours proposé');
  ok((m.match(/_pintadeSubmitInvalidate/g) || []).length === 1,
    'plusieurs boutons de validation : ' + (m.match(/_pintadeSubmitInvalidate/g) || []).length);
  ok(p, 'garde-fou');
});
t('…y compris quand on invalide une preuve du MILIEU de la série', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const troisieme = [];
  for (let i = 0; i < 5; i++) troisieme.push(preuveOk('pB').q);
  preuveOk('pC');
  // La 3e de la série de six : la casser invalide la libération tout autant.
  ok(ctx._pintadeAutoReleaseFrom(troisieme[2].id),
    'seule la 6e est reliée — invalider une preuve du milieu passerait inaperçu');
});
t('l\'annulation est AUTOMATIQUE : aucun appelant ne peut la contourner', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q } = preuveOk('pC');
  ok(ctx.pintadeActivePeriod().holderId === 'pC', 'préalable faux');
  // Même en demandant explicitement le contraire, la libération tombe : une
  // preuve rejetée ne peut avoir libéré personne.
  invalider(q, 'litige', { undoRelease: false });
  ok(ctx.pintadeActivePeriod().id === p.id, 'la libération a survécu à l\'invalidation');
  ok(ctx.pintadeActivePeriod().holderId === 'pA', 'porteuse = ' + ctx.pintadeActivePeriod().holderId);
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_invalidated_proof');
  ok(inc.metadata.hadTriggeredRelease === true && inc.metadata.releaseUndone === true, JSON.stringify(inc.metadata));
  ok(inc.coachDecision === 'invalidate_and_undo_release', 'décision tracée = ' + inc.coachDecision);
});
t('invalider une preuve SANS libération ne touche à aucune garde', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'hors sujet');
  ok(ctx.pintadeActivePeriod().id === p.id && ctx.pintadeActivePeriod().holderId === 'pA', 'garde abîmée');
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_invalidated_proof');
  ok(inc.metadata.hadTriggeredRelease === false && inc.metadata.releaseUndone === false, JSON.stringify(inc.metadata));
  ok(inc.coachDecision === 'invalidate', 'décision tracée = ' + inc.coachDecision);
});
t('l\'annulation rend la garde à la porteuse et efface la garde née à tort', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q } = preuveOk('pC');
  const nee = ctx.pintadeActivePeriod();
  ok(nee.holderId === 'pC', 'préalable faux');
  invalider(q, 'peluche absente', true);
  const now = ctx.pintadeActivePeriod();
  ok(now && now.id === p.id, 'la garde de pA n\'a pas repris : ' + (now && now.holderId));
  ok(now.holderId === 'pA' && now.ended === false, JSON.stringify({ h: now.holderId, e: now.ended }));
  const nee2 = (S.pintadeHolders || []).find(h => h.id === nee.id);
  ok(nee2 && nee2.deletedAt, 'la garde née à tort survit');
  // L'idempotence se relâche : la libération pourra se redéclencher plus tard.
  ok(ctx._pintadeAutoReleaseDone(p.id) === false, 'l\'auto-libération reste verrouillée à jamais');
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_invalidated_proof');
  ok(inc.metadata.releaseUndone === true, JSON.stringify(inc.metadata));
});
t('annuler la libération prévient les deux joueuses ET le coach', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { q } = preuveOk('pC');
  pushes.length = 0;
  invalider(q, '');
  const undone = pushes.filter(x => (x.payload || {}).type === 'pintade_release_undone');
  ok(undone.length === 3, 'notifications d\'annulation = ' + undone.length);
  ok(undone.some(x => (x.keys || []).includes('player:pC')), 'la nouvelle porteuse n\'est pas prévenue');
  ok(undone.some(x => (x.keys || []).includes('player:pA')), 'l\'ancienne porteuse n\'est pas prévenue');
  // Récap coach : un transfert annulé est ce qu'on relit trois jours plus tard
  // en se demandant qui porte quoi.
  ok(undone.some(x => (x.keys || []).some(k => String(k).startsWith('coach:'))), 'le coach n\'a pas de récapitulatif');
});
t('après annulation, la porteuse peut se relibérer normalement', () => {
  seed('coach');
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT, SANS_REPOS, { updatedAt: NOW });
  const p = startGarde('pA', 30, 'coach');
  for (let i = 0; i < 5; i++) preuveOk('pB');
  invalider(preuveOk('pC').q, 'litige', true);
  ok(ctx.pintadeActivePeriod().id === p.id, 'la garde de pA n\'a pas repris');
  // La série repart de zéro (l'invalidation est un raté) : il faut 6 preuves.
  ok(ctx.pintadeOkStreak(p.id) === 0, 'série = ' + ctx.pintadeOkStreak(p.id));
  for (let i = 0; i < 5; i++) preuveOk('pB');
  const { freed } = preuveOk('pC');
  ok(freed && freed.successorId === 'pC', 'la libération ne peut plus se redéclencher');
});
// --- SUPPRESSION PHYSIQUE DE LA PHOTO ----------------------------------------
// Masquer la ligne ne suffit pas pour une image réellement déplacée : le fichier
// reste ouvert à qui possède l'URL. Le coach peut donc effacer l'objet du
// bucket. La LIGNE, elle, survit — c'est la trace de l'incident.
t('la photo n\'est PAS supprimée par défaut', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'hors sujet');
  ok(storageRemovals.length === 0, 'suppression déclenchée sans qu\'on la demande');
  ok(q.photoUrl, 'URL effacée sans qu\'on la demande');
  ok(ctx._pintadePhotoWasDeleted(q) === false, 'la photo passe pour supprimée');
});
t('cochée, la photo part vraiment du bucket — et l\'URL est détachée AVANT', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  const url = q.photoUrl;
  invalider(q, 'peluche absente', { deletePhoto: true });
  ok(storageRemovals.length === 1, 'aucun appel au Storage : ' + storageRemovals.length);
  ok(storageRemovals[0].bucket === 'pintade-proofs', 'bucket = ' + storageRemovals[0].bucket);
  ok(storageRemovals[0].paths.length === 1 && /^proof-.+\.jpg$/.test(storageRemovals[0].paths[0]),
    'chemin envoyé = ' + JSON.stringify(storageRemovals[0].paths));
  // Détachée d'abord : même si le Storage refuse, plus personne ne la voit.
  ok(!q.photoUrl, 'l\'URL est restée dans le dossier : ' + q.photoUrl);
  ok(url && url !== q.photoUrl, 'garde-fou');
  // La LIGNE survit : c'est la trace.
  ok(!q.deletedAt && ctx._pintadeStatus(q) === 'invalidated_by_coach', 'la demande a été effacée');
});
t('le nom du fichier reste tracé dans l\'incident (ménage possible si l\'appel rate)', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, '', { deletePhoto: true });
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_invalidated_proof');
  ok(inc.metadata.photoDeleted === true, JSON.stringify(inc.metadata));
  ok(/^proof-.+\.jpg$/.test(inc.metadata.photoPath || ''), 'chemin non tracé : ' + inc.metadata.photoPath);
});
t('un Storage qui refuse ne fait PAS échouer l\'invalidation', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  storageShouldFail = true;
  const done = invalider(q, 'peluche absente', { deletePhoto: true });
  storageShouldFail = false;
  ok(done === true, 'l\'invalidation a échoué parce que le réseau a hoqueté');
  ok(ctx._pintadeStatus(q) === 'invalidated_by_coach', 'statut = ' + ctx._pintadeStatus(q));
  ok(ctx.pintadeStreak(p.id) === 1, 'la comptabilité n\'a pas été appliquée');
});
t('« photo supprimée » est DÉRIVÉ, donc visible par toutes — pas seulement le coach', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'hors sujet', { deletePhoto: true });
  ok(ctx._pintadePhotoWasDeleted(q) === true, 'la suppression n\'est pas dérivable');
  // Aller-retour base COMPLET : un drapeau posé en mémoire ne survivrait pas.
  const back = ctx._pintadeRequestFromRow(Object.assign({}, ctx._dumpPintadeRequestRow(q),
    { period_id: q.periodId, holder_id: q.holderId }));
  ok(ctx._pintadePhotoWasDeleted(back) === true, 'perdu à l\'aller-retour base');
  // …et une joueuse voit la même chose.
  S.auth = { role: 'player', playerId: 'pB' };
  const row = ctx._pintadeFeedRow(q);
  ok(/photo supprimée/.test(row), 'la joueuse ne voit pas que la photo a été retirée');
  ok(!/<img/.test(row), 'une image est encore rendue');
});
// --- SUPPRIMER LA PHOTO SANS INVALIDER (v.119) -------------------------------
// Deux besoins distincts : une photo peut être déplacée sans que la preuve soit
// contestable, et on ne s'aperçoit pas toujours du problème au moment où l'on
// tranche. Le geste est donc disponible à tout moment, et il ne juge RIEN.
function supprimerPhoto(q) {
  S.auth = { role: 'coach', coachId: 'admin' };
  storageRemovals.length = 0;
  return ctx.pintadeDeleteProofPhoto(q.id);
}
t('supprimer la photo NE touche ni au statut ni à la comptabilité', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  ok(supprimerPhoto(q) === true, 'suppression refusée');
  ok(ctx._pintadeStatus(q) === 'ok', 'le statut a bougé : ' + ctx._pintadeStatus(q));
  ok(ctx.pintadeOkStreak(p.id) === 1, 'la série a bougé : ' + ctx.pintadeOkStreak(p.id));
  ok(ctx.pintadeStreak(p.id) === 0, 'un raté est apparu');
  ok(!q.photoUrl, 'l\'URL est restée');
  ok(storageRemovals.length === 1 && /^proof-.+\.jpg$/.test(storageRemovals[0].paths[0]),
    'objet non effacé : ' + JSON.stringify(storageRemovals));
});
t('…et la mention apparaît sur une preuve restée VALIDE', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  supprimerPhoto(q);
  ok(ctx._pintadePhotoWasDeleted(q) === true, 'suppression non dérivable sur une preuve valide');
  const row = ctx._pintadeFeedRow(q);
  ok(/Preuve validée — photo supprimée/.test(row), 'le feed ne le dit pas : ' + row.slice(0, 200));
  ok(!/<img/.test(row), 'une image est encore rendue');
});
t('la dérivation passe par le JOURNAL — donc elle voyage', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  supprimerPhoto(q);
  const inc = (S.pintadeIncidents || []).find(i => i.incidentType === 'coach_deleted_photo');
  ok(inc && inc.metadata.requestId === q.id, 'incident non tracé');
  ok(inc.metadata.photoDeleted === true, JSON.stringify(inc.metadata));
  ok(/^proof-.+\.jpg$/.test(inc.metadata.photoPath || ''), 'chemin non tracé');
  ok(inc.metadata.statusAtDeletion === 'ok', 'statut au moment du geste = ' + inc.metadata.statusAtDeletion);
  // Le journal est synchronisé : la mention survit à un aller-retour base.
  const back = ctx._pintadeRequestFromRow(Object.assign({}, ctx._dumpPintadeRequestRow(q),
    { period_id: q.periodId, holder_id: q.holderId }));
  ok(ctx._pintadePhotoWasDeleted(back) === true, 'perdu à l\'aller-retour base');
});
t('sur une preuve DÉJÀ invalidée, la photo reste supprimable', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'hors sujet');                        // sans cocher la suppression
  ok(q.photoUrl, 'la photo a été supprimée sans qu\'on le demande');
  ok(ctx.pintadeCanDeletePhoto(q) === true, 'le bouton a disparu alors que la photo est là');
  ok(supprimerPhoto(q) === true, 'suppression refusée après invalidation');
  ok(ctx._pintadeStatus(q) === 'invalidated_by_coach', 'le statut a bougé');
  const row = ctx._pintadeFeedRow(q);
  ok(/Invalidée par le coach — photo supprimée/.test(row), 'mention absente : ' + row.slice(0, 200));
});
t('un RATÉ avec photo est aussi nettoyable (le chrono n\'excuse pas l\'image)', () => {
  seed('coach');
  const p = startGarde('pA', 30, 'coach');
  demande(); ouvrir();
  const q = lastReq();
  q.photoUrl = proofUrl(q.id); q.status = 'failed_timeout'; q.resolvedAt = NOW;
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.pintadeCanDeletePhoto(q) === true, 'aucun moyen de retirer une photo hors délai');
  ok(/openPintadeDeletePhoto/.test(ctx._pintadeFeedRow(q)), 'bouton absent de la ligne de raté');
  ok(supprimerPhoto(q) === true, 'suppression refusée');
  ok(ctx.pintadeStreak(p.id) === 1, 'la comptabilité a bougé : ' + ctx.pintadeStreak(p.id));
});
t('le bouton est coach-only et DISPARAÎT une fois la photo partie', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(/openPintadeDeletePhoto/.test(ctx._pintadeFeedRow(q)), 'le coach n\'a pas le bouton');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(!/openPintadeDeletePhoto/.test(ctx._pintadeFeedRow(q)), 'une joueuse voit le bouton');
  ok(ctx.pintadeDeleteProofPhoto(q.id) === false, 'une joueuse a pu supprimer la photo');
  ok(q.photoUrl, 'la photo a sauté quand même');
  supprimerPhoto(q);
  S.auth = { role: 'coach', coachId: 'admin' };
  // Un bouton qui ne fait plus rien est un piège.
  ok(!/openPintadeDeletePhoto/.test(ctx._pintadeFeedRow(q)), 'le bouton survit à la suppression');
  ok(ctx.pintadeDeleteProofPhoto(q.id) === false, 'double suppression acceptée');
});
t('la modale autonome ne laisse PAS croire qu\'elle invalide', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openPintadeDeletePhoto(q.id);
  const m = ctx.__lastModal || '';
  ok(/Supprimer définitivement/.test(m), 'pas de bouton de confirmation');
  ok(/reste <strong>valide<\/strong>/.test(m), 'la modale ne rassure pas sur le statut de la preuve');
  ok(!/_pintadeSubmitInvalidate/.test(m), 'la modale peut invalider par mégarde');
});
t('_pintadeStoragePath refuse tout ce qui ne vient pas de NOTRE bucket', () => {
  ok(ctx._pintadeStoragePath('https://x/storage/v1/object/public/pintade-proofs/proof-a-1.jpg') === 'proof-a-1.jpg');
  ok(ctx._pintadeStoragePath('https://evil.example/pintade-proofs/../../etc/passwd') === '',
    'un chemin de traversée est accepté');
  ok(ctx._pintadeStoragePath('https://x/storage/v1/object/public/autre-bucket/a.jpg') === '',
    'un bucket étranger est accepté');
  ok(ctx._pintadeStoragePath('') === '' && ctx._pintadeStoragePath(null) === '', 'entrée vide mal gérée');
});
t('aller-retour base : les trois colonnes d\'invalidation survivent', () => {
  seed('coach');
  startGarde('pA', 30, 'coach');
  const { q } = preuveOk('pB');
  invalider(q, 'peluche absente');
  const row = ctx._dumpPintadeRequestRow(q);
  ok(row.status === 'invalidated_by_coach', 'statut poussé = ' + row.status);
  ok(row.invalidated_by && row.invalidated_at && row.invalidation_reason === 'peluche absente', JSON.stringify(row));
  const back = ctx._pintadeRequestFromRow(Object.assign({}, row, { period_id: q.periodId, holder_id: q.holderId }));
  ok(back.status === 'invalidated_by_coach', 'statut relu = ' + back.status);
  ok(back.invalidationReason === 'peluche absente', 'motif perdu');
  ok(back.invalidatedAt === q.invalidatedAt, 'horodatage perdu à l\'aller-retour');
});

// =============================================================================
// LES HEURES DE REPOS (migration 20260812_001)
// -----------------------------------------------------------------------------
// Le jeu tournait 24 h sur 24. La v.107 avait déjà empêché les 30 secondes de la
// photo de s'écouler pendant qu'elle dort, mais rien n'interdisait la DEMANDE.
//
// CE QUI EST VERROUILLÉ ICI :
//   • le passage de minuit est le cas NORMAL (23 → 7), pas l'exception ;
//   • une plage « à l'endroit » (sieste 13 → 15) marche aussi ;
//   • start === end désactive la mécanique, sans drapeau supplémentaire ;
//   • les heures s'entendent en Europe/Paris, PAS dans le fuseau de l'appareil ;
//   • et surtout : l'échéance de connexion ne peut pas expirer pendant le repos
//     — sinon interdire les demandes de nuit ne servirait à rien, il suffirait
//     d'en lancer une à 22 h 55 pour la faire rater en dormant.
// =============================================================================
function reglesRepos(start, end, extra) {
  S.pintadeRules = Object.assign({}, ctx.PINTADE_RULES_DEFAULT,
    { restStartHour: start, restEndHour: end, updatedAt: NOW }, extra || {});
}
// Positionne l'horloge du test à une heure de PARIS donnée, ce jour-là.
function aParis(hour) {
  for (let i = 0; i < 48; i++) {
    if (ctx._pintadeParisHour(NOW) === hour) return;
    NOW += H;
  }
  throw new Error('heure de Paris introuvable : ' + hour);
}

t('le passage de minuit est le cas NORMAL (23 → 7)', () => {
  seed('coach'); reglesRepos(23, 7);
  [23, 0, 3, 6].forEach(h => ok(ctx._pintadeIsRestHour(h) === true, h + 'h devrait être du repos'));
  [7, 8, 12, 22].forEach(h => ok(ctx._pintadeIsRestHour(h) === false, h + 'h ne devrait PAS être du repos'));
});
t('une plage à l\'endroit marche aussi (sieste 13 → 15)', () => {
  seed('coach'); reglesRepos(13, 15);
  [13, 14].forEach(h => ok(ctx._pintadeIsRestHour(h) === true, h + 'h devrait être du repos'));
  [12, 15, 23, 0].forEach(h => ok(ctx._pintadeIsRestHour(h) === false, h + 'h ne devrait PAS être du repos'));
});
t('start === end désactive la mécanique', () => {
  seed('coach'); reglesRepos(9, 9);
  ok(ctx.pintadeRestEnabled() === false, 'le repos se croit actif');
  for (let h = 0; h < 24; h++) ok(ctx._pintadeIsRestHour(h) === false, h + 'h bloqué alors que le repos est coupé');
});
t('les heures s\'entendent en EUROPE/PARIS, pas dans le fuseau de l\'appareil', () => {
  seed('coach'); reglesRepos(23, 7);
  // 2026-08-10T21:30:00Z = 23 h 30 à Paris (heure d'été, UTC+2) → repos.
  ok(ctx.pintadeIsRestAt(RealDate.parse('2026-08-10T21:30:00Z')) === true, 'minuit parisien non reconnu');
  // …et 05 h 30 UTC = 07 h 30 à Paris → le repos est fini.
  ok(ctx.pintadeIsRestAt(RealDate.parse('2026-08-10T05:30:00Z')) === false, 'le réveil parisien n\'est pas vu');
  // En hiver (UTC+1) la même conversion doit suivre le changement d'heure.
  ok(ctx.pintadeIsRestAt(RealDate.parse('2026-01-15T22:30:00Z')) === true, 'heure d\'hiver mal convertie');
});
t('pendant le repos, la demande est REFUSÉE — et le bouton le dit', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(23, 7);
  aParis(2);                                   // 2 h du matin
  ok(ctx.pintadeIsRestNow() === true, 'préalable faux : ' + ctx._pintadeParisHour(NOW) + 'h');
  const why = ctx.pintadeRequestBlockedReason();
  ok(/Repos jusqu/.test(why || ''), 'raison donnée : ' + why);
  ok(ctx.pintadeCanRequest() === false, 'le créneau est ouvert en pleine nuit');
  const avant = (S.pintadeRequests || []).length;
  ok(ctx.requestPintadeProof() === false, 'une demande est partie en pleine nuit');
  ok((S.pintadeRequests || []).length === avant, 'une demande a été écrite malgré le refus');
});
t('le repos passe AVANT le rate limit (la raison la plus longue prime)', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(23, 7);
  aParis(14); demande();                       // une demande en journée
  aParis(2);                                   // …puis on arrive dans la nuit
  const why = ctx.pintadeRequestBlockedReason();
  ok(/Repos jusqu/.test(why || ''), 'on annonce « dans X min » en pleine nuit : ' + why);
});
t('hors repos, tout redevient normal', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(23, 7);
  aParis(10);
  ok(ctx.pintadeIsRestNow() === false, 'il est ' + ctx._pintadeParisHour(NOW) + 'h et on se croit la nuit');
  ok(ctx.pintadeCanRequest() === true, 'bloqué en pleine journée : ' + ctx.pintadeRequestBlockedReason());
});

// --- LE TROU DE LA FRONTIÈRE -------------------------------------------------
t('une demande juste AVANT le repos ne peut pas expirer pendant la nuit', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(23, 7, { connectWindowHours: 2 });
  aParis(22);                                  // 22 h : la fenêtre de 2 h finit à 0 h
  demande();
  const q = lastReq();
  const h = ctx._pintadeParisHour(q.connectDeadlineAt);
  ok(!ctx.pintadeIsRestAt(q.connectDeadlineAt),
    'échéance en plein repos (' + h + 'h) → elle rate en dormant, comme avant la v.107');
  ok(h === 7, 'échéance reportée à ' + h + 'h au lieu de la fin du repos');
  // …et elle ne rate PAS tant que le repos dure.
  aParis(3);
  ok(ctx._pintadeStatus(q) === 'pending', 'ratée en pleine nuit : ' + ctx._pintadeStatus(q));
});
t('…mais une demande en pleine journée garde sa fenêtre normale', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(23, 7, { connectWindowHours: 2 });
  aParis(10);
  demande();
  const q = lastReq();
  ok(q.connectDeadlineAt === NOW + 2 * H, 'fenêtre rallongée sans raison');
});
t('repos coupé → aucune échéance n\'est reportée', () => {
  seed('player', 'pB');
  startGarde('pA', 30, 'player', 'pB');
  reglesRepos(9, 9, { connectWindowHours: 2 });
  aParis(22);
  demande();
  ok(lastReq().connectDeadlineAt === NOW + 2 * H, 'report appliqué alors que le repos est coupé');
});

// --- CONFIG COACH + TEXTE ----------------------------------------------------
t('l\'écran de configuration expose les deux heures', () => {
  seed('coach'); reglesRepos(23, 7);
  ctx.openPintadeRules();
  const m = ctx.__lastModal || '';
  ok(/id="pr-rest-start"/.test(m) && /id="pr-rest-end"/.test(m), 'listes déroulantes absentes');
  ok(/<option value="23" selected>23h<\/option>/.test(m), 'heure de début non présélectionnée');
  ok(/<option value="7" selected>7h<\/option>/.test(m), 'heure de fin non présélectionnée');
  ok(/désactiver le repos/.test(m), 'on n\'explique pas comment couper la mécanique');
});
t('les deux heures font l\'aller-retour base', () => {
  seed('coach'); reglesRepos(1, 6);
  const row = ctx._dumpPintadeRulesRow(S.pintadeRules);
  ok(row.rest_start_hour === 1 && row.rest_end_hour === 6, JSON.stringify(row));
  const back = ctx._pintadeRulesFromRow(row);
  ok(back.restStartHour === 1 && back.restEndHour === 6, JSON.stringify(back));
  // Une base pas encore migrée retombe sur les défauts, sans planter.
  const vieux = ctx._pintadeRulesFromRow({ id: 'default' });
  ok(vieux.restStartHour === 23 && vieux.restEndHour === 7, JSON.stringify(vieux));
});
t('le texte par défaut annonce les heures de repos', () => {
  seed('coach');
  const txt = ctx.pintadeRulesText();     // rulesText vide → texte de référence
  ok(/Heures de repos/.test(txt), 'les règles n\'en parlent pas');
  ok(/23h et 7h/.test(txt), 'les heures par défaut ne sont pas citées');
  ok(/on ne rate pas en dormant/.test(txt),
    'la garantie de la frontière n\'est pas annoncée aux joueuses');
});

console.log('\n' + R.join('\n'));
const bad = R.filter(r => r.startsWith('✗'));
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' OK');
process.exit(bad.length ? 1 : 0);
