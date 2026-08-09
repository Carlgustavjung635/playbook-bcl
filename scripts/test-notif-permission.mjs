// Test FORCER L'ACTIVATION DES NOTIFICATIONS
// (cf. migration 20260807_001 — players.notif_permission / notif_permission_at).
//
// Une notification n'existe que si le navigateur l'autorise, et cette
// autorisation ne vivait QUE dans le navigateur de la joueuse : le coach n'avait
// aucun moyen de savoir qui recevait ses messages, et relançait donc tout le
// monde « au cas où ».
//
// CHOIX STRUCTURANTS verrouillés ici :
//   • NULL (« jamais mesuré ») n'est PAS 'denied'. Une joueuse qui n'a pas
//     encore ouvert la v.106 ne doit pas apparaître comme ayant refusé ;
//   • sur 'denied', la page ne peut PLUS rien : le navigateur ne redemandera
//     pas. Le rappel doit dire d'aller dans les réglages, et surtout PAS
//     afficher un bouton « Activer » qui ne produirait rien ;
//   • la mesure n'est poussée en base QUE si elle a changé (sinon chaque
//     ouverture de l'app écrirait une ligne `players` par joueuse) ;
//   • et elle est poussée par un UPDATE CIBLÉ, jamais par upsertPlayer — qui
//     réécrirait la ligne entière depuis une copie locale possiblement périmée
//     (le mode de panne corrigé en v.104) ;
//   • le bandeau se replie pour la SESSION (il revient au prochain chargement),
//     la modale se reporte pour la JOURNÉE (patron du rappel de licence) ;
//   • le rappel ne concerne jamais un coach.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n') + '\n;globalThis.state = state; globalThis.K = K;';

