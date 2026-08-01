// Test APERÇU COACH DE LA PRÉPA — le coach parcourt une séance comme une joueuse,
// drills lançables compris, SANS qu'une seule écriture parte.
//
// POURQUOI SUR LE VRAI index.html : la promesse tient en deux moitiés qu'une copie
// de fonctions pures ne peut pas vérifier —
//   1. le rendu doit être STRICTEMENT celui de la joueuse (donc il faut rendre les
//      deux et les comparer, pas relire une intention) ;
//   2. aucune écriture ne doit partir (donc il faut instrumenter persist(),
//      _trainingFlush(), notifyPush() et le Storage, et prouver 0 appel).
// Même approche que test-coach-training-detail.mjs.
//
// MAINTENANCE — si ce test casse après un changement SANS RAPPORT avec la prépa,
// c'est probablement le boot d'index.html qui touche une API navigateur pas encore
// stubée (cf. `ctx`) : ajouter le stub, ne pas supprimer le test.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\nglobalThis.TRAINING_LEVELS = TRAINING_LEVELS;';

// --- stubs DOM minimalistes -------------------------------------------------
const store = {};
const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {}, click() {},
});
const doc = {
  getElementById: () => mkEl(),
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
  alert: () => {}, prompt: () => '', confirm: () => true,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 360, innerHeight: 740,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
  Blob: class { constructor(p) { this.parts = p; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(code, ctx, { filename: 'index.inline.js' });
} catch (e) {
  console.log('✗ ÉVALUATION: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('✓ script évalué');

// --- INSTRUMENTATION DES ÉCRITURES ------------------------------------------
// Tout ce qui pourrait sortir de l'app est compté. `persist()` et `_trainingFlush()`
// sont des `function` de haut niveau → propriétés du global du contexte : les
// réassigner intercepte bien les appels INTERNES d'index.html.
ctx.__w = { persist: 0, flush: 0, push: 0, upload: 0, toasts: [], modals: [] };
const realPersist = ctx.persist;
ctx.persist = function () { ctx.__w.persist++; return realPersist.apply(this, arguments); };
ctx._trainingFlush = function () { ctx.__w.flush++; };
ctx.notifyPush = (keys, payload) => { ctx.__w.push++; ctx.__w.pushPayload = payload; };
ctx.render = () => {};
ctx.showToast = m => { ctx.__w.toasts.push(String(m)); };
ctx.openModal = h => { ctx.__lastModal = h; ctx.__w.modals.push(h); };
ctx.closeModal = () => { ctx.__lastModal = '(closed)'; };
// PbSync : le vrai vit dans un <script type="module">, hors de portée. Le Proxy
// suffit à réveiller les `if (window.PbSync)` sans rien écrire.
ctx.PbSync = new Proxy({}, {
  get: (t, k) => (typeof k === 'symbol' || k === 'then') ? undefined : (() => {})
});
// Storage Supabase : toute tentative d'upload est une ÉCRITURE et doit être comptée.
ctx.sb = {
  storage: {
    from: () => ({
      upload: async () => { ctx.__w.upload++; return { error: null }; },
      getPublicUrl: () => ({ data: { publicUrl: 'https://x/y.jpg' } }),
    })
  }
};

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion'); };
const M = () => String(ctx.__lastModal || '');
const resetW = () => { ctx.__w.persist = 0; ctx.__w.flush = 0; ctx.__w.push = 0; ctx.__w.upload = 0; ctx.__w.toasts = []; ctx.__w.modals = []; };
// Aucune écriture, quel qu'en soit le canal.
const assertNoWrite = where => {
  assert(ctx.__w.persist === 0, where + ' : persist() appelé ' + ctx.__w.persist + '×');
  assert(ctx.__w.flush === 0, where + ' : _trainingFlush() appelé ' + ctx.__w.flush + '×');
  assert(ctx.__w.push === 0, where + ' : notifyPush() appelé ' + ctx.__w.push + '×');
  assert(ctx.__w.upload === 0, where + ' : upload Storage appelé ' + ctx.__w.upload + '×');
};

// --- décor -------------------------------------------------------------------
// Dates RELATIVES : un décor en dur passe au vert la semaine de son écriture puis
// silencieusement au rouge un mois plus tard.
const S = ctx.state;
const DAY = 86400000;
const iso = d => ctx.isoDate(new Date(d));
const NOW = Date.now();
const TODAY = iso(NOW);
const DOW_TODAY = ctx._trainingDayOfWeek(TODAY);

function seed() {
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [
    { id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] },
    { id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e2'] },
  ];
  S.seasons = [{ id: 'S1', name: 'Saison test', startDate: iso(NOW - 300 * DAY), endDate: iso(NOW + 300 * DAY), status: 'active' }];
  S.activeSeasonId = 'S1';
  S.currentSeasonId = 'S1';
  S.players = [
    { id: 'pA', name: 'Alice', num: 7, photo: '' },
    { id: 'pB', name: 'Bea', num: 8, photo: '' },
  ];
  S.seasonPlayers = [
    { seasonId: 'S1', playerId: 'pA', teamTag: 'e1', joinedAt: iso(NOW - 300 * DAY), leftAt: null },
    { seasonId: 'S1', playerId: 'pB', teamTag: 'e1', joinedAt: iso(NOW - 300 * DAY), leftAt: null },
  ];
  // Programme EN COURS : c'est le cas dur — le bouton « ✓ J'ai fait la séance »
  // serait actif pour une joueuse, donc l'aperçu doit le remplacer explicitement.
  S.trainingPrograms = [{
    id: 'prog1', name: 'Prépa estivale', startDate: iso(NOW - 10 * DAY), endDate: iso(NOW + 20 * DAY),
    daysActive: [1, 2, 3, 4, 5, 6, 7],
    scoringConfig: { points: { min: 10, med: 20, ultra: 30 }, post_bonus: 10, squad_multiplier: 2, remind_hour: 9 },
    isActive: true, teamTag: 'both', deletedAt: null, updatedAt: NOW,
  }];
  S.drills = [{ id: 'd1', name: 'Fractionné 45/30', mode: 'interval', deletedAt: null, updatedAt: NOW }];
  S.trainingSessions = [1, 2, 3, 4, 5, 6, 7].map(d => ({
    id: 's' + d, programId: 'prog1', dayOfWeek: d, name: 'Séance J' + d,
    formatLabel: '45/30', introText: 'Bien s\'échauffer.', notesRecovery: 'Étirements 10 min.',
    blocks: [
      { type: 'warmup', name: 'Échauffement', instructions: 'Mobilité générale.', track_distance: false,
        levels: { min: { text: '5 min' }, med: { text: '10 min' }, ultra: { text: '15 min' } } },
      { type: 'running', name: 'Course', instructions: 'Allure soutenue.', track_distance: true,
        levels: { min: { text: '2 km' }, med: { text: '4 km', drill_id: 'd1' }, ultra: { text: '6 km', drill_id: 'd1' } } },
    ],
    isTemplate: false, position: d, deletedAt: null, updatedAt: NOW,
  }));
  S.trainingCompletions = [];
  S.gageDraws = []; S.matches = []; S.broadcasts = []; S.challenges = [];
  S._previewMode = false;
  S._trainingView = null;
  S._trainingValidate = null;
  S._trainingDash = null;
  ctx.window._trainingResume = null;
  resetW();
}
seed();

// ============================================================================
// 1) ENTRÉE ET SORTIE DE L'APERÇU
// ============================================================================
t('le bouton « Aperçu joueuse » est présent dans la bibliothèque coach', () => {
  ctx.openTrainingPrograms();
  assert(M().includes("openTrainingCoachPreview('prog1')"), 'bouton d\'aperçu absent de la bibliothèque');
  assert(M().includes('🔍 Aperçu joueuse'), 'libellé du bouton absent');
});

t('une joueuse ne peut pas entrer en aperçu coach', () => {
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingCoachPreview('prog1');
  assert(S._previewMode !== true, 'drapeau posé pour une joueuse !');
  seed();
});

t('openTrainingCoachPreview() pose le drapeau et ouvre l\'écran programme joueuse', () => {
  ctx.openTrainingCoachPreview('prog1');
  assert(S._previewMode === true, 'drapeau non posé');
  assert(ctx._trainingPreviewOn() === true, '_trainingPreviewOn() faux pour un coach en aperçu');
  assert(M().includes('🔍 Aperçu joueuse'), 'eyebrow d\'aperçu absent');
  assert(M().includes('Mode aperçu coach'), 'bandeau d\'aperçu absent');
  assert(M().includes('Rien n\'est enregistré'), 'la promesse « rien n\'est enregistré » n\'est pas écrite');
  assert(M().includes("Quitter l'aperçu"), 'bouton de sortie absent de l\'écran programme');
  assert(M().includes("openTrainingSession('prog1','s" + DOW_TODAY + "'"), 'les séances ne sont pas ouvrables');
  assertNoWrite('entrée en aperçu');
});

t('« Quitter l\'aperçu » efface le drapeau et ramène à la bibliothèque coach', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  ctx.exitTrainingCoachPreview('prog1');
  assert(S._previewMode === false, 'drapeau non effacé');
  assert(S._trainingView === null, 'écran de séance non nettoyé');
  assert(ctx.window._trainingResume === null, 'reprise de drill non nettoyée');
  assert(M().includes('Prépa physique') && M().includes('Nouveau programme'), 'retour à la bibliothèque raté');
});

t('la croix ✕ sort de l\'aperçu (et ne laisse pas le drapeau derrière)', () => {
  ctx.openTrainingCoachPreview('prog1');
  assert(M().includes('exitTrainingCoachPreview()'), 'la croix de l\'écran programme ne sort pas de l\'aperçu');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  assert(M().includes('exitTrainingCoachPreview()'), 'la croix de la séance ne sort pas de l\'aperçu');
  ctx.exitTrainingCoachPreview();
  assert(S._previewMode === false, 'drapeau survivant');
});

// ============================================================================
// 2) LE RENDU EST CELUI DE LA JOUEUSE
// ============================================================================
// On rend la MÊME séance des deux côtés et on compare le corps. Un aperçu qui
// diverge du vécu de la joueuse ne sert à rien.
const bodyOf = h => { const m = String(h).match(/<div class="modal-body">([\s\S]*?)<div class="modal-footer"/); return m ? m[1] : ''; };
const footerOf = h => { const m = String(h).match(/<div class="modal-footer"[\s\S]*$/); return m ? m[0] : ''; };
const stripPreviewBanner = b => b.replace(/<div style="padding:10px 12px;background:var\(--bg-3\);border-left:3px solid var\(--orange\)[^]*?Mode aperçu coach[^]*?<\/div>/, '');
// L'indentation des template literals n'est pas du contenu : on compare le RENDU,
// pas la mise en forme du source (retirer un bandeau laisse forcément des blancs).
const norm = b => String(b).replace(/\s+/g, ' ').trim();

t('le corps de la séance est identique au rendu joueuse (au bandeau près)', () => {
  seed();
  // 1) rendu joueuse
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  const playerBody = norm(bodyOf(M()));
  const playerFooter = footerOf(M());
  // 2) rendu coach en aperçu
  seed();
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  const coachBody = norm(stripPreviewBanner(bodyOf(M())));
  assert(playerBody.length > 200, 'rendu joueuse vide — décor cassé');
  assert(coachBody === playerBody,
    'le corps diverge du rendu joueuse\n--- joueuse ---\n' + playerBody.slice(0, 400) + '\n--- coach ---\n' + coachBody.slice(0, 400));
  assert(playerFooter.includes("J'ai fait la séance"), 'la joueuse n\'avait pas le bouton de validation — décor cassé');
});

t('les 3 niveaux et les blocs sont bien là, et le niveau se change', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  assert(M().includes('🟢 Minimum') && M().includes('🟠 Medium') && M().includes('🔴 Ultra'), 'les 3 niveaux ne sont pas proposés');
  assert(M().includes('10 min'), 'texte du niveau MED absent');
  assert(M().includes('Mobilité générale'), 'instructions du bloc absentes');
  assert(M().includes('Ta distance te sera demandée'), 'mention distance absente');
  ctx._tvLevel('ultra');
  assert(S._trainingView.level === 'ultra', 'niveau non changé');
  assert(M().includes('15 min') && M().includes('6 km'), 'le passage en ULTRA n\'a pas changé le contenu');
  assertNoWrite('navigation entre niveaux');
});

t('le drill reste lançable pour de vrai en aperçu', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  assert(M().includes("launchTrainingDrill('d1')"), 'bouton de lancement du drill absent');
  assert(M().includes('⏳ Fractionné · Fractionné 45/30'), 'libellé du drill absent');
  let launched = null;
  ctx.launchInterval = id => { launched = id; };
  resetW();
  ctx.launchTrainingDrill('d1');
  assert(launched === 'd1', 'le runtime du drill n\'a pas été lancé');
  assert(ctx.window._trainingResume && ctx.window._trainingResume.sessionId === 's' + DOW_TODAY, 'la séance ne sera pas rouverte après le drill');
  assertNoWrite('lancement du drill');
  // Le retour de drill rouvre la séance TOUJOURS en aperçu.
  ctx._trainingMaybeResume();
  assert(ctx._trainingPreviewOn() === true, 'l\'aperçu est tombé au retour du drill');
  assert(M().includes('Mode aperçu coach'), 'bandeau perdu au retour du drill');
});

// ============================================================================
// 3) LE PIED DE PAGE NE PROPOSE PLUS DE VALIDER
// ============================================================================
t('le pied de page annonce l\'aperçu et n\'offre aucune validation', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  const f = footerOf(M());
  assert(f.includes('Mode aperçu — aucune sauvegarde'), 'mention « aucune sauvegarde » absente du pied');
  assert(f.includes("Quitter l'aperçu"), 'bouton de sortie absent du pied');
  assert(!f.includes("J'ai fait la séance"), 'le bouton de validation est encore proposé !');
  assert(!f.includes('openTrainingValidate'), 'openTrainingValidate encore câblé dans le pied');
});

// ============================================================================
// 4) DÉFENSE EN PROFONDEUR — les fonctions d'écriture refusent d'elles-mêmes
// ============================================================================
t('openTrainingValidate() refuse et prévient', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  resetW();
  ctx.openTrainingValidate();
  assert(S._trainingValidate === null, 'écran de validation ouvert en aperçu !');
  assert(ctx.__w.toasts.some(x => x.includes('aperçu')), 'aucun retour à l\'utilisateur : ' + JSON.stringify(ctx.__w.toasts));
  assertNoWrite('openTrainingValidate');
});

