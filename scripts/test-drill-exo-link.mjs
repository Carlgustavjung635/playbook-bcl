// Test « LIEN EXO ↔ DRILL + REFONTE UX DE LA BIBLIOTHÈQUE » (migration 20260816_003).
//
// Deux chantiers, un seul fichier parce qu'ils partagent la même colonne d'idées :
// retrouver le bon drill au bon moment.
//
// CHOIX STRUCTURANTS verrouillés ici — ce sont eux qui cassent en silence :
//   • le drill se lit sur la FICHE DE L'EXO, jamais sur une copie dans le menu.
//     C'est ce qui fait qu'associer un drill aujourd'hui éclaire un menu composé
//     il y a trois semaines. La DOSE, elle, reste figée dans le menu : les deux
//     règles cohabitent et il ne faut pas les confondre ;
//   • un drill supprimé se comporte EXACTEMENT comme une absence d'association :
//     pas de bouton mort, pas de carte cassée ;
//   • `exo_templates.drill_id` porte une CLÉ ÉTRANGÈRE : un id qui ne désigne
//     aucune ligne ferait échouer le lot d'upsert ENTIER de la table — donc sa
//     synchro, en silence. L'id est validé à l'écriture ;
//   • les deux colonnes neuves ne sont poussées qu'APRÈS que le serveur les a
//     renvoyées une fois (détection de schéma). Sans ça, déployer le front avant
//     la migration tuerait la synchro des drills ET de la bibliothèque d'exos —
//     mode de panne déjà payé en v.115 ;
//   • `last_used_at` n'est daté que CÔTÉ COACH : la colonne est partagée, une
//     joueuse qui répète son fractionné réordonnerait la biblio du coach ;
//   • un bloc de prépa RECOPIE le drill de l'exo (comme il recopie son texte) :
//     une séance publiée ne bouge plus si l'exo change d'avis ensuite.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K;'
  + '\n;globalThis.DRILL_LIB_CATS = DRILL_LIB_CATS;'
  + '\n;globalThis.DRILL_RETURN_TO = DRILL_RETURN_TO;'
  + '\n;globalThis.TRAINING_LEVELS = TRAINING_LEVELS;';

// Les dump/apply PbSync vivent dans le bloc <script type="module"> : leur portée
// ne franchit PAS la frontière des blocs, d'où les exports explicites. La
// détection de schéma se teste ICI, en EXÉCUTANT la sérialisation — la greper
// ne prouverait rien.
const moduleBlock = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && /type\s*=\s*["']module["']/.test(m[1]))
  .map(m => m[2])[0]
  .replace(/^\s*import\s[^\n]*\n/m, '')
  + '\n;globalThis.ENTITIES = ENTITIES;'
  + '\n;globalThis._dumpDrillRow = _dumpDrillRow; globalThis._drillFromRow = _drillFromRow;'
  + '\n;globalThis._dumpExoTemplateRow = _dumpExoTemplateRow; globalThis._exoTemplateFromRow = _exoTemplateFromRow;';

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
    if (id in fields) return { value: fields[id], textContent: '', checked: !!fields[id], innerHTML: '' };
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
ctx.render = () => {}; ctx.showToast = m => { ctx.__toast = m; };
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = null; };
ctx.notifyPush = () => {};

const RealDate = Date;
let NOW = RealDate.parse('2026-08-16T10:00:00Z');
class D extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
ctx.Date = D;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// Les runtimes plein écran sont hors sujet pour le ROUTAGE : on ne veut savoir
// QUE lequel est appelé, d'où les mouchards. Les vrais sont gardés de côté :
// c'est EUX qui datent le lancement, et ça se vérifie en les exécutant (les
// greper ne prouverait rien).
const REAL = { stimulus: ctx.launchDrill, circuit: ctx.launchCircuit, interval: ctx.launchInterval };
const launched = [];
const stubRuntimes = () => {
  ctx.launchDrill = id => launched.push(['stimulus', id]);
  ctx.launchCircuit = id => launched.push(['circuit', id]);
  ctx.launchInterval = id => launched.push(['interval', id]);
};
stubRuntimes();
// Rend les VRAIS runtimes, en neutralisant seulement ce qui exige un navigateur.
const useRealRuntimes = () => {
  ctx.launchDrill = REAL.stimulus; ctx.launchCircuit = REAL.circuit; ctx.launchInterval = REAL.interval;
  ctx._drillEnsureStandalone = () => true;
  ctx.startDrillGame = () => {};
};

