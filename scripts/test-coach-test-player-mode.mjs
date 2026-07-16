// Test MODE JOUEUSE TEST (« ghost ») — le coach prévisualise l'app en joueuse,
// sans PIN, et RIEN ne doit être écrit nulle part.
//
// Même harnais que test-training-wizard.mjs : les blocs <script> classiques
// d'index.html sont évalués dans un vm à DOM stubé, puis on pilote le vrai code.
// C'est indispensable ici : la propriété à prouver n'est pas « une fonction pure
// rend le bon résultat » mais « AUCUNE écriture ne sort », ce qu'une copie fidèle
// ne peut pas vérifier. On instrumente donc localStorage, le client Supabase et
// le push, et on compte les écritures — elles doivent rester à ZÉRO.
//
// Le bloc <script type="module"> (PbSync/_flushAll/_reassertRows) est hors de
// portée du vm : ses verrous lisent window.__PB_TEST_MODE__, on vérifie donc que
// le drapeau est correctement posé/levé (le reste est couvert par le smoke).
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.TEST_PLAYER_ID = TEST_PLAYER_ID;';

// --- mouchards : tout ce qui pourrait écrire -------------------------------
const W = { localStorage: [], sbWrite: [], sbRead: [], storageWrite: [], push: [] };
const store = {};

const mkEl = () => ({
  style: {}, className: '', innerHTML: '', textContent: '', id: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {}, files: [],
});
const doc = {
  getElementById: () => mkEl(), createElement: mkEl,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible',
};