t('confirmTrainingCompletion() n\'insère RIEN, même l\'état de validation forcé', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  // Forçage direct : on court-circuite l'UI pour prouver que la garde est DANS la
  // fonction, pas seulement sur le bouton.
  S._trainingValidate = {
    programId: 'prog1', sessionId: 's' + DOW_TODAY, datePlanned: TODAY, level: 'med',
    squadOn: false, squadTeammateId: '', squadPhotoUrl: '',
    postOn: false, postPhotoUrl: '', postMessage: '', distanceKm: '5', busy: false
  };
  resetW();
  const before = S.trainingCompletions.length;
  ctx.confirmTrainingCompletion();
  assert(S.trainingCompletions.length === before, 'une completion a été créée en aperçu !');
  assertNoWrite('confirmTrainingCompletion');
  assert(ctx.__w.toasts.some(x => x.includes('aperçu')), 'aucun retour à l\'utilisateur');
});

t('_tvaPhoto() n\'envoie aucune photo au Storage', async () => {
  const ev = { target: { files: [{ name: 'x.jpg' }], value: 'x' } };
  resetW();
  ctx._tvaPhoto('squad', ev);
  assert(ctx.__w.upload === 0, 'upload Storage déclenché en aperçu !');
  assert(ev.target.value === '', 'le champ fichier n\'a pas été purgé');
});

