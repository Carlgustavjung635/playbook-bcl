// Test SUIVI DES LICENCES — auto-déclaré par la joueuse, override coach.
// (migrations 20260729_001 + _002_licences_self_declared)
//
// Le statut est déclaré par LA JOUEUSE depuis sa carte d'accueil (4 états repris
// du vécu terrain), pas saisi par le coach. Le coach voit l'agrégat dans
// l'écran Effectif et peut corriger — typiquement « c'est fait » après
// vérification dans le portail FFBB.
//
// Deux points sensibles verrouillés ici :
//   1. « pas encore répondu » = ABSENCE DE LIGNE, jamais un statut stocké. Le
//      coach doit distinguer « n'a jamais répondu » de « a répondu quelque
//      chose ». Tout repli sur une valeur par défaut casse cette distinction.
//   2. le SCOPING PAR SAISON — raison d'être de la table dédiée plutôt que de
//      colonnes licence_* sur `players` (qui écraseraient l'historique au
//      changement de saison : le « cumul cross-saison » déjà corrigé 4× ici).
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
const modalRoot = { innerHTML: '', trim() { return this.innerHTML.trim(); } };
const doc = {
  // FIDÈLE AU VRAI DOM : closeModal() ne retire PAS #modal-root, il vide son
  // contenu. L'élément EXISTE donc en permanence dès la 1re modale ; seul son
  // innerHTML dit si une modale est ouverte. Le harnais modélisait l'inverse —
  // c'est ce qui avait laissé passer le bug du rappel jamais affiché (v.93).
  getElementById: (id) => (id === 'modal-root' ? modalRoot : mkEl()),
  createElement: mkEl,
  querySelector: () => null, querySelectorAll: () => [],
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
ctx.openModal = h => { ctx.__lastModal = h; modalRoot.innerHTML = h; };
ctx.closeModal = () => { modalRoot.innerHTML = ''; };   // vide, mais l'élément reste

function seed() {
  pushed = [];
  modalRoot.innerHTML = '';        // aucune modale ouverte au départ
  ctx.__lastModal = null;
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
  S.gages = []; S.gageDraws = []; S.convocations = []; S.matches = [];
  S.trainingCompletions = []; S.trainingPrograms = [];
}
const lic = (pid, sid) => ctx._licenceFor(pid, sid);
const asPlayer = (pid) => { S.auth = { role: 'player', playerId: pid }; };
const asCoach = () => { S.auth = { role: 'coach', coachId: 'admin' }; };

// --- 1) « pas encore répondu » = absence de ligne ---------------------------
t('les 4 états sont ceux de la demande', () => {
  assert(JSON.stringify(ctx.LICENCE_STATUSES) ===
    JSON.stringify(['email_received_todo', 'email_missing', 'in_progress', 'done']),
    'vocabulaire = ' + JSON.stringify(ctx.LICENCE_STATUSES));
});
t('sans déclaration : statut null, aucune ligne créée', () => {
  seed();
  assert(lic('pA') === null, 'ligne fantôme');
  const rows = ctx._licenceRows();
  assert(rows.length === 3, 'effectif = ' + rows.length);
  assert(rows.every(r => r.status === null), 'un repli par défaut masque « pas répondu »');
  assert(S.playerLicences.length === 0, 'table pré-remplie');
});
t('les compteurs comptent les « sans réponse » à part', () => {
  const st = ctx._licenceStats();
  assert(st.total === 3 && st.none === 3 && st.done === 0, JSON.stringify(st));
});

// --- 2) la JOUEUSE déclare ---------------------------------------------------
t('la joueuse déclare son état depuis sa carte', () => {
  seed(); asPlayer('pA');
  assert(ctx.setMyLicenceStatus('in_progress') === true, 'refusé');
  const l = lic('pA');
  assert(l.status === 'in_progress', 'statut = ' + l.status);
  assert(l.updatedBy === 'player', 'auteur = ' + l.updatedBy);
  assert(l.seasonId === '2026-2027', 'saison = ' + l.seasonId);
  asCoach();
});
t('les 4 états sont mutuellement exclusifs (une seule ligne, écrasée)', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('email_received_todo');
  ctx.setMyLicenceStatus('in_progress');
  ctx.setMyLicenceStatus('done');
  assert(S.playerLicences.length === 1, 'lignes = ' + S.playerLicences.length);
  assert(lic('pA').status === 'done', 'statut = ' + lic('pA').status);
  asCoach();
});
t('une joueuse ne peut PAS déclarer pour une autre', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('done');
  assert(lic('pB') === null, 'ligne écrite sur une autre joueuse');
  asCoach();
});
t('le coach ne passe pas par setMyLicenceStatus', () => {
  seed();
  assert(ctx.setMyLicenceStatus('done') === false, 'écriture acceptée hors rôle joueuse');
  assert(S.playerLicences.length === 0, 'ligne écrite');
});
t('un statut inconnu est refusé (pas de ligne bidon)', () => {
  seed(); asPlayer('pA');
  assert(ctx.setMyLicenceStatus('n_importe_quoi') === false, 'accepté');
  assert(S.playerLicences.length === 0, 'ligne écrite');
  asCoach();
});
t('« pas reçu l\'e-mail » prévient le coach (sinon cul-de-sac)', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('email_missing');
  const p = pushed.find(x => x.payload && x.payload.type === 'licence_email_missing');
  assert(p, 'aucune alerte coach');
  assert(/#13 Candice/.test(p.payload.body), 'joueuse absente : ' + p.payload.body);
  asCoach();
});
t('les autres états n\'alertent PAS le coach', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('in_progress');
  assert(!pushed.some(x => x.payload && x.payload.type === 'licence_email_missing'), 'alerte parasite');
  asCoach();
});

