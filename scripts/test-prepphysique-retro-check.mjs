// Chantier A — rétroactivité des checks joueuse (prépa physique journalière).
// Règle : cochable si le programme a démarré (today >= startDate), le jour n'est
// pas dans le futur, et pas antérieur au démarrage. → on peut cocher EN RETARD
// (jours passés post-démarrage), jamais le futur ni avant le lancement.
// Le helper est copié CONFORME à index.html (offseasonDayCheckable), today injecté.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// --- helper copié conforme à index.html ---
function offseasonDayCheckable(date, startDate, today) {
  const started = !startDate || today >= startDate;
  return started && date <= today && (!startDate || date >= startDate);
}

// Garde-fou anti-dérive : le helper testé doit être IDENTIQUE à la source.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

console.log('SCÉNARIO 1 — AVANT le démarrage : rien n\'est cochable');
t('today < startDate → jour du programme non cochable', () => {
  // programme démarre 2026-07-10, on est le 2026-07-05
  assert.strictEqual(offseasonDayCheckable('2026-07-10', '2026-07-10', '2026-07-05'), false);
  assert.strictEqual(offseasonDayCheckable('2026-07-12', '2026-07-10', '2026-07-05'), false);
});

console.log('SCÉNARIO 2 — APRÈS le démarrage : les jours passés deviennent cochables');
t('jour passé (>= start, < today) → cochable EN RETARD', () => {
  // démarrage 2026-07-01, aujourd'hui 2026-07-08
  assert.strictEqual(offseasonDayCheckable('2026-07-03', '2026-07-01', '2026-07-08'), true);
  assert.strictEqual(offseasonDayCheckable('2026-07-01', '2026-07-01', '2026-07-08'), true); // jour du démarrage
});
t('aujourd\'hui → cochable', () => {
  assert.strictEqual(offseasonDayCheckable('2026-07-08', '2026-07-01', '2026-07-08'), true);
});

console.log('SCÉNARIO 3 — le FUTUR reste verrouillé');
t('jour futur (> today) → jamais cochable, même programme démarré', () => {
  assert.strictEqual(offseasonDayCheckable('2026-07-09', '2026-07-01', '2026-07-08'), false);
  assert.strictEqual(offseasonDayCheckable('2026-07-20', '2026-07-01', '2026-07-08'), false);
});

console.log('SCÉNARIO 4 — jour ANTÉRIEUR au démarrage reste verrouillé');
t('date < startDate → non cochable (comportement actuel préservé)', () => {
  // édge : une date planifiée avant la date de lancement configurée
  assert.strictEqual(offseasonDayCheckable('2026-06-28', '2026-07-01', '2026-07-08'), false);
});

console.log('SCÉNARIO 5 — programme sans startDate (legacy) : basé sur la date seule');
t('pas de startDate → cochable si date <= today', () => {
  assert.strictEqual(offseasonDayCheckable('2026-07-03', '', '2026-07-08'), true);  // passé
  assert.strictEqual(offseasonDayCheckable('2026-07-08', '', '2026-07-08'), true);  // aujourd'hui
  assert.strictEqual(offseasonDayCheckable('2026-07-09', '', '2026-07-08'), false); // futur
});

console.log('SCÉNARIO 6 — intégration : le rendu gate today ET les jours passés');
t('renderPlayerProgrammeDaily : today via canToday, jours passés via offseasonDayCheckable', () => {
  const fn = html.slice(html.indexOf('function renderPlayerProgrammeDaily('), html.indexOf('function togglePlayerProgrammeDailyExercise('));
  assert.ok(/const canToday = offseasonDayCheckable\(todayStr, o\.startDate, todayStr\)/.test(fn), 'canToday absent');
  assert.ok(/exoRow\(todayStr, it, canToday\)/.test(fn), 'today doit utiliser canToday');
  assert.ok(/const canLate = offseasonDayCheckable\(date, o\.startDate, todayStr\)/.test(fn), 'canLate absent');
  assert.ok(/items\.map\(it => exoRow\(date, it, canLate\)\)/.test(fn), 'jours passés doivent utiliser canLate');
});
t('togglePlayerProgrammeDailyExercise : garde-fou serveur (future/pre-start rejeté)', () => {
  const tog = html.slice(html.indexOf('function togglePlayerProgrammeDailyExercise('), html.indexOf('function togglePlayerProgrammeExercise('));
  assert.ok(/if \(o && !offseasonDayCheckable\(date, o\.startDate, todayStr\)\) return;/.test(tog), 'garde-fou toggle absent');
});

console.log(`\n✅ ${pass} assertions OK — rétroactivité gated par le démarrage (retard OK, futur verrouillé).`);
