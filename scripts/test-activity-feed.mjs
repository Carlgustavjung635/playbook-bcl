// Test LE FEED DU GROUPE — mur d'activité positive (migration 20260816_001).
//
// La spec demandait une table d'événements alimentée par des « hooks » posés
// dans chaque feature, et des tests d'idempotence de ces hooks. Le feed est
// DÉRIVÉ à la lecture : il n'y a donc pas de hook à rendre idempotent, il y a
// une dérivation à rendre STABLE et HONNÊTE. C'est ce que ce fichier verrouille,
// et les deux propriétés se testent bien plus durement qu'un insert :
//
//   • STABLE   — deux dérivations successives rendent EXACTEMENT les mêmes
//                identifiants (c'est ce qui permet aux réactions de s'y
//                raccrocher sans table d'événements) ;
//   • HONNÊTE  — une preuve de pintade invalidée après coup, une photo
//                d'Ardoise refusée, une séance supprimée, une tentative de défi
//                éditée : le feed SUIT, dans la seconde. Une ligne écrite en
//                base au moment de l'événement, elle, aurait continué de
//                célébrer un fait annulé. C'est LE test central de ce fichier.
//
// Les autres pièges verrouillés ici :
//   • RIEN DE NÉGATIF n'entre — jamais (raté de pintade, dette expirée, séance
//     manquée). C'est une règle de produit, pas un réglage d'affichage ;
//   • le TROU D'INTERSAISON : une séance validée le 20 juillet (prépa estivale)
//     doit rester dans le feed — les bornes propres d'une saison la jetteraient
//     (bug corrigé en v.123, retombé ici en une ligne si on l'oublie) ;
//   • une source qui casse ne doit PAS emporter le mur entier (v.80) ;
//   • le STAT'MAN ne voit rien et n'écrit rien ;
//   • une réaction retirée puis remise réécrit LA MÊME ligne (id déterministe) :
//     sans ça, soft-delete + contrainte d'unicité = upsert en échec, et une
//     table qui cesse de se synchroniser EN SILENCE ;
//   • la purge 60 j SOFT-delete : un hard delete sur une ligne d'id « x… » est
//     repoussé par n'importe quel client au flush suivant ;
//   • la sérialisation du bloc module est ÉVALUÉE (pas grepée) sur une vraie
//     réaction, bornes des CHECK comprises.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\n;globalThis.FEED_EMOJIS = FEED_EMOJIS;'
  + '\n;globalThis.FEED_RETENTION_DAYS = FEED_RETENTION_DAYS;'
  + '\n;globalThis.FEED_PAGE_SIZE = FEED_PAGE_SIZE;';

