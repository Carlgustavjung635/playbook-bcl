// Test : la section Composition (avec bouton « ✏️ Modifier » coach) est visible
// sur les matchs À VENIR, pas seulement les matchs joués. Fix du gating : la
// compo était rendue uniquement dans la branche « match joué » de renderMatchDetail.
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

const src = ['getMatchRoster', 'getMatchComposition', 'renderMatchComposition'].map(extractFn).join('\n\n');
const players = [{ id: 'a', num: 4, name: 'Lea' }, { id: 'b', num: 7, name: 'Mia' }];
function render(role, m) {
  const state = { auth: { role, playerId: role === 'player' ? 'a' : null }, players, convocations: [], currentSeasonId: 's1' };
  return new Function('state', 'esc', 'getSeasonPlayers', '_seasonsLoaded',
    src + '\nreturn renderMatchComposition;'
  )(state, s => String(s), () => players, () => true)(m);
}

console.log('SCÉNARIO 1 — match À VENIR : section visible + label « prévue » + bouton coach');
{
  const upcoming = { id: 'm1', seasonId: 's1', date: '2026-12-31', scoreUs: 0, scoreOpp: 0 };
  const outCoach = render('coach', upcoming);
  t('titre « Composition prévue » (match à venir)', () => assert.ok(/🏀 Composition prévue/.test(outCoach)));
  t('bouton « ✏️ Modifier » coach → openRosterManager', () => {
    assert.ok(/openRosterManager\('m1'\)/.test(outCoach) && outCoach.includes('✏️ Modifier'));
  });
  // Joueuse : la compo n'est visible qu'une fois RÉVÉLÉE (cf. lineupRevealed, PR #122).
  const outPlayer = render('player', { ...upcoming, lineupRevealed: true });
  t('joueuse (compo révélée) : section visible mais AUCUN bouton Modifier', () => {
    assert.ok(/Composition prévue/.test(outPlayer));
    assert.ok(!/openRosterManager/.test(outPlayer));
  });
}

console.log('SCÉNARIO 2 — match JOUÉ : titre « Composition » (sans « prévue »)');
{
  const played = { id: 'm2', seasonId: 's1', date: '2026-01-01', scoreUs: 55, scoreOpp: 48 };
  const out = render('coach', played);
  t('titre « 🏀 Composition » (pas « prévue »)', () => {
    assert.ok(/🏀 Composition</.test(out));
    assert.ok(!/Composition prévue/.test(out));
  });
  t('bouton Modifier toujours présent (coach)', () => assert.ok(/openRosterManager\('m2'\)/.test(out)));
}

console.log('SCÉNARIO 3 — câblage renderMatchDetail : compo rendue dans la branche « à venir »');
{
  const rmd = extractFn('renderMatchDetail');
  t('branche isToPlay inclut renderMatchComposition(m)', () => {
    assert.ok(/isToPlay \? \(renderMatchComposition\(m\) \+ renderMatchPrep\(m\)/.test(rmd));
  });
  t('la branche « joué » garde aussi la compo (showCompo)', () => {
    assert.ok(/showCompo \? renderMatchComposition\(m\) : ''/.test(rmd));
  });
  t('pas de double rendu : les 2 appels sont dans des branches exclusives du ternaire', () => {
    // isToPlay ? (... renderMatchComposition ...) : `... showCompo ? renderMatchComposition ...`
    const n = (rmd.match(/renderMatchComposition\(m\)/g) || []).length;
    assert.strictEqual(n, 2); // 1 par branche
  });
}

console.log('SCÉNARIO 4 — coach sans compo dérivable voit quand même la section (accès édition)');
{
  // Pas d'effectif résolvable → getMatchComposition vide, mais coach garde l'accès.
  const state = { auth: { role: 'coach', playerId: null }, players: [], convocations: [], currentSeasonId: 's1' };
  const out = new Function('state', 'esc', 'getSeasonPlayers', '_seasonsLoaded',
    src + '\nreturn renderMatchComposition;'
  )(state, s => String(s), () => [], () => true)({ id: 'm3', seasonId: 's1', date: '2026-12-31', scoreUs: 0, scoreOpp: 0 });
  t('compo vide + coach → section rendue avec bouton Modifier', () => {
    assert.ok(out && /openRosterManager\('m3'\)/.test(out));
  });
}

console.log(`\n✅ ${pass} assertions OK — édition compo sur match à venir.`);
