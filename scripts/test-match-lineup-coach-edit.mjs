// Test : le coach peut modifier la composition du match à tout moment.
// Réutilise l'infra existante (m.roster.included = override synced via roster
// jsonb ; getMatchRoster priorise l'override ; toggleRosterPlayer édite).
// Le fix ajoute le bouton « ✏️ Modifier » (coach only) dans la section compo.
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

// getMatchRoster passe par _convocResp (v.91) pour tenir compte des
// indisponibilités : on extrait la chaîne complète.
const src = ['_unavailMeta', '_unavailOn', '_convocResp', 'getMatchRoster', 'getMatchComposition', 'ensureMatchRoster', 'toggleRosterPlayer']
  .map(extractFn).join('\n\n');
const players = [{ id: 'a', num: 4, name: 'Lea' }, { id: 'b', num: 7, name: 'Mia' }, { id: 'c', num: 9, name: 'Zoe' }];
function build(state) {
  const log = { persisted: 0 };
  const api = new Function('state', 'getSeasonPlayers', '_seasonsLoaded', 'recalcMatchScore', 'persist', 'closeModal', 'setTimeout', 'openRosterManager', 'render', 'confirm',
    src + '\nreturn { getMatchRoster, getMatchComposition, ensureMatchRoster, toggleRosterPlayer };'
  )(state, () => players, () => true, () => {}, () => log.persisted++, () => {}, () => {}, () => {}, () => {}, () => true);
  return { api, log };
}

console.log('SCÉNARIO 1 — override m.roster.included prioritaire sur la compo dérivée');
{
  const st = { players, convocations: [], currentSeasonId: 's1', matches: [{ id: 'm1', seasonId: 's1', date: '2026-07-10', roster: { included: ['a', 'c'] } }] };
  const { api } = build(st);
  t('compo = l\'override du coach [a,c] (pas tout l\'effectif)', () => {
    assert.deepStrictEqual(api.getMatchComposition(st.matches[0], null).map(x => x.id), ['a', 'c']);
  });
}

console.log('SCÉNARIO 2 — fallback si pas d\'override (rétrocompat)');
{
  // Pas de roster → dérive de la convoc du jour (b absente → exclue).
  const st = { players, convocations: [{ type: 'match', date: '2026-07-10', responses: { b: { status: 'absent' } } }], currentSeasonId: 's1', matches: [{ id: 'm1', seasonId: 's1', date: '2026-07-10' }] };
  const { api } = build(st);
  t('sans override → dérive convoc (a,c ; b absente exclue)', () => {
    assert.deepStrictEqual(api.getMatchComposition(st.matches[0], null).map(x => x.id), ['a', 'c']);
  });
}
{
  // Ni override ni convoc → effectif saison complet.
  const st = { players, convocations: [], currentSeasonId: 's1', matches: [{ id: 'm1', seasonId: 's1', date: '2026-07-10' }] };
  const { api } = build(st);
  t('sans override ni convoc → effectif saison complet', () => {
    assert.deepStrictEqual(api.getMatchComposition(st.matches[0], null).map(x => x.id).sort(), ['a', 'b', 'c']);
  });
}

console.log('SCÉNARIO 3 — édition : ajouter / retirer (écriture atomique dans roster.included)');
{
  const st = { players, convocations: [], currentSeasonId: 's1', matches: [{ id: 'm1', seasonId: 's1', date: '2026-07-10', roster: { included: ['a'] } }] };
  const { api, log } = build(st);
  api.toggleRosterPlayer('m1', 'b', true);
  t('ajouter b → included [a,b] + persist (sync)', () => {
    assert.deepStrictEqual(st.matches[0].roster.included, ['a', 'b']);
    assert.ok(log.persisted >= 1);
  });
  api.toggleRosterPlayer('m1', 'a', false);
  t('retirer a → included [b]', () => assert.deepStrictEqual(st.matches[0].roster.included, ['b']));
  api.toggleRosterPlayer('m1', 'b', true); // idempotent : déjà présente
  t('ré-ajouter b (déjà présente) → pas de doublon', () => assert.deepStrictEqual(st.matches[0].roster.included, ['b']));
}

console.log('SCÉNARIO 4 — la compo rendue reflète l\'override (joueuse voit la vérité coach)');
{
  const st = { players, convocations: [], currentSeasonId: 's1', matches: [{ id: 'm1', seasonId: 's1', date: '2026-07-10', roster: { included: ['b'] } }] };
  const { api } = build(st);
  // viewerId = 'b' (la joueuse Mia) → isMe sur elle
  const comp = api.getMatchComposition(st.matches[0], 'b');
  t('joueuse voit exactement l\'override coach (b), marquée TOI', () => {
    assert.deepStrictEqual(comp.map(x => x.id), ['b']);
    assert.strictEqual(comp[0].isMe, true);
  });
}

console.log('SCÉNARIO 5 — câblage UI : bouton coach only + éditeur existant');
t('renderMatchComposition : bouton « ✏️ Modifier » gaté coach → openRosterManager', () => {
  const r = extractFn('renderMatchComposition');
  assert.ok(/const isCoach = state\.auth && state\.auth\.role === 'coach';/.test(r));
  assert.ok(/\$\{isCoach \? `<button class="section-action" onclick="openRosterManager\('\$\{m\.id\}'\)">✏️ Modifier<\/button>` : ''\}/.test(r));
});
t('la joueuse ne voit PAS le bouton (gating isCoach)', () => {
  const r = extractFn('renderMatchComposition');
  // openRosterManager n'apparaît que dans la branche isCoach
  assert.ok(!/role === 'player'[\s\S]{0,200}openRosterManager/.test(r));
});
t('éditeur openRosterManager : badge présence « convoquée » sur les retenues', () => {
  const o = extractFn('openRosterManager');
  assert.ok(/convBadge/.test(o) && /✓ présente/.test(o) && /✗ absente/.test(o));
});
t('pas de nouvelle migration (réutilise m.roster déjà synced via roster jsonb)', () => {
  // dump matches pousse déjà roster (jsonb) — pas de champ lineup séparé ajouté.
  assert.ok(/roster: m\.roster \|\| \{\}/.test(html));
});

console.log(`\n✅ ${pass} assertions OK — édition compo coach (override m.roster.included).`);