t('_trainingNotifyCoachCompletion() n\'envoie aucun push', () => {
  resetW();
  ctx._trainingNotifyCoachCompletion(S.trainingPrograms[0], { pointsTotal: 40, contractLevel: 'med' });
  assert(ctx.__w.push === 0, 'push envoyé en aperçu !');
});

// ============================================================================
// 5) LE DRAPEAU N'EST NI CONTAGIEUX, NI PERSISTANT
// ============================================================================
t('le drapeau n\'est PAS honoré pour une joueuse (elle valide normalement)', () => {
  seed();
  S.auth = { role: 'player', playerId: 'pA' };
  S._previewMode = true;   // forçage hostile
  assert(ctx._trainingPreviewOn() === false, 'une joueuse serait passée en aperçu !');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  assert(footerOf(M()).includes("J'ai fait la séance"), 'la joueuse a perdu son bouton de validation');
  S._trainingValidate = {
    programId: 'prog1', sessionId: 's' + DOW_TODAY, datePlanned: TODAY, level: 'med',
    squadOn: false, squadTeammateId: '', squadPhotoUrl: '',
    postOn: false, postPhotoUrl: '', postMessage: '', distanceKm: '', busy: false
  };
  resetW();
  ctx.confirmTrainingCompletion();
  assert(S.trainingCompletions.length === 1, 'la joueuse n\'a PAS pu valider — la garde déborde sur elle !');
  assert(ctx.__w.persist > 0 && ctx.__w.flush > 0, 'la validation joueuse n\'a rien écrit');
  seed();
});

