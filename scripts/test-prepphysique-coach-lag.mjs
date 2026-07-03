// Chantier B — dashboard coach : "qui n'a pas fait". Compte les exos planifiés
// ÉCHUS (date >= démarrage ET <= aujourd'hui) non cochés, par joueuse, trié par
// retard décroissant. Le helper est copié CONFORME à index.html.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// --- helper copié conforme à index.html ---
function computeOffseasonDailyLag(sched, logs, pool, startDate, today) {
  const dueDates = Object.keys(sched || {})
    .filter(d => (!startDate || d >= startDate) && d <= today)
    .sort();
  return pool.map(p => {
    const pLogs = (logs || {})[p.id] || {};
    let planned = 0, done = 0;
    const lateDates = [];
    dueDates.forEach(d => {
      const items = sched[d] || [];
      const dLog = pLogs[d] || {};
      const dDone = items.filter(it => dLog[it.id] && dLog[it.id].done).length;
      planned += items.length;
      done += dDone;
      if (items.length - dDone > 0) lateDates.push({ date: d, missing: items.length - dDone });
    });
    return { player: p, planned, done, lag: planned - done, lateDates };
  }).filter(x => x.planned > 0)
    .sort((a, b) => b.lag - a.lag || String(a.player.name).localeCompare(String(b.player.name)));
}

// Fixtures : programme démarré 2026-07-01, aujourd'hui 2026-07-08.
// Schedule : 07-02 (2 exos), 07-05 (3 exos), 07-08 aujourd'hui (2 exos),
//            07-10 FUTUR (2 exos, ne doit PAS compter),
//            06-28 AVANT démarrage (1 exo, ne doit PAS compter).
const sched = {
  '2026-06-28': [{ id: 'z' }],
  '2026-07-02': [{ id: 'a' }, { id: 'b' }],
  '2026-07-05': [{ id: 'c' }, { id: 'd' }, { id: 'e' }],
  '2026-07-08': [{ id: 'f' }, { id: 'g' }],
  '2026-07-10': [{ id: 'h' }, { id: 'i' }],
};
const START = '2026-07-01', TODAY = '2026-07-08';
const pool = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Zoe' }, { id: 'p3', name: 'Bob' }];
// Total échu = 2 + 3 + 2 = 7 exos par joueuse.
const logs = {
  // Alice : tout fait sur 07-02, rien ailleurs → 5 en retard
  p1: { '2026-07-02': { a: { done: true }, b: { done: true } } },
  // Zoe : rien du tout → 7 en retard
  p2: {},
  // Bob : tout fait sauf 1 le 07-05 → 1 en retard
  p3: {
    '2026-07-02': { a: { done: true }, b: { done: true } },
    '2026-07-05': { c: { done: true }, d: { done: true } }, // e manquant
    '2026-07-08': { f: { done: true }, g: { done: true } },
  },
};

const res = computeOffseasonDailyLag(sched, logs, pool, START, TODAY);
const by = Object.fromEntries(res.map(x => [x.player.id, x]));

console.log('SCÉNARIO 1 — total planifié = seulement les jours ÉCHUS (>= start, <= today)');
t('7 exos échus par joueuse (futur 07-10 et pré-start 06-28 exclus)', () => {
  assert.strictEqual(by.p1.planned, 7);
  assert.strictEqual(by.p2.planned, 7);
  assert.strictEqual(by.p3.planned, 7);
});

console.log('SCÉNARIO 2 — comptage du retard (planifié - coché)');
t('Alice 5 en retard, Zoe 7, Bob 1', () => {
  assert.strictEqual(by.p1.lag, 5);
  assert.strictEqual(by.p2.lag, 7);
  assert.strictEqual(by.p3.lag, 1);
});

console.log('SCÉNARIO 3 — tri par retard décroissant (les moins assidues en tête)');
t('ordre = Zoe (7) → Alice (5) → Bob (1)', () => {
  assert.deepStrictEqual(res.map(x => x.player.id), ['p2', 'p1', 'p3']);
});

console.log('SCÉNARIO 4 — dates spécifiques en retard exposées');
t('Bob : uniquement 07-05 avec 1 exo manquant', () => {
  assert.deepStrictEqual(by.p3.lateDates, [{ date: '2026-07-05', missing: 1 }]);
});
t('Zoe : les 3 dates échues, chacune tous les exos manquants', () => {
  assert.deepStrictEqual(by.p2.lateDates, [
    { date: '2026-07-02', missing: 2 },
    { date: '2026-07-05', missing: 3 },
    { date: '2026-07-08', missing: 2 },
  ]);
});

console.log('SCÉNARIO 5 — indicateur global > 3 exos en retard');
t('2 joueuses (Zoe, Alice) ont > 3 exos en retard', () => {
  const alert = res.filter(x => x.lag > 3).length;
  assert.strictEqual(alert, 2);
});

console.log('SCÉNARIO 6 — cas "tout le monde à jour" → liste vide après filtre lag>0');
t('aucune joueuse en retard si tout coché', () => {
  const full = {
    p1: {
      '2026-07-02': { a: { done: true }, b: { done: true } },
      '2026-07-05': { c: { done: true }, d: { done: true }, e: { done: true } },
      '2026-07-08': { f: { done: true }, g: { done: true } },
    },
  };
  const r = computeOffseasonDailyLag(sched, full, [{ id: 'p1', name: 'Alice' }], START, TODAY);
  assert.strictEqual(r[0].lag, 0);
  assert.strictEqual(r.filter(x => x.lag > 0).length, 0);
});

console.log('SCÉNARIO 7 — programme non démarré : rien d\'échu, liste vide');
t('today < startDate → aucune date due → filtre planned>0 vide la liste', () => {
  const r = computeOffseasonDailyLag(sched, logs, pool, '2026-08-01', '2026-07-08');
  assert.strictEqual(r.length, 0);
});

// Garde-fou anti-dérive : la source appelle bien le helper dans le dashboard.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
console.log('SCÉNARIO 8 — intégration dashboard coach');
t('openOffseasonDashboardDaily utilise computeOffseasonDailyLag + alerte >3', () => {
  const fn = html.slice(html.indexOf('function openOffseasonDashboardDaily('), html.indexOf('function openOffseasonDashboard('));
  assert.ok(/computeOffseasonDailyLag\(sched, logs, _seasonPool, o\.startDate, today\)/.test(fn), 'appel lag absent');
  assert.ok(/lagRows\.filter\(x => x\.lag > 3\)\.length/.test(fn), 'indicateur global >3 absent');
  assert.ok(/⚠️ Retards/.test(fn), 'section Retards absente');
  assert.ok(/\$\{lagSection\}/.test(fn), 'lagSection non injectée dans le body');
});

console.log(`\n✅ ${pass} assertions OK — dashboard coach "qui n'a pas fait" (retards cumulés + tri + alerte).`);