// Le bloc <script type="module"> porte les dump/apply PbSync : ses fonctions ne
// franchissent PAS la frontière des blocs — d'où l'export explicite.
const moduleBlock = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && /type\s*=\s*["']module["']/.test(m[1]))
  .map(m => m[2])[0]
  .replace(/^\s*import\s[^\n]*\n/m, '')
  + '\n;globalThis.ENTITIES = ENTITIES;'
  + '\n;globalThis._dumpFeedReactionRow = _dumpFeedReactionRow;'
  + '\n;globalThis._feedReactionFromRow = _feedReactionFromRow;';

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
  setTimeout: (fn) => { try { if (typeof fn === 'function') fn(); } catch (e) {} return 0; },
  clearTimeout() {}, setInterval: () => 0, clearInterval() {},
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

// --- horloge maîtrisée -------------------------------------------------------
const RealDate = Date;
let NOW = RealDate.parse('2026-08-15T10:00:00Z');
class D extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
ctx.Date = D;
const DAY = 86400000;
const ago = (d) => NOW - d * DAY;

// Saisons : 1er sept. → 30 juin. Juillet et août ne sont dans les bornes
// propres d'AUCUNE saison — c'est tout l'objet du test « intersaison ».
function seed(role, pid) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  NOW = RealDate.parse('2026-08-15T10:00:00Z');
  ctx._pbFeedSeenAt = null;
  ctx._pbFeedExtraSources = [];
  S.auth = role === 'coach' ? { role: 'coach', coachId: 'admin' }
    : role === 'stat' ? { role: 'stat', playerId: null }
      : { role: 'player', playerId: pid || 'pA' };
  S.players = [
    { id: 'pA', num: 4, name: 'Alice', photo: '' },
    { id: 'pB', num: 7, name: 'Bea', photo: 'https://cdn/bea.jpg' },
    { id: 'pC', num: 9, name: 'Cléo', photo: '' },
    { id: 'pZ', num: 12, name: 'Zoé', photo: '' }   // hors effectif de la saison courante
  ];
  S.coaches = [{ id: 'admin', name: 'Coach Nat', coachRole: 'admin_coach', teams: ['e1'] }];
  S.seasons = [
    { id: 's25', name: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30' },
    { id: 's26', name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', active: true }
  ];
  S.seasonPlayers = ['pA', 'pB', 'pC'].map(p => ({ seasonId: 's26', playerId: p, teamTag: 'e1' }));
  S.currentSeasonId = 's26';
  S.team = { multiSquad: false };
  S.trainingCompletions = [];
  S.pintadeRequests = [];
  S.ardoiseAssignments = [];
  S.ardoiseMenus = [];
  S.challenges = [];
  S.feedReactions = [];
  S.pointsHarvests = [];
  S.pointsLedger = [];
  S.teamFilter = 'all';
  S._feedLimit = null;
}

// Jeu de données « vie normale de l'équipe » : un exemplaire de chaque type.
function seedFullFeed(role, pid) {
  seed(role, pid);
  S.trainingCompletions = [
    { id: 'tc1', playerId: 'pA', dateCompleted: ago(2), contractLevel: 'ultra',
      squadPhotoUrl: 'https://cdn/squad.jpg', runningDistanceKm: 5.2, pointsTotal: 30 },
    { id: 'tc2', playerId: 'pB', dateCompleted: ago(3), contractLevel: 'min', postPhotoUrl: 'https://cdn/post.jpg' }
  ];
  S.pintadeRequests = [
    { id: 'pq1', holderId: 'pB', status: 'ok', resolvedAt: ago(1), photoUrl: 'https://cdn/pintade.jpg' },
    { id: 'pq2', holderId: 'pC', status: 'failed_timeout', resolvedAt: ago(1) },              // raté → JAMAIS
    { id: 'pq3', holderId: 'pC', status: 'failed_not_seen', resolvedAt: ago(2) }              // raté → JAMAIS
  ];
  S.ardoiseMenus = [{ id: 'm1', name: 'Cardio du chef', level: 'dessert', pointsReward: 20 }];
  S.ardoiseAssignments = [
    { id: 'ard1', playerId: 'pC', menuId: 'm1', status: 'done_validated', validatedAt: ago(1),
      proofPhotoUrl: 'https://cdn/ardoise.jpg', seasonId: 's26' },
    { id: 'ard2', playerId: 'pA', menuId: 'm1', status: 'expired_penalized', updatedAt: ago(2), seasonId: 's26' } // négatif → JAMAIS
  ];
  S.challenges = [{
    id: 'c1', title: 'Burpees', mode: 'series', scope: 'individual', lowerIsBetter: false,
    seasonId: 's26', scores: {},
    series: {
      pA: [
        { id: 'a1', made: 42, createdAt: ago(5) },
        { id: 'a2', made: 48, createdAt: ago(4) }    // record perso + record équipe
      ],
      pB: [{ id: 'b1', made: 30, createdAt: ago(6) }]
    }
  }];
  S.players.find(p => p.id === 'pC').dateNaissance = '2004-08-15';   // c'est aujourd'hui
}
const types = (evs) => evs.map(e => e.type);
const byType = (evs, ty) => evs.filter(e => e.type === ty);

// ============================================================
// 1. DÉRIVATION : les 7 types, sans une seule écriture
// ============================================================
t('les 7 types d\'événements sortent de leurs sources', () => {
  seedFullFeed('player', 'pA');
  const evs = ctx.pbFeedEvents();
  ['training_validated', 'pintade_proof_ok', 'challenge_participated',
   'personal_record', 'team_record', 'ardoise_done', 'birthday_today']
    .forEach(ty => ok(byType(evs, ty).length > 0, 'type manquant : ' + ty));
});

t('dériver le feed n\'écrit RIEN (ni event, ni compteur)', () => {
  seedFullFeed('player', 'pA');
  const before = JSON.stringify({ tc: S.trainingCompletions, pq: S.pintadeRequests, ar: S.ardoiseAssignments, ch: S.challenges });
  ctx.pbFeedEvents(); ctx.pbFeedEvents();
  eq(S.feedReactions.length, 0, 'aucune réaction créée');
  eq(JSON.stringify({ tc: S.trainingCompletions, pq: S.pintadeRequests, ar: S.ardoiseAssignments, ch: S.challenges }), before, 'sources intactes');
});

t('les identifiants sont STABLES entre deux dérivations', () => {
  seedFullFeed('player', 'pA');
  const a = ctx.pbFeedEvents().map(e => e.id).join('|');
  const b = ctx.pbFeedEvents().map(e => e.id).join('|');
  eq(a, b, 'ids instables → toutes les réactions se décrocheraient');
  ok(a.includes('af:train:tc1'), 'id dérivé de la source');
});

t('un même événement n\'apparaît qu\'UNE fois (dédoublonnage par id)', () => {
  seedFullFeed('player', 'pA');
  const ids = ctx.pbFeedEvents().map(e => e.id);
  eq(ids.length, new Set(ids).size, 'doublon dans le feed');
});

t('le feed est trié du plus récent au plus ancien', () => {
  seedFullFeed('player', 'pA');
  const ts = ctx.pbFeedEvents().map(e => e.ts);
  ok(ts.every((v, i) => i === 0 || ts[i - 1] >= v), 'tri cassé');
});

// ============================================================
// 2. HONNÊTETÉ : le feed suit les corrections a posteriori
// ============================================================
t('preuve de pintade INVALIDÉE par le coach → l\'événement disparaît', () => {
  seedFullFeed('player', 'pA');
  ok(byType(ctx.pbFeedEvents(), 'pintade_proof_ok').length === 1, 'préalable');
  const q = S.pintadeRequests.find(x => x.id === 'pq1');
  q.invalidatedBy = 'coach:admin'; q.invalidatedAt = NOW;
  eq(byType(ctx.pbFeedEvents(), 'pintade_proof_ok').length, 0, 'une preuve rejetée continuait d\'être célébrée');
});

t('photo d\'Ardoise REFUSÉE (retour in_progress) → l\'événement disparaît', () => {
  seedFullFeed('player', 'pA');
  ok(byType(ctx.pbFeedEvents(), 'ardoise_done').length === 1, 'préalable');
  const a = S.ardoiseAssignments.find(x => x.id === 'ard1');
  a.status = 'in_progress'; a.validatedAt = null;
  eq(byType(ctx.pbFeedEvents(), 'ardoise_done').length, 0, 'un menu refusé restait affiché comme réglé');
});

t('séance de prépa SUPPRIMÉE → l\'événement disparaît', () => {
  seedFullFeed('player', 'pA');
  S.trainingCompletions.find(c => c.id === 'tc1').deletedAt = NOW;
  eq(byType(ctx.pbFeedEvents(), 'training_validated').filter(e => e.id === 'af:train:tc1').length, 0);
});

t('tentative de défi ÉDITÉE rétroactivement → le record suit', () => {
  seedFullFeed('player', 'pA');
  const rec = byType(ctx.pbFeedEvents(), 'personal_record')[0];
  ok(/42 → 48/.test(rec.meta), 'record initial : ' + rec.meta);
  // Le buzzer a menti : la 2e tentative valait 45, pas 48 (édition v.121).
  S.challenges[0].series.pA[1].made = 45;
  eq(byType(ctx.pbFeedEvents(), 'personal_record')[0].meta, '42 → 45', 'le record n\'a pas suivi l\'édition');
  // Corrigée SOUS le précédent : ce n'est plus un record du tout.
  S.challenges[0].series.pA[1].made = 20;
  eq(byType(ctx.pbFeedEvents(), 'personal_record').length, 0, 'un record annulé restait gravé');
});

t('tentative SUPPRIMÉE → sa participation et son record disparaissent', () => {
  seedFullFeed('player', 'pA');
  S.challenges[0].series.pA.forEach(s => { s.deletedAt = NOW; });
  const evs = ctx.pbFeedEvents();
  eq(byType(evs, 'personal_record').length, 0);
  eq(byType(evs, 'challenge_participated').filter(e => e.actorId === 'pA').length, 0);
});

// ============================================================
// 3. RIEN DE NÉGATIF
// ============================================================
t('aucun raté, aucune sanction, aucune dette n\'entre dans le feed', () => {
  seedFullFeed('player', 'pA');
  S.ardoiseAssignments.push(
    { id: 'ard3', playerId: 'pB', menuId: 'm1', status: 'pending_draw', assignedAt: ago(1), seasonId: 's26' },
    { id: 'ard4', playerId: 'pB', menuId: 'm1', status: 'in_progress', drawnAt: ago(1), seasonId: 's26' },
    { id: 'ard5', playerId: 'pB', menuId: 'm1', status: 'done_home', updatedAt: ago(1), seasonId: 's26' }
  );
  const evs = ctx.pbFeedEvents();
  const blob = JSON.stringify(evs);
  eq(byType(evs, 'ardoise_done').length, 1, 'seule la dette RÉGLÉE compte');
  ok(!/failed|expired|pending_draw|in_progress|done_home/.test(blob), 'un état négatif a fui dans le feed');
});

t('la séance validée n\'expose PAS le kilométrage (règle produit)', () => {
  seedFullFeed('player', 'pA');
  const e = byType(ctx.pbFeedEvents(), 'training_validated').find(x => x.id === 'af:train:tc1');
  ok(!/5[.,]2|km/i.test(JSON.stringify(e)), 'le km est passé dans le feed : ' + JSON.stringify(e));
  eq(e.meta, '🔴 Ultra', 'le niveau, lui, est bien là');
});

// ============================================================
// 4. FENÊTRES : 60 jours, saison, TROU D'INTERSAISON
// ============================================================
t('au-delà de 60 jours, l\'événement sort du feed', () => {
  seedFullFeed('player', 'pA');
  // En PLEINE saison : sinon c'est la fenêtre de saison qui coupe la première
  // (en août, 60 jours en arrière retombent sur la saison précédente) et on ne
  // testerait pas ce qu'on croit.
  NOW = RealDate.parse('2027-03-15T10:00:00Z');
  S.trainingCompletions = [
    { id: 'old', playerId: 'pA', dateCompleted: ago(ctx.FEED_RETENTION_DAYS + 1), contractLevel: 'min' },
    { id: 'fresh', playerId: 'pA', dateCompleted: ago(ctx.FEED_RETENTION_DAYS - 1), contractLevel: 'min' }
  ];
  const ids = ctx.pbFeedEvents().map(e => e.id);
  ok(!ids.includes('af:train:old'), '61 jours : toujours affiché');
  ok(ids.includes('af:train:fresh'), '59 jours : disparu');
});

t('TROU D\'INTERSAISON : la séance du 20 juillet reste dans le feed', () => {
  // Le piège de la v.123 : les saisons vont du 1er sept. au 30 juin, donc
  // juillet et août ne sont dans les bornes propres d'AUCUNE saison. Un filtre
  // naïf (`date entre startDate et endDate`) jetterait toute la prépa estivale
  // — c'est-à-dire précisément ce que le feed a à montrer en août.
  seed('player', 'pA');
  S.trainingCompletions = [
    { id: 'ete', playerId: 'pA', dateCompleted: RealDate.parse('2026-07-20T18:00:00Z'), contractLevel: 'med' }
  ];
  const ids = ctx.pbFeedEvents().map(e => e.id);
  ok(ids.includes('af:train:ete'), 'la séance de la prépa estivale est tombée dans le trou d\'intersaison');
});

t('un événement de la saison PRÉCÉDENTE ne remonte pas', () => {
  seed('player', 'pA');
  NOW = RealDate.parse('2026-07-05T10:00:00Z');   // 60 j en arrière chevauchent juin (saison s25)
  S.trainingCompletions = [
    { id: 'juin', playerId: 'pA', dateCompleted: RealDate.parse('2026-06-20T18:00:00Z'), contractLevel: 'min' }
  ];
  ok(!ctx.pbFeedEvents().map(e => e.id).includes('af:train:juin'), 'cumul cross-saison');
});

t('une joueuse hors de l\'effectif de la saison n\'apparaît pas', () => {
  seedFullFeed('player', 'pA');
  S.trainingCompletions.push({ id: 'tcz', playerId: 'pZ', dateCompleted: ago(1), contractLevel: 'min' });
  ok(!ctx.pbFeedEvents().map(e => e.id).includes('af:train:tcz'));
});

t('multi-effectif : une joueuse E2 ne voit pas le mur de E1', () => {
  seedFullFeed('player', 'pA');
  S.team = { multiSquad: true };
  S.seasonPlayers = [
    { seasonId: 's26', playerId: 'pA', teamTag: 'e1' },
    { seasonId: 's26', playerId: 'pB', teamTag: 'e2' },
    { seasonId: 's26', playerId: 'pC', teamTag: 'e2' }
  ];
  S.auth = { role: 'player', playerId: 'pB' };       // E2
  const actors = new Set(ctx.pbFeedEvents().map(e => e.actorId));
  ok(!actors.has('pA'), 'une joueuse E2 voyait l\'activité de E1');
  ok(actors.has('pB'), 'sa propre équipe reste visible');
});

// ============================================================
// 5. DÉFIS : records et participation
// ============================================================
t('la PREMIÈRE tentative n\'est pas un record (perso ni équipe)', () => {
  seed('player', 'pA');
  S.challenges = [{ id: 'c9', title: 'Tirs', mode: 'series', lowerIsBetter: false, seasonId: 's26',
    series: { pA: [{ id: 'x1', made: 10, createdAt: ago(1) }] } }];
  const evs = ctx.pbFeedEvents();
  eq(byType(evs, 'personal_record').length, 0, 'un début n\'est pas un record');
  eq(byType(evs, 'team_record').length, 0);
  eq(byType(evs, 'challenge_participated').length, 1, 'la participation, elle, compte');
});

t('record ÉQUIPE : attribué à celle qui bat la marque, pas à la première', () => {
  seed('player', 'pA');
  S.challenges = [{ id: 'c9', title: 'Tirs', mode: 'series', lowerIsBetter: false, seasonId: 's26',
    series: {
      pA: [{ id: 'x1', made: 10, createdAt: ago(5) }],
      pB: [{ id: 'y1', made: 14, createdAt: ago(4) }]     // bat le 10 de pA
    } }];
  const tr = byType(ctx.pbFeedEvents(), 'team_record');
  eq(tr.length, 1);
  eq(tr[0].actorId, 'pB');
  eq(tr[0].meta, '10 → 14');
});

t('chrono (lowerIsBetter) : le record, c\'est le PLUS PETIT temps', () => {
  seed('player', 'pA');
  S.challenges = [{ id: 'c8', title: 'Navette', mode: 'timed', lowerIsBetter: true, seasonId: 's26',
    series: { pA: [
      { id: 'z1', durationMs: 13000, createdAt: ago(5) },
      { id: 'z2', durationMs: 15000, createdAt: ago(4) },   // plus lent → rien
      { id: 'z3', durationMs: 12000, createdAt: ago(3) }    // plus rapide → record
    ] } }];
  const pr = byType(ctx.pbFeedEvents(), 'personal_record');
  eq(pr.length, 1, 'un temps plus lent a été compté comme un record');
  ok(/13\.00s → 12\.00s/.test(pr[0].meta), 'meta : ' + pr[0].meta);
});

t('participation groupée par JOUR : 3 séries un mardi = 1 ligne', () => {
  seed('player', 'pA');
  const d = RealDate.parse('2026-08-11T18:00:00Z');
  S.challenges = [{ id: 'c7', title: 'Burpees', mode: 'series', lowerIsBetter: false, seasonId: 's26',
    series: { pA: [
      { id: 'q1', made: 5, createdAt: d },
      { id: 'q2', made: 6, createdAt: d + 600000 },
      { id: 'q3', made: 7, createdAt: d + 1200000 }
    ] } }];
  const part = byType(ctx.pbFeedEvents(), 'challenge_participated');
  eq(part.length, 1, 'le mur est noyé par les tentatives');
  eq(part[0].meta, '3 tentatives');
});

t('les défis AUTO et les tentatives sans date n\'entrent pas', () => {
  seed('player', 'pA');
  S.challenges = [
    { id: 'auto', title: 'Présence', mode: 'series', autoCount: true, seasonId: 's26',
      series: { pA: [{ id: 'k1', made: 3, createdAt: ago(1) }] } },
    { id: 'nodate', title: 'Sans date', mode: 'series', seasonId: 's26',
      series: { pA: [{ id: 'k2', made: 3, createdAt: 0 }] } }
  ];
  eq(ctx.pbFeedEvents().length, 0, 'un événement sans date ne peut pas être trié');
});

// ============================================================
// 5bis. GROS LOT RÉCOLTÉ À LA BANQUE (v.126 + migration 20260816_002)
// ============================================================
t('une grosse récolte fait événement, une petite non', () => {
  seed('player', 'pA');
  S.pointsHarvests = [
    { id: 'pA|s26', playerId: 'pA', seasonId: 's26', claimedTotal: 900,
      lastClaimedAt: ago(1), lastClaimedAmount: 400, updatedAt: 1 },
    { id: 'pB|s26', playerId: 'pB', seasonId: 's26', claimedTotal: 120,
      lastClaimedAt: ago(1), lastClaimedAmount: 30, updatedAt: 1 }
  ];
  const evs = byType(ctx.pbFeedEvents(), 'points_claimed_big');
  eq(evs.length, 1, 'le seuil « gros lot » ne filtre pas');
  eq(evs[0].actorId, 'pA');
  ok(/400 pts/.test(evs[0].text), 'texte : ' + evs[0].text);
});

t('un repère de récolte hérité (montant 0) ne fabrique pas de faux événement', () => {
  seed('player', 'pA');
  S.pointsHarvests = [{ id: 'pA|s26', playerId: 'pA', seasonId: 's26', claimedTotal: 5000,
    lastClaimedAt: ago(1), updatedAt: 1 }];   // colonne absente avant la migration _002
  eq(byType(ctx.pbFeedEvents(), 'points_claimed_big').length, 0,
     'un cumul élevé n\'est pas une récolte élevée');
});

t('le montant de récolte n\'est poussé QU\'APRÈS avoir vu la colonne (ordre des migrations)', () => {
  seed('player', 'pA');
  const row = { id: 'pA|s26', playerId: 'pA', seasonId: 's26', claimedTotal: 500,
    lastClaimedAt: ago(9), lastClaimedAmount: 250, claimedKeys: [], claimedThrough: ago(9), updatedAt: 1 };
  // Base SANS la migration _002 (la banque vient d'être créée) : pousser la
  // colonne ferait échouer le lot, et la banque cesserait de se synchroniser
  // EN SILENCE. On ne la pousse donc pas tant qu'on ne l'a pas vue.
  eq(ctx._dumpPointsHarvestRow(row).last_claimed_amount, undefined,
     'colonne poussée alors que le serveur ne l\'a jamais renvoyée');
  // Le serveur renvoie la colonne → migration passée → on peut l'écrire.
  eq(ctx._pointsHarvestFromRow({ id: 'x', last_claimed_amount: 250 }).lastClaimedAmount, 250);
  eq(ctx._dumpPointsHarvestRow(row).last_claimed_amount, 250, 'colonne vue mais toujours pas poussée');
  eq(ctx._pointsHarvestFromRow({ id: 'x' }).lastClaimedAmount, 0, 'ligne sans la colonne → 0');
});

// ============================================================
// 6. STAT'MAN : ni vue, ni écriture
// ============================================================
t('le stat\'man ne voit pas le feed', () => {
  seedFullFeed('stat');
  eq(ctx.feedIsVisible(), false);
  eq(ctx.renderActivityFeed(), '', 'le mur s\'affiche pour le stat\'man');
});

t('le stat\'man ne peut pas réagir', () => {
  seedFullFeed('stat');
  ctx.toggleFeedReaction('af:train:tc1', 'heart', ago(2));
  eq(S.feedReactions.length, 0, 'le stat\'man a écrit une réaction');
});

t('joueuse et coach voient EXACTEMENT le même mur', () => {
  seedFullFeed('player', 'pA');
  const asPlayer = ctx.pbFeedEvents().map(e => e.id).join('|');
  seedFullFeed('coach');
  const asCoach = ctx.pbFeedEvents().map(e => e.id).join('|');
  eq(asPlayer, asCoach, 'les deux vues ont divergé');
  ok(ctx.renderActivityFeed().includes('Vie du groupe'), 'section absente chez le coach');
});

// ============================================================
// 7. RÉACTIONS
// ============================================================
t('réagir crée UNE ligne, à identifiant déterministe', () => {
  seedFullFeed('player', 'pA');
  ctx.toggleFeedReaction('af:train:tc2', 'fire', ago(3));
  eq(S.feedReactions.length, 1);
  const r = S.feedReactions[0];
  eq(r.id, 'xafr:af:train:tc2:pA:fire');
  ok(String(r.id).startsWith('x'), 'un id qui ne commence pas par « x » se fait effacer par l\'apply PbSync');
  eq(r.actorKind, 'player');
  eq(r.eventAt, ago(3), 'eventAt sert au balayage 60 j');
});

t('retirer puis remettre réécrit LA MÊME ligne (jamais une 2e)', () => {
  seedFullFeed('player', 'pA');
  const ev = 'af:train:tc2';
  ctx.toggleFeedReaction(ev, 'fire', ago(3));
  const id = S.feedReactions[0].id;
  ctx.toggleFeedReaction(ev, 'fire', ago(3));
  eq(S.feedReactions.length, 1, 'une 2e ligne violerait unique(event_id, actor_id, emoji)');
  ok(!!S.feedReactions[0].deletedAt, 'retrait = soft-delete');
  ctx.toggleFeedReaction(ev, 'fire', ago(3));
  eq(S.feedReactions.length, 1);
  eq(S.feedReactions[0].id, id, 'l\'id doit être réutilisé');
  eq(S.feedReactions[0].deletedAt, null, 'remise = deleted_at effacé');
});

t('plusieurs emojis par personne, un seul de chaque', () => {
  seedFullFeed('player', 'pA');
  const ev = 'af:pintade:pq1';
  ctx.toggleFeedReaction(ev, 'heart', ago(1));
  ctx.toggleFeedReaction(ev, 'clap', ago(1));
  ctx.toggleFeedReaction(ev, 'heart', ago(1));   // retire le ❤️
  ctx.toggleFeedReaction(ev, 'heart', ago(1));   // le remet
  const tally = ctx.feedReactionTally(ev);
  eq(tally.heart.n, 1); eq(tally.clap.n, 1); eq(tally.fire.n, 0);
  ok(tally.heart.mine && tally.clap.mine);
});

t('le comptage agrège joueuses ET coach', () => {
  seedFullFeed('player', 'pA');
  ctx.toggleFeedReaction('af:pintade:pq1', 'muscle', ago(1));
  S.auth = { role: 'player', playerId: 'pC' };
  ctx.toggleFeedReaction('af:pintade:pq1', 'muscle', ago(1));
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.toggleFeedReaction('af:pintade:pq1', 'muscle', ago(1));
  eq(ctx.feedReactionTally('af:pintade:pq1').muscle.n, 3);
  eq(S.feedReactions.filter(r => r.actorKind === 'coach').length, 1);
});

t('un emoji hors des 4 autorisés est refusé', () => {
  seedFullFeed('player', 'pA');
  ctx.toggleFeedReaction('af:pintade:pq1', 'poop', ago(1));
  eq(S.feedReactions.length, 0, 'un emoji hors CHECK ferait échouer TOUT le lot d\'upsert');
});

t('les 4 emojis du front sont exactement ceux du CHECK de la migration', () => {
  const sql = fs.readFileSync('supabase/migrations/20260816_001_activity_feed_reactions.sql', 'utf8');
  const m = sql.match(/emoji\s+text not null check \(emoji in \(([^)]+)\)\)/);
  ok(m, 'CHECK emoji introuvable dans la migration');
  const inSql = m[1].split(',').map(s => s.trim().replace(/'/g, '')).sort().join(',');
  eq(ctx.FEED_EMOJIS.map(e => e.id).sort().join(','), inSql);
});

// ============================================================
// 8. SÉRIALISATION (bloc module) — ÉVALUÉE, pas grepée
// ============================================================
t('l\'entité PbSync feedReactions est déclarée sur la bonne table', () => {
  const e = ctx.ENTITIES.find(x => x.key === 'feedReactions');
  ok(e, 'entité absente : la table ne se synchroniserait jamais');
  eq(e.table, 'activity_feed_reactions');
  eq(e.pk, 'id');
});

t('le dump d\'une réaction produit des colonnes conformes aux CHECK', () => {
  seedFullFeed('player', 'pA');
  ctx.toggleFeedReaction('af:train:tc1', 'clap', ago(2));
  const row = ctx._dumpFeedReactionRow(S.feedReactions[0]);
  eq(row.event_id, 'af:train:tc1');
  eq(row.actor_kind, 'player');
  eq(row.emoji, 'clap');
  ok(typeof row.event_at === 'string' && row.event_at.includes('T'), 'event_at doit être une ISO string');
  eq(row.deleted_at, null);
  // Valeurs hors bornes → repli, jamais de valeur qui ferait échouer l'upsert.
  const bad = ctx._dumpFeedReactionRow({ id: 'x1', eventId: 'e', actorId: 'a', actorKind: 'alien', emoji: 'poop' });
  eq(bad.actor_kind, 'player'); eq(bad.emoji, 'heart');
});

t('dump → fromRow → dump est stable (aller-retour sans perte)', () => {
  seedFullFeed('player', 'pA');
  ctx.toggleFeedReaction('af:train:tc1', 'clap', ago(2));
  const row = ctx._dumpFeedReactionRow(S.feedReactions[0]);
  const back = ctx._feedReactionFromRow(Object.assign({ created_at: new D(NOW).toISOString() }, row));
  eq(JSON.stringify(ctx._dumpFeedReactionRow(back)), JSON.stringify(row));
});

// ============================================================
// 9. PURGE 60 JOURS
// ============================================================
t('la purge SOFT-delete les réactions hors fenêtre, et rien d\'autre', () => {
  seedFullFeed('player', 'pA');
  S.feedReactions = [
    { id: 'xafr:vieux', eventId: 'af:train:x', actorId: 'pA', actorKind: 'player', emoji: 'heart',
      eventAt: ago(ctx.FEED_RETENTION_DAYS + 5), createdAt: ago(60), updatedAt: ago(60), deletedAt: null },
    { id: 'xafr:frais', eventId: 'af:train:tc1', actorId: 'pA', actorKind: 'player', emoji: 'heart',
      eventAt: ago(2), createdAt: ago(2), updatedAt: ago(2), deletedAt: null }
  ];
  const n = ctx.feedPurgeOldReactions(true);
  eq(n, 1);
  eq(S.feedReactions.length, 2, 'un hard delete serait repoussé par le prochain client au flush');
  ok(!!S.feedReactions[0].deletedAt && !S.feedReactions[1].deletedAt);
});

t('la purge ne retourne pas deux fois le même jour', () => {
  seedFullFeed('player', 'pA');
  S.feedReactions = [{ id: 'xafr:v', eventId: 'e', actorId: 'pA', actorKind: 'player', emoji: 'heart',
    eventAt: ago(90), createdAt: ago(90), updatedAt: ago(90), deletedAt: null }];
  eq(ctx.feedPurgeOldReactions(), 1, 'premier passage');
  S.feedReactions[0].deletedAt = null;             // on la « ressuscite » pour vérifier le débrayage
  eq(ctx.feedPurgeOldReactions(), 0, 'la purge a retourné le même jour');
});

t('le stat\'man ne déclenche aucune purge', () => {
  seedFullFeed('stat');
  S.feedReactions = [{ id: 'xafr:v', eventId: 'e', actorId: 'pA', actorKind: 'player', emoji: 'heart',
    eventAt: ago(90), createdAt: ago(90), updatedAt: ago(90), deletedAt: null }];
  eq(ctx.feedPurgeOldReactions(true), 0);
  eq(S.feedReactions[0].deletedAt, null);
});

// ============================================================
// 10. ROBUSTESSE : une source qui casse ne tue pas le mur
// ============================================================
t('une source en échec n\'emporte pas les autres', () => {
  seedFullFeed('player', 'pA');
  S.pintadeRequests = 'données corrompues';      // .filter n'existe pas → throw
  const evs = ctx.pbFeedEvents();
  ok(evs.length > 0, 'tout le mur est tombé avec une seule source');
  eq(byType(evs, 'pintade_proof_ok').length, 0);
  ok(byType(evs, 'training_validated').length > 0, 'les autres sources doivent survivre');
});

t('une source d\'extension (Banque de points) est branchable sans toucher au moteur', () => {
  seedFullFeed('player', 'pA');
  ctx._pbFeedExtraSources = [(scope, since) => ([{
    id: 'af:points:L1', type: 'points_claimed_big', ts: NOW - 3600000,
    actorId: 'pA', actorLabel: '#4 Alice', actorPhoto: '',
    icon: '🎁', text: 'a récolté 400 pts après sa prépa', meta: '+400', photoUrl: ''
  }])];
  const evs = ctx.pbFeedEvents();
  eq(byType(evs, 'points_claimed_big').length, 1);
  eq(evs[0].id, 'af:points:L1', 'le plus récent doit être en tête');
  // Et une extension qui casse ne casse rien non plus.
  ctx._pbFeedExtraSources = [() => { throw new Error('boom'); }];
  ok(ctx.pbFeedEvents().length > 0);
});

// ============================================================
// 11. RENDU
// ============================================================
t('le rendu porte les réactions, la photo lazy et l\'échappement HTML', () => {
  seedFullFeed('player', 'pA');
  S.players.find(p => p.id === 'pA').name = 'Ali<script>ce';
  const html = ctx.renderActivityFeed();
  ok(html.includes('Vie du groupe'), 'titre');
  ok(html.includes('feed-react'), 'barre de réactions');
  ok(html.includes('loading="lazy"'), 'les photos doivent être en lazy load');
  ok(html.includes('&lt;script&gt;'), 'échappement HTML absent');
  ok(!/Ali<script>/.test(html), 'XSS : nom injecté brut');
});

t('aucune couleur en dur dans le rendu du feed (thèmes clairs)', () => {
  seedFullFeed('player', 'pA');
  const html = ctx.renderActivityFeed();
  ok(!/#[0-9a-fA-F]{3,6}\b/.test(html.replace(/&#39;/g, '')), 'couleur hexadécimale en dur dans le feed');
  ok(!/rgba?\((?!var)/.test(html), 'couleur rgb() en dur dans le feed');
});

t('le mur vide affiche quand même sa section (seul point d\'entrée)', () => {
  seed('player', 'pA');
  const html = ctx.renderActivityFeed();
  ok(html.includes('Vie du groupe'), 'la section disparaissait : feature invisible pour toujours');
  ok(html.includes('feed-empty'), 'état vide explicite');
});

t('« Voir plus » n\'apparaît qu\'au-delà de la page, et allonge la liste', () => {
  seed('player', 'pA');
  S.trainingCompletions = Array.from({ length: 9 }, (_, i) => (
    { id: 'tc' + i, playerId: 'pA', dateCompleted: ago(i + 1), contractLevel: 'min' }));
  let html = ctx.renderActivityFeed();
  ok(html.includes('feedShowMore'), 'bouton absent alors qu\'il y a 9 événements');
  eq((html.match(/class="feed-item"/g) || []).length, ctx.FEED_PAGE_SIZE);
  ctx.feedShowMore();
  html = ctx.renderActivityFeed();
  eq((html.match(/class="feed-item"/g) || []).length, 9);
  ok(!html.includes('feedShowMore'), 'bouton encore là alors que tout est affiché');
});

t('le compteur « N nouvelles » se lit contre un instantané de session', () => {
  seedFullFeed('player', 'pA');
  const html = ctx.renderActivityFeed();
  ok(/nouvelles? activités?/.test(html), 'compteur absent au premier passage : ' + html.slice(0, 300));
  // Le filigrane vient d'avancer, mais l'instantané de session ne bouge pas :
  // le compteur doit rester lisible tant que la joueuse est là.
  ok(/nouvelles? activités?/.test(ctx.renderActivityFeed()), 'le compteur s\'est effacé sous les yeux de la joueuse');
  ctx._pbFeedSeenAt = null;                       // nouvelle session
  ok(!/nouvelles? activités?/.test(ctx.renderActivityFeed()), 'tout est « nouveau » à chaque session');
});

t('la carte anniversaire ne dévoile pas les mots écrits à l\'avance', () => {
  seedFullFeed('player', 'pA');
  S.birthdayMessages = [{ id: 'bm1', birthdayPlayerId: 'pC', authorPlayerId: 'pA', birthdayYear: 2026, message: 'SURPRISE SECRÈTE' }];
  ok(!/SURPRISE SECRÈTE/.test(ctx.renderActivityFeed()), 'le feed a spoilé un mot d\'anniversaire');
});

// ============================================================
console.log('\n=== FEED DU GROUPE (v.125) ===\n');
R.forEach(r => console.log(r));
const fail = R.filter(r => r.startsWith('✗'));
console.log('\n' + (R.length - fail.length) + '/' + R.length + ' OK');
if (fail.length) process.exit(1);
