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
ctx.closeModal = () => {};

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

// --- 3) CÔTÉ COACH : la section « État d'esprit équipe » ---------------------
// La carte coach n'était affichée QUE s'il existait au moins un ressenti
// (`if (reviews.length === 0) return ''`). Or ses deux onclick sont les SEULS
// points d'entrée de openTeamReviewsDashboard() dans toute l'app : à zéro
// ressenti, le coach n'avait aucun moyen de savoir que la fonctionnalité
// existait. Et comme le CTA joueuse était lui-même inatteignable (cf. §1), le
// compteur ne pouvait jamais quitter zéro — les deux invisibilités se
// nourrissaient l'une l'autre.
function asCoach(reviews) {
  asPlayer([]);
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.players = [{ id: 'pX', name: 'Lea', num: 7 }, { id: 'pY', name: 'Mia', num: 8 }];
  S.seasonPlayers = ['pX', 'pY'].map(playerId => ({ seasonId: 'S1', playerId, teamTag: 'e1', joinedAt: shift(-200), leftAt: null }));
  S.teamReviews = reviews || [];
}
const REV = (pid, date, extra) => Object.assign({
  id: 'r-' + pid, pid, date, ambiance: 4, roleClarity: 4, playtime: 4, physique: 4,
  comment: '', updatedAt: Date.now(),
}, extra || {});

t('sans aucun ressenti, la section coach reste visible et accessible', () => {
  asCoach([]);
  const h = ctx.renderHomeCoach();
  ok(h.includes('État d\'esprit équipe'), 'la section a disparu de l\'accueil coach');
  ok(h.includes('openTeamReviewsDashboard()'), 'plus aucun accès au tableau de bord des ressentis');
  ok(h.includes('Aucun ressenti cette saison'), 'l\'état vide n\'est pas annoncé');
  ok(h.includes('0/2 joueuses'), 'le compteur 0/N n\'est pas rendu');
});
t('avec des ressentis, la carte affiche les moyennes (comportement inchangé)', () => {
  asCoach([REV('pX', shift(-5)), REV('pY', shift(-2), { ambiance: 2, roleClarity: 2, playtime: 2, physique: 2 })]);
  const h = ctx.renderHomeCoach();
  ok(h.includes('Ressenti actuel'), 'la carte de moyennes a disparu');
  ok(h.includes('2/2 joueuses'), 'le compteur ne suit pas les ressentis reçus');
  ok(!h.includes('Aucun ressenti cette saison'), 'l\'état vide s\'affiche alors qu\'il y a des ressentis');
});
t('un ressenti HORS saison ne remonte pas — et l\'accès reste ouvert', () => {
  asCoach([REV('pX', shift(-900))]);
  const h = ctx.renderHomeCoach();
  ok(h.includes('Aucun ressenti cette saison'), 'un ressenti d\'une autre saison est compté');
  ok(h.includes('openTeamReviewsDashboard()'), 'l\'accès au tableau de bord est perdu');
});
t('le tableau de bord coach n\'est JAMAIS exposé à la joueuse', () => {
  asPlayer([]);
  ok(!ctx.renderHomePlayer().includes('openTeamReviewsDashboard'), 'écran coach exposé sur l\'accueil joueuse');
});