function seed(role) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  launched.length = 0;
  stubRuntimes();
  NOW = RealDate.parse('2026-08-16T10:00:00Z');
  ctx._drillLib = null; ctx._ardExoDrill = null; ctx._ardMenuDraftBox = null;
  ctx._drillReturnTo = null; ctx._trainingResume = null; ctx._ardExoAfterDrill = null;
  S.auth = (role === 'coach') ? { role: 'coach', coachId: 'admin' } : { role: 'player', playerId: 'pA' };
  S.players = [{ id: 'pA', num: 4, name: 'Alice' }];
  S.seasons = []; S.seasonPlayers = []; S.currentSeasonId = null;
  S.ardoiseAssignments = []; S.ardoiseRules = null;
  S.drills = [
    { id: 'd1', name: 'Réaction couleurs', stimuli: { colors: ['red', 'blue'] }, lengthMs: 7000, delayMs: 500, durationMode: 'rounds', durationValue: 10, updatedAt: 10 },
    { id: 'd2', name: 'Circuit gainage', mode: 'circuit', stages: [{ type: 'timer', duration_ms: 30000 }], updatedAt: 20 },
    { id: 'd3', name: 'Fractionné 30/30', mode: 'interval', intervalConfig: { cycles: { count: 8, work_ms: 30000, rest_ms: 30000 } }, updatedAt: 30 },
    { id: 'd4', name: 'Épaules à sec', stimuli: { colors: ['red'] }, updatedAt: 40 },
    { id: 'd5', name: 'Modèle perso', mode: 'interval', isPreset: true, intervalConfig: {}, updatedAt: 50 }
  ];
  S.drillImages = [];
  S.exoTemplates = [
    { id: 'e1', name: 'Gainage planche', category: 'gainage', defaultSets: 3, defaultDurationSec: 45, defaultRestSec: 30, descriptionMd: 'Dos plat', drillId: 'd2', updatedAt: 1 },
    { id: 'e2', name: 'Squats', category: 'jambes', defaultSets: 4, defaultReps: 15, defaultRestSec: 45, descriptionMd: '', drillId: null, updatedAt: 1 }
  ];
  // Menu composé AVANT toute association : c'est lui qui doit s'éclairer.
  S.ardoiseMenus = [
    { id: 'm1', name: 'Le Gainage Royal', level: 'plat', pointsReward: 20, isActive: true, updatedAt: 1,
      items: [
        { exo_id: 'e1', name: 'Gainage planche', sets: 3, duration_sec: 45, rest_sec: 30, note: '', order: 0 },
        { exo_id: 'e2', name: 'Squats', sets: 4, reps: 15, rest_sec: 45, note: '', order: 1 }
      ] }
  ];
}

// =============================================================================
console.log('\n=== L\'EXO POINTE VERS SON DRILL ===');

t('_exoDrillOf remonte le drill VIVANT par la fiche d\'exo', () => {
  seed('coach');
  const d = ctx._exoDrillOf('e1');
  ok(d, 'le drill est résolu');
  eq(d.id, 'd2');
  eq(ctx._exoDrillOf('e2'), null, 'un exo sans association ne rend rien');
  eq(ctx._exoDrillOf(null), null, 'ni un exo_id absent');
  eq(ctx._exoDrillOf('inconnu'), null, 'ni un exo qui n\'existe pas');
});

t('un drill SUPPRIMÉ se comporte comme une absence d\'association', () => {
  seed('coach');
  S.drills.find(d => d.id === 'd2').deletedAt = NOW;
  eq(ctx._exoDrillOf('e1'), null, 'pas de drill mort rendu…');
  const h = ctx._ardMenuCardHtml(S.ardoiseMenus[0], null);
  ok(!/Lancer/.test(h), '…donc aucun bouton mort sur la carte');
  ok(/Gainage planche/.test(h), 'et la carte reste intacte');
});

