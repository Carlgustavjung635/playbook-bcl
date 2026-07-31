// Test SUIVI COACH DE LA PRÉPA — onglet « Suivi détaillé », timeline, photos,
// évolution des km, corrections, mot du coach, export CSV.
//
// POURQUOI UN TEST SUR LE VRAI index.html (et pas des copies de fonctions pures) :
// tout ce chantier est du RENDU et de la MUTATION D'ÉTAT. Une copie fidèle des
// helpers ne peut pas attraper un template literal cassé, une classe CSS qui
// n'existe pas, un helper mal nommé, ni une garde d'étanchéité oubliée (une
// joueuse ne doit JAMAIS voir l'onglet détaillé : il porte les photos et les
// messages des autres). Même approche que test-training-wizard.mjs.
//
// MAINTENANCE — si ce test casse après un changement SANS RAPPORT avec la prépa,
// c'est probablement le boot d'index.html qui touche une API navigateur pas
// encore stubée (cf. `ctx`) : ajouter le stub, ne pas supprimer le test.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\nglobalThis.TRAINING_LEVELS = TRAINING_LEVELS;'
  // `const` de haut niveau = portée LEXICALE du contexte, pas propriété du global :
  // sans ce pont, ctx.RUN_FORMAT_NONE vaut undefined et les filtres testés
  // passent silencieusement en « aucun filtre ».
  + '\nglobalThis.RUN_FORMAT_NONE = RUN_FORMAT_NONE; globalThis.RUN_FORMAT_SOURCE_LABEL = RUN_FORMAT_SOURCE_LABEL;';

// --- stubs DOM minimalistes -------------------------------------------------
const store = {};
const els = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {}, click() {},
});
const doc = {
  // Les champs pilotés par les tests (textarea du mot du coach) sont injectés
  // dans `els` ; tout le reste retombe sur un élément neutre.
  getElementById: id => (els[id] || mkEl()),
  createElement: mkEl,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible',
};
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  document: doc,
  navigator: {
    userAgent: 'probe', onLine: true,
    serviceWorker: {
      getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}),
      ready: Promise.resolve({ showNotification() {} }), addEventListener() {},
    },
  },
  location: { hash: '', href: 'http://localhost/', replace() {}, reload() {} },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  alert: () => {}, prompt: () => '',
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  // innerWidth n'a aucune influence sur le rendu ici : la mise en page est faite
  // par le CSS (paliers en `em`), pas par du JS qui lirait la largeur. Les
  // assertions responsive du §12 parsent donc le CSS plutôt que de simuler un
  // appareil — il n'existe pas de « largeur de référence » à simuler.
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 360, innerHeight: 740,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
};
// confirm() pilotable : les tests de suppression ont besoin des deux réponses.
ctx.__confirm = true;
ctx.confirm = () => ctx.__confirm;
// Blob/URL : l'export CSV les exige, on capture le contenu produit.
ctx.Blob = class { constructor(parts, opts) { ctx.__blob = (parts || []).join(''); ctx.__blobType = (opts || {}).type || ''; } };
ctx.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
ctx.__els = els;
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('✓ script évalué');

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

// --- décor -------------------------------------------------------------------
// Les dates sont RELATIVES à aujourd'hui : un décor en dur (« programme du
// 28 juillet ») fait passer le test au vert la semaine de son écriture puis
// silencieusement au rouge un mois plus tard.
const S = ctx.state;
const DAY = 86400000;
const iso = d => ctx.isoDate(new Date(d));
const NOW = Date.now();
const TODAY = iso(NOW);
const back = n => iso(NOW - n * DAY);

const PHOTO_SQUAD = 'https://x.supabase.co/storage/v1/object/public/training-photos/squad-1.jpg';
const PHOTO_POST = 'https://x.supabase.co/storage/v1/object/public/training-photos/post-1.jpg';

let seq = 0;
function comp(o) {
  seq++;
  const dp = o.datePlanned;
  const dow = ctx._trainingDayOfWeek(dp);
  return Object.assign({
    id: 'c' + seq, programId: 'prog1', sessionId: 's' + dow, playerId: 'pA',
    datePlanned: dp, dateCompleted: Date.parse(dp + 'T18:00:00Z'), contractLevel: 'med',
    basePoints: 20, squadTeammateId: null, squadPhotoUrl: null, postPhotoUrl: null, postMessage: '',
    runningDistanceKm: null, pointsTotal: 20, notes: '',
    updatedBy: null, editedAt: null, coachNote: '', coachNoteAt: null,
    createdAt: Date.parse(dp + 'T18:00:00Z'), updatedAt: Date.parse(dp + 'T18:00:00Z'), deletedAt: null,
  }, o);
}

function seed() {
  seq = 0;
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [
    { id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] },
    { id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e2'] },
  ];
  S.seasons = [{ id: 'S1', name: 'Saison test', startDate: back(300), endDate: iso(NOW + 300 * DAY), status: 'active' }];
  S.activeSeasonId = 'S1';
  // `currentSeasonId` EN PLUS de la saison active : _playerVisibleToUser (garde de
  // portée des corrections) lit `state.currentSeasonId` et non getActiveSeasonId().
  // En vrai il est toujours posé par ensureCurrentSeason() après la sync ; sans
  // lui la garde échoue en mode fermé (refus), ce qui est le bon sens de l'erreur.
  S.currentSeasonId = 'S1';
  S.players = [
    { id: 'pA', name: 'Alice', num: 7, photo: '' },
    { id: 'pB', name: 'Bea', num: 8, photo: '' },
    { id: 'pC', name: 'Chloe', num: 9, photo: '' },   // E2 seulement
  ];
  S.seasonPlayers = [
    { seasonId: 'S1', playerId: 'pA', teamTag: 'e1', joinedAt: back(300), leftAt: null },
    { seasonId: 'S1', playerId: 'pB', teamTag: 'e1', joinedAt: back(300), leftAt: null },
    { seasonId: 'S1', playerId: 'pC', teamTag: 'e2', joinedAt: back(300), leftAt: null },
  ];
  S.trainingPrograms = [{
    id: 'prog1', name: 'Prépa estivale', startDate: back(40), endDate: iso(NOW + 20 * DAY),
    daysActive: [1, 2, 3, 4, 5, 6, 7],   // tous les jours actifs → chaque date est prévue
    scoringConfig: { points: { min: 10, med: 20, ultra: 30 }, post_bonus: 10, squad_multiplier: 2, remind_hour: 9 },
    isActive: true, teamTag: 'both', deletedAt: null, updatedAt: NOW,
  }];
  S.trainingSessions = [1, 2, 3, 4, 5, 6, 7].map(d => ({
    id: 's' + d, programId: 'prog1', dayOfWeek: d, name: 'Séance J' + d,
    blocks: [], isTemplate: false, position: d, deletedAt: null, updatedAt: NOW,
  }));
  S.trainingCompletions = [
    // Alice — dans les 7 j, avec les deux photos, un post et de la distance
    comp({ id: 'cA1', playerId: 'pA', datePlanned: back(1), contractLevel: 'ultra', basePoints: 30, pointsTotal: 70,
      squadTeammateId: 'pB', squadPhotoUrl: PHOTO_SQUAD, postPhotoUrl: PHOTO_POST,
      postMessage: 'Grosse séance sous la pluie', runningDistanceKm: 6.2 }),
    comp({ id: 'cA2', playerId: 'pA', datePlanned: back(3), runningDistanceKm: 4 }),
    // hors fenêtre 7 j, dans les 30 j
    comp({ id: 'cA3', playerId: 'pA', datePlanned: back(12), runningDistanceKm: 3.5 }),
    // hors fenêtre 30 j
    comp({ id: 'cA4', playerId: 'pA', datePlanned: back(35), contractLevel: 'min', basePoints: 10, pointsTotal: 10 }),
    // Bea
    comp({ id: 'cB1', playerId: 'pB', datePlanned: back(2), runningDistanceKm: 2.1 }),
    comp({ id: 'cB2', playerId: 'pB', datePlanned: back(4) }),
    // Chloe (E2) — sert à prouver le scoping
    comp({ id: 'cC1', playerId: 'pC', datePlanned: back(2) }),
  ];
  S.gageDraws = []; S.matches = []; S.broadcasts = []; S.challenges = [];
  ctx.state._trainingDash = null;
  ctx.state._trainingEdit = null;
  ctx.state._trainingView = null;
  ctx.__pushes = [];
  ctx.__toasts = [];
  ctx.__confirm = true;
}
ctx.render = () => {};
ctx.showToast = m => { ctx.__toasts.push(String(m)); };
ctx.notifyPush = (keys, payload) => { ctx.__pushes.push({ keys, payload }); };
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = '(closed)'; };
seed();

