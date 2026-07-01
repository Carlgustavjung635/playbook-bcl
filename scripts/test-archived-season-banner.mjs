// Test de la bannière « saison archivée » (au lieu du masquage silencieux) et de
// la réactivation. Exécute _archivedSeasonBanner + reactivateCurrentSeason.
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

const src = [extractFn(html, '_archivedSeasonBanner'), extractFn(html, 'reactivateCurrentSeason')].join('\n\n');
function make(state, curStatus, confirmReturn = true) {
  const cur = state.currentSeasonId ? (state.seasons || []).find(s => s.id === state.currentSeasonId) : null;
  const log = { rendered: 0, persisted: 0, reopened: null };
  const api = new Function('state', 'getCurrentSeason', 'esc', 'confirm', 'persist', 'render', 'openEffectif', 'closeModal', 'openSeasonsModal',
    src + '\nreturn { _archivedSeasonBanner, reactivateCurrentSeason };'
  )(state, () => cur, s => String(s), () => confirmReturn, () => log.persisted++, () => log.rendered++, tab => { log.reopened = tab; }, () => {}, () => {});
  return { api, log };
}

console.log('SCÉNARIO 1 — bannière conditionnelle');
{
  const state = { currentSeasonId: 's1', seasons: [{ id: 's1', name: 'Saison 25-26', status: 'archived' }] };
  const { api } = make(state, 'archived');
  const b = api._archivedSeasonBanner();
  t('archivée → bannière explicite (titre + réactiver + autre saison)', () => {
    assert.ok(/Cette saison est archivée/.test(b));
    assert.ok(/reactivateCurrentSeason\(\)/.test(b));
    assert.ok(/openSeasonsModal\(\)/.test(b));
  });
}
{
  const state = { currentSeasonId: 's1', seasons: [{ id: 's1', name: 'X', status: 'active' }] };
  t('active → pas de bannière', () => assert.strictEqual(make(state, 'active').api._archivedSeasonBanner(), ''));
}
{
  const state = { currentSeasonId: 's1', seasons: [{ id: 's1', name: 'X', status: 'draft' }] };
  t('draft → pas de bannière', () => assert.strictEqual(make(state, 'draft').api._archivedSeasonBanner(), ''));
}

console.log('SCÉNARIO 2 — réactivation');
{
  const state = { currentSeasonId: 's1', seasons: [
    { id: 's1', name: 'Vieille', status: 'archived' },
    { id: 's2', name: 'Active', status: 'active' },
  ] };
  const { api, log } = make(state, 'archived', true);
  api.reactivateCurrentSeason();
  t('archived → active, l\'autre active → archivée, persist + render', () => {
    assert.strictEqual(state.seasons.find(s => s.id === 's1').status, 'active');
    assert.strictEqual(state.seasons.find(s => s.id === 's2').status, 'archived');
    assert.strictEqual(state.currentSeasonId, 's1');
    assert.ok(log.persisted >= 1 && log.rendered >= 1);
  });
}
{
  const state = { currentSeasonId: 's1', seasons: [{ id: 's1', name: 'V', status: 'archived' }] };
  make(state, 'archived', false).api.reactivateCurrentSeason();
  t('confirm refusé → no-op', () => assert.strictEqual(state.seasons[0].status, 'archived'));
}

console.log('SCÉNARIO 3 — câblage : boutons désactivés + bannières placées');
t('_effectifSeasonBody : bannière + boutons désactivés si readOnly', () => {
  const b = extractFn(html, '_effectifSeasonBody');
  assert.ok(/_archivedSeasonBanner\(\)/.test(b));
  assert.ok(/readOnly \? `[\s\S]*disabled[\s\S]*Ajouter joueuse[\s\S]*disabled[\s\S]*Créer une nouvelle/.test(b));
});
t('renderPlays affiche aussi la bannière (coach)', () => {
  const r = extractFn(html, 'renderPlays');
  assert.ok(/isCoach \? `<div[^`]*_archivedSeasonBanner\(\)/.test(r));
});

console.log(`\n✅ ${pass} assertions OK — bannière archivée + réactivation.`);