t('un exo supprimé de la bibliothèque n\'éteint que le bouton', () => {
  seed('coach');
  S.exoTemplates.find(e => e.id === 'e1').deletedAt = NOW;
  const h = ctx._ardMenuCardHtml(S.ardoiseMenus[0], null);
  ok(!/Lancer/.test(h), 'plus de bouton');
  ok(/Gainage planche/.test(h), 'mais la ligne du menu survit — son nom y est recopié');
});

// =============================================================================
console.log('\n=== « ▶ LANCER » PARTOUT OÙ L\'EXO APPARAÎT ===');

t('la carte d\'ardoise porte le bouton — sur un menu composé AVANT l\'association', () => {
  seed('player');
  // Le menu de seed() a été écrit sans aucun drill ; l'association vit sur la
  // fiche d'exo. Si le lien avait été COPIÉ dans le menu, ce test échouerait.
  const h = ctx._ardMenuCardHtml(S.ardoiseMenus[0], null);
  ok(/launchExoDrill\('e1','ardoise'\)/.test(h), 'le bouton part de l\'exo, pas du drill');
  eq((h.match(/ard-item-drill/g) || []).length, 1, 'un seul bouton : e2 n\'a pas de drill');
  ok(/Circuit/.test(h), 'et il annonce le type de drill qui va s\'ouvrir');
});

t('associer un drill À POSTERIORI éclaire les menus déjà écrits', () => {
  seed('coach');
  ok(!/exo_id.*e2/.test(''), '');
  eq((ctx._ardMenuCardHtml(S.ardoiseMenus[0], null).match(/ard-item-drill/g) || []).length, 1);
  S.exoTemplates.find(e => e.id === 'e2').drillId = 'd3';
  eq((ctx._ardMenuCardHtml(S.ardoiseMenus[0], null).match(/ard-item-drill/g) || []).length, 2,
    'le menu n\'a pas bougé, il s\'est éclairé');
});

t('la DOSE reste figée dans le menu — les deux règles cohabitent', () => {
  seed('coach');
  S.exoTemplates.find(e => e.id === 'e1').defaultSets = 99;
  const h = ctx._ardMenuCardHtml(S.ardoiseMenus[0], null);
  ok(/3 × 45 s/.test(h), 'la dose du menu ignore la nouvelle valeur par défaut');
});

t('launchExoDrill route vers le bon runtime et arme le retour', () => {
  seed('player');
  ctx.launchExoDrill('e1', 'ardoise');
  eq(launched.length, 1);
  eq(launched[0][0], 'circuit', 'd2 est un circuit');
  eq(ctx._drillReturnTo, 'ardoise', 'on saura où revenir');
});

t('launchExoDrill sur un exo sans drill ne lance RIEN', () => {
  seed('player');
  ctx.launchExoDrill('e2', 'ardoise');
  eq(launched.length, 0);
  ok(/introuvable/i.test(String(ctx.__toast || '')), 'et le dit');
});

t('une clé de retour inconnue est ignorée, pas exécutée', () => {
  seed('player');
  ctx.launchExoDrill('e1', 'nimportequoi');
  eq(ctx._drillReturnTo, null, 'seules les clés déclarées valent quelque chose');
});

t('le retour de séance PRIME sur tout autre retour', () => {
  seed('player');
  const opened = [];
  ctx.openTrainingSession = (...a) => opened.push(a);
  ctx._trainingResume = { programId: 'p1', sessionId: 's1', datePlanned: '2026-08-16' };
  ctx._drillReturnTo = 'ardoise';
  ctx._trainingMaybeResume();
  eq(opened.length, 1, 'la séance est rouverte');
  eq(ctx._drillReturnTo, null, 'et l\'autre retour est désarmé, pas empilé');
});

t('sans séance, le retour d\'ardoise s\'exécute', () => {
  seed('player');
  let n = 0;
  ctx.openArdoiseScreen = () => { n++; };
  ctx._drillReturnTo = 'ardoise';
  ctx._trainingMaybeResume();
  eq(n, 1, 'l\'écran d\'ardoise est rouvert');
  eq(ctx._drillReturnTo, null, 'et le retour est à usage unique');
  ctx._trainingMaybeResume();
  eq(n, 1, 'un second render() ne le rejoue pas');
});

// =============================================================================
console.log('\n=== LA PRÉPA RECOPIE, ELLE NE RÉFÉRENCE PAS ===');

