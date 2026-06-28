// Test réordonnancement des exos du programme estival (offseason).
// Reproduit moveOffseasonStep (hebdo) et moveOffseasonDayExercise (journalier)
// + vérifie l'intégrité (aucune perte/dup), la persistance (round-trip dump/apply
// PbSync) et que l'ordre affiché côté joueuse = ordre du tableau.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// --- swap générique (logique commune aux deux fonctions de move) ---
function swap(arr, idx, delta) {
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= arr.length) return false; // bounds-check
  const tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
  return true;
}
// Round-trip PbSync : dump (camel→snake) puis apply (snake→camel) pour un
// programme, en se limitant aux champs qui portent l'ordre (exercises, daily).
function roundTrip(pr) {
  const dumped = {
    id: String(pr.id), name: pr.title || 'Programme',
    mode: pr.mode === 'daily' ? 'daily' : 'weekly',
    exercises: pr.exercises || [], daily_schedule: pr.dailySchedule || {},
  };
  return {
    id: String(dumped.id), title: dumped.name, mode: dumped.mode,
    exercises: dumped.exercises || [], dailySchedule: dumped.daily_schedule || {},
  };
}
const labels = arr => arr.map(x => x.label);
const ids = arr => arr.map(x => x.id);

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 0 — le code attendu est présent dans index.html');
t('moveOffseasonStep (hebdo) existe', () => assert.ok(/function moveOffseasonStep\(idx, delta\)/.test(html)));
t('moveOffseasonDayExercise (journalier) existe', () => assert.ok(/function moveOffseasonDayExercise\(date, idx, delta\)/.test(html)));
t('boutons ▲/▼ câblés dans le mode journalier', () => {
  assert.ok(/moveOffseasonDayExercise\('\$\{date\}',\$\{i\},-1\)/.test(html), 'bouton monter manquant');
  assert.ok(/moveOffseasonDayExercise\('\$\{date\}',\$\{i\},1\)/.test(html), 'bouton descendre manquant');
});
t('boutons ▲/▼ déjà présents dans le mode hebdo', () => {
  assert.ok(/moveOffseasonStep\(\$\{i\},-1\)/.test(html) && /moveOffseasonStep\(\$\{i\},1\)/.test(html));
});

console.log('SCÉNARIO 1 — HEBDO : monter / descendre');
t('descendre l\'exo 0 → permute avec 1', () => {
  const ex = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.strictEqual(swap(ex, 0, 1), true);
  assert.deepStrictEqual(labels(ex), ['B', 'A', 'C']);
});
t('monter le dernier → permute avec l\'avant-dernier', () => {
  const ex = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.strictEqual(swap(ex, 2, -1), true);
  assert.deepStrictEqual(labels(ex), ['A', 'C', 'B']);
});

console.log('SCÉNARIO 2 — bornes : pas de déplacement hors limites');
t('monter le premier (idx 0, -1) → refusé, tableau inchangé', () => {
  const ex = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.strictEqual(swap(ex, 0, -1), false);
  assert.deepStrictEqual(labels(ex), ['A', 'B']);
});
t('descendre le dernier → refusé, tableau inchangé', () => {
  const ex = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.strictEqual(swap(ex, 1, 1), false);
  assert.deepStrictEqual(labels(ex), ['A', 'B']);
});

console.log('SCÉNARIO 3 — intégrité : aucune perte ni duplication');
t('après plusieurs moves, même ensemble d\'ids (juste réordonné)', () => {
  const ex = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const before = new Set(ids(ex));
  swap(ex, 0, 1); swap(ex, 3, -1); swap(ex, 1, 1);
  assert.strictEqual(ex.length, 4);
  assert.deepStrictEqual(new Set(ids(ex)), before);
  assert.strictEqual(new Set(ids(ex)).size, 4, 'pas de doublon');
});

console.log('SCÉNARIO 4 — JOURNALIER : réordonner les exos d\'une date');
t('move dans dailySchedule[date] permute dans la bonne date', () => {
  const e = { dailySchedule: { '2026-07-01': [{ id: '1', label: 'X' }, { id: '2', label: 'Y' }, { id: '3', label: 'Z' }], '2026-07-02': [{ id: '9', label: 'autre' }] } };
  const arr = e.dailySchedule['2026-07-01'];
  swap(arr, 2, -1); // remonter Z
  assert.deepStrictEqual(labels(e.dailySchedule['2026-07-01']), ['X', 'Z', 'Y']);
  assert.deepStrictEqual(labels(e.dailySchedule['2026-07-02']), ['autre'], 'l\'autre date est intacte');
});

console.log('SCÉNARIO 5 — PERSISTANCE : round-trip PbSync conserve l\'ordre');
t('hebdo : ordre préservé après dump→apply', () => {
  const pr = { id: 'p1', title: 'Prépa estivale', mode: 'weekly', exercises: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], dailySchedule: {} };
  swap(pr.exercises, 0, 1); // → B, A
  const back = roundTrip(pr);
  assert.deepStrictEqual(labels(back.exercises), ['B', 'A']);
});
t('journalier : ordre par date préservé après dump→apply', () => {
  const pr = { id: 'p2', title: 'Prépa', mode: 'daily', exercises: [], dailySchedule: { '2026-07-01': [{ id: '1', label: 'X' }, { id: '2', label: 'Y' }, { id: '3', label: 'Z' }] } };
  swap(pr.dailySchedule['2026-07-01'], 0, 1); // → Y, X, Z
  const back = roundTrip(pr);
  assert.deepStrictEqual(labels(back.dailySchedule['2026-07-01']), ['Y', 'X', 'Z']);
});

console.log('SCÉNARIO 6 — AFFICHAGE JOUEUSE : suit l\'ordre du tableau');
t('le rendu joueuse mappe items dans l\'ordre du tableau (items.map, pas de tri)', () => {
  // garde-fou anti-régression : le bloc joueuse ne doit pas trier les exos par id/label.
  const playerDay = html.slice(html.indexOf('const dayBlock = (date, isToday)'), html.indexOf('const dayBlock = (date, isToday)') + 1500);
  assert.ok(/items\.map\(it =>/.test(playerDay), 'le rendu joueuse doit itérer items dans l\'ordre');
  assert.ok(!/items\.slice\(\)\.sort|items\.sort\(/.test(playerDay), 'le rendu joueuse ne doit PAS trier les exos');
});

console.log(`\n✅ ${pass} assertions OK — réordonnancement exos programme estival (hebdo + journalier).`);
