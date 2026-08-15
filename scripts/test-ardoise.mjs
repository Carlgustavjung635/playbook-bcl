// Test L'ARDOISE — dettes sportives « menu du chef » (migration 20260815_001).
//
// Le coach ardoise une joueuse ; elle TIRE son menu au sort ; elle a N jours
// pour le consommer. Non consommé → la dette expire ET une nouvelle la remplace,
// déjà tirée, avec un nouveau délai.
//
// CHOIX STRUCTURANTS verrouillés ici — ce sont eux qui cassent en silence :
//   • RIEN n'est compté en base : nombre de dettes, dette courante, total de
//     points se DÉRIVENT des assignations ;
//   • la dette de pénalité, elle, est bien une LIGNE — et c'est le DÉTERMINISME
//     (id calculé depuis le parent, dates calculées, menu tiré par hachage) qui
//     empêche onze appareils d'en écrire onze. C'est LE test central de ce
//     fichier : sans lui, la feature fabrique des dettes fantômes ;
//   • UN SEUL menu à la fois : une dette déjà tirée passe TOUJOURS devant celles
//     qui attendent leur tirage, même si le coach les a posées avant ;
//   • `done_home` n'expire JAMAIS : la joueuse a envoyé sa preuve, la lenteur du
//     coach ne doit pas lui coûter une pénalité ;
//   • le remplacement est 1-pour-1 : une chaîne de trois semaines d'absence ne
//     doit pas produire quatre dettes, mais une ;
//   • les points sont FIGÉS à la validation : changer le barème d'un menu ne
//     réécrit pas l'historique ;
//   • un refus de preuve n'est PAS un état terminal ;
//   • un menu ou un exo supprimé ne casse aucune dette déjà tirée.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\n;globalThis.ARDOISE_RULES_DEFAULT = ARDOISE_RULES_DEFAULT;'
  + '\n;globalThis.ARDOISE_DAY = ARDOISE_DAY;';

// Le bloc <script type="module"> porte les dump/apply PbSync : on le charge pour
// vérifier que les entités ardoise sont bien déclarées et que le dump ne casse
// pas sur une dette réelle. Ses fonctions ne franchissent PAS la frontière des
// blocs — d'où l'export explicite d'ENTITIES.
const moduleBlock = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && /type\s*=\s*["']module["']/.test(m[1]))
  .map(m => m[2])[0]
  .replace(/^\s*import\s[^\n]*\n/m, '')
  + '\n;globalThis.ENTITIES = ENTITIES;';

const store = {};
const fields = {};
const mkEl = (id) => ({ id: id || '', style: {}, className: '', innerHTML: '', textContent: '', value: '',
  checked: false, disabled: false, files: [],
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, getAttribute: () => null, focus() {} });
const doc = {
  getElementById: (id) => {
    if (id === 'modal-root') return null;
    if (id in fields) return { value: fields[id], textContent: '', checked: !!fields[id] };
    return mkEl(id);
  },
  createElement: () => mkEl(),
  querySelector: () => null,
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
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'égalité') + ' : ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); };

const S = ctx.state;
ctx.render = () => {}; ctx.showToast = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = null; };
const pushes = [];
ctx.notifyPush = (keys, payload) => { pushes.push({ keys, payload }); };

// --- horloge maîtrisée -------------------------------------------------------
const RealDate = Date;
let NOW = RealDate.parse('2026-08-15T10:00:00Z');
class D extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
ctx.Date = D;
const advance = ms => { NOW += ms; };
const DAY = 86400000;