t('le drapeau ne part jamais en base ni en localStorage', () => {
  ctx.openTrainingCoachPreview('prog1');
  realPersist();
  const dump = JSON.stringify(store);
  assert(!dump.includes('_previewMode'), '_previewMode retrouvé dans le stockage local');
  assert(!dump.includes('previewMode'), 'une trace de previewMode a été persistée');
});

t('doLogout() éteint l\'aperçu (le logout SPA ne recharge pas la page)', () => {
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  ctx.doLogout();
  assert(S._previewMode === false, 'drapeau survivant au logout');
  assert(S._trainingView === null, 'écran de séance survivant au logout');
  assert(ctx.window._trainingResume === null, 'reprise de drill survivante au logout');
  seed();
});

// ============================================================================
// 6) AUCUNE FUITE VERS LES ÉCRANS JOUEUSE
// ============================================================================
t('l\'aperçu ne fabrique aucune carte « Ma prépa » côté coach', () => {
  ctx.openTrainingCoachPreview('prog1');
  assert(ctx.renderTrainingPlayerCard() === '', 'carte joueuse rendue pour un coach en aperçu');
});

t('aucune écriture sur TOUT le parcours d\'aperçu bout en bout', () => {
  seed();
  resetW();
  ctx.openTrainingPrograms();
  ctx.openTrainingCoachPreview('prog1');
  ctx.openTrainingSession('prog1', 's' + DOW_TODAY, TODAY);
  ctx._tvLevel('min'); ctx._tvLevel('ultra'); ctx._tvLevel('med');
  ctx.openTrainingValidate();
  ctx.confirmTrainingCompletion();
  ctx.exitTrainingCoachPreview('prog1');
  assertNoWrite('parcours complet');
  assert(S.trainingCompletions.length === 0, 'des données ont été créées sur le parcours');
});

// --- bilan ------------------------------------------------------------------
R.forEach(l => console.log(l));
const ko = R.filter(l => l.startsWith('✗'));
console.log('\n' + (ko.length ? '✗ ' : '✓ ') + (R.length - ko.length) + '/' + R.length + ' checks OK');
process.exit(ko.length ? 1 : 0);