t('un bloc créé depuis un exo recopie le drill dans les 3 niveaux', () => {
  seed('coach');
  ctx._trainingWizard = null;
  const w = { openDay: 'mon', sessions: {}, config: { distance_bonus: 5, improvement_bonus: 5 } };
  ctx._tw = () => w;
  ctx._twSession = () => (w.sessions.mon = w.sessions.mon || { blocks: [] });
  ctx.renderTrainingWizard = () => {};
  fields['tw-exo-pick'] = 'e1';
  ctx._twAddBlockFromExo();
  const b = w.sessions.mon.blocks[0];
  ok(b, 'le bloc est créé');
  ctx.TRAINING_LEVELS.forEach(l => eq(b.levels[l].drill_id, 'd2', 'niveau ' + l));
  ok(/Gainage planche/.test(b.levels.min.text), 'le texte est pré-rempli comme avant');
});

t('la séance publiée ne bouge PLUS si l\'exo change d\'avis ensuite', () => {
  seed('coach');
  const w = { openDay: 'mon', sessions: {}, config: { distance_bonus: 5, improvement_bonus: 5 } };
  ctx._tw = () => w;
  ctx._twSession = () => (w.sessions.mon = w.sessions.mon || { blocks: [] });
  ctx.renderTrainingWizard = () => {};
  fields['tw-exo-pick'] = 'e1';
  ctx._twAddBlockFromExo();
  S.exoTemplates.find(e => e.id === 'e1').drillId = 'd3';
  eq(w.sessions.mon.blocks[0].levels.min.drill_id, 'd2', 'la séance garde SON drill');
});

t('un exo pointant un drill mort ne recopie rien dans le bloc', () => {
  seed('coach');
  S.drills.find(d => d.id === 'd2').deletedAt = NOW;
  const w = { openDay: 'mon', sessions: {}, config: { distance_bonus: 5, improvement_bonus: 5 } };
  ctx._tw = () => w;
  ctx._twSession = () => (w.sessions.mon = w.sessions.mon || { blocks: [] });
  ctx.renderTrainingWizard = () => {};
  fields['tw-exo-pick'] = 'e1';
  ctx._twAddBlockFromExo();
  eq(w.sessions.mon.blocks[0].levels.min.drill_id, null, 'pas de bouton « Lancer » mort côté joueuse');
});

// =============================================================================
console.log('\n=== L\'ÉDITEUR D\'EXO ===');

t('le sélecteur groupe par mode et pré-sélectionne l\'association existante', () => {
  seed('coach');
  ctx.openExoEditor('e1');
  const h = String(ctx.__lastModal || '');
  ok(/Associer un drill/.test(h), 'le champ est là');
  ok(/optgroup label="⚡ Réaction"/.test(h) && /optgroup label="🔄 Circuit"/.test(h), 'groupé par mode');
  ok(/value="d2" selected/.test(h), 'le drill déjà associé est coché');
  ok(!/value="d5"/.test(h), 'les presets perso ne sont pas des drills jouables');
});

t('le filtre par nom réécrit les options SANS perdre la sélection', () => {
  seed('coach');
  ctx.openExoEditor('e1');
  ctx._ardExoDrillFilter('fraction');
  const h = ctx._ardExoDrillSelectHtml();
  ok(/value="d3"/.test(h), 'le fractionné remonte');
  ok(/value="d2" selected/.test(h), 'et le drill associé reste listé ET coché, même filtré');
});

t('la recherche est tolérante aux accents et aux frappes partielles', () => {
  ok(ctx._drillNameMatches('Réaction couleurs', 'reaction'), 'accents ignorés');
  ok(ctx._drillNameMatches('Réaction couleurs', 'REACT'), 'casse ignorée');
  ok(ctx._drillNameMatches('Fractionné 30/30', 'frac30'), 'sous-séquence');
  ok(ctx._drillNameMatches('Épaules à sec', 'epaules'), 'É → e');
  ok(!ctx._drillNameMatches('Circuit gainage', 'zzz'), 'et elle sait dire non');
  ok(ctx._drillNameMatches('n\'importe quoi', ''), 'requête vide = tout passe');
});