function seed(role, pid) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  pushes.length = 0;
  ctx._ardWatch = null; ctx._ardOverlayOpen = false; ctx._ardMenuDraft = null;
  NOW = RealDate.parse('2026-08-15T10:00:00Z');
  S.auth = (role === 'coach') ? { role: 'coach', coachId: 'admin' } : { role: 'player', playerId: pid || 'pA' };
  S.players = [
    { id: 'pA', num: 4, name: 'Alice' },
    { id: 'pB', num: 7, name: 'Bea' },
    { id: 'pC', num: 9, name: 'Cléo' }
  ];
  S.seasons = []; S.seasonPlayers = []; S.currentSeasonId = null;
  S.ardoiseAssignments = [];
  S.ardoiseRules = null;                     // → défauts (7 j, plafond 10)
  S.exoTemplates = [
    { id: 'e1', name: 'Gainage planche', category: 'gainage', defaultSets: 3, defaultReps: null, defaultDurationSec: 45, defaultRestSec: 30, descriptionMd: 'Dos plat', updatedAt: 1 },
    { id: 'e2', name: 'Squats', category: 'jambes', defaultSets: 4, defaultReps: 15, defaultDurationSec: null, defaultRestSec: 45, descriptionMd: '', updatedAt: 1 }
  ];
  S.ardoiseMenus = [
    { id: 'm1', name: 'Le Gainage Royal', level: 'plat', items: [{ exo_id: 'e1', name: 'Gainage planche', sets: 3, reps: null, duration_sec: 45, rest_sec: 30, note: '', order: 0 }], pointsReward: 20, isActive: true, updatedAt: 1 },
    { id: 'm2', name: 'Cuisses de feu', level: 'feu', items: [{ exo_id: 'e2', name: 'Squats', sets: 4, reps: 15, duration_sec: null, rest_sec: 45, note: '', order: 0 }], pointsReward: 40, isActive: true, updatedAt: 1 },
    { id: 'm3', name: 'Mise en bouche', level: 'starter', items: [{ exo_id: 'e2', name: 'Squats', sets: 2, reps: 10, duration_sec: null, rest_sec: 30, note: '', order: 0 }], pointsReward: 10, isActive: true, updatedAt: 1 }
  ];
}
// Tire la dette au sort SANS passer par l'animation (qui vit dans des
// setTimeout stubés) : on appelle directement l'écriture, qui est le sujet.
const draw = (aid) => ctx._ardCommitDraw(aid);

// =============================================================================
console.log('\n=== ASSIGNATION ===');

t('le coach ardoise : N dettes en pending_draw, empilées (2 + 2 = 4)', () => {
  seed('coach');
  eq(ctx.ardoiseAssign('pA', 2), 2, 'premier lot');
  eq(ctx.ardoiseDebtCount('pA'), 2, 'après le 1er lot');
  ctx.ardoiseAssign('pA', 2);
  eq(ctx.ardoiseDebtCount('pA'), 4, 'les dettes S\'EMPILENT');
  ok(ctx.ardoiseAssignmentsOf('pA').every(a => a.status === 'pending_draw'), 'toutes en attente de tirage');
  ok(ctx.ardoiseAssignmentsOf('pA').every(a => !a.menuId), 'aucune n\'est pré-tirée par le coach');
});

t('une joueuse ne peut PAS s\'ardoiser elle-même', () => {
  seed('player', 'pA');
  eq(ctx.ardoiseAssign('pA', 3), 0, 'assignation refusée hors rôle coach');
  eq(ctx.ardoiseDebtCount('pA'), 0);
});

t('le plafond borne l\'ajout, il ne le refuse pas silencieusement', () => {
  seed('coach');
  ctx.ardoiseAssign('pA', 5);
  ctx.ardoiseAssign('pA', 5);
  eq(ctx.ardoiseDebtCount('pA'), 10, 'plafond par défaut');
  eq(ctx.ardoiseAssign('pA', 3), 0, 'au plafond, plus rien n\'entre');
  eq(ctx.ardoiseDebtCount('pA'), 10, 'et le compteur ne bouge pas');
});

t('les dettes d\'une joueuse ne comptent pas pour une autre', () => {
  seed('coach');
  ctx.ardoiseAssign('pA', 3);
  eq(ctx.ardoiseDebtCount('pA'), 3);
  eq(ctx.ardoiseDebtCount('pB'), 0);
});

// =============================================================================
console.log('\n=== UN SEUL MENU À LA FOIS ===');

t('la dette courante est la première en attente de tirage', () => {
  seed('player', 'pA');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.ardoiseAssign('pA', 3);
  S.auth = { role: 'player', playerId: 'pA' };
  const cur = ctx.ardoiseCurrentDebt('pA');
  ok(cur, 'il y a une dette courante');
  eq(cur.id, ctx.ardoiseAssignmentsOf('pA')[0].id, 'la plus ancienne');
});

t('une fois une dette tirée, les autres ne sont PAS tirables', () => {
  seed('player', 'pA');
  S.auth = { role: 'coach', coachId: 'admin' }; ctx.ardoiseAssign('pA', 3);
  S.auth = { role: 'player', playerId: 'pA' };
  const list = ctx.ardoiseAssignmentsOf('pA');
  draw(list[0].id);
  eq(list[0].status, 'in_progress');
  ok(!ctx.ardoiseCanDraw(list[1]), 'la 2e attend en cuisine');
  ok(!ctx.ardoiseCanDraw(list[2]), 'la 3e aussi');
  eq(ctx.ardoiseCurrentDebt('pA').id, list[0].id, 'la courante reste celle qui tourne');
});