const M = () => String(ctx.__lastModal || '');

// ============================================================================
// 1) ONGLETS + ÉTANCHÉITÉ
// ============================================================================
t('openTrainingDashboard() ouvre le classement par défaut', () => {
  ctx.openTrainingDashboard('prog1');
  assert(ctx._td().tab === 'rank', 'onglet = ' + ctx._td().tab);
  assert(M().includes('Classement · points'), 'classement absent');
  assert(M().includes('🏆 Classement') && M().includes('📊 Suivi détaillé'), 'barre d\'onglets absente');
});

t('openTrainingDashboard(id,"detail") ouvre directement le suivi détaillé', () => {
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(ctx._td().tab === 'detail', 'onglet = ' + ctx._td().tab);
  assert(M().includes('Toutes les validations'), 'timeline absente');
});

t('ÉTANCHÉITÉ : une joueuse n\'a ni onglet ni suivi détaillé', () => {
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(ctx._td().tab === 'rank', 'la joueuse a atterri sur le détail !');
  assert(!M().includes('Suivi détaillé'), 'bouton d\'onglet exposé à la joueuse');
  assert(!M().includes(PHOTO_POST), 'photo d\'une validation exposée à la joueuse');
  assert(!M().includes('Grosse séance sous la pluie'), 'message d\'une joueuse exposé');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('ÉTANCHÉITÉ : le forçage direct de l\'onglet est neutralisé au rendu', () => {
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.state._trainingDash = { programId: 'prog1', tab: 'detail', playerId: '', sessionId: '', period: 'all', limit: 40 };
  ctx.renderTrainingDashboard();
  assert(ctx._td().tab === 'rank', 'onglet forcé accepté');
  assert(!M().includes(PHOTO_SQUAD), 'photos exposées via forçage');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('le classement coach est cliquable et emmène au détail de la joueuse', () => {
  ctx.openTrainingDashboard('prog1');
  assert(M().includes("_td().playerId='pA'"), 'ligne de classement non cliquable côté coach');
});

// ============================================================================
// 2) COMPTEURS + FILTRES + SCOPING
// ============================================================================
t('scoping : la joueuse E2 ne remonte pas pour un coach E1', () => {
  seed();
  S.auth = { role: 'coach', coachId: 'c2' };   // coach scopé E2
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(!M().includes('Alice'), 'Alice (E1) visible par le coach E2');
  assert(M().includes('Chloe'), 'Chloe (E2) invisible par son propre coach');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('compteurs en tête : joueuses / séances / km / points sur le set filtré', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const comps = ctx._tdFilteredCompletions(S.trainingPrograms[0]);
  assert(comps.length === 7, 'attendu 7 validations (tout), reçu ' + comps.length);
  const km = comps.reduce((a, c) => a + (c.runningDistanceKm || 0), 0);
  assert(Math.abs(km - 15.8) < 0.001, 'km cumulés = ' + km);
  assert(M().includes('>3</b> joueuse') || M().includes('<b>3</b> joueuse'), 'compteur joueuses faux : ' + M().slice(M().indexOf('joueuse') - 60, M().indexOf('joueuse') + 10));
  assert(M().includes('<b>7</b> séance'), 'compteur séances faux');
  assert(M().includes('<b>15.8</b> km'), 'compteur km faux');
});

t('filtre période 7 j : ne garde que les validations récentes', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('period', 'w');
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id).sort();
  // Fenêtre = [aujourd'hui-6 ; fin du programme] → J-1, J-2, J-3 et J-4 dedans,
  // J-12 et J-35 dehors.
  assert(JSON.stringify(ids) === JSON.stringify(['cA1', 'cA2', 'cB1', 'cB2', 'cC1']), 'ids 7 j = ' + ids.join(','));
});

t('filtre période 30 j : inclut J-12, exclut J-35', () => {
  ctx._tdSet('period', 'm');
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id);
  assert(ids.includes('cA3'), 'J-12 exclu à tort');
  assert(!ids.includes('cA4'), 'J-35 inclus à tort');
});

t('une validation ANTICIPÉE (jour prévu demain) reste visible dans « 7 j »', () => {
  // Régression : borner le filtre à aujourd'hui ferait disparaître une séance
  // validée dans la fenêtre H-24, dont le datePlanned est dans le futur.
  S.trainingCompletions.push(comp({ id: 'cAdv', playerId: 'pB', datePlanned: iso(NOW + DAY) }));
  ctx._tdSet('period', 'w');
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id);
  assert(ids.includes('cAdv'), 'validation anticipée masquée : ' + ids.join(','));
  S.trainingCompletions = S.trainingCompletions.filter(c => c.id !== 'cAdv');
});

t('filtre joueuse : drill-down + ses stats', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('playerId', 'pA');
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['cA1', 'cA2', 'cA3', 'cA4']), 'ids = ' + ids.join(','));
  assert(M().includes('Ses validations'), 'titre de drill-down absent');
  assert(M().includes('Assiduité'), 'tuile assiduité absente');
  assert(M().includes('#7 Alice'), 'en-tête joueuse absent');
  assert(M().includes('Envoyer un mot'), 'CTA encouragement absent');
});

t('drill-down : le dénominateur d\'assiduité suit la période affichée', () => {
  // 7 j → 7 séances prévues (programme actif tous les jours), 2 validées.
  ctx._tdSet('period', 'w');
  assert(M().includes('2/7 séances'), 'dénominateur hors période : ' + M().slice(M().indexOf('séance') - 40, M().indexOf('séance') + 10));
});

t('filtre séance : ne garde que la séance choisie', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const sid = S.trainingCompletions.find(c => c.id === 'cA1').sessionId;
  ctx._tdSet('sessionId', sid);
  const comps = ctx._tdFilteredCompletions(S.trainingPrograms[0]);
  assert(comps.length > 0 && comps.every(c => c.sessionId === sid), 'filtre séance inopérant');
});

t('cas vide : message + CTA « voir tout le programme »', () => {
  seed();
  S.trainingCompletions = [];
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('period', 'w');
  assert(M().includes('Aucune validation'), 'état vide absent');
  assert(M().includes('Voir tout le programme'), 'CTA absent');
  assert(!M().includes('Toutes les validations'), 'timeline rendue alors que vide');
});

t('changer un filtre remet la pagination à zéro', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdMore(); ctx._tdMore();
  assert(ctx._td().limit === 120, 'limit = ' + ctx._td().limit);
  ctx._tdSet('period', 'm');
  assert(ctx._td().limit === 40, 'limit non réinitialisé : ' + ctx._td().limit);
});

