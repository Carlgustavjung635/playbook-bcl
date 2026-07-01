// Test de l'auto-lien à la création (joueuse + play) à la saison courante.
// Exécute les vrais helpers autoLinkPlayerToCurrentSeason / autoLinkPlayToCurrentSeason
// et vérifie le câblage dans addNewPlayer / savePlay.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const srcFns = ['_editableCurrentSeasonId', 'autoLinkPlayerToCurrentSeason', 'autoLinkPlayToCurrentSeason']
  .map(n => extractFn(html, n)).join('\n\n');

function make(state, seasonStatus) {
  const cur = state.currentSeasonId ? { id: state.currentSeasonId, status: seasonStatus } : null;
  return new Function('state', 'getCurrentSeason', 'isoDate',
    srcFns + '\nreturn { _editableCurrentSeasonId, autoLinkPlayerToCurrentSeason, autoLinkPlayToCurrentSeason };'
  )(state, () => cur, () => '2026-07-01');
}

console.log('SCÉNARIO 1 — joueuse auto-liée à la saison éditable');
{
  const state = { currentSeasonId: 's1', seasonPlayers: [], seasonPlays: [] };
  const api = make(state, 'active');
  const ok = api.autoLinkPlayerToCurrentSeason('pC', 'e1');
  t('lien créé (active, leftAt vide, teamTag e1)', () => {
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(state.seasonPlayers, [{ seasonId: 's1', playerId: 'pC', joinedAt: '2026-07-01', leftAt: '', role: '', teamTag: 'e1' }]);
  });
}
{
  const state = { currentSeasonId: 's1', seasonPlayers: [{ seasonId: 's1', playerId: 'pC', leftAt: '2025-01-01', teamTag: 'e1' }] };
  make(state, 'draft').autoLinkPlayerToCurrentSeason('pC');
  t('idempotent : lien parti (leftAt) → réintégré (leftAt vidé)', () => {
    assert.strictEqual(state.seasonPlayers[0].leftAt, '');
    assert.strictEqual(state.seasonPlayers.length, 1);
  });
}
{
  const state = { currentSeasonId: 's1', seasonPlayers: [] };
  const ok = make(state, 'archived').autoLinkPlayerToCurrentSeason('pC');
  t('saison archivée → refus (false, aucun lien)', () => { assert.strictEqual(ok, false); assert.strictEqual(state.seasonPlayers.length, 0); });
}
{
  const state = { currentSeasonId: null, seasonPlayers: [] };
  const ok = make(state, 'active').autoLinkPlayerToCurrentSeason('pC');
  t('aucune saison courante → refus', () => { assert.strictEqual(ok, false); assert.strictEqual(state.seasonPlayers.length, 0); });
}

console.log('SCÉNARIO 2 — play auto-lié (mais pas en mode legacy)');
{
  // Saison utilise déjà le rattachement (au moins 1 lien) → nouveau play lié actif.
  const state = { currentSeasonId: 's1', seasonPlays: [{ seasonId: 's1', playId: 'pOld', active: true }] };
  const ok = make(state, 'active').autoLinkPlayToCurrentSeason('pNew');
  t('saison avec liens → play lié actif', () => {
    assert.strictEqual(ok, true);
    assert.ok(state.seasonPlays.find(sp => sp.playId === 'pNew' && sp.active === true));
  });
}
{
  // Mode legacy : aucun lien play pour la saison → on NE lie PAS (préserve la
  // visibilité de tous les plays existants).
  const state = { currentSeasonId: 's1', seasonPlays: [] };
  const ok = make(state, 'active').autoLinkPlayToCurrentSeason('pNew');
  t('saison en mode legacy (0 lien) → PAS de lien (rétrocompat)', () => {
    assert.strictEqual(ok, false);
    assert.strictEqual(state.seasonPlays.length, 0);
  });
}
{
  const state = { currentSeasonId: 's1', seasonPlays: [{ seasonId: 's1', playId: 'x', active: true }] };
  const ok = make(state, 'archived').autoLinkPlayToCurrentSeason('pNew');
  t('saison archivée → refus', () => { assert.strictEqual(ok, false); });
}

console.log('SCÉNARIO 3 — câblage dans addNewPlayer / savePlay');
t('addNewPlayer appelle autoLinkPlayerToCurrentSeason', () => {
  assert.ok(/autoLinkPlayerToCurrentSeason\(newP\.id, 'e1'\)/.test(extractFn(html, 'addNewPlayer')));
});
t('savePlay lie le nouveau play (gardé par isNew)', () => {
  const s = extractFn(html, 'savePlay');
  assert.ok(/if \(isNew\) autoLinkPlayToCurrentSeason\(obj\.id\)/.test(s));
});
t('createNewPlayerForSeason continue de lier (inchangé)', () => {
  assert.ok(/seasonPlayers\.push\(/.test(extractFn(html, 'createNewPlayerForSeason')));
});

console.log(`\n✅ ${pass} assertions OK — auto-lien à la création (joueuse + play).`);