t('une dette DÉJÀ TIRÉE passe devant celles qui attendent leur tirage', () => {
  // C'est l'invariant qui empêche deux chronos de tourner en parallèle : une
  // pénalité auto-tirée arrive APRÈS des dettes en attente, et doit quand même
  // être la courante.
  seed('coach');
  ctx.ardoiseAssign('pA', 2);            // deux pending_draw, anciennes
  advance(DAY);
  const late = { id: 'xLATE', playerId: 'pA', menuId: 'm1', drawnAt: NOW, deadlineAt: NOW + 7 * DAY,
    status: 'in_progress', assignedBy: 'system', assignedAt: NOW, pointsAwarded: 0,
    parentId: null, notes: '', seasonId: null, createdAt: NOW, updatedAt: NOW, deletedAt: null };
  S.ardoiseAssignments.push(late);
  eq(ctx.ardoiseCurrentDebt('pA').id, 'xLATE', 'la dette en cours prime sur l\'ancienneté');
});

t('une joueuse ne peut pas tirer la dette d\'une autre', () => {
  seed('coach'); ctx.ardoiseAssign('pB', 1);
  S.auth = { role: 'player', playerId: 'pA' };
  ok(!ctx.ardoiseCanDraw(ctx.ardoiseAssignmentsOf('pB')[0]), 'tirage refusé');
});

t('le tirage FIGE le menu, la date et l\'échéance', () => {
  seed('coach'); ctx.ardoiseAssign('pA', 1);
  S.auth = { role: 'player', playerId: 'pA' };
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  draw(a.id);
  ok(a.menuId, 'un menu est tiré');
  eq(a.drawnAt, NOW, 'daté du tirage');
  eq(a.deadlineAt, NOW + 7 * DAY, 'échéance = tirage + 7 jours');
  // Le coach change le délai APRÈS coup : la dette déjà tirée garde son contrat.
  S.ardoiseRules = Object.assign({}, ctx.ARDOISE_RULES_DEFAULT, { deadlineDays: 30, updatedAt: NOW });
  eq(a.deadlineAt, NOW + 7 * DAY, 'l\'échéance ne se recalcule JAMAIS à la lecture');
});

// =============================================================================
console.log('\n=== LA PÉNALITÉ AUTOMATIQUE : DÉTERMINISME ===');

// Le scénario de référence : une dette tirée, jamais faite, échéance dépassée.
function scenarioExpired() {
  seed('coach');
  ctx.ardoiseAssign('pA', 1);
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  S.auth = { role: 'player', playerId: 'pA' }; draw(a.id);
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(8 * DAY);
  return a;
}

t('échéance dépassée → la dette expire et une remplaçante naît, déjà tirée', () => {
  const a = scenarioExpired();
  ok(ctx.ardoiseSweep(), 'le balayage a écrit');
  eq(a.status, 'expired_penalized', 'la dette est morte');
  const next = S.ardoiseAssignments.find(x => x.parentId === a.id);
  ok(next, 'une remplaçante existe');
  eq(next.status, 'in_progress', 'elle arrive DÉJÀ tirée — sinon la sanction s\'esquive en n\'ouvrant pas l\'app');
  ok(next.menuId, 'avec son menu');
  eq(next.drawnAt, a.deadlineAt, 'datée de l\'ÉCHÉANCE, pas de l\'instant du constat');
  eq(next.deadlineAt, a.deadlineAt + 7 * DAY, 'nouveau délai plein');
});

t('l\'id de la remplaçante est CALCULÉ depuis le parent (et commence par « x »)', () => {
  const a = scenarioExpired();
  ctx.ardoiseSweep();
  const next = S.ardoiseAssignments.find(x => x.parentId === a.id);
  eq(next.id, ctx._ardPenaltyIdFor(a.id), 'id dérivé, pas tiré au hasard');
  ok(next.id.startsWith('x'), 'préfixe « x » = heuristique anti-wipe de PbSync');
});