// --- 4) AGRÉGATION : le DERNIER ressenti de chaque joueuse, et lui seul -------
// « L'état d'esprit actuel de l'équipe » n'est pas la moyenne de tout ce qui a
// été écrit depuis septembre : une joueuse qui répond dix fois pèserait dix
// fois plus qu'une qui répond une fois, et un coup de mou de novembre tirerait
// encore la moyenne en avril. Une seule ligne par joueuse : la plus récente.
t('deux entrées d\'une même joueuse : seule la dernière compte', () => {
  asCoach([
    REV('pX', shift(-30), { ambiance: 1, roleClarity: 1, playtime: 1, physique: 1 }),
    REV('pX', shift(-2), { id: 'r-pX-2', ambiance: 5, roleClarity: 5, playtime: 5, physique: 5 }),
  ]);
  const latest = Object.values(ctx.latestTeamReviewByPlayer(ctx.activeTeamReviews()));
  ok(latest.length === 1, 'l\'historique est recompté dans l\'agrégation');
  ok(latest[0].ambiance === 5, 'ce n\'est pas la dernière entrée qui est retenue');
  const h = ctx.renderHomeCoach();
  ok(h.includes('5.0'), 'la moyenne cumule l\'ancienne entrée au lieu de la remplacer');
  ok(h.includes('1/2 joueuse'), 'le compteur compte les entrées, pas les joueuses');
});
t('à date égale, c\'est la saisie la plus récente qui gagne', () => {
  const d = shift(-4);
  asCoach([
    REV('pX', d, { ambiance: 1, updatedAt: 1000 }),
    REV('pX', d, { id: 'r-pX-2', ambiance: 5, updatedAt: 2000 }),
  ]);
  const latest = Object.values(ctx.latestTeamReviewByPlayer(ctx.activeTeamReviews()));
  ok(latest.length === 1 && latest[0].ambiance === 5, 'départage par updatedAt cassé');
});
t('la date PUBLIÉE prime sur l\'horodatage technique', () => {
  // Une vieille entrée resynchronisée porte un updatedAt récent : elle ne doit
  // pas pour autant redevenir « le ressenti actuel » de la joueuse.
  asCoach([
    REV('pX', shift(-2), { ambiance: 5, updatedAt: 1000 }),
    REV('pX', shift(-90), { id: 'r-pX-old', ambiance: 1, updatedAt: 9e12 }),
  ]);
  const latest = Object.values(ctx.latestTeamReviewByPlayer(ctx.activeTeamReviews()));
  ok(latest.length === 1 && latest[0].ambiance === 5, 'une vieille entrée resynchronisée a repris la main');
});
t('l\'historique par joueuse garde TOUTES les entrées', () => {
  asCoach([REV('pX', shift(-30)), REV('pX', shift(-2), { id: 'r-pX-2' })]);
  ctx.openTeamReviewHistory('pX');
  ok(/2 entrées/.test(ctx.__lastModal), 'l\'historique a perdu les entrées précédentes');
  ok(ctx.__lastModal.includes('actuel'), 'la plus récente n\'est pas repérable');
});