t('pagination : 45 validations → 40 affichées + reste annoncé (pas de troncature muette)', () => {
  seed();
  // Programme rallongé : les 45 validations doivent TOUTES tomber dans ses bornes,
  // sinon le filtre de période en écarterait et il n'y aurait plus de reste.
  S.trainingPrograms[0].startDate = back(100);
  S.trainingCompletions = [];
  for (let i = 0; i < 45; i++) S.trainingCompletions.push(comp({ playerId: 'pA', datePlanned: back(i + 1) }));
  ctx.openTrainingDashboard('prog1', 'detail');
  const shown = (M().match(/openTrainingCompletionDetail\(/g) || []).length;
  assert(shown === 40, 'lignes rendues = ' + shown);
  assert(M().includes('restante'), 'reste non annoncé');
  ctx._tdMore();
  const shown2 = (M().match(/openTrainingCompletionDetail\(/g) || []).length;
  assert(shown2 === 45, 'après _tdMore, lignes = ' + shown2);
});

// ============================================================================
// 3) TIMELINE
// ============================================================================
t('timeline : joueuse, séance, jour, niveau, points, squad, km, message', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const h = M();
  assert(h.includes('#7 Alice'), 'joueuse absente');
  assert(h.includes('70'), 'points absents');
  assert(h.includes('👯 Bea'), 'coéquipière absente');
  assert(h.includes('6.2 km'), 'distance absente');
  assert(h.includes('Ultra'), 'niveau absent');
});

t('timeline : vignettes des 2 photos, en lazy load', () => {
  const h = M();
  assert(h.includes(PHOTO_SQUAD) && h.includes(PHOTO_POST), 'vignettes absentes');
  const idx = h.indexOf(PHOTO_SQUAD);
  assert(h.slice(idx, idx + 200).includes('loading="lazy"'), 'vignette non lazy');
});

t('timeline : ordre chronologique inverse (le plus récent en tête)', () => {
  const comps = ctx._tdFilteredCompletions(S.trainingPrograms[0]);
  for (let i = 1; i < comps.length; i++) {
    assert(comps[i - 1].datePlanned >= comps[i].datePlanned, 'ordre cassé à ' + i);
  }
});

t('timeline : la ligne ne porte aucune largeur fixe (elle suit son conteneur)', () => {
  const rows = M().split('openTrainingCompletionDetail(').slice(1, 2).join('');
  assert(!/width:\s*\d{3,}px/.test(rows), 'largeur fixe >= 100px dans une ligne');
  assert(!/flex:\s*[^;"]*\d{2,}px/.test(rows), 'flex-basis en px inline dans une ligne (la classe doit décider)');
});

t('renderCompletionsTimeline({showPlayer:false}) masque l\'identité (vue drill-down)', () => {
  const one = ctx.renderCompletionsTimeline([S.trainingCompletions.find(c => c.id === 'cA1')], { showPlayer: false });
  assert(!one.includes('Alice'), 'joueuse affichée alors que masquée');
  assert(one.includes('6.2 km'), 'contenu perdu');
});

// ============================================================================
// 4) ÉVOLUTION DES KM
// ============================================================================
t('graphique km : SVG avec une courbe et une légende', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const h = M();
  assert(h.includes('Évolution des km'), 'bloc km absent');
  assert(h.includes('<svg'), 'svg absent');
  assert(h.includes('<path d="M'), 'courbe absente');
  assert(h.includes('#7 Alice · '), 'légende absente');
});

t('graphique km : cumul CROISSANT (le tri chronologique est appliqué)', () => {
  const pool = ctx._trainingPoolFor(S.trainingPrograms[0]);
  const withKm = ctx._tdFilteredCompletions(S.trainingPrograms[0]).filter(c => c.runningDistanceKm > 0);
  const series = ctx._tdKmSeries(withKm, pool, 'pA');
  assert(series.length === 1, 'séries = ' + series.length);
  const ys = series[0].pts.map(p => p.km);
  for (let i = 1; i < ys.length; i++) assert(ys[i] >= ys[i - 1], 'cumul décroissant : ' + ys.join(','));
  assert(Math.abs(ys[ys.length - 1] - 13.7) < 0.001, 'cumul final = ' + ys[ys.length - 1]);
});

t('graphique km : au plus 5 courbes en vue globale (légende lisible sur mobile)', () => {
  seed();
  S.trainingCompletions = [];
  S.players = [];
  S.seasonPlayers = [];
  for (let i = 0; i < 8; i++) {
    const id = 'p' + i;
    S.players.push({ id, name: 'J' + i, num: i, photo: '' });
    S.seasonPlayers.push({ seasonId: 'S1', playerId: id, teamTag: 'e1', joinedAt: back(300), leftAt: null });
    S.trainingCompletions.push(comp({ playerId: id, datePlanned: back(2), runningDistanceKm: i + 1 }));
  }
  const pool = ctx._trainingPoolFor(S.trainingPrograms[0]);
  const series = ctx._tdKmSeries(ctx._tdFilteredCompletions(S.trainingPrograms[0]), pool, '');
  assert(series.length === 5, 'séries = ' + series.length);
  // Les 5 plus grosses distances, pas les 5 premières venues.
  assert(series[0].name.includes('J7'), 'tri par distance non appliqué : ' + series[0].name);
});

t('un seul point : marqueur dessiné, pas de courbe invisible', () => {
  const svg = ctx.renderKmChart([{ name: 'Solo', color: 'var(--orange)', pts: [{ ms: Date.parse(back(2) + 'T00:00:00Z'), km: 5 }] }]);
  assert(svg.includes('<circle'), 'marqueur absent');
  assert(!svg.includes('<path'), 'courbe dessinée sur un point unique');
});

t('aucune distance saisie → pas de graphique (et pas de courbe plate à zéro)', () => {
  seed();
  S.trainingCompletions.forEach(c => { c.runningDistanceKm = null; });
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(!M().includes('Évolution des km'), 'graphique rendu sans donnée');
  assert(M().includes('Toutes les validations'), 'timeline perdue au passage');
});

t('drill-down : tableau Date/Séance/Km/Cumul sous le graphique', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('playerId', 'pA');
  const h = M();
  assert(h.includes('<table'), 'tableau absent');
  assert(h.includes('Cumul'), 'colonne cumul absente');
  // Le scroll est porté par .td-table-wrap (CSS), pas par un style inline — il est
  // ainsi confiné au tableau et ne peut jamais devenir un scroll de page.
  assert(h.includes('class="td-table-wrap"'), 'tableau sans conteneur scrollable');
});

// ============================================================================
// 5) PANNEAU DE DÉTAIL + PHOTOS
// ============================================================================
t('détail : toutes les données, photos zoomables, message', () => {
  seed();
  ctx.openTrainingCompletionDetail('cA1');
  const h = M();
  assert(h.includes('Grosse séance sous la pluie'), 'message absent');
  assert(h.includes("openTrainingPhoto('cA1','squad')"), 'zoom squad absent');
  assert(h.includes("openTrainingPhoto('cA1','post')"), 'zoom post absent');
  assert(h.includes('6.2 km'), 'distance absente');
  assert(h.includes('#8 Bea'), 'coéquipière absente');
  assert(h.includes('✎ Modifier') && h.includes('🗑'), 'actions de correction absentes');
});

t('détail : une joueuse ne peut pas l\'ouvrir', () => {
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.__lastModal = '(rien)';
  ctx.openTrainingCompletionDetail('cA1');
  assert(M() === '(rien)', 'panneau de détail ouvert pour une joueuse');
  ctx.openTrainingPhoto('cA1', 'post');
  assert(M() === '(rien)', 'photo ouverte pour une joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('photo plein écran : image + retour vers le détail', () => {
  ctx.openTrainingPhoto('cA1', 'post');
  assert(M().includes(PHOTO_POST), 'image absente');
  assert(M().includes("openTrainingCompletionDetail('cA1')"), 'retour absent');
});

t('l\'URL de la photo n\'est jamais interpolée dans un onclick', () => {
  ctx.openTrainingCompletionDetail('cA1');
  assert(!/onclick="[^"]*storage\/v1/.test(M()), 'URL Storage dans un attribut onclick');
});

// ============================================================================
// 6) CORRECTION
// ============================================================================
t('édition : préremplie avec les valeurs de la validation', () => {
  seed();
  ctx.openEditCompletionModal('cA1');
  const e = ctx._tce();
  assert(e.level === 'ultra', 'niveau = ' + e.level);
  assert(e.squadTeammateId === 'pB', 'squad = ' + e.squadTeammateId);
  assert(e.distanceKm === '6.2', 'km = ' + e.distanceKm);
  assert(e.points === 70 && e.original === 70, 'points = ' + e.points);
  assert(e.pointsTouched === false, 'points marqués forcés d\'entrée');
});

t('édition : changer le niveau recalcule le total au barème courant', () => {
  ctx._tceSet('level', 'min');
  // min(10) × squad(2) + post(10) = 30
  assert(ctx._tceComputed().total === 30, 'total auto = ' + ctx._tceComputed().total);
  assert(M().includes('70 pts → <b>30 pts</b>'), 'avant/après non affiché');
});

t('édition : retirer la squad retire le multiplicateur', () => {
  ctx._tceSet('squadTeammateId', '');
  assert(ctx._tceComputed().total === 20, 'total = ' + ctx._tceComputed().total);  // 10 + 10 post
});

t('édition : un total forcé n\'est plus écrasé par le recalcul', () => {
  ctx._tcePoints('total', 45);
  assert(ctx._tce().pointsTouched === true, 'forçage non enregistré');
  ctx._tceSet('level', 'ultra');
  assert(ctx._tce().points === 45, 'valeur forcée écrasée : ' + ctx._tce().points);
  assert(M().includes('Valeur forcée'), 'forçage non signalé à l\'écran');
});

t('édition : ↺ auto rebranche le recalcul', () => {
  ctx._tceAuto();
  assert(ctx._tce().pointsTouched === false, 'retour auto raté');
});

t('enregistrer : écrit les champs ET la trace d\'audit', () => {
  seed();
  ctx.openEditCompletionModal('cA1');
  ctx._tceSet('level', 'med');
  ctx._tceSet('squadTeammateId', '');
  ctx._tceSet('distanceKm', '7.5');
  ctx._tceSet('notes', 'distance corrigée d\'après sa montre');
  ctx.saveCompletionEdit('cA1');
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(c.contractLevel === 'med', 'niveau = ' + c.contractLevel);
  assert(c.squadTeammateId === null, 'squad non retirée');
  assert(c.runningDistanceKm === 7.5, 'km = ' + c.runningDistanceKm);
  assert(c.basePoints === 20, 'base = ' + c.basePoints);
  assert(c.pointsTotal === 30, 'total = ' + c.pointsTotal);   // 20 + 10 post
  assert(c.notes.includes('montre'), 'notes non enregistrées');
  assert(c.updatedBy === 'admin', 'auteur = ' + c.updatedBy);
  assert(c.editedAt > 0, 'editedAt absent');
  assert(c.updatedAt === c.editedAt, 'updatedAt non bumpé (la sync ne pousserait pas)');
  assert(ctx.state._trainingEdit === null, 'état d\'édition non purgé');
});

t('enregistrer : le classement suit la correction', () => {
  const row = ctx._trainingLeaderboard('prog1').find(r => r.id === 'pA');
  // 30 (corrigée) + 20 + 20 + 10 = 80
  assert(row.points === 80, 'points classement = ' + row.points);
});

t('enregistrer : retirer une photo la retire vraiment', () => {
  seed();
  ctx.openEditCompletionModal('cA1');
  ctx._tceSet('squadPhotoUrl', '');
  ctx.saveCompletionEdit('cA1');
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(c.squadPhotoUrl === null, 'photo squad conservée');
  assert(c.postPhotoUrl === PHOTO_POST, 'photo post perdue au passage');
});

t('correction : total forcé respecté à l\'enregistrement', () => {
  seed();
  ctx.openEditCompletionModal('cA2');
  ctx._tcePoints('total', 55);
  ctx.saveCompletionEdit('cA2');
  assert(S.trainingCompletions.find(x => x.id === 'cA2').pointsTotal === 55, 'total forcé perdu');
});

t('correction : un coach scopé ne peut pas toucher une joueuse hors effectif', () => {
  seed();
  S.auth = { role: 'coach', coachId: 'c2' };   // E2
  ctx.openEditCompletionModal('cA1');           // Alice = E1
  assert(!ctx._tce(), 'formulaire d\'édition ouvert hors portée');
  ctx.saveCompletionEdit('cA1');
  assert(S.trainingCompletions.find(x => x.id === 'cA1').editedAt === null, 'écriture hors portée');
  ctx.deleteTrainingCompletion('cA1');
  assert(S.trainingCompletions.find(x => x.id === 'cA1').deletedAt === null, 'suppression hors portée');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('correction : un coach scopé PEUT corriger SA joueuse', () => {
  seed();
  S.auth = { role: 'coach', coachId: 'c2' };
  ctx.openEditCompletionModal('cC1');           // Chloe = E2
  assert(ctx._tce(), 'formulaire refusé sur sa propre joueuse');
  ctx._tceSet('distanceKm', '3');
  ctx.saveCompletionEdit('cC1');
  assert(S.trainingCompletions.find(x => x.id === 'cC1').runningDistanceKm === 3, 'correction refusée');
  assert(S.trainingCompletions.find(x => x.id === 'cC1').updatedBy === 'c2', 'auteur non tracé');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('correction : une joueuse ne peut RIEN corriger', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openEditCompletionModal('cA1');
  assert(!ctx._tce(), 'la joueuse a ouvert le formulaire');
  ctx.saveCompletionEdit('cA1');
  assert(S.trainingCompletions.find(x => x.id === 'cA1').editedAt === null, 'la joueuse a écrit');
  ctx.deleteTrainingCompletion('cA1');
  assert(S.trainingCompletions.find(x => x.id === 'cA1').deletedAt === null, 'la joueuse a supprimé');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// ============================================================================
// 7) SUPPRESSION (soft-delete)
// ============================================================================
t('suppression annulée au confirm() → rien ne bouge', () => {
  seed();
  ctx.__confirm = false;
  ctx.deleteTrainingCompletion('cA1');
  assert(S.trainingCompletions.find(x => x.id === 'cA1').deletedAt === null, 'supprimée malgré l\'annulation');
  ctx.__confirm = true;
});

t('suppression = SOFT-delete (la ligne reste, deleted_at posé)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx.deleteTrainingCompletion('cA1');
  const raw = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(raw, 'ligne hard-deletée → un client la repousserait au flush');
  assert(raw.deletedAt > 0, 'deletedAt absent');
  assert(raw.updatedAt === raw.deletedAt, 'updatedAt non bumpé → la sync ne propagerait pas');
  assert(raw.updatedBy === 'admin', 'auteur de la suppression non tracé');
});

t('supprimée : disparue des sélecteurs, du classement et de la timeline', () => {
  assert(!ctx._trainingCompletionsOf('prog1').some(c => c.id === 'cA1'), 'encore dans les sélecteurs');
  assert(!ctx._trainingCompletionById('cA1'), 'encore résolue par id');
  const row = ctx._trainingLeaderboard('prog1').find(r => r.id === 'pA');
  assert(row.points === 50, 'points classement = ' + row.points);   // 70 retirés de 120
  assert(!M().includes(PHOTO_SQUAD), 'photo encore dans la timeline');
});

t('supprimée : la joueuse peut re-valider (unicité portée par les lignes vivantes)', () => {
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(!ctx._trainingCompletionFor(c.sessionId, 'pA', c.datePlanned), 'la ligne morte bloque encore la re-validation');
});

// ============================================================================
// 8) MOT DU COACH
// ============================================================================
t('mot du coach : enregistré, horodaté, poussé à la joueuse SEULE', () => {
  seed();
  els['tcn-text'] = { value: '6 km sous la pluie, chapeau.' };
  ctx.openTrainingCoachNote('cA1');
  ctx.saveTrainingCoachNote('cA1');
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(c.coachNote.includes('chapeau'), 'mot non enregistré');
  assert(c.coachNoteAt > 0, 'horodatage absent');
  assert(ctx.__pushes.length === 1, 'pushes = ' + ctx.__pushes.length);
  assert(JSON.stringify(ctx.__pushes[0].keys) === JSON.stringify(['player:pA']), 'destinataires = ' + JSON.stringify(ctx.__pushes[0].keys));
  assert(ctx.__pushes[0].payload.type === 'training_coach_note', 'type de push faux');
});

t('mot du coach : un mot vide est refusé (pas d\'écriture à blanc)', () => {
  seed();
  els['tcn-text'] = { value: '   ' };
  ctx.saveTrainingCoachNote('cA1');
  assert(!S.trainingCompletions.find(x => x.id === 'cA1').coachNote, 'mot vide enregistré');
  assert(ctx.__pushes.length === 0, 'push envoyé pour un mot vide');
});

t('mot du coach : retirable', () => {
  seed();
  els['tcn-text'] = { value: 'Bravo' };
  ctx.saveTrainingCoachNote('cA1');
  ctx.saveTrainingCoachNote('cA1', true);
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  assert(c.coachNote === null && c.coachNoteAt === null, 'mot non retiré');
});

t('raccourci drill-down : le mot s\'accroche à la validation la plus récente', () => {
  seed();
  ctx.openTrainingCoachNoteForPlayer('pA', 'prog1');
  assert(M().includes('Un mot pour elle'), 'formulaire non ouvert');
  assert(M().includes(ctx.formatDate(back(1), 'short')), 'ancrée sur la mauvaise séance');
});

t('raccourci drill-down : sans validation, on le dit au lieu d\'ouvrir un formulaire mort', () => {
  seed();
  S.trainingCompletions = S.trainingCompletions.filter(c => c.playerId !== 'pB');
  ctx.__lastModal = '(rien)';
  ctx.openTrainingCoachNoteForPlayer('pB', 'prog1');
  assert(M() === '(rien)', 'formulaire ouvert sans aucune validation');
  assert(ctx.__toasts.join(' ').includes('Aucune séance'), 'aucun retour utilisateur');
});

t('mot du coach : une joueuse ne peut pas s\'en écrire un', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  els['tcn-text'] = { value: 'je suis la meilleure' };
  ctx.saveTrainingCoachNote('cA1');
  assert(!S.trainingCompletions.find(x => x.id === 'cA1').coachNote, 'la joueuse a écrit un mot de coach');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// ============================================================================
// 9) RETOUR CÔTÉ JOUEUSE (feed + écran de séance)
// ============================================================================
t('feed joueuse : le mot du coach et la correction remontent', () => {
  seed();
  els['tcn-text'] = { value: 'Chapeau pour hier.' };
  ctx.saveTrainingCoachNote('cA1');
  ctx.openEditCompletionModal('cA1');
  ctx._tceSet('distanceKm', '6.4');
  ctx.saveCompletionEdit('cA1');
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.setNotifSeenAt(0);
  const feed = ctx.notifFeed({ showRead: true });
  const note = feed.find(i => String(i.id).startsWith('trnote-cA1'));
  const edit = feed.find(i => String(i.id).startsWith('tredit-cA1'));
  assert(note, 'entrée « mot du coach » absente');
  assert(note.detail.includes('Chapeau'), 'détail du mot absent');
  assert(note.action.includes('openTrainingSession('), 'action non actionnable : ' + note.action);
  assert(edit, 'entrée « séance corrigée » absente');
  assert(note.id !== edit.id, 'mot et correction fondus en une seule entrée');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('feed joueuse : elle ne voit ni le mot ni la correction des AUTRES', () => {
  S.auth = { role: 'player', playerId: 'pB' };
  const feed = ctx.notifFeed({ showRead: true });
  assert(!feed.some(i => String(i.id).startsWith('trnote-cA1')), 'mot d\'une autre joueuse exposé');
  assert(!feed.some(i => String(i.id).startsWith('tredit-cA1')), 'correction d\'une autre joueuse exposée');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('feed joueuse : les notes PRIVÉES du coach ne fuient jamais', () => {
  seed();
  ctx.openEditCompletionModal('cA1');
  ctx._tceSet('notes', 'SECRET: elle triche sur ses distances');
  ctx.saveCompletionEdit('cA1');
  S.auth = { role: 'player', playerId: 'pA' };
  const dump = JSON.stringify(ctx.notifFeed({ showRead: true }));
  assert(!dump.includes('SECRET'), 'notes privées du coach dans le feed joueuse');
  // ...ni sur son écran de séance
  ctx.openTrainingSession('prog1', S.trainingCompletions.find(c => c.id === 'cA1').sessionId, back(1));
  assert(!M().includes('SECRET'), 'notes privées du coach sur l\'écran joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
});

t('écran joueuse : le mot du coach et la mention de correction s\'affichent', () => {
  seed();
  els['tcn-text'] = { value: 'Continue comme ça.' };
  ctx.saveTrainingCoachNote('cA1');
  ctx.openEditCompletionModal('cA1');
  ctx._tceSet('distanceKm', '6.3');
  ctx.saveCompletionEdit('cA1');
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingSession('prog1', S.trainingCompletions.find(c => c.id === 'cA1').sessionId, back(1));
  assert(M().includes('Un mot du coach'), 'bandeau du mot absent');
  assert(M().includes('Continue comme ça.'), 'texte du mot absent');
  assert(M().includes('a corrigé cette validation'), 'mention de correction absente');
  assert(M().includes('Séance validée'), 'bandeau de validation perdu');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// ============================================================================
// 10) EXPORT CSV
// ============================================================================
t('CSV : en-tête, séparateur ;, BOM UTF-8', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx.exportTrainingCompletionsCsv('prog1');
  const csv = String(ctx.__blob || '');
  assert(csv.charCodeAt(0) === 0xFEFF, 'BOM absent → accents cassés dans Excel FR');
  const head = csv.slice(1).split('\r\n')[0];
  assert(head.split(';').length === 17, 'colonnes = ' + head.split(';').length);
  assert(head.includes('Distance km') && head.includes('Corrigée par'), 'en-tête incomplet');
  assert(head.includes('Format course'), 'colonne format de course absente');
  assert(ctx.__blobType.includes('text/csv'), 'type MIME = ' + ctx.__blobType);
});

t('CSV : une ligne par validation FILTRÉE (ce qu\'on voit est ce qu\'on exporte)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('playerId', 'pA');
  ctx.exportTrainingCompletionsCsv('prog1');
  const rows = String(ctx.__blob).slice(1).split('\r\n').filter(Boolean);
  assert(rows.length === 5, 'lignes = ' + rows.length + ' (attendu 1 en-tête + 4)');
  assert(rows.every((r, i) => i === 0 || r.startsWith('7;Alice')), 'une autre joueuse dans l\'export');
});

t('CSV : les valeurs contenant ; " ou un saut de ligne sont échappées', () => {
  seed();
  const c = S.trainingCompletions.find(x => x.id === 'cA1');
  c.postMessage = 'Dur ; très "dur"\nmais fait';
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx.exportTrainingCompletionsCsv('prog1');
  const csv = String(ctx.__blob);
  assert(csv.includes('"Dur ; très ""dur"" mais fait"'), 'échappement CSV cassé');
  const rows = csv.slice(1).split('\r\n').filter(Boolean);
  assert(rows.length === 8, 'un saut de ligne a créé une ligne fantôme : ' + rows.length);
});

t('CSV : rien à exporter → message, pas de fichier vide', () => {
  seed();
  S.trainingCompletions = [];
  ctx.__blob = null;
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx.exportTrainingCompletionsCsv('prog1');
  assert(ctx.__blob === null, 'fichier vide produit');
  assert(ctx.__toasts.join(' ').includes('Rien à exporter'), 'aucun retour utilisateur');
});

t('CSV : réservé au coach', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.__blob = null;
  ctx.exportTrainingCompletionsCsv('prog1');
  assert(ctx.__blob === null, 'une joueuse a exporté toutes les données');
  S.auth = { role: 'coach', coachId: 'admin' };
});

// ============================================================================
// 11) ROBUSTESSE
// ============================================================================
t('programme supprimé en cours de route → la modale se ferme sans throw', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  S.trainingPrograms[0].deletedAt = Date.now();
  ctx.renderTrainingDashboard();
  assert(M() === '(closed)', 'modale non fermée');
});

t('validation orpheline (séance/joueuse inconnues) → pas de crash', () => {
  seed();
  S.trainingCompletions.push(comp({ id: 'cOrph', playerId: 'pA', sessionId: 'inconnue', datePlanned: back(2) }));
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(M().includes('Toutes les validations'), 'rendu cassé');
  ctx.openTrainingCompletionDetail('cOrph');
  assert(M().includes('Séance'), 'détail cassé');
});

t('validation sans datePlanned → filtrée sans faire tomber l\'écran', () => {
  seed();
  S.trainingCompletions.push(comp({ id: 'cNoDate', playerId: 'pA', datePlanned: null }));
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(M().includes('Toutes les validations'), 'rendu cassé');
});

t('aucune séance / programme vide → état vide propre', () => {
  seed();
  S.trainingCompletions = [];
  S.trainingSessions = [];
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(M().includes('Aucune validation'), 'état vide absent');
});

t('_tdMore / _tdSet sans état ouvert → no-op silencieux', () => {
  ctx.state._trainingDash = null;
  ctx._tdMore(); ctx._tdSet('period', 'w'); ctx._tdTab('detail');
  assert(true);
});

// ============================================================================
// 12) FORMAT DE COURSE (dérivé de la séance — aucune migration)
// ============================================================================
// Les chaînes testées ici sont celles RÉELLEMENT en base (prépa estivale 2026),
// relevées avant d'écrire le parseur. Ne pas les « simplifier » : c'est
// exactement ce que le coach a tapé, apostrophes et guillemets compris.
const P = ctx._parseRunFormat;

t('parse le format d\'une séance : « 4\' / 2\' » → 240s / 120s', () => {
  const f = P("4' / 2'");
  assert(f && f.work === 240 && f.rest === 120, JSON.stringify(f));
});
t('parse « 45" / 30" » → 45s / 30s', () => {
  const f = P('45" / 30"');
  assert(f && f.work === 45 && f.rest === 30, JSON.stringify(f));
});
t('le contenu entre crochets PRIME sur la durée totale (« Course 24 min 4x[4\'/2\'] »)', () => {
  const f = P("Course 24 min 4x[4'/2']");
  assert(f && f.work === 240 && f.rest === 120, 'a parsé la durée totale : ' + JSON.stringify(f));
});
t('parse un texte de bloc bavard : « 18 blocs [45" course rapide / 30" marche active] »', () => {
  const f = P('18 blocs [45" course rapide / 30" marche active]');
  assert(f && f.work === 45 && f.rest === 30, JSON.stringify(f));
});
t('parse les unités écrites en toutes lettres (min / s)', () => {
  assert(JSON.stringify(P('2 min / 1 min')) === JSON.stringify({ work: 120, rest: 60 }), 'min');
  assert(JSON.stringify(P('90 s / 30 s')) === JSON.stringify({ work: 90, rest: 30 }), 's');
  assert(JSON.stringify(P('30 secondes / 15 secondes')) === JSON.stringify({ work: 30, rest: 15 }), 'secondes');
});
t('aucun format identifiable → null (on n\'invente jamais un badge)', () => {
  ['', null, undefined, 'Capacité', 'Format Intermittent', '45 minutes', '3 tours'].forEach(v =>
    assert(P(v) === null, 'a inventé un format sur : ' + JSON.stringify(v)));
});
t('garde-fou : des valeurs absurdes sont rejetées plutôt que badgées', () => {
  assert(P('0" / 30"') === null, 'zéro accepté');
  assert(P('200 min / 2 min') === null, 'durée hors bornes acceptée');
});
t('CLÉ CANONIQUE : deux notations du même format tombent dans le même seau', () => {
  const a = ctx._runFormatOf(...Object.values(P("4' / 2'")));
  const b = ctx._runFormatOf(...Object.values(P('240 s / 120 s')));
  assert(a.key === b.key, a.key + ' != ' + b.key);
  assert(a.label === "4′/2′", 'libellé = ' + a.label);
});
t('libellé : 45 → 45″, 240 → 4′, 90 → 1′30', () => {
  assert(ctx._runSecLabel(45) === '45″', ctx._runSecLabel(45));
  assert(ctx._runSecLabel(240) === '4′', ctx._runSecLabel(240));
  assert(ctx._runSecLabel(90) === '1′30', ctx._runSecLabel(90));
});

t('PRIORITÉ 1 : le champ « Format » de la séance fait foi', () => {
  const f = ctx._trainingRunFormat({ formatLabel: '45" / 30"', blocks: [{ type: 'course', name: "Course 4x[4'/2']" }] });
  assert(f && f.key === '45-30', 'clé = ' + (f && f.key));
  assert(f.source === 'session', 'source = ' + f.source);
});
t('PRIORITÉ 2 : à défaut, un drill `interval` lié au bloc de course', () => {
  seed();
  S.drills = [{ id: 'dIv', name: '45/30', mode: 'interval', deletedAt: null,
    intervalConfig: { cycles: { work_ms: 45000, rest_ms: 30000 } } }];
  const f = ctx._trainingRunFormat({ formatLabel: '', blocks: [
    { type: 'course', name: 'Course', levels: { min: { drill_id: 'dIv' }, med: {}, ultra: {} } }] });
  assert(f && f.key === '45-30' && f.source === 'drill', JSON.stringify(f));
});
t('PRIORITÉ 2 bis : un drill `circuit` lié n\'est PAS un format (cas réel du club)', () => {
  // La donnée de prod : les blocs de course pointent « Course fractionnée fond »,
  // un drill de mode `circuit` sans interval_config. Le lire comme un format
  // inventerait un badge à partir de rien.
  seed();
  S.drills = [{ id: 'dCirc', name: 'Course fractionnée fond', mode: 'circuit', deletedAt: null, intervalConfig: null }];
  const f = ctx._trainingRunFormat({ formatLabel: '', blocks: [
    { type: 'course', name: 'Course', levels: { min: { drill_id: 'dCirc' }, med: {}, ultra: {} } }] });
  assert(f === null, 'format inventé depuis un drill circuit : ' + JSON.stringify(f));
});
t('PRIORITÉ 3 : à défaut, le nom puis le texte du bloc de course', () => {
  seed();
  S.drills = [];
  const f1 = ctx._trainingRunFormat({ formatLabel: '', blocks: [{ type: 'course', name: "Course 24 min 4x[4'/2']" }] });
  assert(f1 && f1.key === '240-120' && f1.source === 'block', JSON.stringify(f1));
  const f2 = ctx._trainingRunFormat({ formatLabel: '', blocks: [
    { type: 'course', name: 'Course', levels: { min: { text: '' }, med: { text: '18 blocs [45" / 30"]' }, ultra: { text: '' } } }] });
  assert(f2 && f2.key === '45-30' && f2.source === 'block', JSON.stringify(f2));
});
t('seuls les blocs de type `course` sont regardés', () => {
  const f = ctx._trainingRunFormat({ formatLabel: '', blocks: [{ type: 'gainage', name: "6 séries [30\" / 20\"]" }] });
  assert(f === null, 'un bloc de gainage a produit un format de course');
});
t('séance sans rien → null, et aucun crash', () => {
  assert(ctx._trainingRunFormat(null) === null);
  assert(ctx._trainingRunFormat({}) === null);
  assert(ctx._trainingRunFormat({ blocks: null }) === null);
});

// --- décor déterministe pour l'UI -------------------------------------------
// Les sessionId sont FORCÉS : le décor de base les déduit du jour de la semaine
// de datePlanned, ce qui ferait dépendre les assertions du jour où le test tourne.
function seedFormats() {
  seed();
  S.drills = [];
  S.trainingSessions.forEach(x => { x.formatLabel = ''; });
  S.trainingSessions.find(x => x.id === 's1').formatLabel = '45" / 30"';
  S.trainingSessions.find(x => x.id === 's2').formatLabel = "4' / 2'";
  S.trainingCompletions = [
    comp({ id: 'f1', playerId: 'pA', datePlanned: back(1), sessionId: 's1', runningDistanceKm: 3.2 }),
    comp({ id: 'f2', playerId: 'pA', datePlanned: back(2), sessionId: 's1', runningDistanceKm: 2.8 }),
    comp({ id: 'f3', playerId: 'pB', datePlanned: back(3), sessionId: 's2', runningDistanceKm: 6 }),
    comp({ id: 'f4', playerId: 'pB', datePlanned: back(4), sessionId: 's3' }),   // séance sans format
  ];
}

t('timeline : chaque ligne porte l\'étiquette du format de sa séance', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  const h = M();
  assert(h.includes('td-fmt-tag">45″/30″'), 'étiquette 45″/30″ absente');
  assert(h.includes('td-fmt-tag">4′/2′'), 'étiquette 4′/2′ absente');
});
t('le format ne s\'affiche JAMAIS seul : sans distance, on le dit', () => {
  // f4 est sur une séance SANS format → aucune mention ; f1..f3 ont une distance.
  seedFormats();
  S.trainingCompletions.find(c => c.id === 'f1').runningDistanceKm = null;
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(M().includes('pas de distance'), 'absence de distance non signalée');
});
t('une séance sans format ne produit aucune étiquette', () => {
  seedFormats();
  const only = ctx.renderCompletionsTimeline([S.trainingCompletions.find(c => c.id === 'f4')], {});
  assert(!only.includes('td-fmt-tag'), 'étiquette posée sur une séance sans format');
  assert(!only.includes('pas de distance'), 'mention de distance sur une séance sans course');
});

t('FILTRE : les chips listent les formats du programme + « tous »', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  const h = M();
  assert(h.includes('Tous formats'), 'chip « tous » absente');
  assert(h.includes(">45″/30″</button>"), 'chip 45″/30″ absente');
  assert(h.includes(">4′/2′</button>"), 'chip 4′/2′ absente');
  assert(h.includes('Sans format'), 'chip « sans format » absente');
});
t('FILTRE : les chips ne sont PAS affichées si le programme n\'a qu\'un format', () => {
  seedFormats();
  S.trainingSessions.forEach(x => { x.formatLabel = '45" / 30"'; });
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(!M().includes('Tous formats'), 'rangée de filtres affichée sans choix à offrir');
});
t('FILTRE : sélectionner un format restreint la timeline', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('runFormat', '45-30');
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['f1', 'f2']), 'ids = ' + ids.join(','));
});
t('FILTRE : « sans format » isole les séances sans course identifiable', () => {
  ctx._tdSet('runFormat', ctx.RUN_FORMAT_NONE);
  const ids = ctx._tdFilteredCompletions(S.trainingPrograms[0]).map(c => c.id);
  assert(JSON.stringify(ids) === JSON.stringify(['f4']), 'ids = ' + ids.join(','));
});
t('FILTRE : il se combine avec les autres (joueuse + format)', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('runFormat', '45-30');
  ctx._tdSet('playerId', 'pB');
  assert(ctx._tdFilteredCompletions(S.trainingPrograms[0]).length === 0, 'combinaison de filtres inopérante');
});
t('FILTRE : il est purgé par « retirer les filtres »', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('runFormat', '45-30');
  ctx._tdSet('playerId', 'pC');           // aucune validation → état vide
  assert(M().includes('sur ce format de course'), 'le format n\'est pas mentionné dans l\'état vide');
  assert(M().includes("_td().runFormat=''"), 'le CTA ne purge pas le filtre format');
});

t('RÉPARTITION : une carte par format, avec séances, km et MOYENNE', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  const st = ctx._tdRunFormatStats(ctx._tdFilteredCompletions(S.trainingPrograms[0]));
  const a = st.find(x => x.key === '45-30');
  const b = st.find(x => x.key === '240-120');
  const none = st.find(x => x.key === ctx.RUN_FORMAT_NONE);
  assert(a && a.n === 2 && a.km === 6 && a.avg === 3, JSON.stringify(a));
  assert(b && b.n === 1 && b.km === 6 && b.avg === 6, JSON.stringify(b));
  assert(none && none.n === 1 && none.nKm === 0 && none.avg === null, JSON.stringify(none));
  // ...et c'est bien rendu : c'est le livrable analytique de la feature.
  assert(M().includes('Par format de course'), 'bloc de répartition absent');
  assert(M().includes('moy 3'), 'moyenne absente du rendu');
});
t('RÉPARTITION : une carte est cliquable et bascule le filtre', () => {
  assert(M().includes("_tdSet('runFormat','45-30')"), 'carte non cliquable');
});
t('RÉPARTITION : pas de bloc quand tout est du même format (rien à comparer)', () => {
  seedFormats();
  S.trainingSessions.forEach(x => { x.formatLabel = '45" / 30"'; });
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(!M().includes('Par format de course'), 'bloc de répartition affiché sans comparaison possible');
});

t('DÉTAIL : la ligne format donne le libellé ET sa provenance', () => {
  seedFormats();
  ctx.openTrainingCompletionDetail('f1');
  const h = M();
  assert(h.includes('Format course'), 'ligne absente');
  assert(h.includes('45″/30″'), 'libellé absent');
  assert(h.includes('format de la séance'), 'provenance absente');
});
t('DÉTAIL : sans distance, la ligne le dit au lieu de laisser un vide', () => {
  seedFormats();
  S.trainingCompletions.find(c => c.id === 'f1').runningDistanceKm = null;
  ctx.openTrainingCompletionDetail('f1');
  assert(M().includes('aucune distance saisie'), 'absence de distance non explicitée');
});

t('CSV : la colonne format porte le libellé lisible, pas la clé canonique', () => {
  seedFormats();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx.exportTrainingCompletionsCsv('prog1');
  const csv = String(ctx.__blob);
  assert(csv.includes('45″/30″'), 'libellé absent du CSV');
  assert(!csv.includes('45-30'), 'clé canonique exportée (illisible dans un tableur)');
});

t('RÉTROACTIF : aucune écriture, aucun champ ajouté sur les validations', () => {
  seedFormats();
  const before = JSON.stringify(S.trainingCompletions);
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('runFormat', '45-30');
  ctx.openTrainingCompletionDetail('f1');
  ctx.exportTrainingCompletionsCsv('prog1');
  assert(JSON.stringify(S.trainingCompletions) === before, 'la dérivation a muté les validations');
});

// ============================================================================
// 13) RESPONSIVE MOBILE UNIVERSEL
// ============================================================================
// On PARSE le CSS réel plutôt que de simuler une largeur : la mise en page de cet
// écran est faite à 100 % par des media queries, jamais par du JS qui lirait
// window.innerWidth. Simuler « un iPhone 13 » ne prouverait donc rien — et
// figerait le test sur un modèle. Ce qu'on vérifie, ce sont les INVARIANTS :
// mobile-first, paliers en `em`, cibles tactiles, aucun débordement possible.
const CSS = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
// Les règles/queries du bloc prépa : tout ce qui touche un sélecteur .td-*.
function tdMediaQueries() {
  const out = [];
  const re = /@media\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    for (; i < CSS.length && depth > 0; i++) { if (CSS[i] === '{') depth++; else if (CSS[i] === '}') depth--; }
    const body = CSS.slice(start, i - 1);
    if (/\.td-|\.segmented\.td-seg/.test(body)) out.push({ cond: m[1].trim(), body });
    re.lastIndex = i;
  }
  return out;
}
function baseRuleOf(sel) {
  const noMedia = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(noMedia);
  return m ? m[1] : '';
}