t('ONZE APPAREILS écrivent la MÊME ligne — id ET menu identiques', () => {
  // Le test central. Chaque « appareil » repart du même état d'avant balayage,
  // avec sa propre liste de menus dans un ordre différent (rien ne garantit
  // l'ordre d'arrivée d'un fetch).
  const a = scenarioExpired();
  const snapshot = JSON.stringify(S.ardoiseAssignments);
  const menus = JSON.stringify(S.ardoiseMenus);
  const results = [];
  for (let dev = 0; dev < 11; dev++) {
    S.ardoiseAssignments = JSON.parse(snapshot);
    const shuffled = JSON.parse(menus);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (dev * 7 + i * 3) % (i + 1);
      const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    S.ardoiseMenus = shuffled;
    // Les appareils ne constatent pas au même instant.
    NOW = a.deadlineAt + (dev + 1) * 3600000;
    ctx.ardoiseSweep({ silent: true });
    const next = S.ardoiseAssignments.find(x => x.parentId === a.id);
    results.push({ id: next.id, menuId: next.menuId, drawnAt: next.drawnAt, deadlineAt: next.deadlineAt });
  }
  const first = JSON.stringify(results[0]);
  results.forEach((r, i) => eq(JSON.stringify(r), first, 'appareil #' + i + ' diverge'));
});

t('le balayage est IDEMPOTENT : le rejouer ne crée rien', () => {
  const a = scenarioExpired();
  ctx.ardoiseSweep();
  const n1 = S.ardoiseAssignments.length;
  advance(3600000); ctx.ardoiseSweep();
  advance(3600000); ctx.ardoiseSweep();
  eq(S.ardoiseAssignments.length, n1, 'aucune dette fantôme');
});

t('trois semaines hors ligne → une chaîne, PAS quatre dettes', () => {
  const a = scenarioExpired();
  advance(30 * DAY);                        // ~5 cycles de 7 jours d'un coup
  ctx.ardoiseSweep();
  eq(ctx.ardoiseDebtCount('pA'), 1, 'le remplacement est 1-pour-1');
  const chain = S.ardoiseAssignments.filter(x => x.playerId === 'pA');
  ok(chain.length >= 4, 'la chaîne est bien matérialisée (' + chain.length + ' maillons)');
  const live = ctx.ardoiseLiveDebts('pA')[0];
  ok(live.deadlineAt > NOW, 'le dernier maillon a une échéance FUTURE — sinon la chaîne n\'a pas convergé');
  // Et la chaîne est reproductible : deux appareils obtiennent la même.
  const ids = chain.map(x => x.id).sort().join('|');
  S.ardoiseAssignments = S.ardoiseAssignments.filter(x => x.id === a.id);
  a.status = 'in_progress';
  ctx.ardoiseSweep({ silent: true });
  eq(S.ardoiseAssignments.filter(x => x.playerId === 'pA').map(x => x.id).sort().join('|'), ids,
    'la chaîne rejouée est identique');
});

// ÉCART ASSUMÉ AVEC LA SPÉCIFICATION D'ORIGINE — à relire avant de « corriger ».
// La spec disait : « au plafond, l'expiration ne régénère rien ». Appliqué
// littéralement, le plafond devient une PORTE DE SORTIE : une joueuse à 10
// dettes n'a qu'à ne rien faire pendant 10 semaines pour que ses ardoises
// s'éteignent une à une jusqu'à zéro — l'inaction totale serait donc la
// stratégie optimale, exactement l'inverse de ce que la feature cherche.
//
// Le remplacement est donc TOUJOURS 1-pour-1 : le plafond ne peut pas être
// dépassé (une dette meurt avant que sa remplaçante ne naisse), mais il ne
// décroît pas non plus tout seul. Le plafond garde son vrai rôle : borner ce
// que le coach ajoute. La garde `>= maxDebts` du code reste utile pour une
// donnée importée ou aberrante.
t('au plafond, l\'expiration remplace 1-pour-1 — le plafond n\'est pas une porte de sortie', () => {
  seed('coach');
  ctx.ardoiseAssign('pA', 10);
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  S.auth = { role: 'player', playerId: 'pA' }; draw(a.id);
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(8 * DAY);
  ctx.ardoiseSweep();
  eq(a.status, 'expired_penalized', 'elle expire');
  ok(S.ardoiseAssignments.find(x => x.parentId === a.id), 'et elle est remplacée');
  eq(ctx.ardoiseDebtCount('pA'), 10, 'le compteur ne monte pas, mais ne descend pas non plus');
});

