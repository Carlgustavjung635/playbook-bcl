// Contexte d'exécution partagé pour les harnais : le VRAI index.html, joué dans
// un vm à DOM stubé. Repris tel quel du patron des harnais existants (cf.
// test-drill-exo-link.mjs) — factorisé ici parce que deux harnais neufs
// (notes coachs / exos alternatifs) en avaient besoin à l'identique.
import fs from 'node:fs';
import vm from 'node:vm';

export function buildCtx(extraExports = '') {
  const html = fs.readFileSync('index.html', 'utf8');
  const all = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/\bsrc=/.test(m[1]));
  const code = all.filter(m => !/type\s*=\s*["']module["']/.test(m[1])).map(m => m[2]).join('\n;\n')
    + '\n;globalThis.state = state; globalThis.K = K;' + extraExports;
  // Les dump/apply PbSync vivent dans le bloc <script type="module"> : leur
  // portée ne franchit PAS la frontière des blocs, d'où l'export explicite.
  const moduleBlock = all.filter(m => /type\s*=\s*["']module["']/.test(m[1])).map(m => m[2])[0]
    .replace(/^\s*import\s[^\n]*\n/m, '') + '\n;globalThis.ENTITIES = ENTITIES;';

  const store = {}, fields = {};
  const mkEl = (id) => ({ id: id || '', style: {}, className: '', innerHTML: '', textContent: '', value: '',
    checked: false, disabled: false, files: [], appendChild() {}, remove() {}, addEventListener() {},
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} }, getContext: () => null,
    setAttribute() {}, getAttribute: () => null, focus() {}, setSelectionRange() {} });
  const doc = {
    getElementById: (id) => (id in fields ? { value: fields[id], textContent: '', checked: !!fields[id], innerHTML: '' } : mkEl(id)),
    createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [],
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
  ctx.createClient = () => {
    const q = new Proxy({}, { get: (o, k) => (k === 'then' ? undefined : () => q) });
    return { from: () => q, storage: { from: () => q }, channel: () => ({ on: () => ({ on: () => ({ subscribe() {} }), subscribe() {} }), subscribe() {} }), removeChannel() {}, auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(code, ctx, { filename: 'index.inline.js' }); }
  catch (e) { console.log('X EVALUATION: ' + e.message); process.exit(1); }
  try { vm.runInContext(moduleBlock, ctx, { filename: 'index.module.js' }); }
  catch (e) { console.log('X EVALUATION MODULE: ' + e.message); process.exit(1); }
  ctx.render = () => {}; ctx.openModal = h => { ctx.__lastModal = h; }; ctx.closeModal = () => {};
  ctx.renderTrainingPlanEditor = () => {}; ctx.persist = () => {}; ctx.notifyPush = () => {};
  ctx.fields = fields;
  return ctx;
}

export function runner() {
  const R = [];
  return {
    R,
    t: (label, fn) => { try { fn(); R.push('OK  ' + label); } catch (e) { R.push('KO  ' + label + ' -> ' + e.message); } },
    ok: (c, m) => { if (!c) throw new Error(m || 'assertion'); },
    eq: (a, b, m) => { if (a !== b) throw new Error((m || 'egalite') + ' : ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); },
    end: () => {
      R.forEach(l => console.log(l));
      const ko = R.filter(l => l.startsWith('KO')).length;
      console.log(ko ? '\n' + ko + ' ECHEC(S)' : '\nTOUT PASSE (' + R.length + ')');
      process.exit(ko ? 1 : 0);
    }
  };
}
