// Test des suppressions individuelles (remplacent le hard-reset, PR #107 revert).
// Vérifie : le hard-reset a totalement disparu ; deleteSeason (cascade scopée +
// garde-fou dernière saison + recalage saison courante + coach-only) ; deleteConvoc
// (série récurrente vs entraînement unique) ; removePlayer (purge + liens saison) ;
// deleteMatch (match + convoc liée). Les fonctions sont exécutées pour de vrai.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// Extracteur naïf par comptage d'accolades (OK ici : chaque ${...} est équilibré).
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'fonction introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('accolades non équilibrées : ' + name);
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 1 — le hard-reset a totalement disparu');
t('plus aucune référence HARD_RESET / confirmHardReset / doHardReset', () => {
  assert.ok(!/HARD_RESET|confirmHardReset|doHardReset|syncHardResetBtn/.test(html));
});
t('plus de « Zone dangereuse » ni « Réinitialiser toutes les données »', () => {
  assert.ok(!/Zone dangereuse/.test(html));
  assert.ok(!/Réinitialiser toutes les données/.test(html));
});
t('plus de clé d\'audit bcl_last_hard_reset', () => assert.ok(!/bcl_last_hard_reset/.test(html)));

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 2 — UI suppression saison (coach, si >1 saison)');
t('bouton « 🗑 Supprimer » par saison conditionné à seasons.length > 1', () => {
  assert.ok(/\$\{seasons\.length > 1 \? `<button[^`]*onclick="deleteSeason\('\$\{esc\(s\.id\)\}'\)"/.test(html));
});
t('deleteSeason est gardé coach', () => {
  const src = extractFn(html, 'deleteSeason');
  assert.ok(/if \(!\(state\.auth && state\.auth\.role === 'coach'\)\) return;/.test(src));
});

// ---------------------------------------------------------------------------
// Sandbox commun.
const NEEDED = ['getActiveSeasonId', 'ensureCurrentSeasonId', 'deleteSeason', 'deleteConvoc', 'removePlayer', 'deleteMatch'];
const concatSrc = NEEDED.map(n => extractFn(html, n)).join('\n\n');