t('la garde de plafond tient face à une donnée aberrante (11 dettes en base)', () => {
  seed('coach');
  ctx.ardoiseAssign('pA', 10);
  // Une 11e dette « impossible », comme un import pourrait en produire.
  const extra = ctx.ardoiseAssignmentsOf('pA')[0];
  S.ardoiseAssignments.push(Object.assign({}, extra, { id: 'xEXTRA', assignedAt: extra.assignedAt + 1 }));
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  S.auth = { role: 'player', playerId: 'pA' }; draw(a.id);
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(8 * DAY);
  ctx.ardoiseSweep();
  ok(!S.ardoiseAssignments.find(x => x.parentId === a.id), 'au-dessus du plafond, on ne régénère pas');
  eq(ctx.ardoiseDebtCount('pA'), 10, 'et l\'anomalie se résorbe');
});

t('pénalité désactivée : la dette expire sans remplaçante', () => {
  seed('coach');
  S.ardoiseRules = Object.assign({}, ctx.ARDOISE_RULES_DEFAULT, { autoPenaltyOnExpire: false, updatedAt: 1 });
  ctx.ardoiseAssign('pA', 1);
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  S.auth = { role: 'player', playerId: 'pA' }; draw(a.id);
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(8 * DAY); ctx.ardoiseSweep();
  eq(a.status, 'expired_penalized');
  ok(!S.ardoiseAssignments.find(x => x.parentId === a.id), 'aucune remplaçante');
});

t('une dette PAS ENCORE TIRÉE n\'expire jamais — son chrono n\'a pas démarré', () => {
  seed('coach');
  ctx.ardoiseAssign('pA', 2);
  advance(60 * DAY);
  ctx.ardoiseSweep();
  eq(ctx.ardoiseDebtCount('pA'), 2, 'elles attendent toujours leur tirage');
  ok(ctx.ardoiseAssignmentsOf('pA').every(x => x.status === 'pending_draw'));
});

t('une joueuse ne balaie QUE ses propres dettes', () => {
  seed('coach');
  ['pA', 'pB'].forEach(p => {
    ctx.ardoiseAssign(p, 1);
    const a = ctx.ardoiseLiveDebts(p)[0];
    S.auth = { role: 'player', playerId: p }; draw(a.id);
    S.auth = { role: 'coach', coachId: 'admin' };
  });
  advance(8 * DAY);
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.ardoiseSweep();
  eq(ctx.ardoiseAssignmentsOf('pA').find(x => x.status === 'expired_penalized') !== undefined, true, 'la sienne est traitée');
  ok(!ctx.ardoiseAssignmentsOf('pB').some(x => x.status === 'expired_penalized'), 'celle de Bea est laissée au coach');
});

// =============================================================================
console.log('\n=== PREUVE ET VALIDATION ===');

function scenarioDrawn() {
  seed('coach'); ctx.ardoiseAssign('pA', 1);
  const a = ctx.ardoiseAssignmentsOf('pA')[0];
  S.auth = { role: 'player', playerId: 'pA' }; draw(a.id);
  return a;
}

t('preuve envoyée (done_home) : la dette SORT du chrono d\'expiration', () => {
  const a = scenarioDrawn();
  a.status = 'done_home'; a.proofPhotoUrl = 'https://x/p.jpg'; a.updatedAt = NOW;
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(30 * DAY);
  ctx.ardoiseSweep();
  eq(a.status, 'done_home', 'la lenteur du coach ne coûte RIEN à la joueuse');
  ok(!S.ardoiseAssignments.find(x => x.parentId === a.id), 'aucune pénalité');
  eq(ctx.ardoiseDebtCount('pA'), 1, 'mais la dette reste due tant qu\'il n\'a pas validé');
});

t('validation : points FIGÉS depuis le barème du menu au moment du geste', () => {
  const a = scenarioDrawn();
  a.menuId = 'm2';                       // « Cuisses de feu » — 40 points
  a.status = 'done_home';
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.ardoiseValidate(a.id, false));
  eq(a.status, 'done_validated');
  eq(a.pointsAwarded, 40);
  eq(ctx.ardoisePointsOf('pA'), 40);
  eq(ctx.ardoiseDebtCount('pA'), 0, 'la dette est soldée');
  // Le coach change le barème : l'historique ne bouge pas.
  S.ardoiseMenus.find(m => m.id === 'm2').pointsReward = 5;
  eq(a.pointsAwarded, 40, 'points figés');
  eq(ctx.ardoisePointsOf('pA'), 40, 'et le total avec');
});

