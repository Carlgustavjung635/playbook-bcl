// Test RESSENTI JOUEUSE — les deux formulaires doivent être ATTEIGNABLES.
//
// ORIGINE : les deux fonctionnalités existaient toujours dans le code, mais
// plus aucun écran ne menait à elles. Deux causes distinctes, même symptôme :
//
//  1) « Mon ressenti équipe » (ambiance / rôle / temps de jeu / physique) :
//     le CTA `teamReviewCta()` a été déplacé de l'Accueil vers l'onglet Forme,
//     puis l'onglet Forme a été retiré de SECTIONS_PLAYER (prépa full package)
//     SANS relocaliser le CTA → plus appelé depuis aucun écran atteignable.
//
//  2) « Donner mon ressenti » (auto-éval post-match) : le bloc s'affiche bien
//     pour la phase 'past-unscored', mais l'onglet « Joués » de la joueuse ne
//     listait que les matchs AVEC score. Un match disputé hier, score pas
//     encore saisi par le coach, n'était donc nulle part : ni « À venir »
//     (l'horizon part d'aujourd'hui), ni « Joués ». Le détail du match était
//     inatteignable pile pendant la fenêtre où on demande le ressenti.
//     La vue coach, elle, gardait déjà ces matchs (cf. _matchIsUpcoming) : la
//     vue joueuse avait dérivé.
//
// CE TEST VERROUILLE L'ATTEIGNABILITÉ, pas le contenu des formulaires.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.TEAM_REVIEW_FIELDS = TEAM_REVIEW_FIELDS;';

const store = {};
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = { getElementById: () => mkEl(), createElement: mkEl, querySelector: () => null,
  querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
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
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try { vm.runInContext(code, ctx, { filename: 'index.inline.js' }); }
catch (e) { console.log('✗ ÉVALUATION: ' + e.message); process.exit(1); }

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

const S = ctx.state;
ctx.render = () => {}; ctx.showToast = () => {}; ctx.notifyPush = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };

// Dates RELATIVES au jour du test : la fenêtre à couvrir est « le match vient
// d'avoir lieu », elle glisse avec le calendrier. Aucun littéral de date ici.
const iso = d => d.toISOString().slice(0, 10);
const shift = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const HIER = shift(-3);       // disputé, score pas encore saisi
const AVANT = shift(-40);     // disputé et scoré
const DEMAIN = shift(+10);    // à venir

const M = (id, date, extra) => Object.assign({
  id, date, opponent: 'Adv ' + id, home: true, scoreUs: 0, scoreOpp: 0,
  status: 'to_play', seasonId: 'S1', teamTag: 'e1', playerReviews: {}, playerStats: {},
}, extra || {});

function asPlayer(matches) {
  S.auth = { role: 'player', playerId: 'pX' };
  S.coaches = [];
  S.seasons = [{ id: 'S1', name: 'S', startDate: shift(-200), endDate: shift(+200), status: 'active' }];
  S.activeSeasonId = 'S1'; S.currentSeasonId = 'S1';
  S.players = [{ id: 'pX', name: 'Lea', num: 7 }];
  S.seasonPlayers = [{ seasonId: 'S1', playerId: 'pX', teamTag: 'e1', joinedAt: shift(-200), leftAt: null }];
  S.matches = matches || [];
  S.convocations = (matches || []).map((m, i) => ({
    id: 'cv' + i, type: 'match', title: 'vs ' + m.opponent, date: m.date, time: '19:30',
    location: '', note: '', recurrence: null, cancelledInstances: [], instanceOverrides: {},
    attachments: [], responses: {}, seasonId: 'S1', teamTag: 'e1', closed: false,
  }));
  S.teamReviews = [];
  S.view = null; S._matchTab = null; S._matchRange = null;
}