t('le bloc prépa existe bien dans le CSS (et pas seulement en styles inline)', () => {
  assert(CSS.includes('.td-row'), '.td-row absent du CSS');
  assert(CSS.includes('.td-filters'), '.td-filters absent du CSS');
  assert(tdMediaQueries().length >= 3, 'paliers responsive absents : ' + tdMediaQueries().length);
});

t('MOBILE-FIRST : tous les paliers du bloc sont des min-width (aucun max-width)', () => {
  tdMediaQueries().forEach(q => {
    assert(/min-width/.test(q.cond), 'palier non min-width : ' + q.cond);
    assert(!/max-width/.test(q.cond), 'max-width interdite (rétrécirait le mobile) : ' + q.cond);
  });
});

t('les paliers sont exprimés en `em` (ils suivent la taille de police, pas un appareil)', () => {
  tdMediaQueries().forEach(q => {
    assert(/\dem\b/.test(q.cond), 'palier pas en em : ' + q.cond);
    assert(!/\dpx\b/.test(q.cond), 'palier en px : ' + q.cond);
  });
});

t('BASE = mise en page la plus étroite : filtres et photos empilés par défaut', () => {
  assert(/flex-direction:\s*column/.test(baseRuleOf('.td-filters')), '.td-filters pas empilé en base');
  assert(/flex-direction:\s*column/.test(baseRuleOf('.td-photos')), '.td-photos pas empilé en base');
  assert(/flex-direction:\s*column/.test(baseRuleOf('.td-kv')), '.td-kv pas empilé en base');
  // ...et la mise en ligne n'arrive QUE dans un palier.
  const inRow = tdMediaQueries().map(q => q.body).join('\n');
  assert(/\.td-filters\s*\{[^}]*flex-direction:\s*row/.test(inRow), '.td-filters ne passe jamais en ligne');
});

