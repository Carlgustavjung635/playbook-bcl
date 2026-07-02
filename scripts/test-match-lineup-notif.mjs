// Test : notif à la révélation de compo. Retenues → message perso « tu es
// retenue » ; non retenues (même effectif/équipe) → message NEUTRE, JAMAIS
// « tu n'es pas retenue ». Calendrier joueuse : non retenue = event neutre.
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

console.log('SCÉNARIO 1 — 2 messages distincts, jamais d\'exclusion explicite');
{
  const src = ['getMatchRoster', 'getMatchComposition', '_notifyLineupRevealed'].map(extractFn).join('\n\n');
  const players = [{ id: 'a', num: 4, name: 'Lea' }, { id: 'b', num: 7, name: 'Mia' }, { id: 'c', num: 9, name: 'Zoe' }];
  const state = { players, convocations: [], currentSeasonId: 's1' };
  const pushed = [];
  new Function('state', 'notifyPush', '_pushPlayerKeys', 'getActiveSeasonId', '_seasonsLoaded', 'getSeasonPlayers', 'formatDate',
    src + '\nreturn _notifyLineupRevealed;'
  )(state, (k, p) => pushed.push({ k, p }), ids => ids.map(x => 'player:' + x), () => 's1', () => true, () => players, d => d)(
    { id: 'm1', opponent: 'CA Pontacq', date: '2026-12-31', time: '18:00', place: 'Gymnase', teamTag: 'e1', seasonId: 's1', roster: { included: ['a'] } }
  );
  const perso = pushed.find(x => x.p.type === 'lineup_in');
  const pub = pushed.find(x => x.p.type === 'lineup_pub');
  t('retenue (a) → message PERSO « tu es retenue »', () => {
    assert.deepStrictEqual(perso.k, ['player:a']);
    assert.ok(/retenue/i.test(perso.p.title));
    assert.ok(/CA Pontacq/.test(perso.p.body));
  });
  t('non retenues (b,c) → message NEUTRE « compo publiée »', () => {
    assert.deepStrictEqual(pub.k, ['player:b', 'player:c']);
    assert.ok(/publiée/i.test(pub.p.body));
  });
  t('SÉCURITÉ : aucun message ne dit « pas/non retenue » ni « exclue »', () => {
    const all = JSON.stringify(pushed);
    assert.ok(!/pas retenue|non retenue|non retenu|exclue|écartée|banc/i.test(all));
  });
  t('une retenue n\'est jamais dans la liste neutre (pas de doublon)', () => {
    assert.ok(!pub.k.includes('player:a'));
  });
}

console.log('SCÉNARIO 2 — compo sans retenue → seulement le message neutre');
{
  const src = ['getMatchRoster', 'getMatchComposition', '_notifyLineupRevealed'].map(extractFn).join('\n\n');
  const players = [{ id: 'b', num: 7, name: 'Mia' }];
  const state = { players, convocations: [], currentSeasonId: 's1' };
  const pushed = [];
  new Function('state', 'notifyPush', '_pushPlayerKeys', 'getActiveSeasonId', '_seasonsLoaded', 'getSeasonPlayers', 'formatDate',
    src + '\nreturn _notifyLineupRevealed;'
  )(state, (k, p) => pushed.push({ k, p }), ids => ids.map(x => 'player:' + x), () => 's1', () => true, () => players, d => d)(
    { id: 'm1', opponent: 'X', date: '2026-12-31', teamTag: 'e1', seasonId: 's1', roster: { included: [] } }
  );
  t('0 retenue → pas de message perso, juste le neutre', () => {
    assert.ok(!pushed.some(x => x.p.type === 'lineup_in'));
    assert.ok(pushed.some(x => x.p.type === 'lineup_pub'));
  });
}

console.log('SCÉNARIO 3 — calendrier joueuse : non retenue (révélé) = event neutre');
{
  const src = ['getMatchRoster', 'getMatchComposition', 'playerEventRow'].map(extractFn).join('\n\n');
  function row(playerId, match) {
    const state = { auth: { role: 'player', playerId }, matches: [match], players: [{ id: 'a' }, { id: 'b' }], convocations: [], currentSeasonId: 's1' };
    const ev = { type: 'match', matchId: match.id, date: match.date, time: match.time, title: 'vs ' + match.opponent, responses: {} };
    return new Function('state', 'esc', 'getSeasonPlayers', '_seasonsLoaded',
      src + '\nreturn (pid,ev)=>playerEventRow(ev,pid);'
    )(state, s => String(s), () => [{ id: 'a' }, { id: 'b' }], () => true)(playerId, ev);
  }
  const match = { id: 'm1', opponent: 'X', date: '2026-12-31', time: '18:00', lineupRevealed: true, roster: { included: ['a'] } };
  const outIn = row('a', match);   // retenue
  const outOut = row('b', match);  // non retenue
  t('retenue → « ✓ Présente »', () => assert.ok(/✓ Présente/.test(outIn)));
  t('non retenue (révélé) → « Match de l\'équipe » (PAS Présente/Absente)', () => {
    assert.ok(/Match de l'équipe/.test(outOut));
    assert.ok(!/✓ Présente/.test(outOut) && !/✕ Absente/.test(outOut));
  });
  const matchHidden = { id: 'm1', opponent: 'X', date: '2026-12-31', time: '18:00', lineupRevealed: false, roster: { included: ['a'] } };
  t('compo NON révélée → comportement inchangé (présente par défaut)', () => {
    assert.ok(/✓ Présente/.test(row('b', matchHidden)));
  });
}

console.log(`\n✅ ${pass} assertions OK — notif révélation (neutre, digne).`);
