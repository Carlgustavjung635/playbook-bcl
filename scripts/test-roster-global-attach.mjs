// Test du bouton « + Ajouter / ↺ Réintégrer » sur l'onglet Roster global de
// l'écran Effectif : rattache une joueuse hors-saison à la saison en cours.
// Exécute _effectifRosterBody (rendu conditionnel) + attachPlayerToCurrentSeason.
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

const players = [
  { id: 'p1', name: 'Lea', num: 7, pin: '1' },      // dans la saison
  { id: 'p2', name: 'Candice', num: 9, pin: '0000' }, // jamais liée
  { id: 'p3', name: 'Zoe', num: 5, pin: '1' },        // partie (leftAt)
];
const seasonPlayers = [
  { seasonId: 's1', playerId: 'p1', leftAt: '' },
  { seasonId: 's1', playerId: 'p3', leftAt: '2025-01-01' },
];
function renderRoster(state, cur) {
  const body = extractFn(html, '_effectifRosterBody');
  return new Function('state', 'esc', '_lastSeenBadge', 'getCurrentSeason',
    body + '\nreturn _effectifRosterBody();'
  )(state, s => String(s).replace(/'/g, '&#39;'), () => ({ color: '#888', dot: 'o', label: 'vue' }), () => cur);
}

console.log('SCÉNARIO 1 — saison active : boutons contextuels');
{
  const out = renderRoster({ currentSeasonId: 's1', players, seasonPlayers }, { id: 's1', status: 'active' })
    .replace(/&#39;/g, "'");
  t('Candice (jamais liée) → bouton « + Ajouter » actif vers attachPlayerToCurrentSeason', () => {
    assert.ok(/attachPlayerToCurrentSeason\('p2'\)[^>]*>\+ Ajouter/.test(out));
  });
  t('Zoe (partie, leftAt) → bouton « ↺ Réintégrer » (pas « + Ajouter »)', () => {
    assert.ok(/attachPlayerToCurrentSeason\('p3'\)[^>]*>↺ Réintégrer/.test(out));
  });
  t('Lea (déjà dans la saison) → AUCUN bouton d\'attache', () => {
    assert.ok(!/attachPlayerToCurrentSeason\('p1'\)/.test(out));
  });
  t('le bouton actif n\'est pas désactivé', () => {
    assert.ok(!/attachPlayerToCurrentSeason\('p2'\)[^`]*disabled/.test(out));
  });
}

console.log('SCÉNARIO 2 — saison archivée : bouton grisé + tooltip');
{
  const out = renderRoster({ currentSeasonId: 's1', players, seasonPlayers }, { id: 's1', status: 'archived' });
  t('bouton présent mais disabled + tooltip « Saison archivée »', () => {
    assert.ok(/disabled[^>]*title="Saison archivée/.test(out));
    assert.ok(!out.includes('attachPlayerToCurrentSeason('), 'aucun onclick actif en archivée');
  });
}

console.log('SCÉNARIO 3 — aucune saison courante : bouton grisé + tooltip');
{
  const out = renderRoster({ currentSeasonId: null, players, seasonPlayers: [] }, null);
  t('bouton disabled + tooltip « Aucune saison courante »', () => {
    assert.ok(/disabled[^>]*title="Aucune saison courante"/.test(out));
  });
}

console.log('SCÉNARIO 4 — attachPlayerToCurrentSeason : crée le lien + toast + reste sur roster');
{
  const src = [extractFn(html, '_editableCurrentSeasonId'), extractFn(html, 'autoLinkPlayerToCurrentSeason'), extractFn(html, 'attachPlayerToCurrentSeason')].join('\n\n');
  const state = { currentSeasonId: 's1', players, seasonPlayers: [{ seasonId: 's1', playerId: 'p1', leftAt: '' }] };
  const log = { toasts: [], reopened: null, persisted: 0 };
  const api = new Function('state', 'getCurrentSeason', 'isoDate', 'persist', 'showToast', 'openEffectif',
    src + '\nreturn { attachPlayerToCurrentSeason };'
  )(state, () => ({ id: 's1', status: 'active' }), () => '2026-07-01', () => log.persisted++, m => log.toasts.push(m), tab => { log.reopened = tab; });
  api.attachPlayerToCurrentSeason('p2');
  t('lien créé pour Candice (active, leftAt vide, e1)', () => {
    const link = state.seasonPlayers.find(sp => sp.playerId === 'p2');
    assert.ok(link && link.leftAt === '' && link.teamTag === 'e1' && link.seasonId === 's1');
  });
  t('toast de confirmation avec le nom', () => assert.ok(log.toasts.some(m => /Candice/.test(m) && /ajoutée à la saison/.test(m))));
  t('reste sur l\'onglet Roster (openEffectif roster) + persist', () => {
    assert.strictEqual(log.reopened, 'roster');
    assert.ok(log.persisted >= 1);
  });
}
{
  // Réintégration d'une joueuse partie : idempotent (leftAt vidé, pas de doublon).
  const src = [extractFn(html, '_editableCurrentSeasonId'), extractFn(html, 'autoLinkPlayerToCurrentSeason'), extractFn(html, 'attachPlayerToCurrentSeason')].join('\n\n');
  const state = { currentSeasonId: 's1', players, seasonPlayers: [{ seasonId: 's1', playerId: 'p3', leftAt: '2025-01-01', teamTag: 'e1' }] };
  new Function('state', 'getCurrentSeason', 'isoDate', 'persist', 'showToast', 'openEffectif',
    src + '\nreturn { attachPlayerToCurrentSeason };'
  )(state, () => ({ id: 's1', status: 'active' }), () => '2026-07-01', () => {}, () => {}, () => {}).attachPlayerToCurrentSeason('p3');
  t('Zoe réintégrée : leftAt vidé, un seul lien (pas de doublon)', () => {
    const links = state.seasonPlayers.filter(sp => sp.playerId === 'p3');
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].leftAt, '');
  });
}

console.log(`\n✅ ${pass} assertions OK — bouton rattacher joueuse (Roster global).`);