const store = {};
const fields = {};
let openPopup = false;
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  checked: false, disabled: false,
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = {
  getElementById: (id) => (id === 'modal-root' ? null : (id in fields ? { value: fields[id], textContent: '' } : mkEl())),
  createElement: mkEl,
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
  AudioContext: undefined, speechSynthesis: undefined,
  // Remplacé scénario par scénario (voir setPerm) : c'est LE sujet du test.
  Notification: undefined, PushManager: undefined,
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
ctx.closeModal = () => { ctx.__lastModal = null; };

// Écritures serveur observées. `updateNotifPermission` = UPDATE ciblé ;
// `upsertPlayer` = la ligne ENTIÈRE, qu'on ne veut JAMAIS voir sur ce chemin.
const writes = [];
ctx.PbStore = {
  updateNotifPermission: (pid, perm) => { writes.push({ kind: 'update', pid, perm }); return Promise.resolve(); },
  upsertPlayer: (p) => { writes.push({ kind: 'upsert', pid: p && p.id }); return Promise.resolve(); },
  touchLastSeen: () => Promise.resolve(),
};

// `Notification.permission` est en lecture seule dans un vrai navigateur :
// on remplace l'objet entier, ce que fait de toute façon chaque appareil.
function setPerm(p) {
  ctx.Notification = (p === null) ? undefined : { permission: p, requestPermission: () => Promise.resolve(p) };
}
// LA SOUSCRIPTION PUSH, indépendante de la permission — c'est tout l'objet du
// correctif v.112. `null` = pas encore mesurée (état du démarrage).
function setSub(v) { ctx._notifPushSubscribed = v; }
function seed(role, pid, perm) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0; openPopup = false; ctx.__lastModal = null;
  ctx._notifBannerHidden = false;
  setSub(null);
  setPerm(perm === undefined ? 'default' : perm);
  S.auth = (role === 'coach') ? { role: 'coach', coachId: 'admin' } : { role: 'player', playerId: pid || 'pA' };
  S.coaches = [{ id: 'admin', name: 'Sonia', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.currentSeasonId = '2026-2027';
  S.players = [
    { id: 'pA', name: 'Emma Petit', num: 14, pin: '1234' },
    { id: 'pB', name: 'Lea Dubois', num: 7, pin: '1234', notifPermission: 'granted' },
    { id: 'pC', name: 'Nina Roux', num: 5, pin: '1234', notifPermission: 'denied' },
    { id: 'pD', name: 'Zoe Blanc', num: 9, pin: '1234' },              // jamais mesurée
  ];
  S.seasonPlayers = ['pA', 'pB', 'pC', 'pD'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.convocations = []; S.matches = []; S.gages = []; S.gageDraws = [];
  S.playerLicences = []; S.playerUnavailabilities = []; S.birthdayMessages = [];
  S.pintadeHolders = []; S.pintadeRequests = []; S.pintadeIncidents = []; S.pintadeRules = null;
  S.trainingCompletions = []; S.trainingPrograms = []; S.trainingPlans = [];
  S.plays = []; S.challenges = []; S.broadcasts = [];
}

// =============================================================================
// 1) LA MESURE
// =============================================================================
t('checkNotifPermission rend les quatre états, jamais autre chose', () => {
  seed('player', 'pA');
  ['granted', 'default', 'denied'].forEach(p => { setPerm(p); ok(ctx.checkNotifPermission() === p, p + ' → ' + ctx.checkNotifPermission()); });
  setPerm(null);
  ok(ctx.checkNotifPermission() === 'unsupported', 'sans API Notification → ' + ctx.checkNotifPermission());
  setPerm('n_importe_quoi');
  ok(ctx.checkNotifPermission() === 'unsupported', 'valeur inconnue → ' + ctx.checkNotifPermission());
});
t('la mesure part en base par UPDATE CIBLÉ, jamais par upsertPlayer', () => {
  seed('player', 'pA', 'granted');
  ctx._notifSyncPermission();
  ok(writes.length === 1, writes.length + ' écritures : ' + JSON.stringify(writes));
  ok(writes[0].kind === 'update', 'la ligne joueuse entière a été réécrite');
  ok(writes[0].pid === 'pA' && writes[0].perm === 'granted', JSON.stringify(writes[0]));
  const p = S.players.find(x => x.id === 'pA');
  ok(p.notifPermission === 'granted' && p.notifPermissionAt > 0, 'état local non mis à jour');
});
t('rien n\'est réécrit tant que la mesure ne bouge pas', () => {
  seed('player', 'pA', 'granted');
  ctx._notifSyncPermission();
  writes.length = 0;
  ctx._notifSyncPermission(); ctx._notifSyncPermission(); ctx._notifSyncPermission();
  ok(writes.length === 0, 'écrit ' + writes.length + ' fois pour rien');
  setPerm('denied');
  ctx._notifSyncPermission();
  ok(writes.length === 1 && writes[0].perm === 'denied', 'un changement réel n\'est pas remonté');
});
t('un refus est remonté (c\'est même le cas le plus utile au coach)', () => {
  seed('player', 'pA', 'denied');
  ctx._notifSyncPermission();
  ok(writes.some(w => w.perm === 'denied'), 'le refus reste local');
});
t('un coach ne pollue jamais la colonne d\'une joueuse', () => {
  seed('coach', null, 'denied');
  ctx._notifSyncPermission();
  ok(writes.length === 0, 'le coach a écrit : ' + JSON.stringify(writes));
});

// =============================================================================
// 2) LE BANDEAU
// =============================================================================
t('le bandeau ne s\'affiche que quand il y a un problème', () => {
  seed('player', 'pA', 'granted');
  ok(ctx.renderNotifBanner() === '', 'bandeau affiché alors que tout va bien');
  setPerm('default');
  ok(/Active tes notifs/.test(ctx.renderNotifBanner()), 'bandeau absent sur « default »');
  setPerm('denied');
  ok(/bloquées/.test(ctx.renderNotifBanner()), 'bandeau absent sur « denied »');
  setPerm(null);
  // Le texte du bandeau passe par esc() — l'apostrophe y devient &#39;. C'est
  // voulu : ce libellé est interpolé dans du HTML.
  const b = ctx.renderNotifBanner();
  ok(/Installe l/.test(b) && /accueil/.test(b), 'bandeau absent sur « unsupported » : ' + b.slice(0, 200));
  ok(!/écran d'accueil/.test(b), 'le texte n\'est plus échappé (régression XSS)');
});
t('le bandeau ne s\'affiche jamais chez un coach', () => {
  seed('coach', null, 'denied');
  ok(ctx.renderNotifBanner() === '', 'bandeau affiché au coach');
});
t('« masquer » vaut pour la SESSION, pas pour la journée', () => {
  seed('player', 'pA', 'default');
  ok(ctx.renderNotifBanner() !== '', 'bandeau absent au départ');
  ctx.dismissNotifBanner();
  ok(ctx.renderNotifBanner() === '', 'le bandeau survit au repli');
  // Aucune trace en localStorage : au prochain chargement, il revient.
  ok(!Object.keys(store).some(k => /banner/.test(k)), 'le repli a été persisté : le bandeau ne reviendrait jamais');
  ctx._notifBannerHidden = false;                  // = rechargement de la page
  ok(ctx.renderNotifBanner() !== '', 'le bandeau ne revient pas au boot suivant');
});
t('le bandeau est bien EN TÊTE de l\'accueil joueuse', () => {
  seed('player', 'pA', 'denied');
  const home = ctx.renderHomePlayer();
  const iBanner = home.indexOf('Notifications bloquées');
  ok(iBanner > -1, 'bandeau absent de l\'accueil');
  ok(iBanner < home.indexOf('Salut #'), 'bandeau placé après le bloc identité');
});

// =============================================================================
// 3) LA MODALE
// =============================================================================
t('« default » : un vrai bouton d\'activation + « Plus tard »', () => {
  seed('player', 'pA', 'default');
  ctx.openNotifPrompt({ prompt: true });
  const m = ctx.__lastModal;
  ok(/enableNotifsFromPrompt\(\)/.test(m), 'aucun bouton d\'activation');
  ok(/Plus tard/.test(m), '« Plus tard » absent d\'un rappel imposé');
  ok(/snoozeNotifPrompt\(\)/.test(m), 'la croix ne reporte pas le rappel');
});
t('« denied » : PAS de faux bouton d\'activation, mais le chemin des réglages', () => {
  seed('player', 'pA', 'denied');
  ctx.openNotifPrompt({ prompt: true });
  const m = ctx.__lastModal;
  ok(!/enableNotifsFromPrompt/.test(m), 'un bouton « Activer » sans effet est proposé');
  ok(/Réglages/.test(m) && /iPhone/.test(m) && /Android/.test(m), 'les instructions manquent');
});
t('« unsupported » : on explique d\'installer l\'app', () => {
  seed('player', 'pA', null);
  ctx.openNotifPrompt({ prompt: true });
  const m = ctx.__lastModal;
  ok(!/enableNotifsFromPrompt/.test(m), 'bouton inopérant proposé');
  ok(/écran d'accueil/.test(m), 'instruction d\'installation absente');
});
t('ouverte à la main (bandeau), la modale n\'impose pas « Plus tard »', () => {
  seed('player', 'pA', 'default');
  ctx.openNotifPrompt();
  ok(!/Plus tard/.test(ctx.__lastModal), '« Plus tard » sur une ouverture volontaire');
  ok(/closeModal\(\)/.test(ctx.__lastModal), 'la croix ne referme pas');
});

// =============================================================================
// 4) LE RAPPEL AU BOOT
// =============================================================================
t('le rappel ne se déclenche pas si tout est déjà autorisé', () => {
  seed('player', 'pA', 'granted');
  ok(ctx.maybeShowNotifPrompt() === false, 'rappel affiché pour rien');
});
t('le rappel ne concerne jamais un coach', () => {
  seed('coach', null, 'denied');
  ok(ctx.maybeShowNotifPrompt() === false, 'rappel affiché au coach');
});
t('« Plus tard » reporte à demain, pas à la prochaine ouverture', () => {
  seed('player', 'pA', 'default');
  ok(ctx.maybeShowNotifPrompt() === true, 'premier rappel non affiché');
  ctx.snoozeNotifPrompt();
  ok(ctx.maybeShowNotifPrompt() === false, 'le report ne tient pas');
  ok(ctx.maybeShowNotifPrompt() === false, 'ni au deuxième essai');
  // Le report est DATÉ (une PWA gardée ouverte n'ouvre jamais de session neuve)
  // ET porte l'ÉTAT auquel il répond (v.112).
  const m = JSON.parse(store[ctx.K.notifSnooze] || '{}');
  const e = Object.values(m)[0] || {};
  ok(/^\d{4}-\d{2}-\d{2}$/.test(e.d || ''), 'report non daté : ' + JSON.stringify(m));
  ok(e.s === 'default', 'report sans état : ' + JSON.stringify(m));
  ok(ctx.maybeShowNotifPrompt(true) === true, 'même forcé, le rappel refuse de s\'ouvrir');
});
t('un report pré-v.112 (date nue) est toujours honoré', () => {
  seed('player', 'pA', 'default');
  const today = ctx.isoDate(new Date());
  store[ctx.K.notifSnooze] = JSON.stringify({ [ctx.themeIdentityKey()]: today });
  ok(ctx.maybeShowNotifPrompt() === false, 'un ancien report est ignoré → la joueuse est reharcelée');
});
// =============================================================================
// 4bis) LE TROU DE LA v.106 À LA v.110 : PERMISSION ACCORDÉE, PUSH COUPÉ
// -----------------------------------------------------------------------------
// `disablePush()` désabonne le pushManager et désenregistre le service worker,
// mais ne touche pas `Notification.permission` — seul le navigateur l'accorde ou
// la retire. Une joueuse qui coupait ses notifs depuis l'app se retrouvait donc
// avec 'granted' ET aucune souscription. Tout le rappel se gardait sur
// `checkNotifPermission() !== 'granted'` : condition fausse, plus rien ne
// s'affichait, et elle ne recevait plus rien sans que rien ne le lui dise.
// Ces assertions-là manquaient : c'est pour ça que le bug est passé.
// =============================================================================
t('RÉGRESSION v.110 : permission accordée + souscription morte → la modale S\'AFFICHE', () => {
  seed('player', 'pA', 'granted');
  setSub(false);
  ok(ctx.notifEffectiveState() === 'unsubscribed', 'état effectif : ' + ctx.notifEffectiveState());
  ok(ctx.maybeShowNotifPrompt() === true, 'la modale ne s\'affiche toujours pas — le bug v.110 est intact');
});
t('…et la modale propose un vrai bouton de réactivation, pas les réglages', () => {
  seed('player', 'pA', 'granted');
  setSub(false);
  ctx.openNotifPrompt({ prompt: true });
  const m = ctx.__lastModal || '';
  ok(/enableNotifsFromPrompt/.test(m), 'aucun bouton de réactivation');
  ok(/coupées sur cet appareil/.test(m), 'le message n\'explique pas ce qui s\'est passé');
  ok(!/Réglages/.test(m), 'on renvoie à tort vers les réglages du téléphone');
});
t('…et le bandeau le dit aussi', () => {
  seed('player', 'pA', 'granted');
  setSub(false);
  ok(ctx.notifNeedsAttention() === true, 'le bandeau se croit inutile');
  const b = ctx.renderNotifBanner() || '';
  ok(/coupées sur cet appareil/.test(b), 'bandeau muet : ' + b.slice(0, 120));
  ok(/Réactiver/.test(b), 'pas d\'appel à l\'action de réactivation');
});
t('souscription VIVE + permission accordée → toujours aucun rappel', () => {
  seed('player', 'pA', 'granted');
  setSub(true);
  ok(ctx.notifEffectiveState() === 'granted', 'état : ' + ctx.notifEffectiveState());
  ok(ctx.maybeShowNotifPrompt() === false, 'rappel affiché alors que tout va bien');
  ok(ctx.renderNotifBanner() === '', 'bandeau affiché alors que tout va bien');
});
t('souscription NON MESURÉE → on ne crie pas au loup sur une supposition', () => {
  seed('player', 'pA', 'granted');
  setSub(null);
  ok(ctx.notifEffectiveState() === 'granted', 'un état non mesuré déclenche une fausse alerte');
  ok(ctx.renderNotifBanner() === '', 'bandeau affiché sur une supposition');
});
t('un refus « denied » prime sur la souscription', () => {
  seed('player', 'pA', 'denied');
  setSub(true);
  ok(ctx.notifEffectiveState() === 'denied', 'état : ' + ctx.notifEffectiveState());
});
t('le report ne survit PAS à un changement d\'état (elle coupe après avoir reporté)', () => {
  seed('player', 'pA', 'default');
  ok(ctx.maybeShowNotifPrompt() === true, 'premier rappel non affiché');
  ctx.snoozeNotifPrompt();
  ok(ctx.maybeShowNotifPrompt() === false, 'le report ne tient pas');
  // Même journée, mais l'état a changé : c'est une AUTRE question.
  setPerm('granted'); setSub(false);
  ok(ctx.maybeShowNotifPrompt() === true, 'le report d\'hier bâillonne une situation nouvelle');
});
t('le report reposé sur le NOUVEL état tient à son tour', () => {
  seed('player', 'pA', 'granted');
  setSub(false);
  ok(ctx.maybeShowNotifPrompt() === true, 'rappel non affiché');
  ctx.snoozeNotifPrompt();
  ok(ctx.maybeShowNotifPrompt() === false, 'le report du nouvel état ne tient pas');
});

t('le report est par IDENTITÉ (le téléphone d\'une joueuse peut en servir deux)', () => {
  seed('player', 'pA', 'default');
  ctx.maybeShowNotifPrompt(); ctx.snoozeNotifPrompt();
  ok(ctx.maybeShowNotifPrompt() === false, 'pA devrait être reportée');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(ctx.maybeShowNotifPrompt() === true, 'le report de pA a bâillonné pB');
});
t('le rappel cède le passage à une popup déjà ouverte, et repasse plus tard', () => {
  seed('player', 'pA', 'default');
  openPopup = true;
  ok(ctx.maybeShowNotifPrompt() === false, 'le rappel est passé devant une popup');
  openPopup = false;
  ok(ctx.maybeShowNotifPrompt() === true, 'le rappel a renoncé pour de bon');
});

// =============================================================================
// 5) LE BADGE COACH (écran Effectif)
// =============================================================================
t('« jamais mesuré » n\'est PAS « a refusé »', () => {
  seed('coach');
  const jamais = ctx.notifPermBadge(S.players.find(p => p.id === 'pD'));
  const refus = ctx.notifPermBadge(S.players.find(p => p.id === 'pC'));
  ok(jamais && /inconnu/.test(jamais.label), 'jamais mesuré → ' + JSON.stringify(jamais));
  ok(refus && /bloqu/.test(refus.label), 'refus → ' + JSON.stringify(refus));
  ok(jamais.label !== refus.label, 'les deux états sont confondus');
});
t('aucun badge quand les notifs sont actives', () => {
  seed('coach');
  ok(ctx.notifPermBadge(S.players.find(p => p.id === 'pB')) === null, 'badge affiché sur une joueuse OK');
  ok(ctx.notifPermBadgeHtml(S.players.find(p => p.id === 'pB')) === '', 'html non vide');
  ok(ctx.notifPermDotHtml(S.players.find(p => p.id === 'pB')) === '', 'point non vide');
});
t('le badge 🔕 apparaît bien dans la liste de l\'effectif coach', () => {
  seed('coach');
  const body = ctx._effectifRosterBody();
  ok(/Nina Roux/.test(body), 'la liste ne contient pas la joueuse');
  ok(/🔕/.test(body), 'le badge notifs manque dans le roster');
  // La joueuse qui a autorisé ne doit porter AUCUNE marque : une ligne
  // d'effectif ne montre que ce qui appelle une action.
  const i = body.indexOf('Lea Dubois');
  ok(i > -1 && !/🔕/.test(body.slice(i, i + 400)), 'badge affiché sur une joueuse OK');
});
t('le point compact apparaît dans l\'onglet Saison', () => {
  seed('coach');
  const body = ctx._effectifSeasonBody();
  ok(/Nina Roux/.test(body), 'liste saison vide');
  ok(/🔕/.test(body), 'point notifs absent de l\'onglet Saison');
});

// =============================================================================
// 6) CHANGEMENT D'IDENTITÉ
// =============================================================================
t('un logout remet à zéro le repli du bandeau', () => {
  seed('player', 'pA', 'default');
  ctx.dismissNotifBanner();
  ok(ctx._notifBannerHidden === true, 'repli non posé');
  ctx.doLogout();
  ok(ctx._notifBannerHidden === false, 'la joueuse suivante hérite du repli');
  ok(ctx._notifBootChecked === false, 'le rappel ne sera jamais réévalué pour la suivante');
});

// =============================================================================
// 6) LES POINTS DE DÉCLENCHEMENT (garde STRUCTURELLE sur index.html)
// -----------------------------------------------------------------------------
// L'autre moitié du bug v.110 : le rappel était bien écrit, mais appelé depuis
// UN SEUL endroit — le bloc de boot, gardé par `role === 'player'` évalué à cet
// instant. On ouvre pourtant l'app déconnectée ou en coach et on se connecte
// ENSUITE : le garde était faux au boot, et se connecter ne rejouait rien.
// Ces assertions portent sur le texte source parce que c'est du CÂBLAGE : le vm
// ne peut pas prouver qu'un `visibilitychange` réel rappellera la fonction.
// =============================================================================
t('le rappel est rejoué APRÈS un login joueuse (pas seulement au boot)', () => {
  const i = html.indexOf('_touchCurrentPlayerLastSeen(true)');
  ok(i > 0, 'ancre de fin de login introuvable — test à réécrire');
  const after = html.slice(i, i + 1400);
  ok(/notifPromptAfterCheck\(\)/.test(after),
    'se connecter en joueuse en cours de session ne redéclenche pas le rappel');
});
t('le rappel repasse au RETOUR AU PREMIER PLAN (retour des réglages du téléphone)', () => {
  // lastIndexOf : le rappel de licence est appelé DEUX fois (boot + retour au
  // premier plan). C'est le second qu'on vise.
  const i = html.lastIndexOf('maybeShowLicencePrompt(); } catch (e) {}');
  ok(i > 0, 'ancre visibilitychange introuvable — test à réécrire');
  ok(/notifPromptAfterCheck\(\)/.test(html.slice(i, i + 700)),
    'le rappel notifs manque dans le handler visibilitychange, alors que licence et gages y sont');
});
t('le boot mesure la souscription avant de décider', () => {
  ok(/setTimeout\(\(\) => \{ try \{ notifPromptAfterCheck\(\); \} catch \(e\) \{\} \}, 3400\)/.test(html),
    'le boot appelle encore maybeShowNotifPrompt sans mesurer la souscription');
});
t('plus aucun garde ne se fie à la seule permission', () => {
  const src = ctx.notifNeedsAttention.toString() + ctx.maybeShowNotifPrompt.toString();
  ok(/notifEffectiveState/.test(src), 'un garde lit encore checkNotifPermission() seul');
});

console.log('\n' + R.join('\n'));
const bad = R.filter(r => r.startsWith('✗'));
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' OK');
process.exit(bad.length ? 1 : 0);