// --- 5) SUPPRESSION ADMIN (soft-delete, migration 20260811_001) --------------
t('l\'admin supprime un ressenti : soft-delete horodaté et signé', () => {
  asCoach([REV('pX', shift(-2))]);
  ctx.deleteTeamReview('r-pX');
  const r = S.teamReviews.find(x => x.id === 'r-pX');
  ok(r, 'la ligne a été supprimée DUR : elle reviendra au prochain flush');
  ok(r.deletedAt > 0, 'deletedAt non posé');
  ok(r.deletedBy === 'admin', 'deletedBy ne trace pas le coach (audit)');
  ok(ctx.activeTeamReviews().length === 0, 'le ressenti supprimé est toujours servi');
});
t('un ressenti supprimé ne compte dans AUCUNE moyenne', () => {
  asCoach([
    REV('pX', shift(-2), { ambiance: 5, roleClarity: 5, playtime: 5, physique: 5 }),
    REV('pY', shift(-2), { id: 'r-pY', ambiance: 1, roleClarity: 1, playtime: 1, physique: 1 }),
  ]);
  ctx.deleteTeamReview('r-pY');
  const h = ctx.renderHomeCoach();
  ok(h.includes('5.0'), 'la moyenne compte encore le ressenti supprimé');
  ok(h.includes('1/2 joueuse'), 'le compteur compte encore le ressenti supprimé');
});
t('supprimer la dernière entrée fait remonter la précédente', () => {
  asCoach([
    REV('pX', shift(-30), { ambiance: 1 }),
    REV('pX', shift(-2), { id: 'r-pX-2', ambiance: 5 }),
  ]);
  ctx.deleteTeamReview('r-pX-2');
  const latest = Object.values(ctx.latestTeamReviewByPlayer(ctx.activeTeamReviews()));
  ok(latest.length === 1 && latest[0].ambiance === 1, 'la joueuse n\'a plus de ressenti courant');
});
t('un coach d\'équipe (non admin) ne peut pas supprimer', () => {
  asCoach([REV('pX', shift(-2))]);
  S.coaches = [{ id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e2'] }];
  S.auth = { role: 'coach', coachId: 'c2' };
  ctx.deleteTeamReview('r-pX');
  ok(!S.teamReviews[0].deletedAt, 'un coach non-admin a pu supprimer un ressenti');
});
t('une joueuse ne peut pas supprimer, même en appelant la fonction', () => {
  asCoach([REV('pX', shift(-2))]);
  S.auth = { role: 'player', playerId: 'pX' };
  ctx.deleteTeamReview('r-pX');
  ok(!S.teamReviews[0].deletedAt, 'une joueuse a pu supprimer un ressenti');
});
t('le bouton 🗑 n\'est proposé qu\'à l\'admin', () => {
  asCoach([REV('pX', shift(-2))]);
  ctx.openTeamReviewsDashboard();
  ok(ctx.__lastModal.includes('deleteTeamReview('), 'l\'admin n\'a pas de bouton de suppression');
  S.coaches = [{ id: 'c2', name: 'Coach E2', coachRole: 'coach', teams: ['e1'] }];
  S.auth = { role: 'coach', coachId: 'c2' };
  ctx.openTeamReviewsDashboard();
  ok(!ctx.__lastModal.includes('deleteTeamReview('), 'bouton de suppression exposé à un coach non-admin');
});
t('un ressenti supprimé disparaît de l\'historique ET du CTA joueuse', () => {
  asCoach([REV('pX', shift(-2))]);
  ctx.deleteTeamReview('r-pX');
  ctx.openTeamReviewHistory('pX');
  ok(/0 entrée/.test(ctx.__lastModal), 'le ressenti supprimé reste dans l\'historique');
  S.auth = { role: 'player', playerId: 'pX' };
  const h = ctx.renderHomePlayer();
  ok(h.includes('Confidentiel'), 'le CTA joueuse annonce encore une dernière entrée supprimée');
});
t('la sync porte deleted_at / deleted_by dans les DEUX sens', () => {
  // Garde STATIQUE : l'entité PbSync vit dans le bloc <script type="module">,
  // que ce harnais ne charge pas (il ne concatène que les <script> classiques).
  // Sans cette vérification, la suppression resterait locale à l'appareil et
  // le ressenti réapparaîtrait chez tout le monde — sans qu'aucun test ne bronche.
  const a = html.indexOf("key: 'teamReviews'");
  const b = html.indexOf("key: 'playerMatchFeedback'");
  ok(a > 0 && b > a, 'entité teamReviews introuvable — test à réajuster');
  const src = html.slice(a, b);
  ok(/deleted_at:\s*r\.deletedAt/.test(src), 'deleted_at n\'est pas poussé au serveur (dump)');
  ok(/deleted_by:\s*r\.deletedBy/.test(src), 'deleted_by n\'est pas poussé au serveur (dump)');
  ok(/deletedAt:\s*r\.deleted_at/.test(src), 'deleted_at est perdu au retour du serveur (apply)');
  ok(/deletedBy:\s*r\.deleted_by/.test(src), 'deleted_by est perdu au retour du serveur (apply)');
});
t('la migration soft-delete est versionnée dans le repo', () => {
  const sql = fs.readFileSync('supabase/migrations/20260811_001_team_reviews_soft_delete.sql', 'utf8');
  ok(/add column if not exists deleted_at/.test(sql), 'colonne deleted_at absente de la migration');
  ok(/add column if not exists deleted_by/.test(sql), 'colonne deleted_by absente de la migration');
});

R.forEach(l => console.log('  ' + l));
const bad = R.filter(l => l.startsWith('✗'));
console.log(bad.length ? `\n❌ ${bad.length}/${R.length} KO` : `\n✅ ${R.length} assertions OK — les deux formulaires de ressenti sont atteignables.`);
process.exit(bad.length ? 1 : 0);