t('enregistrer écrit l\'association', () => {
  seed('coach');
  ctx.openExoEditor('e2');
  fields['ard-e-name'] = 'Squats';
  fields['ard-e-cat'] = 'jambes';
  ctx._ardExoDrillSet('d3');
  ctx._ardSaveExo('e2');
  eq(S.exoTemplates.find(e => e.id === 'e2').drillId, 'd3');
});

t('un id de drill FANTÔME est refusé à l\'écriture (la colonne est une FK)', () => {
  seed('coach');
  ctx.openExoEditor('e2');
  fields['ard-e-name'] = 'Squats';
  ctx._ardExoDrillSet('d-nexiste-pas');
  ctx._ardSaveExo('e2');
  eq(S.exoTemplates.find(e => e.id === 'e2').drillId, null,
    'sinon le lot d\'upsert ENTIER de exo_templates échouerait — en silence');
});

t('un drill SOFT-supprimé reste une association valide (sa ligne existe)', () => {
  seed('coach');
  S.drills.find(d => d.id === 'd3').deletedAt = NOW;
  ctx.openExoEditor('e2');
  fields['ard-e-name'] = 'Squats';
  ctx._ardExoDrillSet('d3');
  ctx._ardSaveExo('e2');
  eq(S.exoTemplates.find(e => e.id === 'e2').drillId, 'd3', 'la FK tient, et l\'association survivra à une restauration');
});

t('« Créer un nouveau drill » ENREGISTRE l\'exo avant de partir', () => {
  seed('coach');
  ctx.openExoEditor('e2');
  fields['ard-e-name'] = 'Squats sautés';
  ctx._ardExoNewDrill('e2');
  eq(S.exoTemplates.find(e => e.id === 'e2').name, 'Squats sautés', 'le texte tapé n\'est pas perdu');
  eq(ctx._ardExoAfterDrill, 'e2', 'et on sait sur quelle fiche revenir');
});