t('validation « vu à l\'entraînement » sur une dette en cours', () => {
  const a = scenarioDrawn();
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.ardoiseValidate(a.id, true));
  eq(a.status, 'done_at_training');
  ok(a.pointsAwarded > 0, 'elle marque aussi des points');
  eq(ctx.ardoiseDoneCount('pA'), 1);
});

t('une joueuse ne peut pas valider sa propre ardoise', () => {
  const a = scenarioDrawn();
  ok(!ctx.ardoiseValidate(a.id, true), 'refusé hors rôle coach');
  eq(a.status, 'in_progress');
});

t('déclarer « fait à l\'entraînement » N\'AUTO-VALIDE PAS — le coach tranche', () => {
  const a = scenarioDrawn();
  ok(ctx.ardoiseDeclareAtTraining(a.id));
  eq(a.status, 'in_progress', 'la dette reste ouverte');
  ok(pushes.some(p => p.payload.type === 'ardoise_declared'), 'mais le coach est prévenu');
});

t('refus de preuve : retour en cours, PAS un état terminal', () => {
  const a = scenarioDrawn();
  const dl = a.deadlineAt;
  a.status = 'done_home';
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.ardoiseRejectProof(a.id, 'on ne voit pas l\'exercice'));
  eq(a.status, 'in_progress');
  eq(a.deadlineAt, dl, 'l\'échéance d\'origine est conservée — pas de double peine');
  eq(ctx.ardoiseDebtCount('pA'), 1, 'la dette est toujours due');
  ok(/refusée/i.test(a.notes), 'le motif est tracé');
  ok(pushes.some(p => p.payload.type === 'ardoise_rejected'));
});

t('prolonger repart de MAINTENANT si l\'échéance est déjà passée', () => {
  const a = scenarioDrawn();
  S.auth = { role: 'coach', coachId: 'admin' };
  advance(20 * DAY);
  ctx.ardoiseExtend(a.id, 3);
  ok(a.deadlineAt >= NOW + 3 * DAY - 1000, '« +3 jours » doit laisser 3 jours réels');
});

t('effacer une dette = SOFT delete (jamais de hard delete sur un id « x… »)', () => {
  const a = scenarioDrawn();
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.ardoiseCancel(a.id));
  ok(a.deletedAt, 'marquée supprimée');
  ok(S.ardoiseAssignments.some(x => x.id === a.id), 'la ligne EXISTE toujours — sinon tout client la repousserait au flush');
  eq(ctx.ardoiseDebtCount('pA'), 0);
});

// =============================================================================
console.log('\n=== BIBLIOTHÈQUE ET MENUS ===');

t('un menu désactivé sort du tirage mais reste lisible', () => {
  seed('coach');
  S.ardoiseMenus.find(m => m.id === 'm2').isActive = false;
  ok(!ctx.ardoiseDrawPool().some(m => m.id === 'm2'), 'hors vivier');
  ok(ctx.ardoiseMenuById('m2'), 'toujours lisible par id');
});

t('un menu VIDE n\'est jamais tiré', () => {
  seed('coach');
  S.ardoiseMenus.push({ id: 'mV', name: 'Vide', level: 'plat', items: [], pointsReward: 10, isActive: true, updatedAt: 1 });
  ok(!ctx.ardoiseDrawPool().some(m => m.id === 'mV'));
});

t('un menu SUPPRIMÉ reste lisible sur les dettes qui le portent', () => {
  const a = scenarioDrawn();
  const mid = a.menuId;
  const m = S.ardoiseMenus.find(x => x.id === mid);
  m.deletedAt = NOW; m.updatedAt = NOW;
  ok(!ctx.ardoiseDrawPool().some(x => x.id === mid), 'plus tirable');
  ok(ctx.ardoiseMenuById(mid), 'mais la dette d\'Alice affiche encore son menu');
});

t('un exo supprimé ne vide pas les menus (nom et dose y sont RECOPIÉS)', () => {
  seed('coach');
  const e = S.exoTemplates.find(x => x.id === 'e1');
  e.deletedAt = NOW;
  eq(ctx.exoTemplateById('e1'), null, 'hors bibliothèque');
  const m = ctx.ardoiseMenuById('m1');
  eq(m.items[0].name, 'Gainage planche', 'la ligne du menu survit intacte');
  ok(ctx.ardoiseDrawPool().some(x => x.id === 'm1'), 'et le menu reste tirable');
});