// Faux client Supabase : compte les écritures, laisse passer les lectures.
const mkQuery = (table) => {
  const q = {
    select() { W.sbRead.push(table); return q; },
    eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
    single() { return q; }, maybeSingle() { return q; },
    insert() { W.sbWrite.push({ table, op: 'insert' }); return q; },
    update() { W.sbWrite.push({ table, op: 'update' }); return q; },
    upsert() { W.sbWrite.push({ table, op: 'upsert' }); return q; },
    delete() { W.sbWrite.push({ table, op: 'delete' }); return q; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return q;
};
const realSb = {
  from: (t) => mkQuery(t),
  storage: {
    from: (bucket) => ({
      upload() { W.storageWrite.push({ bucket, op: 'upload' }); return Promise.resolve({ data: {}, error: null }); },
      remove() { W.storageWrite.push({ bucket, op: 'remove' }); return Promise.resolve({ data: {}, error: null }); },
      getPublicUrl: () => ({ data: { publicUrl: 'https://x/fake.jpg' } }),
      list: () => Promise.resolve({ data: [], error: null }),
    }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};

const ctx = {
  console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol, Proxy, Reflect,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL,
  document: doc,
  navigator: {
    userAgent: 'probe', onLine: true,
    serviceWorker: { getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}), ready: Promise.resolve({ showNotification() {} }), addEventListener() {} },
  },
  location: { href: 'https://app.test/', hash: '', replace(u) { W.reload = u; }, reload() { W.reload = 'reload()'; } },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { W.localStorage.push(k); store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0,
  fetch: (url) => { W.push.push(String(url)); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
  alert: () => {}, confirm: () => true, prompt: () => 'x',
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 390, innerHeight: 844,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  sb: realSb,
  __SB_URL__: 'https://x.supabase.co', __SB_ANON__: 'anon',
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'index.inline.js' });

let passed = 0, failed = 0;
const t = (label, fn) => { try { fn(); console.log('  ✓ ' + label); passed++; } catch (e) { console.log('  ✗ ' + label + ' → ' + e.message); failed++; } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };
const resetW = () => { W.localStorage.length = 0; W.sbWrite.length = 0; W.storageWrite.length = 0; W.push.length = 0; };

// --- décor ------------------------------------------------------------------
ctx.state.players = [
  { id: 'p1', name: 'Alice', num: 7 },
  { id: 'p2', name: 'Delph', num: 6 },
];
ctx.state.seasonPlayers = [
  { seasonId: 's1', playerId: 'p1', teamTag: 'e1' },
  { seasonId: 's1', playerId: 'p2', teamTag: 'e1' },
];
ctx.state.seasons = [{ id: 's1', name: '2026', active: true }];
ctx.state.currentSeasonId = 's1';
ctx.render = () => {};
ctx.showToast = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => {};
ctx._installTestModeSbGuard();

console.log('SCÉNARIO 1 — _isTestMode() et le drapeau du module');
t('coach connecté → pas en mode test', () => {
  ctx.state.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx._isTestMode() === false);
});
t('joueuse réelle → pas en mode test', () => {
  ctx.state.auth = { role: 'player', playerId: 'p1' };
  ok(ctx._isTestMode() === false);
});
t('auth null → pas en mode test (pas de crash)', () => {
  ctx.state.auth = null;
  ok(ctx._isTestMode() === false);
});
t('mode:test → true', () => {
  ctx.state.auth = { role: 'player', playerId: '__test__', mode: 'test' };
  ok(ctx._isTestMode() === true);
});

console.log('SCÉNARIO 2 — entrée en mode test');
t('openTestModeModal() puis enterTestMode() avec poste 3 / taille 175', () => {
  ctx.state.auth = null;
  ctx.openTestModeModal();
  ctx._tmSet('name', 'Ghost Test');
  ctx._tmTogglePoste(3);
  ctx._tmSet('taille', '175');
  resetW();
  ctx.enterTestMode();
  ok(ctx._isTestMode(), 'pas en mode test après enterTestMode');
  ok(ctx.state.auth.playerId === '__test__', 'playerId != __test__');
  ok(ctx.state.auth.role === 'player', 'role != player');
  ok(ctx.state.auth.profile.name === 'Ghost Test', 'nom perdu');
  ok(ctx.state.auth.profile.taille === 175, 'taille perdue : ' + ctx.state.auth.profile.taille);
  ok(JSON.stringify(ctx.state.auth.profile.postes) === '[3]', 'postes perdus');
});
t('entrer en mode test n\'écrit RIEN en localStorage (auth de test non persistée)', () => {
  ok(W.localStorage.length === 0, 'clés écrites : ' + W.localStorage.join(','));
});
t('le drapeau window.__PB_TEST_MODE__ est posé (verrou du bloc module)', () => {
  ok(ctx.window.__PB_TEST_MODE__ === true, 'drapeau non posé → PbSync flusherait');
});
t('taille aberrante rejetée → null', () => {
  ctx.openTestModeModal(); ctx._tmSet('taille', '9999'); ctx.enterTestMode();
  ok(ctx.state.auth.profile.taille === null, 'taille 9999 acceptée');
});
t('nom vide → défaut « Joueuse Test »', () => {
  ctx.openTestModeModal(); ctx._tmSet('name', '   '); ctx.enterTestMode();
  ok(ctx.state.auth.profile.name === 'Joueuse Test', ctx.state.auth.profile.name);
});

console.log('SCÉNARIO 3 — la ghost est une joueuse crédible mais hors effectif');
ctx.openTestModeModal(); ctx._tmSet('name', 'Ghost Test'); ctx._tmTogglePoste(3); ctx._tmSet('taille', '175'); ctx.enterTestMode();
t('currentPlayer() renvoie la ghost (sinon la home coach s\'afficherait)', () => {
  const p = ctx.currentPlayer();
  ok(p, 'currentPlayer null → renderHomePlayer retomberait sur renderHomeCoach');
  ok(p.id === '__test__', 'id != __test__');
  ok(p.name === 'Ghost Test', 'nom : ' + p.name);
  ok(p.taille_cm === 175, 'taille : ' + p.taille_cm);
  ok(JSON.stringify(p.postes) === '[3]', 'postes : ' + JSON.stringify(p.postes));
});
t('la ghost n\'est PAS dans state.players (garantie principale)', () => {
  ok(!(ctx.state.players || []).some(p => p.id === '__test__'), 'ghost injectée dans state.players !');
});
t('la ghost n\'est pas dans state.seasonPlayers (sinon flush en base)', () => {
  ok(!(ctx.state.seasonPlayers || []).some(sp => sp.playerId === '__test__'));
});
t('getSeasonPlayers() exclut la ghost', () => {
  const pool = ctx.getSeasonPlayers('s1', { team: 'all' });
  ok(!pool.some(p => p.id === '__test__'), 'ghost dans l\'effectif de saison');
  ok(pool.length === 2, 'effectif altéré : ' + pool.length);
});
t('getSeasonPlayers() exclut la ghost même injectée de force dans state.players', () => {
  ctx.state.players.push({ id: '__test__', name: 'Ghost Test', num: 0 });
  ctx.state.seasonPlayers.push({ seasonId: 's1', playerId: '__test__', teamTag: 'e1' });
  try {
    const pool = ctx.getSeasonPlayers('s1', { team: 'all' });
    ok(!pool.some(p => p.id === '__test__'), 'ceinture inopérante : ghost dans le pool');
    const nolink = ctx.getSeasonPlayers(null);
    ok(!nolink.some(p => p.id === '__test__'), 'ceinture inopérante sans saison');
    ok(!ctx.visiblePlayersForUser(ctx.state.players).some(p => p.id === '__test__'), 'visiblePlayersForUser laisse passer la ghost');
    ok(!ctx._stimPlayersRoster().some(p => p.id === '__test__'), '_stimPlayersRoster laisse passer la ghost');
  } finally {
    ctx.state.players = ctx.state.players.filter(p => p.id !== '__test__');
    ctx.state.seasonPlayers = ctx.state.seasonPlayers.filter(sp => sp.playerId !== '__test__');
  }
});
t('_pushAllPlayerKeys() ne cible jamais la ghost', () => {
  ok(!ctx._pushAllPlayerKeys().includes('player:__test__'), 'la ghost est ciblée par les notifs « à toutes »');
});

console.log('SCÉNARIO 4 — AUCUNE écriture ne sort en mode test');
t('persist() n\'écrit ni localStorage ni PbSync', () => {
  resetW();
  ctx.state.trainingCompletions = [{ id: 'xGHOST', playerId: '__test__', pointsTotal: 50, deletedAt: null }];
  ctx.persist();
  ok(W.localStorage.length === 0, 'localStorage écrit : ' + W.localStorage.join(','));
});
t('la validation fantôme n\'a PAS atterri en localStorage (piège de l\'anti-wipe « x… »)', () => {
  // NB : la clé EXISTE déjà (vide) — le boot appelle persist() bien avant le mode
  // test. La propriété à prouver n'est donc pas « la clé est absente » mais « la
  // ligne fantôme n'y est pas » : c'est elle qui, restée en localStorage avec un
  // id « x… », serait repoussée en base au prochain login réel par l'anti-wipe.
  const raw = store[ctx.K.trainingCompletions] || '[]';
  ok(!raw.includes('xGHOST'), 'ligne fantôme persistée → serait poussée au prochain login réel : ' + raw);
  ok(JSON.parse(raw).length === 0, 'localStorage sali par le mode test : ' + raw);
});
t('sb.from().insert/update/upsert/delete → neutralisés', () => {
  resetW();
  ctx.window.sb.from('training_completions').insert([{ id: 'x1' }]);
  ctx.window.sb.from('challenges').update({ a: 1 });
  ctx.window.sb.from('gages').upsert([{ id: 'x2' }]);
  ctx.window.sb.from('players').delete();
  ok(W.sbWrite.length === 0, 'écritures passées : ' + JSON.stringify(W.sbWrite));
});
t('la chaîne .insert().select().single() est awaitable et rend { data:null, error:null }', async () => {
  const r = ctx.window.sb.from('t').insert([{}]).select().single();
  ok(typeof r.then === 'function', 'chaîne non thenable → un await planterait');
});
t('les LECTURES passent (la ghost doit voir le vrai contenu)', () => {
  resetW();
  ctx.window.sb.from('training_programs').select('*');
  ok(W.sbRead.length > 0, 'les lectures sont bloquées → la ghost ne verrait rien');
  ok(W.sbWrite.length === 0);
});
t('Storage upload/remove → neutralisés', () => {
  resetW();
  ctx.window.sb.storage.from('training-photos').upload('a.jpg', {});
  ctx.window.sb.storage.from('drill-images').upload('b.jpg', {});
  ctx.window.sb.storage.from('training-photos').remove(['a.jpg']);
  ok(W.storageWrite.length === 0, 'uploads passés : ' + JSON.stringify(W.storageWrite));
});
t('getPublicUrl passe (placeholder rendu, pas de crash)', () => {
  const { data } = ctx.window.sb.storage.from('training-photos').getPublicUrl('x.jpg');
  ok(data && data.publicUrl, 'getPublicUrl cassé');
});
t('notifyPush() → no-op (aucun vrai téléphone notifié)', () => {
  resetW();
  ctx.notifyPush(['player:p1', 'player:p2'], { title: 'Test', body: 'x' });
  ok(W.push.length === 0, 'push parti : ' + JSON.stringify(W.push));
});

console.log('SCÉNARIO 5 — sortie propre');
t('doLogout() en mode test → reload, PAS de persist (le piège auth=null)', () => {
  resetW(); W.reload = null;
  ctx.doLogout();
  ok(W.reload, 'aucun reload → state.auth=null puis persist() aurait tout écrit');
  ok(W.localStorage.length === 0, 'localStorage écrit pendant le logout : ' + W.localStorage.join(','));
});
t('exitTestMode() recharge et lève le drapeau', () => {
  W.reload = null;
  ctx.state.auth = { role: 'player', playerId: '__test__', mode: 'test' };
  ctx.window.__PB_TEST_MODE__ = true;
  ctx.exitTestMode();
  ok(W.reload, 'pas de reload');
  ok(ctx.window.__PB_TEST_MODE__ === false, 'drapeau non levé');
});
t('après sortie, un coach réel réécrit normalement (les verrous ne collent pas)', () => {
  resetW();
  ctx.state.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx._isTestMode() === false);
  ctx.persist();
  ok(W.localStorage.length > 0, 'persist() reste bloqué hors mode test → régression majeure');
  ctx.window.__PB_TEST_MODE__ = false;
  ctx.window.sb.from('t').insert([{ a: 1 }]);
  ok(W.sbWrite.length === 1, 'les écritures restent bloquées hors mode test');
});
t('le mode test ne survit pas à un reload (auth de test jamais persistée)', () => {
  ok(store[ctx.K.auth] === undefined || !JSON.parse(store[ctx.K.auth] || 'null')?.mode,
    'une auth mode:test a été persistée → session fantôme ressuscitable');
});

console.log('SCÉNARIO 6 — UI');
t('le bandeau est rendu en mode test, avec le bouton Quitter', () => {
  ctx.state.auth = { role: 'player', playerId: '__test__', mode: 'test', profile: { name: 'Ghost' } };
  const h = ctx.renderTestModeBanner();
  ok(h.includes('Mode test'), 'libellé absent');
  ok(h.includes("rien n'est enregistré"), 'promesse absente');
  ok(h.includes('exitTestMode()'), 'bouton Quitter absent');
});
t('le bandeau est absent hors mode test', () => {
  ctx.state.auth = { role: 'player', playerId: 'p1' };
  ok(ctx.renderTestModeBanner() === '', 'bandeau rendu pour une vraie joueuse !');
  ctx.state.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.renderTestModeBanner() === '', 'bandeau rendu pour le coach');
});
t('le bouton n\'apparaît QUE sur le login coach', () => {
  ctx.state.auth = null;
  ctx.state.authFlow = { stage: 'pin', role: 'coach', playerId: null, pinInput: '' };
  ok(/openTestModeModal\(\)/.test(ctx.renderAuth()), 'bouton absent du login coach');
  ctx.state.authFlow = { stage: 'pin', role: 'player', playerId: 'p1', pinInput: '' };
  ok(!/openTestModeModal\(\)/.test(ctx.renderAuth()), 'bouton exposé sur le login JOUEUSE — une joueuse pourrait entrer en mode test');
  ctx.state.authFlow = { stage: 'role', role: null, playerId: null, pinInput: '' };
  ok(!/openTestModeModal\(\)/.test(ctx.renderAuth()), 'bouton exposé sur le choix de rôle');
});
t('renderHomePlayer() rend sans throw pour la ghost', () => {
  ctx.state.auth = { role: 'player', playerId: '__test__', mode: 'test', profile: { name: 'Ghost Test', postes: [3], taille: 175 } };
  const h = ctx.renderHomePlayer();
  ok(typeof h === 'string' && h.length > 0, 'home joueuse vide');
  ok(h.includes('Ghost Test'), 'la ghost ne se voit pas sur sa propre home');
});

console.log(`\n${failed ? '❌ ' + failed + ' échec(s) / ' + (passed + failed) : '✅ ' + passed + ' assertions OK'} — mode joueuse test (ghost isolée, zéro écriture, sortie par reload)`);
if (failed) process.exit(1);