t('la bibliothèque de drills ramène ensuite à la fiche d\'exo', () => {
  seed('coach');
  ctx._ardExoAfterDrill = 'e2';
  ctx.openDrillLibrary();
  ok(/tu reviens sur ta fiche d'exo/i.test(String(ctx.__lastModal || '')), 'le détour est annoncé');
  let back = null;
  ctx.openExoEditor = id => { back = id; };
  ctx._drillLibClose();
  eq(ctx._ardExoAfterDrill, null, 'le détour se referme');
  ctx.setTimeout = fn => { fn(); return 0; };
});

t('la biblio d\'exos du coach marque les exos liés et les lance sur place', () => {
  seed('coach');
  const h = ctx._ardCoachExosTab();
  ok(/🎯/.test(h), 'l\'exo lié se repère d\'un coup d\'œil');
  ok(/launchExoDrill\('e1','ardoiseExos'\)/.test(h), 'et se teste sans quitter la biblio');
  ok(!/launchExoDrill\('e2'/.test(h), 'un exo sans drill n\'a pas de bouton');
});

// 🔴 RÉGRESSION v.124 : `window._ardMenuDraft = {…}` écrasait la FONCTION
// `_ardMenuDraft()` (même nom, même espace global). L'éditeur de menu levait
// « _ardMenuDraft is not a function » et ne s'ouvrait pas — donc aucun menu
// n'était composable, donc aucune dette ne pouvait être tirée. Sans un mot à
// l'écran. Le slot s'appelle désormais `_ardMenuDraftBox`.
t('l\'éditeur de menu S\'OUVRE (le brouillon n\'écrase plus son accesseur)', () => {
  seed('coach');
  ctx.openArdoiseMenuEditor();
  ok(/Nouveau menu/.test(String(ctx.__lastModal || '')), 'la modale est là');
  ok(typeof ctx._ardMenuDraft === 'function', 'et l\'accesseur est resté une fonction');
  ok(ctx._ardMenuDraftBox, 'le brouillon vit dans son propre slot');
});

t('la composition d\'un menu se teste sans perdre le brouillon en cours', () => {
  seed('coach');
  ctx.openArdoiseMenuEditor('m1');
  const h = String(ctx.__lastModal || '');
  ok(/launchExoDrill\('e1','ardoiseMenuEditor'\)/.test(h), 'le retour ramène à l\'éditeur…');
  ok(ctx._ardMenuDraftBox, '…et le brouillon est bien ce qui l\'y attend');
});

t('une joueuse ne peut pas associer de drill', () => {
  seed('player');
  ctx.openExoEditor('e2');
  fields['ard-e-name'] = 'Squats';
  ctx._ardExoDrillSet('d3');
  eq(ctx._ardSaveExo('e2'), null, 'écriture refusée hors rôle coach');
  eq(S.exoTemplates.find(e => e.id === 'e2').drillId, null);
});

// =============================================================================
console.log('\n=== RÉCEMMENT UTILISÉS ===');

t('le VRAI runtime date le drill au lancement — CÔTÉ COACH', () => {
  seed('coach');
  useRealRuntimes();
  ctx.launchDrillByMode('d1');
  const d = S.drills.find(x => x.id === 'd1');
  eq(d.lastUsedAt, NOW, 'daté');
  eq(d.updatedAt, NOW, 'et updatedAt bumpé, sinon le LWW d\'un autre appareil perdrait la date');
});

t('les trois runtimes datent — circuit et fractionné compris', () => {
  seed('coach');
  useRealRuntimes();
  // La date est écrite AVANT que le runtime ne touche au DOM : ce qui casse
  // ensuite dans un vm sans navigateur ne doit pas la faire disparaître.
  try { ctx.launchCircuit('d2'); } catch (e) {}
  try { ctx.launchInterval('d3'); } catch (e) {}
  eq(S.drills.find(x => x.id === 'd2').lastUsedAt, NOW, 'circuit');
  eq(S.drills.find(x => x.id === 'd3').lastUsedAt, NOW, 'fractionné');
});

t('un drill INJOUABLE n\'est pas daté : rien n\'est parti', () => {
  seed('coach');
  useRealRuntimes();
  S.drills.find(d => d.id === 'd2').stages = [];
  try { ctx.launchCircuit('d2'); } catch (e) {}
  eq(S.drills.find(x => x.id === 'd2').lastUsedAt, undefined,
    'un circuit sans étape ne remonterait pas dans les récents');
});

t('une JOUEUSE ne réordonne pas la bibliothèque du coach', () => {
  seed('player');
  useRealRuntimes();
  ctx.launchDrillByMode('d1');
  eq(S.drills.find(x => x.id === 'd1').lastUsedAt, undefined, 'aucune date écrite');
  eq(S.drills.find(x => x.id === 'd1').updatedAt, 10, 'et sa ligne n\'est pas touchée du tout');
});

t('_drillNoteUsed ne fabrique rien sur un drill supprimé ou inconnu', () => {
  seed('coach');
  S.drills.find(d => d.id === 'd1').deletedAt = NOW;
  ctx._drillNoteUsed('d1');
  ctx._drillNoteUsed('nexiste-pas');
  eq(S.drills.find(x => x.id === 'd1').lastUsedAt, undefined);
});

t('les récents sont ordonnés du plus frais au plus vieux, plafonnés à 5', () => {
  seed('coach');
  S.drills.forEach((d, i) => { d.lastUsedAt = NOW - i * HOUR; });
  S.drills.push({ id: 'd6', name: 'Sixième', stimuli: {}, lastUsedAt: NOW - 10 * HOUR, updatedAt: 1 });
  const r = ctx.recentDrills(5);
  eq(r.length, 5, 'plafond');
  eq(r[0].id, 'd1', 'le plus frais d\'abord');
  ok(!r.some(d => d.isPreset), 'les modèles perso restent hors bibliothèque');
});

t('un drill jamais lancé — ou supprimé — ne figure pas dans les récents', () => {
  seed('coach');
  S.drills.find(d => d.id === 'd1').lastUsedAt = NOW - HOUR;
  S.drills.find(d => d.id === 'd2').lastUsedAt = NOW - 2 * HOUR;
  S.drills.find(d => d.id === 'd2').deletedAt = NOW;
  const r = ctx.recentDrills(5);
  eq(r.length, 1, 'seul d1');
  eq(r[0].id, 'd1');
});

t('l\'âge se lit en français, et bascule sur la date au-delà de 60 jours', () => {
  seed('coach');
  eq(ctx._drillAgoLabel(NOW - 30000), 'à l\'instant');
  eq(ctx._drillAgoLabel(NOW - 20 * MIN), 'il y a 20 min');
  eq(ctx._drillAgoLabel(NOW - 5 * HOUR), 'il y a 5 h');
  eq(ctx._drillAgoLabel(NOW - 3 * DAY), 'il y a 3 j');
  ok(/^le /.test(ctx._drillAgoLabel(NOW - 200 * DAY)), '« il y a 200 j » ne dit plus rien');
  eq(ctx._drillAgoLabel(null), '', 'jamais lancé → rien');
});

// =============================================================================
console.log('\n=== CHIPS + RECHERCHE DE LA BIBLIOTHÈQUE ===');

t('les catégories sont les MODES RÉELS du repo — pas une taxonomie inventée', () => {
  const ids = ctx.DRILL_LIB_CATS.map(c => c.id);
  eq(JSON.stringify(ids), JSON.stringify(['all', 'stimulus', 'circuit', 'interval']));
});

t('un drill historique SANS champ mode compte comme « Réaction »', () => {
  seed('coach');
  eq(ctx._drillLibMode(S.drills.find(d => d.id === 'd1')), 'stimulus');
  eq(ctx._drillLibMode({}), 'stimulus');
  eq(ctx._drillLibMode({ mode: 'circuit' }), 'circuit');
});

t('la chip filtre, « Tous » remet tout', () => {
  seed('coach');
  ctx._drillLibCat('interval');
  eq(ctx.drillLibraryFiltered().length, 1, 'seul le fractionné');
  eq(ctx.drillLibraryFiltered()[0].id, 'd3');
  ctx._drillLibCat('stimulus');
  eq(ctx.drillLibraryFiltered().length, 2, 'les deux réactions');
  ctx._drillLibCat('all');
  eq(ctx.drillLibraryFiltered().length, 4, 'tout — hors preset perso');
});

t('recherche et chip se COMBINENT', () => {
  seed('coach');
  ctx._drillLibSearch('épaules');
  eq(ctx.drillLibraryFiltered().length, 1);
  ctx._drillLibCat('circuit');
  eq(ctx.drillLibraryFiltered().length, 0, '« Épaules » n\'est pas un circuit');
  ctx._drillLibReset();
  eq(ctx.drillLibraryFiltered().length, 4, 'le bouton de secours rend tout');
});

t('la bibliothèque affiche chips, recherche et récents', () => {
  seed('coach');
  S.drills.push({ id: 'd6', name: 'Sixième', stimuli: {}, updatedAt: 1 });
  S.drills.find(d => d.id === 'd1').lastUsedAt = NOW - HOUR;
  S.drills.find(d => d.id === 'd3').lastUsedAt = NOW - 2 * HOUR;
  ctx.openDrillLibrary();
  const h = String(ctx.__lastModal || '');
  ok(/drill-lib-q/.test(h), 'la barre de recherche');
  ok(/Récemment utilisés/.test(h), 'la section récents');
  ok(/_drillLibCat\('interval'\)/.test(h), 'les chips');
  ok(/launchDrillByMode\('d1'\)/.test(h), 'un récent se lance en un clic');
});

t('les récents s\'effacent dès qu\'on filtre : ils seraient un doublon bruyant', () => {
  seed('coach');
  S.drills.push({ id: 'd6', name: 'Sixième', stimuli: {}, updatedAt: 1 });
  S.drills.find(d => d.id === 'd1').lastUsedAt = NOW - HOUR;
  S.drills.find(d => d.id === 'd3').lastUsedAt = NOW - 2 * HOUR;
  ctx._drillLibSearch('circuit');
  ok(!/Récemment utilisés/.test(ctx._drillLibBody()), 'pas au-dessus d\'un résultat de recherche');
});

t('une petite bibliothèque n\'affiche NI chips NI recherche', () => {
  seed('coach');
  S.drills = S.drills.slice(0, 2);
  ctx.openDrillLibrary();
  const h = String(ctx.__lastModal || '');
  ok(!/drill-lib-q/.test(h), 'trois drills ne se cherchent pas');
  ok(!/_drillLibCat/.test(h), 'ni ne se filtrent');
  ok(/Circuit gainage/.test(h), 'mais ils s\'affichent');
});

t('un filtre sans résultat propose de tout réafficher (pas de cul-de-sac)', () => {
  seed('coach');
  ctx._drillLibSearch('zzzzz');
  const h = ctx._drillLibBody();
  ok(/Aucun drill ne correspond/.test(h));
  ok(/_drillLibReset\(\)/.test(h), 'la sortie est offerte');
});

t('bibliothèque vide : l\'état vide ne parle pas de filtre', () => {
  seed('coach');
  S.drills = [];
  const h = ctx._drillLibBody();
  ok(/Aucun drill/.test(h) && !/ne correspond/.test(h));
});

// =============================================================================
console.log('\n=== SYNCHRO : LES DEUX COLONNES NEUVES ===');

t('AVANT la migration : aucune des deux colonnes n\'est poussée', () => {
  // Sans ce garde-fou, le lot d'upsert ENTIER échouerait — et un lot en échec ne
  // fait qu'un console.warn : la table cesserait de se synchroniser EN SILENCE.
  const row = ctx._dumpDrillRow({ id: 'd1', name: 'X', lastUsedAt: 123 });
  ok(!('last_used_at' in row), 'drills.last_used_at attend');
  const exo = ctx._dumpExoTemplateRow({ id: 'e1', name: 'X', drillId: 'd2' });
  ok(!('drill_id' in exo), 'exo_templates.drill_id attend');
});

t('le serveur renvoie la colonne → on la pousse à notre tour', () => {
  ctx._drillFromRow({ id: 'd1', name: 'X', last_used_at: '2026-08-16T09:00:00Z' });
  const row = ctx._dumpDrillRow({ id: 'd1', name: 'X', lastUsedAt: RealDate.parse('2026-08-16T09:00:00Z') });
  eq(row.last_used_at, '2026-08-16T09:00:00.000Z');
  ctx._exoTemplateFromRow({ id: 'e1', name: 'X', drill_id: 'd2' });
  eq(ctx._dumpExoTemplateRow({ id: 'e1', name: 'X', drillId: 'd2' }).drill_id, 'd2');
});

t('un aller-retour complet ne perd ni la date ni l\'association', () => {
  const d = ctx._drillFromRow(ctx._dumpDrillRow({
    id: 'd1', name: 'Réaction', mode: 'stimulus', stimuli: { colors: ['red'] },
    lastUsedAt: RealDate.parse('2026-08-16T09:00:00Z'), updatedAt: RealDate.parse('2026-08-16T09:00:00Z')
  }));
  eq(d.lastUsedAt, RealDate.parse('2026-08-16T09:00:00Z'));
  const e = ctx._exoTemplateFromRow(ctx._dumpExoTemplateRow({
    id: 'e1', name: 'Gainage', category: 'gainage', drillId: 'd2', updatedAt: 1
  }));
  eq(e.drillId, 'd2');
});

t('une absence d\'association se sérialise en NULL, jamais en chaîne vide', () => {
  // '' violerait la clé étrangère : aucune ligne `drills` n'a l'id ''.
  eq(ctx._dumpExoTemplateRow({ id: 'e1', name: 'X', drillId: '' }).drill_id, null);
  eq(ctx._dumpExoTemplateRow({ id: 'e1', name: 'X' }).drill_id, null);
  eq(ctx._dumpDrillRow({ id: 'd1', name: 'X' }).last_used_at, null);
});

t('les entités drills et exoTemplates existent toujours, dans le BON ordre', () => {
  const keys = ctx.ENTITIES.map(e => e.key);
  const iDrills = keys.indexOf('drills'), iExos = keys.indexOf('exoTemplates');
  ok(iDrills >= 0 && iExos >= 0, 'les deux entités sont déclarées');
  ok(iDrills < iExos, 'drills flushe AVANT exo_templates — sinon la FK casserait le lot');
});

t('le dump d\'une bibliothèque réelle ne throw pas', () => {
  seed('coach');
  const dEnt = ctx.ENTITIES.find(e => e.key === 'drills');
  const eEnt = ctx.ENTITIES.find(e => e.key === 'exoTemplates');
  ok(Object.keys(dEnt.dump(S)).length === 5);
  ok(Object.keys(eEnt.dump(S)).length === 2);
});

// =============================================================================
const bad = R.filter(l => l.startsWith('✗'));
console.log('\n' + R.join('\n'));
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' OK');
process.exit(bad.length ? 1 : 0);