// --- 3) override COACH -------------------------------------------------------
t('le coach peut marquer « c\'est fait » sans déclaration de la joueuse', () => {
  seed();
  assert(ctx.markLicenceDone('pA') === true, 'refusé');
  const l = lic('pA');
  assert(l.status === 'done', 'statut = ' + l.status);
  assert(l.updatedBy === 'coach', 'auteur = ' + l.updatedBy);
});
t('le coach peut CORRIGER un « fait » posé par erreur', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.setLicenceStatusAsCoach('pA', 'in_progress');
  assert(lic('pA').status === 'in_progress', 'statut = ' + lic('pA').status);
  assert(S.playerLicences.length === 1, 'doublon : ' + S.playerLicences.length);
});
t('la joueuse est prévenue quand le coach change son statut', () => {
  seed();
  ctx.markLicenceDone('pA');
  const p = pushed.find(x => x.payload && x.payload.type === 'licence_coach_update');
  assert(p, 'aucun push joueuse');
  assert(/fait/i.test(p.payload.body), 'message = ' + p.payload.body);
});
t('une joueuse ne peut pas se servir de l\'override coach', () => {
  seed(); asPlayer('pA');
  assert(ctx.setLicenceStatusAsCoach('pB', 'done') === false, 'override accepté');
  assert(ctx.markLicenceDone('pB') === false, 'raccourci accepté');
  assert(S.playerLicences.length === 0, 'ligne écrite');
  asCoach();
});
t('la joueuse peut reprendre la main après un override coach', () => {
  seed();
  ctx.markLicenceDone('pA');
  asPlayer('pA');
  ctx.setMyLicenceStatus('in_progress');
  assert(lic('pA').status === 'in_progress', 'statut = ' + lic('pA').status);
  assert(lic('pA').updatedBy === 'player', 'auteur = ' + lic('pA').updatedBy);
  asCoach();
});

// --- 4) SCOPING SAISON -------------------------------------------------------
t('la licence de la saison précédente ne fuit PAS sur la saison active', () => {
  seed();
  S.playerLicences.push({ id: 'old', playerId: 'pA', seasonId: '2025-2026', status: 'done',
    notes: '', updatedBy: 'player', createdAt: 1, updatedAt: 1, deletedAt: null });
  assert(lic('pA', '2026-2027') === null, 'fuite cross-saison');
  assert(ctx._licenceRows().find(r => r.player.id === 'pA').status === null,
    'statut de l\'an dernier affiché comme courant');
});
t('l\'historique de la saison précédente est CONSERVÉ', () => {
  asPlayer('pA'); ctx.setMyLicenceStatus('in_progress'); asCoach();
  assert(lic('pA', '2025-2026').status === 'done', 'historique écrasé');
  assert(lic('pA', '2026-2027').status === 'in_progress', 'saison active KO');
  assert(S.playerLicences.length === 2, 'lignes = ' + S.playerLicences.length);
});
t('une ligne soft-deleted est ignorée', () => {
  seed(); asPlayer('pA'); ctx.setMyLicenceStatus('done'); asCoach();
  lic('pA').deletedAt = Date.now();
  assert(lic('pA') === null, 'ligne supprimée encore lue');
});