// --- 1) « Mon ressenti équipe » : le CTA est de retour sur un écran atteignable
t('le CTA ressenti équipe est rendu sur l\'Accueil joueuse', () => {
  asPlayer([]);
  const h = ctx.renderHomePlayer();
  ok(h.includes('Mon ressenti équipe'), 'le CTA n\'apparaît pas sur l\'Accueil');
  ok(h.includes('openTeamReview()'), 'le CTA n\'ouvre pas le formulaire');
});
t('le CTA n\'est plus orphelin : renderHomePlayer appelle teamReviewCta', () => {
  // Garde STATIQUE : c'est précisément le lien d'appel qui avait disparu quand
  // l'onglet Forme a quitté la nav. Un rendu qui passe par hasard ne suffit pas.
  const a = html.indexOf('function renderHomePlayer()');
  const b = html.indexOf('function renderHomePlayerFFBB');   // fonction suivante
  ok(a > 0 && b > a, 'bornes de renderHomePlayer introuvables — test à réajuster');
  ok(/teamReviewCta\(/.test(html.slice(a, b)), 'renderHomePlayer n\'appelle plus teamReviewCta');
});
t('l\'onglet Forme est toujours hors nav — le CTA ne peut donc dépendre que de l\'Accueil', () => {
  const src = html.slice(html.indexOf('const SECTIONS_PLAYER'), html.indexOf('const PLAY_CATEGORIES'));
  ok(!/id:\s*'programme'/.test(src), 'l\'onglet Forme est revenu : revoir le placement du CTA');
});
t('le formulaire couvre bien rôle / temps de jeu / ambiance', () => {
  const keys = ctx.TEAM_REVIEW_FIELDS.map(f => f.key);
  ['ambiance', 'roleClarity', 'playtime'].forEach(k => ok(keys.includes(k), 'axe manquant : ' + k));
});

// --- 2) Auto-éval post-match : le match tout juste disputé reste atteignable
t('un match disputé sans score saisi apparaît dans « Joués »', () => {
  asPlayer([M('recent', HIER)]);
  ctx.setMatchTab('played');
  ok(ctx.renderPlayerMatches().includes('Adv recent'), 'le match vient de disparaître de l\'app');
});
t('sans score, on n\'invente pas un « D · 0–0 »', () => {
  asPlayer([M('recent', HIER)]);
  ctx.setMatchTab('played');
  const h = ctx.renderPlayerMatches();
  ok(h.includes('Score à venir'), 'l\'attente de saisie n\'est pas annoncée');
  ok(!/D · 0–0/.test(h), 'un match non scoré est affiché comme une défaite');
});
t('un match SCORÉ garde son résultat', () => {
  asPlayer([M('vieux', AVANT, { scoreUs: 60, scoreOpp: 55, status: 'played' })]);
  ctx.setMatchTab('played');
  const h = ctx.renderPlayerMatches();
  ok(h.includes('V · 60–55'), 'le résultat d\'un match scoré a été perdu');
  ok(!h.includes('Score à venir'), 'un match scoré est annoncé « à venir »');
});
t('un match ANNULÉ ne remonte pas dans « Joués »', () => {
  asPlayer([M('annul', HIER, { status: 'cancelled' })]);
  ctx.setMatchTab('played');
  ok(!ctx.renderPlayerMatches().includes('Adv annul'), 'un match annulé est listé comme joué');
});
t('un match À VENIR ne bascule pas dans « Joués »', () => {
  asPlayer([M('futur', DEMAIN)]);
  ctx.setMatchTab('played');
  ok(!ctx.renderPlayerMatches().includes('Adv futur'), 'un match à venir est listé comme joué');
});
t('le détail du match propose « Donner mon ressenti »', () => {
  asPlayer([M('recent', HIER)]);
  ok(ctx.getMatchPhase(S.matches[0]) === 'past-unscored', 'phase attendue : past-unscored');
  S.view = { type: 'match', id: 'recent' };
  const h = ctx.renderMatchDetail();
  ok(h.includes('Donner mon ressenti'), 'le bloc auto-éval est absent');
  ok(h.includes("openPlayerReview('recent')"), 'le bouton n\'ouvre pas le formulaire');
});
t('un ressenti déjà donné s\'affiche comme enregistré (et reste modifiable)', () => {
  asPlayer([M('recent', HIER, { playerReviews: { pX: { rating: 4, comment: 'ok' } } })]);
  S.view = { type: 'match', id: 'recent' };
  const h = ctx.renderMatchDetail();
  ok(h.includes('Mon ressenti enregistré'), 'l\'état « déjà donné » n\'est pas rendu');
  ok(h.includes('4/5'), 'la note donnée n\'est pas rappelée');
});
t('le ressenti reste PRIVÉ : rien n\'est exposé aux autres joueuses', () => {
  asPlayer([M('recent', HIER, { playerReviews: { autre: { rating: 2, comment: 'SECRET' } } })]);
  S.view = { type: 'match', id: 'recent' };
  const h = ctx.renderMatchDetail();
  ok(!h.includes('SECRET'), 'le ressenti d\'une coéquipière fuite dans la vue joueuse');
  ok(!h.includes('openPlayerReviewsList'), 'l\'écran coach des ressentis est exposé à la joueuse');
});

R.forEach(l => console.log('  ' + l));
const bad = R.filter(l => l.startsWith('✗'));
console.log(bad.length ? `\n❌ ${bad.length}/${R.length} KO` : `\n✅ ${R.length} assertions OK — les deux formulaires de ressenti sont atteignables.`);
process.exit(bad.length ? 1 : 0);
