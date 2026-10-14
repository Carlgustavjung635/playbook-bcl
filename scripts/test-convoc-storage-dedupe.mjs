// Test : le plan d'entraînement ne doit plus être écrit DEUX FOIS en
// localStorage. resolveTrainingPlan fait pointer `c.trainingPlan` sur l'objet
// de state.trainingPlans ; save(K.convocations, …) sérialisait donc le plan
// entier — photos base64 comprises — une seconde fois.
//
// L'assertion qui compte n'est pas « ça retire le plan », c'est « ça ne le
// retire QUE quand il a un autre domicile ». Un plan legacy pas encore migré
// n'existe nulle part ailleurs : le retirer le détruirait.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let p = 0, sigEnd = -1;
  for (let j = html.indexOf('(', start); j < html.length; j++) {
    if (html[j] === '(') p++;
    else if (html[j] === ')') { p--; if (p === 0) { sigEnd = j; break; } }
  }
  let depth = 0, began = false;
  for (let j = html.indexOf('{', sigEnd); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const src = extractFn('_convocsForStorage');
const build = (state) => new Function('state', src + '\nreturn _convocsForStorage;')(state);

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(300000); // ~300 Ko, comme une vraie
const plan = () => ({ exercises: [{ title: 'TDT', images: [PHOTO] }], validated: false });

console.log('PLAN MIGRÉ — le doublon saute');
{
  const p = plan();
  const state = {
    trainingPlans: [{ convocationId: 'c1', instanceDate: '2026-10-07', plan: p }],
    // live-binding : la convoc pointe sur LE MÊME objet
    convocations: [{ id: 'c1', title: 'Mardi', date: '2026-10-07', trainingPlan: p }],
  };
  const out = build(state)();
  t('trainingPlan retiré de ce qui part en localStorage', () => {
    assert.strictEqual(out[0].trainingPlan, undefined);
  });
  t('le reste de la convoc est intact', () => {
    assert.strictEqual(out[0].id, 'c1');
    assert.strictEqual(out[0].title, 'Mardi');
    assert.strictEqual(out[0].date, '2026-10-07');
  });
  t('le gain est réel : ~300 Ko de moins sérialisés', () => {
    const avant = JSON.stringify(state.convocations).length;
    const apres = JSON.stringify(out).length;
    assert.ok(avant - apres > 290000, 'gain mesuré : ' + (avant - apres));
  });
  t("l'état en mémoire n'est PAS muté (le live-binding doit survivre)", () => {
    assert.strictEqual(state.convocations[0].trainingPlan, p);
    assert.strictEqual(state.trainingPlans[0].plan, p);
  });
}

console.log('PLAN LEGACY NON MIGRÉ — on ne touche à rien');
{
  const p = plan();
  const state = {
    trainingPlans: [],                                   // aucun domicile canonique
    convocations: [{ id: 'c1', title: 'Mardi', trainingPlan: p }],
  };
  const out = build(state)();
  t('le plan est CONSERVÉ (sinon il est détruit)', () => {
    assert.strictEqual(out[0].trainingPlan, p);
  });
}
{
  // Migration partielle : une convoc migrée, une autre pas.
  const p1 = plan(), p2 = plan();
  const state = {
    trainingPlans: [{ convocationId: 'c1', instanceDate: '2026-10-07', plan: p1 }],
    convocations: [
      { id: 'c1', trainingPlan: p1 },
      { id: 'c2', trainingPlan: p2 },
    ],
  };
  const out = build(state)();
  t('chaque convoc est jugée séparément', () => {
    assert.strictEqual(out[0].trainingPlan, undefined);
    assert.strictEqual(out[1].trainingPlan, p2);
  });
}

console.log('ENTRÉES DÉGÉNÉRÉES');
{
  t('convoc sans plan, state vide, entrée nulle', () => {
    assert.deepStrictEqual(build({ convocations: [{ id: 'c1' }] })(), [{ id: 'c1' }]);
    assert.deepStrictEqual(build({})(), []);
    assert.deepStrictEqual(build({ convocations: [null] })(), [null]);
  });
}

console.log('CÂBLAGE');
{
  t('persist() écrit _convocsForStorage(), plus state.convocations brut', () => {
    assert.match(html, /save\(K\.convocations, _convocsForStorage\(\)\);/);
    assert.doesNotMatch(html, /save\(K\.convocations, state\.convocations\);/);
  });
  t('le dump Supabase des convocations reste inchangé (le plan n\'y était pas)', () => {
    assert.doesNotMatch(extractFnSafe('persist'), /training_plan/);
  });
  const v = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).v;
  t('version.json === APP_VERSION', () => {
    assert.strictEqual(html.match(/const APP_VERSION = '([^']+)'/)[1], v);
  });
}
function extractFnSafe(n) { try { return extractFn(n); } catch { return ''; } }

console.log('\n✅ ' + pass + ' assertions vertes');