function makeSandbox(state, { confirmReturn = true } = {}) {
  const log = { confirms: [], alerts: [], toasts: [] };
  const factory = new Function(
    'state', 'confirm', 'alert', 'save', 'K', 'persist', 'showToast', 'closeModal',
    'render', 'openSeasonsModal', 'managePlayers', 'window', 'setTimeout',
    concatSrc + '\nreturn { getActiveSeasonId, ensureCurrentSeasonId, deleteSeason, deleteConvoc, removePlayer, deleteMatch };'
  );
  const api = factory(
    state,
    msg => { log.confirms.push(msg); return confirmReturn; },
    msg => { log.alerts.push(msg); },
    () => {},                                  // save
    { currentSeasonId: 'pb8_current_season_id' },
    () => {},                                  // persist
    msg => { log.toasts.push(msg); },          // showToast
    () => {},                                  // closeModal
    () => {},                                  // render
    () => {},                                  // openSeasonsModal
    () => {},                                  // managePlayers
    { PbStore: null },                         // window
    () => {}                                   // setTimeout (no-op)
  );
  return { api, log };
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 3 — deleteSeason : cascade + garde-fous');
{
  // Garde-fou : une seule saison → refus.
  const state = { auth: { role: 'coach' }, seasons: [{ id: 's1', name: 'Unique' }], currentSeasonId: 's1',
    matches: [], convocations: [], challenges: [], broadcasts: [], seasonPlayers: [], seasonPlays: [] };
  const { api, log } = makeSandbox(state);
  api.deleteSeason('s1');
  t('refuse de supprimer la dernière saison (alert, aucun delete)', () => {
    assert.ok(log.alerts.some(a => /dernière saison/.test(a)));
    assert.strictEqual(state.seasons.length, 1);
  });
}
{
  // Cascade sur une saison non courante, en préservant l'autre saison + legacy.
  const state = {
    auth: { role: 'coach' },
    seasons: [{ id: 's1', name: 'Vieille' }, { id: 's2', name: 'Active', status: 'active' }],
    currentSeasonId: 's2',
    matches: [{ id: 'm1', seasonId: 's1' }, { id: 'm2', seasonId: 's2' }, { id: 'mLeg' /* legacy sans seasonId */ }],
    convocations: [{ id: 'c1', seasonId: 's1' }, { id: 'c2', seasonId: 's2' }],
    challenges: [{ id: 'ch1', seasonId: 's1' }, { id: 'ch2', seasonId: 's2' }],
    broadcasts: [{ id: 'b1', seasonId: 's1' }],
    seasonPlayers: [{ seasonId: 's1', playerId: 'p1' }, { seasonId: 's2', playerId: 'p1' }],
    seasonPlays: [{ seasonId: 's1', playId: 'pl1' }, { seasonId: 's2', playId: 'pl1' }],
    players: [{ id: 'p1', name: 'Lea' }],
  };
  const { api } = makeSandbox(state);
  api.deleteSeason('s1');
  t('saison s1 supprimée, s2 conservée', () => {
    assert.deepStrictEqual(state.seasons.map(s => s.id), ['s2']);
  });
  t('matchs/convocs/défis/diffusions de s1 effacés, s2 + legacy préservés', () => {
    assert.deepStrictEqual(state.matches.map(m => m.id), ['m2', 'mLeg']);
    assert.deepStrictEqual(state.convocations.map(c => c.id), ['c2']);
    assert.deepStrictEqual(state.challenges.map(c => c.id), ['ch2']);
    assert.deepStrictEqual(state.broadcasts.map(b => b.id), []);
  });
  t('liens season_players / season_plays de s1 retirés, ceux de s2 gardés', () => {
    assert.deepStrictEqual(state.seasonPlayers.map(sp => sp.seasonId), ['s2']);
    assert.deepStrictEqual(state.seasonPlays.map(sp => sp.seasonId), ['s2']);
  });
  t('roster global intact', () => assert.deepStrictEqual(state.players.map(p => p.id), ['p1']));
}
{
  // Supprimer la saison COURANTE → recale currentSeasonId sur l'active restante.
  const state = {
    auth: { role: 'coach' },
    seasons: [{ id: 'sDraft', name: 'Brouillon', status: 'draft' }, { id: 'sActive', name: 'Active', status: 'active' }],
    currentSeasonId: 'sDraft',
    matches: [], convocations: [], challenges: [], broadcasts: [], seasonPlayers: [], seasonPlays: [],
  };
  const { api } = makeSandbox(state);
  api.deleteSeason('sDraft');
  t('suppression de la saison courante → currentSeasonId = active restante', () => {
    assert.strictEqual(state.currentSeasonId, 'sActive');
  });
}
{
  // Coach-only : une joueuse ne peut pas supprimer.
  const state = { auth: { role: 'player' }, seasons: [{ id: 'a' }, { id: 'b' }], currentSeasonId: 'a',
    matches: [], convocations: [], challenges: [], broadcasts: [], seasonPlayers: [], seasonPlays: [] };
  const { api } = makeSandbox(state);
  api.deleteSeason('a');
  t('rôle joueuse → no-op (aucune saison supprimée)', () => assert.strictEqual(state.seasons.length, 2));
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 4 — deleteConvoc : série récurrente vs entraînement unique');
{
  const state = { matches: [], convocations: [
    { id: 'cv1', title: 'Mardi muscu', recurrence: { freq: 'weekly' } },
    { id: 'cv2', title: 'Stage ponctuel' },
  ] };
  const { api, log } = makeSandbox(state);
  api.deleteConvoc('cv1');
  t('convoc récurrente : confirm mentionne « série » + supprime', () => {
    assert.ok(log.confirms.some(c => /série/.test(c)));
    assert.ok(!state.convocations.find(c => c.id === 'cv1'));
  });
  api.deleteConvoc('cv2');
  t('entraînement unique : confirm sans « série » + supprime', () => {
    const last = log.confirms[log.confirms.length - 1];
    assert.ok(!/série/.test(last) && /entraînement/.test(last));
    assert.ok(!state.convocations.find(c => c.id === 'cv2'));
  });
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 5 — removePlayer : purge + liens saison');
{
  const state = {
    players: [{ id: 'p1', name: 'Lea' }, { id: 'p2', name: 'Mia' }],
    seasonPlayers: [{ seasonId: 's1', playerId: 'p1' }, { seasonId: 's2', playerId: 'p1' }, { seasonId: 's1', playerId: 'p2' }],
    challenges: [{ id: 'ch', scores: { p1: 5, p2: 3 } }],
    convocations: [{ id: 'cv', responses: { p1: { status: 'present' }, p2: { status: 'absent' } } }],
    matches: [{ id: 'm', playerStats: { p1: {}, p2: {} } }],
  };
  const { api } = makeSandbox(state);
  api.removePlayer('p1');
  t('joueuse retirée du roster global', () => assert.deepStrictEqual(state.players.map(p => p.id), ['p2']));
  t('liens season_players de la joueuse retirés (toutes saisons)', () => {
    assert.deepStrictEqual(state.seasonPlayers.map(sp => sp.playerId), ['p2']);
  });
  t('scores défis / réponses convoc / stats match nettoyés', () => {
    assert.strictEqual(state.challenges[0].scores.p1, undefined);
    assert.strictEqual(state.convocations[0].responses.p1, undefined);
    assert.strictEqual(state.matches[0].playerStats.p1, undefined);
    assert.strictEqual(state.challenges[0].scores.p2, 3); // l'autre joueuse intacte
  });
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 6 — deleteMatch : match + convoc liée');
{
  const state = {
    matches: [{ id: 'm1', convocId: 'cv1' }, { id: 'm2', convocId: null }],
    convocations: [{ id: 'cv1', matchId: 'm1', type: 'match' }],
    view: { type: 'match', id: 'm1' },
  };
  const { api } = makeSandbox(state);
  api.deleteMatch('m1');
  t('match supprimé + sa convoc liée supprimée', () => {
    assert.deepStrictEqual(state.matches.map(m => m.id), ['m2']);
    assert.strictEqual(state.convocations.length, 0);
  });
}

console.log(`\n✅ ${pass} assertions OK — suppressions individuelles (saison/joueuse/match/entraînement).`);