t('la dose s\'écrit sans inventer ce qui n\'est pas renseigné', () => {
  eq(ctx._ardDoseLabel({ sets: 3, reps: 12, rest_sec: 30 }), '3 × 12 · repos 30 s');
  eq(ctx._ardDoseLabel({ duration_sec: 45 }), '45 s');
  eq(ctx._ardDoseLabel({ sets: 4, duration_sec: 40, rest_sec: 20 }), '4 × 40 s · repos 20 s');
  eq(ctx._ardDoseLabel({ reps: 20 }), '20 reps');
  eq(ctx._ardDoseLabel({}), '—', 'rien à dire → rien d\'inventé');
  eq(ctx._ardDoseLabel({ sets: 1, reps: 10, rest_sec: 30 }), '1 × 10', 'pas de repos annoncé sur une seule série');
});

// =============================================================================
console.log('\n=== SYNCHRO (entités PbSync) ===');

t('les 4 entités ardoise sont déclarées', () => {
  const keys = ctx.ENTITIES.map(e => e.key);
  ['exoTemplates', 'ardoiseMenus', 'ardoiseAssignments', 'ardoiseRules'].forEach(k =>
    ok(keys.includes(k), 'entité manquante : ' + k));
});

t('le dump d\'une dette réelle produit des colonnes valides', () => {
  const a = scenarioDrawn();
  const ent = ctx.ENTITIES.find(e => e.key === 'ardoiseAssignments');
  const rows = ent.dump(S);
  const row = rows[a.id];
  ok(row, 'la dette est dumpée');
  eq(row.player_id, 'pA');
  eq(row.status, 'in_progress');
  ok(typeof row.deadline_at === 'string', 'échéance ISO');
  eq(row.points_awarded, 0);
  // Aller-retour : le apply doit rendre la dette telle quelle.
  const before = JSON.stringify({ s: a.status, m: a.menuId, d: a.deadlineAt });
  ent.apply(S, Object.values(rows));
  const after = ctx.ardoiseAssignmentById(a.id);
  eq(JSON.stringify({ s: after.status, m: after.menuId, d: after.deadlineAt }), before, 'aller-retour stable');
});

t('les règles ne sont PAS poussées tant que le coach n\'a rien réglé', () => {
  seed('coach');
  const ent = ctx.ENTITIES.find(e => e.key === 'ardoiseRules');
  eq(Object.keys(ent.dump(S)).length, 0, 'sinon on écraserait la ligne seedée par la migration');
  S.ardoiseRules = Object.assign({}, ctx.ARDOISE_RULES_DEFAULT, { deadlineDays: 14, updatedAt: NOW });
  eq(ent.dump(S).default.deadline_days, 14, 'une fois réglées, elles partent');
});

t('un statut inconnu est ramené à pending_draw, pas propagé', () => {
  const a = scenarioDrawn();
  a.status = 'n_importe_quoi';
  const ent = ctx.ENTITIES.find(e => e.key === 'ardoiseAssignments');
  eq(ent.dump(S)[a.id].status, 'pending_draw', 'une valeur hors CHECK gèlerait la synchro de TOUTE la table');
});

// =============================================================================
console.log('\n=== NOTIFICATIONS ===');

t('ardoiser pousse une notif à la joueuse', () => {
  seed('coach'); pushes.length = 0;
  ctx.ardoiseAssign('pA', 2);
  const p = pushes.find(x => x.payload.type === 'ardoise_assign');
  ok(p, 'push envoyé');
  eq(p.keys[0], 'player:pA');
});

t('la pénalité ne notifie QU\'UNE FOIS, même après dix balayages', () => {
  const a = scenarioExpired();
  pushes.length = 0;
  for (let i = 0; i < 10; i++) { ctx.ardoiseSweep(); advance(60000); }
  const n = pushes.filter(x => x.payload.type === 'ardoise_penalty').length;
  eq(n, 1, 'filigrane local anti-doublon');
});

t('valider notifie la joueuse avec ses points', () => {
  const a = scenarioDrawn();
  a.status = 'done_home';
  S.auth = { role: 'coach', coachId: 'admin' };
  pushes.length = 0;
  ctx.ardoiseValidate(a.id, false);
  const p = pushes.find(x => x.payload.type === 'ardoise_validated');
  ok(p && /points/.test(p.payload.body), 'les points sont annoncés');
});

// =============================================================================
console.log('\n=== RENDU ===');

t('la carte d\'accueil joueuse est MUETTE sans dette', () => {
  seed('player', 'pA');
  eq(ctx.renderArdoisePlayerCard(), '', 'aucune carte');
});

