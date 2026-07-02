// Test : heure de RDV équipe (défaut 1h avant le match, override coach) + notif
// « tu es retenue · RDV à … ». Migration 20260702_004 (rdv_time/rdv_place).
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

const rdv = new Function(extractFn('_rdvDefaultFromTime') + '\n' + extractFn('getMatchRdvTime') + '\nreturn getMatchRdvTime;')();

console.log('SCÉNARIO 1 — défaut = 1h avant l\'heure du match');
t('20:30 → 19:30', () => assert.strictEqual(rdv({ time: '20:30' }), '19:30'));
t('09:00 → 08:00 (padding)', () => assert.strictEqual(rdv({ time: '09:00' }), '08:00'));
t('00:15 → 00:15 (garde-fou minuit, pas d\'heure négative)', () => assert.strictEqual(rdv({ time: '00:15' }), '00:15'));
t('pas d\'heure de match → "" (pas de défaut)', () => assert.strictEqual(rdv({}), ''));

console.log('SCÉNARIO 2 — override coach prioritaire (domicile ET extérieur)');
t('override 17:45 gagne sur le défaut', () => assert.strictEqual(rdv({ time: '20:30', rdvTime: '17:45' }), '17:45'));
t('domicile aussi : défaut 1h avant appliqué', () => assert.strictEqual(rdv({ time: '19:00', home: true }), '18:00'));
t('override respecté même à domicile', () => assert.strictEqual(rdv({ time: '19:00', home: true, rdvTime: '18:15' }), '18:15'));

console.log('SCÉNARIO 3 — notif « tu es retenue » inclut le RDV');
{
  const src = ['getMatchRoster', 'getMatchComposition', '_rdvDefaultFromTime', 'getMatchRdvTime', '_notifyLineupRevealed'].map(extractFn).join('\n\n');
  const players = [{ id: 'a', num: 4, name: 'Lea' }, { id: 'b', num: 7, name: 'Mia' }];
  function fire(match) {
    const pushed = [];
    const state = { players, convocations: [], currentSeasonId: 's1' };
    new Function('state', 'notifyPush', '_pushPlayerKeys', 'getActiveSeasonId', '_seasonsLoaded', 'getSeasonPlayers', 'formatDate',
      src + '\nreturn _notifyLineupRevealed;'
    )(state, (k, p) => pushed.push({ k, p }), ids => ids.map(x => 'player:' + x), () => 's1', () => true, () => players, d => d)(match);
    return pushed;
  }
  const p1 = fire({ id: 'm1', opponent: 'CAP', date: '2026-12-31', time: '20:30', place: 'Gym A', teamTag: 'e1', seasonId: 's1', roster: { included: ['a'] } });
  const perso = p1.find(x => x.p.type === 'lineup_in');
  t('défaut : « RDV à 19:30 » dans le message retenue', () => assert.ok(/RDV à 19:30/.test(perso.p.body)));
  t('le message garde le match + heure', () => assert.ok(/CAP/.test(perso.p.body) && /à 20:30/.test(perso.p.body)));

  const p2 = fire({ id: 'm1', opponent: 'CAP', date: '2026-12-31', time: '20:30', teamTag: 'e1', seasonId: 's1', rdvTime: '18:00', rdvPlace: 'parking club', roster: { included: ['a'] } });
  t('override + lieu : « RDV à 18:00 au parking club »', () => {
    assert.ok(/RDV à 18:00 au parking club/.test(p2.find(x => x.p.type === 'lineup_in').p.body));
  });

  const p3 = fire({ id: 'm1', opponent: 'X', date: '2026-12-31', teamTag: 'e1', seasonId: 's1', roster: { included: ['a'] } }); // pas d'heure
  t('pas d\'heure → pas de « RDV » dans le message (pas de faux 1h avant)', () => {
    assert.ok(!/RDV à/.test(p3.find(x => x.p.type === 'lineup_in').p.body));
  });
  t('non retenues : message neutre inchangé (pas de RDV)', () => {
    assert.ok(!/RDV/.test(p1.find(x => x.p.type === 'lineup_pub').p.body));
  });
}

console.log('SCÉNARIO 4 — champ toujours visible + sync + rétrocompat');
t('modale : « Heure de RDV équipe » hors bloc extérieur (toujours visible)', () => {
  const ed = extractFn('editMatch');
  assert.ok(/Heure de RDV équipe/.test(ed)); // libellé du champ (section « ⏰ Logistique »)
  // l'input m-rdv-time n'est PAS dans le bloc #m-deplacement (lieu covoiturage)
  const idxRdv = ed.indexOf('id="m-rdv-time"');
  const idxDep = ed.indexOf('id="m-deplacement"');
  assert.ok(idxRdv >= 0 && idxRdv < idxDep, 'm-rdv-time doit précéder le bloc déplacement');
});
t('saveMatch ne force plus l\'auto-fill (défaut dynamique)', () => {
  const sm = extractFn('saveMatch');
  assert.ok(!/Auto-fill RDV pour les extérieurs/.test(sm));
  assert.ok(/rdvTimeEl \? \(rdvTimeEl\.value/.test(sm));
});
t('dump/apply matches : rdv_time + rdv_place', () => {
  assert.ok(/rdv_time: m\.rdvTime \|\| null/.test(html) && /rdv_place: m\.rdvPlace \|\| null/.test(html));
  assert.ok(/rdvTime: r\.rdv_time \|\| local\.rdvTime/.test(html) && /rdvPlace: r\.rdv_place/.test(html));
});
t('syncConvocFromMatch utilise getMatchRdvTime (RDV effectif)', () => {
  assert.ok(/effectiveTime = getMatchRdvTime\(m\) \|\| m\.time/.test(html));
});
t('migration 20260702_004 présente (rdv_time/rdv_place)', () => {
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20260702_004_match_rdv_time.sql'), 'utf8');
  assert.ok(/add column if not exists rdv_time text/.test(mig) && /add column if not exists rdv_place text/.test(mig));
});

console.log(`\n✅ ${pass} assertions OK — RDV match (défaut 1h avant + override + notif).`);