// --- 5) carte joueuse (= le rappel) -----------------------------------------
t('sans déclaration : la carte propose les 4 choix', () => {
  seed(); asPlayer('pA');
  const c = ctx.renderLicencePlayerCard();
  assert(c && c.includes('Licence 2026-2027'), 'carte absente');
  assert(/Dis-nous o. tu en es/.test(c), 'appel à l\'action absent');
  ctx.LICENCE_STATUSES.forEach(v => assert(c.includes("setMyLicenceStatus('" + v + "')"), 'choix ' + v + ' absent'));
  asCoach();
});
t('les libellés sont ceux demandés, mot pour mot', () => {
  seed(); asPlayer('pA');
  // esc() encode les apostrophes en &#39; : on dé-échappe avant de comparer, pour
  // que le test porte sur le TEXTE LU par la joueuse et pas sur l'encodage.
  const c = ctx.renderLicencePlayerCard().split('&#39;').join("'");
  assert(c.includes("J'ai reçu l'e-mail, faut que je m'en occupe"), 'libellé 1 absent');
  assert(c.includes("J'ai pas reçu l'e-mail de la FFBB"), 'libellé 2 absent');
  assert(c.includes("C'est en cours"), 'libellé 3 absent');
  assert(c.includes("C'est fait !"), 'libellé 4 absent');
  asCoach();
});
t('« vérifie tes spams » est affiché sur le bon choix', () => {
  seed(); asPlayer('pA');
  assert(/v.rifie tes spams/i.test(ctx.renderLicencePlayerCard()), 'aide spams absente');
  asCoach();
});
t('le choix courant est marqué comme sélectionné', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('in_progress');
  const c = ctx.renderLicencePlayerCard();
  assert(c.includes('◉'), 'aucune sélection visible');
  asCoach();
});
t('une fois « c\'est fait », le rappel disparaît au profit d\'une confirmation', () => {
  seed(); asPlayer('pA');
  ctx.setMyLicenceStatus('done');
  const c = ctx.renderLicencePlayerCard();
  assert(/c&#039;est fait|c'est fait/i.test(c), 'confirmation absente');
  assert(!c.includes("setMyLicenceStatus('in_progress')"), 'les 4 choix sont encore affichés');
  assert(c.includes('openMyLicence()'), 'plus moyen de corriger');
  asCoach();
});
t('après un override coach, la joueuse lit « ton coach a marqué… »', () => {
  seed();
  ctx.markLicenceDone('pA');
  asPlayer('pA');
  assert(/coach a marqu/i.test(ctx.renderLicencePlayerCard()), 'auteur non indiqué');
  asCoach();
});
t('aucune carte côté coach', () => {
  seed();
  assert(ctx.renderLicencePlayerCard() === '', 'carte joueuse rendue pour le coach');
});
t('la carte ne fuite pas le statut des autres', () => {
  seed(); asPlayer('pA'); ctx.setMyLicenceStatus('done');
  asPlayer('pB');
  const c = ctx.renderLicencePlayerCard();
  assert(!/c&#039;est fait|c'est fait/i.test(c) || c.includes('setMyLicenceStatus'), 'statut d\'une autre joueuse affiché');
  asCoach();
});

// --- 6) vue coach DANS l'effectif (pas d'écran dédié) -----------------------
t('plus aucun écran licences dédié', () => {
  assert(!/function openLicences\b/.test(html), 'openLicences existe encore');
  assert(!/openLicences\(\)/.test(html), 'un bouton pointe encore vers openLicences');
});
t('le bandeau de synthèse compte tous les états', () => {
  seed();
  ctx.markLicenceDone('pA');
  asPlayer('pB'); ctx.setMyLicenceStatus('email_missing'); asCoach();
  const s = ctx.renderLicenceSummary();
  assert(s.includes('🎫 Licences 2026-2027'), 'titre absent');
  assert(/1\/3/.test(s), 'ratio fait/total absent : ' + s.slice(0, 200));
  assert(/1 fait/.test(s), 'compteur fait absent');
  assert(/1 e-mail pas re.u/i.test(s), 'compteur bloqué absent');
  assert(/1 sans r.ponse/i.test(s), 'compteur sans réponse absent');
});
t('le bandeau est vide côté joueuse', () => {
  seed(); asPlayer('pA');
  assert(ctx.renderLicenceSummary() === '', 'bandeau coach exposé à la joueuse');
  asCoach();
});
// La ligne d'effectif est allégée : le statut n'y est plus qu'une pastille, et
// toutes les actions sont derrière un tap (openPlayerSeasonPanel).
t('la ligne d\'effectif porte la pastille de licence, pas les boutons', () => {
  seed();
  ctx.openEffectif('season');
  const m = ctx.__lastModal || '';
  assert(m.includes("openPlayerSeasonPanel('pA')"), 'la ligne n\'ouvre pas le panneau');
  assert(!m.includes('markLicenceDone('), 'les actions encombrent encore la ligne');
  assert(m.includes('🎫'), 'pastille de licence absente');
});
t('le panneau joueuse porte le statut ET les actions', () => {
  seed();
  ctx.openPlayerSeasonPanel('pA');
  const m = ctx.__lastModal || '';
  assert(/Pas encore r.pondu/i.test(m), 'statut absent : ' + m.slice(0, 200));
  assert(m.includes("markLicenceDone('pA')"), 'action « marquer fait » absente');
  assert(m.includes("openLicenceEditor('pA')"), 'accès au détail absent');
  assert(m.includes("removePlayerFromSeason('pA')"), 'retrait de la saison absent');
});
t('« marquer fait » disparaît du panneau quand c\'est déjà fait', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.openPlayerSeasonPanel('pA');
  const m = ctx.__lastModal || '';
  assert(!m.includes('markLicenceDone('), 'action redondante encore affichée');
  assert(/C&#39;est fait|C'est fait/.test(m), 'statut fait absent');
});
t('le panneau est un no-op côté joueuse', () => {
  seed(); asPlayer('pA');
  ctx.__lastModal = null;
  ctx.openPlayerSeasonPanel('pB');
  assert(!ctx.__lastModal, 'panneau coach ouvert pour une joueuse');
  asCoach();
});
t('l\'écran Effectif rend avec le bandeau de synthèse', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.openEffectif('season');
  assert((ctx.__lastModal || '').includes('🎫 Licences'), 'bandeau absent de l\'effectif');
});

// --- 6bis) filtre licence dans l'effectif -----------------------------------
t('les 5 filtres sont proposés avec leur compte', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.openEffectif('season');
  const m = ctx.__lastModal || '';
  ['all', 'todo', 'in_progress', 'done', 'none'].forEach(f =>
    assert(m.includes("setLicenceFilter('" + f + "')"), 'filtre ' + f + ' absent'));
  assert(/\d+ \/ 3 joueuses/.test(m), 'compteur X / N absent');
});
t('« à faire » retient tout sauf « c\'est fait » (dont les sans-réponse)', () => {
  seed();
  ctx.markLicenceDone('pA');
  assert(ctx._licenceMatchesFilter('pA', 'todo') === false, 'une licence faite est listée à faire');
  assert(ctx._licenceMatchesFilter('pB', 'todo') === true, 'une sans-réponse devrait être à faire');
});
t('« sans réponse » ne retient QUE l\'absence de déclaration', () => {
  seed();
  asPlayer('pA'); ctx.setMyLicenceStatus('in_progress'); asCoach();
  assert(ctx._licenceMatchesFilter('pA', 'none') === false, 'une déclarée passe pour sans réponse');
  assert(ctx._licenceMatchesFilter('pB', 'none') === true, 'une non déclarée manque');
});
t('le filtre restreint réellement la liste affichée', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.setLicenceFilter('done');
  const m = ctx.__lastModal || '';
  assert(m.includes('Candice'), 'la joueuse filtrée manque');
  assert(!m.includes('Delph'), 'une joueuse hors filtre est affichée');
  ctx.setLicenceFilter('all');
});
t('un filtre vide affiche un état vide, pas une liste muette', () => {
  seed();
  ctx.setLicenceFilter('done');   // personne n'a fait sa licence
  assert(/Aucune joueuse dans ce filtre/.test(ctx.__lastModal || ''), 'état vide absent');
  ctx.setLicenceFilter('all');
});
t('la modale de détail liste les 4 états et l\'auteur', () => {
  seed();
  ctx.markLicenceDone('pA');
  ctx.openLicenceEditor('pA');
  const m = ctx.__lastModal || '';
  ctx.LICENCE_STATUSES.forEach(v => assert(m.includes("setLicenceStatusAsCoach('pA','" + v + "')"), 'état ' + v + ' absent'));
  assert(/D.clar. par le coach/i.test(m), 'auteur absent');
});