t('la carte d\'accueil joueuse annonce le nombre de dettes', () => {
  seed('coach'); ctx.ardoiseAssign('pA', 3);
  S.auth = { role: 'player', playerId: 'pA' };
  const h = ctx.renderArdoisePlayerCard();
  ok(/3 à consommer/.test(h), 'compteur visible');
  ok(/tire ton menu/i.test(h), 'et le geste attendu');
});

t('la carte coach est muette quand rien ne circule', () => {
  seed('coach');
  eq(ctx.renderArdoiseCoachCard(), '', 'l\'accueil coach est déjà chargé');
});

t('la carte menu affiche la dose, les points et le temps restant', () => {
  const a = scenarioDrawn();
  a.menuId = 'm1';
  const h = ctx._ardMenuCardHtml(ctx.ardoiseMenuById('m1'), a);
  ok(/Le Gainage Royal/.test(h), 'le nom');
  ok(/3 × 45 s/.test(h), 'la dose');
  ok(/\+20 points/.test(h), 'les points');
  ok(/7 jours restants/.test(h), 'le délai');
});

t('la carte menu passe au rouge quand l\'échéance est dépassée', () => {
  const a = scenarioDrawn();
  advance(9 * DAY);
  const h = ctx._ardMenuCardHtml(ctx.ardoiseMenuById(a.menuId), a);
  ok(/en retard de 2 jours/.test(h), 'le retard est chiffré, pas juste signalé');
});

t('l\'écran joueuse et l\'écran coach s\'ouvrent sans throw', () => {
  const a = scenarioDrawn();
  ctx.openArdoiseScreen();
  ok(/Mon Ardoise/.test(ctx.__lastModal || ''), 'écran joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openArdoiseCoach('debts');
  ok(/L'Ardoise/.test(ctx.__lastModal || ''), 'écran coach');
  ctx.openArdoiseCoach('menus'); ok(/La carte/.test(ctx.__lastModal || ''), 'onglet menus');
  ctx.openArdoiseCoach('exos'); ok(/Biblioth/.test(ctx.__lastModal || ''), 'onglet biblio');
  ctx.openArdoiseCoach('config'); ok(/Plafond/.test(ctx.__lastModal || ''), 'onglet réglages');
});

t('la cloche joueuse relance sur la dette courante', () => {
  seed('coach'); ctx.ardoiseAssign('pA', 2);
  S.auth = { role: 'player', playerId: 'pA' };
  const feed = ctx.notifFeed();
  const item = feed.find(x => String(x.id).startsWith('ardoise-'));
  ok(item, 'entrée présente');
  ok(/tirer/i.test(item.title), 'elle dit quoi faire');
  ok(/1 autre en cuisine/.test(item.detail), 'et combien attendent derrière');
});

t('la cloche coach relance sur les preuves à valider', () => {
  const a = scenarioDrawn();
  a.status = 'done_home'; a.updatedAt = NOW;
  S.auth = { role: 'coach', coachId: 'admin' };
  const item = ctx.notifFeed().find(x => x.id === 'ardoise-proofs');
  ok(item, 'entrée présente');
  eq(item.count, 1);
});

t('preuve envoyée : la cloche joueuse ne réclame PLUS rien d\'elle', () => {
  const a = scenarioDrawn();
  a.status = 'done_home'; a.updatedAt = NOW;
  const item = ctx.notifFeed().find(x => String(x.id).startsWith('ardoise-'));
  ok(item, 'entrée présente');
  ok(/envoy/i.test(item.title), 'elle informe, elle ne réclame pas');
});

// =============================================================================
console.log('\n=== BIBLIOTHÈQUE PARTAGÉE AVEC LA PRÉPA ===');

t('le picker d\'exos apparaît dans le wizard de prépa dès qu\'un exo existe', () => {
  seed('coach');
  const h = ctx._twExoLibraryPicker();
  ok(/tw-exo-pick/.test(h), 'le sélecteur est là');
  ok(/Gainage planche/.test(h), 'et il liste la bibliothèque de l\'Ardoise');
});

t('bibliothèque vide → aucun sélecteur sur l\'écran le plus chargé de l\'app', () => {
  seed('coach');
  S.exoTemplates = [];
  eq(ctx._twExoLibraryPicker(), '');
});

// =============================================================================
const bad = R.filter(l => l.startsWith('✗'));
console.log('\n' + R.join('\n'));
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' OK');
process.exit(bad.length ? 1 : 0);
