// Test : détection de conflit de compo E1/E2 (même joueuse dans 2 matchs le même
// jour avec chevauchement horaire). Badge inline + swap « Retirer de l'autre ».
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
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const src = ['_matchStartMin', '_lineupConflictsFor'].map(extractFn).join('\n\n');
function conflicts(matches, pid, matchId) {
  return new Function('state', src + '\nreturn _lineupConflictsFor;')({ matches })(pid, matchId).map(x => x.id);
}

console.log('SCÉNARIO 1 — chevauchement horaire même jour');
{
  const matches = [
    { id: 'm1', date: '2026-12-31', time: '18:00', teamTag: 'e1', roster: { included: ['a'] } },
    { id: 'm2', date: '2026-12-31', time: '18:30', teamTag: 'e2', opponent: 'YYY', roster: { included: ['a'] } },
  ];
  t('a dans m1 ET m2 même jour (<3h) → conflit m2', () => {
    assert.deepStrictEqual(conflicts(matches, 'a', 'm1'), ['m2']);
  });
}

console.log('SCÉNARIO 2 — pas de conflit');
{
  const matches = [
    { id: 'm1', date: '2026-12-31', time: '10:00', teamTag: 'e1', roster: { included: ['a'] } },
    { id: 'm2', date: '2026-12-31', time: '18:00', teamTag: 'e2', roster: { included: ['a'] } }, // >3h
    { id: 'm3', date: '2026-12-30', time: '18:00', teamTag: 'e2', roster: { included: ['a'] } }, // autre jour
    { id: 'm4', date: '2026-12-31', time: '18:00', teamTag: 'e2', roster: { included: ['b'] } }, // pas la même joueuse
  ];
  t('écart horaire > 3h → pas de conflit', () => assert.ok(!conflicts(matches, 'a', 'm1').includes('m2')));
  t('autre jour → pas de conflit', () => assert.ok(!conflicts(matches, 'a', 'm1').includes('m3')));
  t('joueuse absente de l\'autre compo → pas de conflit', () => assert.ok(!conflicts(matches, 'a', 'm4').includes('m4')));
}

console.log('SCÉNARIO 3 — heure manquante = conflit potentiel (prudence)');
{
  const matches = [
    { id: 'm1', date: '2026-12-31', teamTag: 'e1', roster: { included: ['a'] } }, // pas d\'heure
    { id: 'm2', date: '2026-12-31', time: '18:00', teamTag: 'e2', roster: { included: ['a'] } },
  ];
  t('une heure absente + même jour → conflit signalé', () => {
    assert.deepStrictEqual(conflicts(matches, 'a', 'm1'), ['m2']);
  });
}

console.log('SCÉNARIO 4 — conflit basé sur roster.included EXPLICITE seulement');
{
  // m2 n'a pas de roster.included défini → dérivé ≠ explicite → pas de conflit
  const matches = [
    { id: 'm1', date: '2026-12-31', time: '18:00', teamTag: 'e1', roster: { included: ['a'] } },
    { id: 'm2', date: '2026-12-31', time: '18:00', teamTag: 'e2' }, // pas de compo définie
  ];
  t('autre match sans compo définie → pas de faux conflit', () => {
    assert.deepStrictEqual(conflicts(matches, 'a', 'm1'), []);
  });
}

console.log('SCÉNARIO 5 — swap + câblage UI');
{
  const swapSrc = extractFn('removeFromOtherLineup');
  const state = { auth: { role: 'coach' }, matches: [{ id: 'm2', roster: { included: ['a', 'b'] } }] };
  const fn = new Function('state', 'persist', 'closeModal', 'setTimeout', 'openRosterManager',
    swapSrc + '\nreturn removeFromOtherLineup;'
  )(state, () => {}, () => {}, () => {}, () => {});
  fn('m2', 'a', 'm1');
  t('removeFromOtherLineup retire a de m2', () => assert.deepStrictEqual(state.matches[0].roster.included, ['b']));
  const ps = { auth: { role: 'player' }, matches: [{ id: 'm2', roster: { included: ['a'] } }] };
  new Function('state', 'persist', 'closeModal', 'setTimeout', 'openRosterManager', swapSrc + '\nreturn removeFromOtherLineup;')(ps, () => {}, () => {}, () => {}, () => {})('m2', 'a', 'm1');
  t('joueuse → swap no-op', () => assert.deepStrictEqual(ps.matches[0].roster.included, ['a']));
  t('badge conflit câblé dans openRosterManager (included + excluded)', () => {
    const o = extractFn('openRosterManager');
    assert.strictEqual((o.match(/_lineupConflictBadge\(p\.id, matchId\)/g) || []).length, 2);
  });
}

console.log(`\n✅ ${pass} assertions OK — conflit compo E1/E2.`);