// --- 6ter) rappel en pop-up (joueuse) ---------------------------------------
// La carte d'accueil se laissait ignorer indéfiniment : le rappel s'impose à
// l'ouverture, mais reste esquivable — « Plus tard » le repousse AU LENDEMAIN.
function clearSnooze() { try { ctx.localStorage.removeItem('pb8_licence_snooze'); } catch (e) {} }

t('sans déclaration, le rappel s\'affiche', () => {
  seed(); clearSnooze(); asPlayer('pA');
  ctx.__lastModal = null;
  assert(ctx.maybeShowLicencePrompt() === true, 'rappel non déclenché');
  const m = ctx.__lastModal || '';
  assert(/Rappel/.test(m), 'ce n\'est pas le mode rappel');
  ctx.LICENCE_STATUSES.forEach(v => assert(m.includes("setMyLicenceStatus('" + v + "')"), 'choix ' + v + ' absent'));
  assert(m.includes('snoozeLicencePrompt()'), 'bouton « Plus tard » absent');
  asCoach();
});
t('une fois « c\'est fait », plus jamais de rappel', () => {
  seed(); clearSnooze(); asPlayer('pA');
  ctx.setMyLicenceStatus('done');
  assert(ctx.maybeShowLicencePrompt() === false, 'rappel affiché alors que c\'est fait');
  asCoach();
});
t('un statut intermédiaire NE dispense PAS du rappel', () => {
  seed(); clearSnooze(); asPlayer('pA');
  ctx.setMyLicenceStatus('in_progress');
  assert(ctx.maybeShowLicencePrompt() === true, 'rappel abandonné trop tôt');
  asCoach();
});
t('« Plus tard » coupe le rappel pour la journée', () => {
  seed(); clearSnooze(); asPlayer('pA');
  assert(ctx.maybeShowLicencePrompt() === true, 'rappel initial absent');
  ctx.snoozeLicencePrompt();
  assert(ctx.maybeShowLicencePrompt() === false, 'rappel réaffiché le même jour');
  asCoach();
});
t('...mais il revient le lendemain (report DATÉ, pas un flag de session)', () => {
  seed(); asPlayer('pA');
  // On simule un report posé la veille.
  ctx.localStorage.setItem('pb8_licence_snooze', JSON.stringify({ [ctx.themeIdentityKey()]: '2020-01-01' }));
  assert(ctx.maybeShowLicencePrompt() === true, 'le report d\'hier bloque encore aujourd\'hui');
  clearSnooze(); asCoach();
});
t('le rappel ne passe pas devant une popup déjà ouverte', () => {
  seed(); clearSnooze(); asPlayer('pA');
  modalRoot.innerHTML = '<div>une autre popup est ouverte</div>';
  assert(ctx.maybeShowLicencePrompt() === false, 'le rappel a doublé une popup en cours');
  modalRoot.innerHTML = '';
  asCoach();
});
t('...sauf en ouverture manuelle (force)', () => {
  seed(); clearSnooze(); asPlayer('pA');
  ctx.snoozeLicencePrompt();
  assert(ctx.maybeShowLicencePrompt(true) === true, 'l\'ouverture manuelle est bloquée par le report');
  asCoach();
});
t('aucun rappel côté coach', () => {
  seed(); clearSnooze();
  assert(ctx.maybeShowLicencePrompt() === false, 'rappel joueuse déclenché pour le coach');
});
t('aucun rappel sans saison active', () => {
  seed(); clearSnooze(); asPlayer('pA');
  S.activeSeasonId = null; S.seasons = [];
  assert(ctx.maybeShowLicencePrompt() === false, 'rappel hors saison');
  asCoach();
});
t('l\'ouverture normale n\'affiche NI « Rappel » ni « Plus tard »', () => {
  seed(); clearSnooze(); asPlayer('pA');
  ctx.openMyLicence();
  const m = ctx.__lastModal || '';
  assert(!/snoozeLicencePrompt/.test(m), '« Plus tard » proposé hors rappel');
  asCoach();
});
t('LE BUG v.93 : une modale FERMÉE ne bloque plus le rappel', () => {
  // closeModal() vide #modal-root sans le retirer. Tester l'existence de
  // l'élément renvoyait « occupé » pour le reste de la session, et le rappel
  // ne partait jamais.
  seed(); clearSnooze(); asPlayer('pA');
  ctx.openModal('<div>une popup</div>');
  ctx.closeModal();                       // l'élément #modal-root existe encore
  assert(ctx.maybeShowLicencePrompt() === true, 'une modale fermée bloque encore le rappel');
  asCoach();
});
t('le rappel est relancé au retour au premier plan', () => {
  // ANCRAGE — `maybeShowGageReveal(); } catch (e) {}` apparaît SIX fois dans le
  // fichier, et indexOf tombait sur la première (un enchaînement de popup sans
  // rapport) : l'assertion échouait quoi qu'il arrive. On ancre sur le handler
  // visibilitychange lui-même, qui est unique.
  const i = html.indexOf('checkForUpdate({ foreground: true })');
  assert(i > 0, 'handler visibilitychange introuvable');
  const fg = html.slice(i, i + 1400);
  assert(/maybeShowLicencePrompt\(/.test(fg), 'aucune seconde chance au foreground');
});
t('le rappel est branché au boot, après gages et diffusions', () => {
  // On ancre sur le hook de boot lui-même : '_gageBootChecked' apparaît AUSSI
  // dans doLogout, bien plus haut dans le fichier.
  const gage = html.indexOf('!window._gageBootChecked');
  const lic = html.indexOf('!window._licenceBootChecked');
  assert(gage > 0 && lic > gage, 'le rappel licence doit venir APRÈS les gages');
  const boot = html.slice(gage, lic + 400);
  assert(/maybeShowLicencePrompt\(\)/.test(boot), 'rappel non branché au boot');
  assert(/_licenceBootChecked/.test(boot), 'garde one-shot absente');
});

// --- 7) sérialisation (bloc module, hors portée du vm) ----------------------
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
const ser = new Function(extractFn('_dumpLicenceRow') + '\n' + extractFn('_licenceFromRow')
  + '\nreturn { _dumpLicenceRow, _licenceFromRow };')();

t('les sérialiseurs du bloc module sont autonomes (piège cross-<script>)', () => {
  // LICENCE_STATUSES est déclaré dans le bloc classique : y référer depuis le
  // bloc module throwerait en prod.
  ser._dumpLicenceRow({ id: 'x', playerId: 'p', seasonId: 's', status: 'done', updatedBy: 'coach' });
});
t('round-trip dump → row → client', () => {
  seed(); asPlayer('pA'); ctx.setMyLicenceStatus('email_missing'); asCoach();
  const l = lic('pA');
  const row = ser._dumpLicenceRow(l);
  assert(row.player_id === 'pA' && row.season_id === '2026-2027', JSON.stringify(row));
  assert(row.status === 'email_missing', 'statut = ' + row.status);
  assert(row.updated_by === 'player', 'auteur = ' + row.updated_by);
  const back = ser._licenceFromRow(Object.assign({ created_at: new Date().toISOString() }, row));
  assert(back.status === l.status && back.updatedBy === 'player' && back.playerId === 'pA', JSON.stringify(back));
});
t('un statut hors contrainte SQL part à null (jamais un repli inventé)', () => {
  const row = ser._dumpLicenceRow({ id: 'x1', playerId: 'pA', seasonId: 's', status: 'validated' });
  assert(row.status === null, 'statut envoyé = ' + row.status);
});
t('un auteur hors contrainte SQL part à null', () => {
  const row = ser._dumpLicenceRow({ id: 'x1', playerId: 'pA', seasonId: 's', status: 'done', updatedBy: 'hacker' });
  assert(row.updated_by === null, 'auteur envoyé = ' + row.updated_by);
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
