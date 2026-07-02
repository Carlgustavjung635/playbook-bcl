// Test : compo privée tant que non révélée (lineupRevealed). Coach voit tout +
// bouton Annoncer ; joueuse ne voit RIEN avant révélation. Migration 20260702_003.
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
function render(role, m) {
  const state = { auth: { role, playerId: 'a' }, players: [{ id: 'a', num: 4, name: 'Lea' }], convocations: [], currentSeasonId: 's1' };
  return new Function('state', 'esc', 'getSeasonPlayers', '_seasonsLoaded',
    src + '\nreturn renderMatchComposition;'
  )(state, s => String(s), () => [{ id: 'a', num: 4, name: 'Lea' }], () => true)(m);
}

console.log('SCÉNARIO 1 — joueuse : compo masquée tant que non révélée');
{
  const notRevealed = render('player', { id: 'm1', lineupRevealed: false, roster: { included: ['a'] } });
  t('message d\'attente affiché', () => assert.ok(/pas encore été annoncée par la coach/.test(notRevealed)));
  t('la joueuse ne voit AUCUN nom de la compo', () => assert.ok(!notRevealed.includes('Lea')));
}
{
  const revealed = render('player', { id: 'm1', lineupRevealed: true, roster: { included: ['a'] } });
  t('compo révélée → la joueuse voit la compo', () => assert.ok(revealed.includes('Lea')));
}

console.log('SCÉNARIO 2 — coach : voit tout + bouton Annoncer (même non révélé)');
{
  const c1 = render('coach', { id: 'm1', lineupRevealed: false, roster: { included: ['a'] } });
  t('coach voit la compo même non révélée', () => assert.ok(c1.includes('Lea')));
  t('bouton « 👁 Annoncer la compo » + statut « privée »', () => {
    assert.ok(/👁 Annoncer la compo/.test(c1) && /toggleLineupRevealed\('m1'\)/.test(c1));
    assert.ok(/Compo privée/.test(c1));
  });
  const c2 = render('coach', { id: 'm1', lineupRevealed: true, roster: { included: ['a'] } });
  t('révélé → bouton « 🙈 Masquer » + statut « annoncée »', () => {
    assert.ok(/🙈 Masquer/.test(c2) && /Compo annoncée/.test(c2));
  });
}

console.log('SCÉNARIO 3 — toggleLineupRevealed : flip + gating coach + notif à l\'annonce');
{
  const tsrc = [extractFn('getMatchRoster'), extractFn('getMatchComposition'), extractFn('_notifyLineupRevealed'), extractFn('toggleLineupRevealed')].join('\n\n');
  function build(role) {
    const state = { auth: { role, playerId: null }, players: [{ id: 'a', num: 4, name: 'Lea' }], convocations: [], currentSeasonId: 's1',
      matches: [{ id: 'm1', opponent: 'CAP', date: '2026-12-31', time: '18:00', teamTag: 'e1', seasonId: 's1', lineupRevealed: false, roster: { included: ['a'] } }] };
    const log = { pushed: [], toasts: [] };
    const fn = new Function('state', 'persist', 'render', 'showToast', 'notifyPush', '_pushPlayerKeys', 'getActiveSeasonId', '_seasonsLoaded', 'getSeasonPlayers', 'formatDate',
      tsrc + '\nreturn toggleLineupRevealed;'
    )(state, () => {}, () => {}, m => log.toasts.push(m), (k, p) => log.pushed.push({ k, p }), ids => ids.map(x => 'player:' + x),
      () => 's1', () => true, () => [{ id: 'a', num: 4, name: 'Lea' }], d => d);
    return { state, log, fn };
  }
  const coach = build('coach');
  coach.fn('m1');
  t('false→true : lineupRevealed=true + toast + notif envoyée', () => {
    assert.strictEqual(coach.state.matches[0].lineupRevealed, true);
    assert.ok(coach.log.pushed.length >= 1);
    assert.ok(coach.log.toasts.some(x => /annoncée/.test(x)));
  });
  coach.fn('m1');
  t('true→false : re-privatisation, PAS de nouvelle notif', () => {
    assert.strictEqual(coach.state.matches[0].lineupRevealed, false);
    // toujours 1 push (celui de l\'annonce), le retrait ne notifie pas
    assert.strictEqual(coach.log.pushed.length, 1);
  });
  const player = build('player');
  player.fn('m1');
  t('joueuse → toggle no-op (reste false)', () => assert.strictEqual(player.state.matches[0].lineupRevealed, false));
}

console.log('SCÉNARIO 4 — sync + saveMatch + migration');
t('dump matches pousse lineup_revealed', () => assert.ok(/lineup_revealed: !!m\.lineupRevealed/.test(html)));
t('apply matches lit lineupRevealed', () => assert.ok(/lineupRevealed: !!r\.lineup_revealed/.test(html)));
t('saveMatch préserve lineupRevealed', () => assert.ok(/lineupRevealed: existing \? !!existing\.lineupRevealed : false/.test(html)));
t('migration : colonne + backfill matchs passés', () => {
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20260702_003_match_lineup_revealed.sql'), 'utf8');
  assert.ok(/add column if not exists lineup_revealed boolean not null default false/.test(mig));
  assert.ok(/update matches set lineup_revealed = true where date < current_date/.test(mig));
});

console.log(`\n✅ ${pass} assertions OK — compo révélée / privée.`);