t('la colonne centrale de la timeline a min-width:0 (sinon un mot long pousse la ligne dehors)', () => {
  assert(/min-width:\s*0/.test(baseRuleOf('.td-row-main')), 'min-width:0 absent de .td-row-main');
});

t('CIBLES TACTILES : .td-tap fait au moins 44px dans les deux axes', () => {
  const r = baseRuleOf('.td-tap');
  const w = Number((r.match(/min-width:\s*(\d+)px/) || [])[1] || 0);
  const h = Number((r.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  assert(w >= 44, 'min-width = ' + w);
  assert(h >= 44, 'min-height = ' + h);
});

t('les boutons d\'icône du suivi utilisent bien .td-tap (crayon, croix, corbeille)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(/class="btn btn-ghost td-tap"[^>]*openEditCompletionModal/.test(M()), 'crayon de timeline sans td-tap');
  ctx._tdSet('playerId', 'pA');
  assert(/td-tap"[^>]*_tdSet\('playerId',''\)/.test(M()), 'croix de drill-down sans td-tap');
  ctx.openTrainingCompletionDetail('cA1');
  assert(/td-tap"[^>]*deleteTrainingCompletion/.test(M()), 'corbeille sans td-tap');
});

t('aucun texte sous 10px dans le rendu du suivi (lisible à 100 % de zoom)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const detail = M();
  ctx.openTrainingCompletionDetail('cA1');
  const both = detail + M();
  const small = [...both.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
    .map(m => Number(m[1])).filter(n => n < 10);
  assert(small.length === 0, 'tailles trop petites trouvées : ' + small.join(', '));
});

t('les textes du SVG restent ≥ 9px après mise à l\'échelle du viewBox', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const svg = M().slice(M().indexOf('<svg'), M().indexOf('</svg>'));
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert(vb, 'viewBox introuvable');
  // Largeur de contenu la plus étroite visée : ~288px (petit mobile, paddings de
  // .modal-body retirés) → facteur d'échelle = 288 / largeur du viewBox.
  const scale = 288 / Number(vb[1]);
  const sizes = [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map(m => Number(m[1]) * scale);
  assert(sizes.length >= 2, 'aucun texte dans le SVG ?');
  sizes.forEach(px => assert(px >= 9, 'texte SVG rendu à ' + px.toFixed(1) + 'px'));
});

t('le SVG est fluide : width:100% + viewBox, aucune largeur en px', () => {
  const svg = M().slice(M().indexOf('<svg'), M().indexOf('</svg>'));
  assert(/width:\s*100%/.test(svg), 'svg pas en largeur fluide');
  assert(!/\swidth="\d+"/.test(svg), 'attribut width fixe sur le svg');
});

t('SCROLL HORIZONTAL : seul le tableau des km a le droit de scroller, dans son conteneur', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  ctx._tdSet('playerId', 'pA');
  const h = M();
  assert(h.includes('class="td-table-wrap"'), 'conteneur scrollable du tableau absent');
  assert(/overflow-x:\s*auto/.test(baseRuleOf('.td-table-wrap')), '.td-table-wrap ne scrolle pas');
  // Aucun overflow-x inline ailleurs dans le rendu : un scroll horizontal doit
  // toujours être une décision explicite prise dans le CSS, jamais une surprise.
  assert(!/overflow-x:\s*(auto|scroll)/.test(h), 'overflow-x inline dans le rendu : ' + h.match(/overflow-x:[^;"]*/));
});

t('aucune largeur ni flex-basis fixe en px dans le rendu (tout suit le conteneur)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const detail = M();
  ctx.openTrainingCompletionDetail('cA1');
  const both = detail + M();
  // Les seules dimensions en px admises sont celles des avatars (carrés de 34/40)
  // et des jauges : on interdit ce qui pourrait dépasser la largeur de contenu.
  const wide = [...both.matchAll(/\bwidth:\s*(\d+)px/g)].map(m => Number(m[1])).filter(n => n > 120);
  assert(wide.length === 0, 'largeurs fixes trop grandes : ' + wide.join(', '));
  assert(!/flex:\s*\d[^;"]*\d{2,}px/.test(both), 'flex-basis en px inline (la classe doit décider)');
});

t('les <select> de filtre sont pleine largeur et étiquetés (accessibilité + zoom)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  const h = M();
  assert(h.includes('class="td-filters"'), 'conteneur de filtres sans classe');
  assert((h.match(/aria-label="Filtrer par/g) || []).length === 2, 'selects non étiquetés');
  assert(/width:\s*100%/.test(baseRuleOf('.td-filters > select')), 'select pas en pleine largeur en base');
});

t('la barre d\'onglets neutralise les marges de .segmented (sinon 36px volés)', () => {
  seed();
  ctx.openTrainingDashboard('prog1', 'detail');
  assert(M().includes('class="segmented td-seg"'), 'classe td-seg absente de la barre d\'onglets');
  const r = baseRuleOf('.segmented.td-seg');
  assert(/margin-left:\s*0/.test(r) && /margin-right:\s*0/.test(r), 'marges latérales non annulées');
});

t('les chips de format wrappent et font 44px (nombre de formats non borné)', () => {
  assert(/flex-wrap:\s*wrap/.test(baseRuleOf('.td-chips')), '.td-chips ne wrappe pas → scroll horizontal');
  assert(!/overflow-x/.test(baseRuleOf('.td-chips')), '.td-chips scrolle au lieu de wrapper');
  const c = baseRuleOf('.td-chip');
  assert(Number((c.match(/min-height:\s*(\d+)px/) || [])[1] || 0) >= 44, 'chip sous 44px : ' + c);
});

t('la répartition par format est mobile-first : 1 colonne en base, 2 au palier', () => {
  assert(/grid-template-columns:\s*1fr\s*;/.test(baseRuleOf('.td-fmt-grid') + ';'), '.td-fmt-grid pas en 1 colonne en base');
  const inRow = tdMediaQueries().map(q => q.body).join('\n');
  assert(/\.td-fmt-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/.test(inRow), '2 colonnes jamais atteintes');
});

t('les vignettes sont dimensionnées par CSS (et grossissent au palier supérieur)', () => {
  assert(/width:\s*42px/.test(baseRuleOf('.td-thumb')), 'vignette de base != 42px');
  const inRow = tdMediaQueries().map(q => q.body).join('\n');
  assert(/\.td-thumb\s*\{[^}]*width:\s*52px/.test(inRow), 'vignette jamais agrandie sur écran plus large');
});

// --- bilan ------------------------------------------------------------------
R.forEach(l => console.log(l));
const ko = R.filter(l => l.startsWith('✗'));
console.log('\n' + (ko.length ? '✗ ' : '✓ ') + (R.length - ko.length) + '/' + R.length + ' checks OK');
process.exit(ko.length ? 1 : 0);
