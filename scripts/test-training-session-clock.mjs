// Test du chrono de session live CLOCK-BASED (basé sur l'heure réelle).
// Réimplémente la machine à états de index.html avec une horloge INJECTÉE `now`
// (pas de timer interne) et vérifie : heures de fin dérivées de T0, décompte =
// due - now, alarme quand now >= due, pause = décalage, +X = décalage, skip =
// avance, rattrapage arrière-plan trivial, offset live, log final.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN = 60000;
const T0 = 1_800_000_000_000; // base d'horloge fixe (déterministe)

// --- Machine à états clock-based (miroir de window._liveSession) ---
function makeSession(durMin, t0) {
  const exos = durMin.map((m, i) => ({ id: 'e' + i, title: 'Exo ' + (i + 1), plannedMs: m * MIN }));
  return { exos, idx: 0, phase: 'running', T0: t0, exoStartedAt: t0, curEndAt: t0 + exos[0].plannedMs, pauseStartedAt: 0, results: [], stoppedEarly: false, finishedAt: 0 };
}
const effEnd = (s, now) => (s.phase === 'paused' && s.pauseStartedAt) ? s.curEndAt + (now - s.pauseStartedAt) : s.curEndAt;
function dueOf(s, i, now) { if (i < s.idx) return s.results[i] ? s.results[i].endClock : null; let t = effEnd(s, now); for (let k = s.idx + 1; k <= i; k++) t += s.exos[k].plannedMs; return t; }
function projectedEnd(s, now) { let t = effEnd(s, now); for (let k = s.idx + 1; k < s.exos.length; k++) t += s.exos[k].plannedMs; return t; }
const plannedEnd = s => s.T0 + s.exos.reduce((a, e) => a + e.plannedMs, 0);
const offset = (s, now) => projectedEnd(s, now) - plannedEnd(s);
const remaining = (s, now) => s.phase === 'paused' ? Math.max(0, s.curEndAt - s.pauseStartedAt) : Math.max(0, s.curEndAt - now);
function recordCurrent(s, skipped, endClock) { const ex = s.exos[s.idx]; s.results[s.idx] = { title: ex.title, plannedMs: ex.plannedMs, actualMs: Math.max(0, endClock - s.exoStartedAt), endClock, skipped: !!skipped }; }
function finish(s, stopped, now) { s.phase = 'done'; s.stoppedEarly = !!stopped; s.finishedAt = now; }
function step(s, from) { s.idx++; if (s.idx >= s.exos.length) { finish(s, false, from); return; } s.phase = 'running'; s.exoStartedAt = from; s.curEndAt = from + s.exos[s.idx].plannedMs; }
function exoEnded(s, now) { const last = s.idx >= s.exos.length - 1; if (last) { recordCurrent(s, false, s.curEndAt); finish(s, false, now); return; } s.phase = 'reveal'; }
function tick(s, now) { if (s.phase === 'running' && now >= s.curEndAt) exoEnded(s, now); }
function advance(s, now) { recordCurrent(s, false, s.curEndAt); step(s, now); }
function skip(s, now) { recordCurrent(s, true, now); step(s, now); }
function addTime(s, min, now) { const add = min * MIN; if (s.phase === 'reveal') { s.phase = 'running'; s.curEndAt = now + add; } else if (s.phase === 'running') { s.curEndAt += add; } }
function pause(s, now) { if (s.phase !== 'running') return; s.pauseStartedAt = now; s.phase = 'paused'; }
function resume(s, now) { if (s.phase !== 'paused') return; const shift = now - s.pauseStartedAt; s.curEndAt += shift; s.exoStartedAt += shift; s.pauseStartedAt = 0; s.phase = 'running'; }
function stop(s, now) { if (['running', 'paused', 'reveal'].includes(s.phase)) recordCurrent(s, false, now); finish(s, true, now); }

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 0 — code clock-based présent dans index.html');
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
t('state clock-based (T0 / curEndAt, plus de endAt/elapsed)', () => {
  assert.ok(/T0: now/.test(html) && /curEndAt: now \+/.test(html));
  assert.ok(!/startedAt: now, exoStartedAt: now, endAt:/.test(html), 'ancien state freerunning résiduel');
});
t('helpers heure : _liveClock / _liveDueOf / _liveProjectedEnd / _liveOffset', () => {
  ['function _liveClock', 'function _liveDueOf', 'function _liveProjectedEnd', 'function _liveOffset'].forEach(fn => assert.ok(html.includes(fn), 'manque ' + fn));
});
t('décompte recalculé chaque seconde (setInterval 1000)', () => assert.ok(/setInterval\(_liveTick, 1000\)/.test(html)));
t('alarme quand now >= dueTime (curEndAt - now <= 0)', () => assert.ok(/s\.curEndAt - now/.test(html)));
t('UI affiche heures de transition + offset', () => {
  assert.ok(/Termine à /.test(html) && /vs planning/.test(html) && /→ \$\{clock\}/.test(html));
});

console.log('SCÉNARIO 1 — heures de fin dérivées de T0');
t('exos 15/20/30 → fins T0+15 / +35 / +65 min', () => {
  const s = makeSession([15, 20, 30], T0);
  assert.strictEqual(dueOf(s, 0, T0), T0 + 15 * MIN);
  assert.strictEqual(dueOf(s, 1, T0), T0 + 35 * MIN);
  assert.strictEqual(dueOf(s, 2, T0), T0 + 65 * MIN);
  assert.strictEqual(projectedEnd(s, T0), T0 + 65 * MIN);
  assert.strictEqual(offset(s, T0), 0);
});

console.log('SCÉNARIO 2 — décompte = due - now (horloge)');
t('à T0+3min sur un exo de 15min → reste 12min', () => {
  const s = makeSession([15], T0);
  assert.strictEqual(remaining(s, T0 + 3 * MIN), 12 * MIN);
});

console.log('SCÉNARIO 3 — alarme quand now >= due');
t('tick à l\'heure de fin (non dernier) → reveal', () => {
  const s = makeSession([15, 20], T0);
  tick(s, T0 + 15 * MIN);
  assert.strictEqual(s.phase, 'reveal'); assert.strictEqual(s.idx, 0);
});
t('« OK lancer » à +3s : exo0 figé à son heure prévue, suite décalée de 3s', () => {
  const s = makeSession([15, 20, 30], T0);
  tick(s, T0 + 15 * MIN);
  advance(s, T0 + 15 * MIN + 3000);
  assert.strictEqual(s.idx, 1);
  assert.strictEqual(s.results[0].endClock, T0 + 15 * MIN);   // figé à l'heure de fin
  assert.strictEqual(s.results[0].actualMs, 15 * MIN);
  assert.strictEqual(dueOf(s, 1, T0 + 15 * MIN + 3000), T0 + 35 * MIN + 3000); // décalé du délai de décision
  assert.strictEqual(offset(s, T0 + 15 * MIN + 3000), 3000);
});

console.log('SCÉNARIO 4 — PAUSE = décalage de l\'horloge');
t('pendant la pause, l\'offset reflète la pause en cours', () => {
  const s = makeSession([15, 20, 30], T0);
  pause(s, T0 + 5 * MIN);
  assert.strictEqual(offset(s, T0 + 7 * MIN), 2 * MIN);          // 2 min de pause écoulées
  assert.strictEqual(dueOf(s, 0, T0 + 7 * MIN), T0 + 17 * MIN);   // fin courante repoussée
});
t('reprise : curEndAt + toutes les fins futures décalées de la pause', () => {
  const s = makeSession([15, 20, 30], T0);
  pause(s, T0 + 5 * MIN); resume(s, T0 + 8 * MIN);                // pause de 3 min
  assert.strictEqual(s.curEndAt, T0 + 18 * MIN);
  assert.strictEqual(dueOf(s, 1, T0 + 8 * MIN), T0 + 38 * MIN);   // +3 min
  assert.strictEqual(offset(s, T0 + 8 * MIN), 3 * MIN);
  assert.strictEqual(s.results[0], undefined);                   // exo0 toujours en cours
});

console.log('SCÉNARIO 5 — +X min = décalage des transitions futures');
t('+5 min repousse la fin courante ET la suite', () => {
  const s = makeSession([15, 20, 30], T0);
  addTime(s, 5, T0 + 2 * MIN);
  assert.strictEqual(s.curEndAt, T0 + 20 * MIN);
  assert.strictEqual(dueOf(s, 1, T0 + 2 * MIN), T0 + 40 * MIN);
  assert.strictEqual(offset(s, T0 + 2 * MIN), 5 * MIN);
});
t('+5 depuis le reveal reprend l\'exo courant', () => {
  const s = makeSession([15, 20], T0);
  tick(s, T0 + 15 * MIN);
  addTime(s, 5, T0 + 15 * MIN + 1000);
  assert.strictEqual(s.phase, 'running'); assert.strictEqual(s.idx, 0);
  assert.strictEqual(s.curEndAt, T0 + 15 * MIN + 1000 + 5 * MIN);
});

console.log('SCÉNARIO 6 — SKIP = avance (raccourcit la session)');
t('skip à 5 min d\'un exo de 15 → suite avancée, offset négatif', () => {
  const s = makeSession([15, 20, 30], T0);
  skip(s, T0 + 5 * MIN);
  assert.strictEqual(s.results[0].skipped, true);
  assert.strictEqual(s.idx, 1);
  assert.strictEqual(s.curEndAt, T0 + 25 * MIN);                  // 5 + 20
  assert.strictEqual(projectedEnd(s, T0 + 5 * MIN), T0 + 55 * MIN);
  assert.strictEqual(offset(s, T0 + 5 * MIN), -10 * MIN);         // 10 min gagnées
});

console.log('SCÉNARIO 7 — rattrapage arrière-plan TRIVIAL (clock-based)');
t('tick longtemps après la fin → alarme rattrapée, reveal (un seul exo)', () => {
  const s = makeSession([10, 10, 10], T0);
  tick(s, T0 + 47 * MIN);  // app en arrière-plan bien au-delà de la fin de l'exo 1
  assert.strictEqual(s.phase, 'reveal'); assert.strictEqual(s.idx, 0);
  // le reste est juste sans hack : remaining serait 0 (clampé), pas de dérive
  assert.strictEqual(remaining(makeSession([10], T0), T0 + 30 * MIN), 0);
});

console.log('SCÉNARIO 8 — log final (réel mur vs planifié)');
t('stop en cours : réel = finishedAt - T0, skipped listés, stoppedEarly', () => {
  const s = makeSession([10, 10, 10], T0);    // planifié 30 min
  skip(s, T0 + 2 * MIN);                        // exo0 skippé → exo1 à T0+2
  stop(s, T0 + 6 * MIN);                        // stop 6 min après T0
  const realMs = s.finishedAt - s.T0;
  assert.strictEqual(realMs, 6 * MIN);
  assert.strictEqual(plannedEnd(s) - s.T0, 30 * MIN);
  assert.deepStrictEqual(s.results.filter(Boolean).filter(r => r.skipped).map(r => r.title), ['Exo 1']);
  assert.strictEqual(s.stoppedEarly, true);
});
t('session complète à l\'heure pile → réel = planifié', () => {
  const s = makeSession([5, 5], T0);
  tick(s, T0 + 5 * MIN); advance(s, T0 + 5 * MIN);   // pas de délai → pile
  tick(s, T0 + 10 * MIN);
  assert.strictEqual(s.phase, 'done');
  assert.strictEqual(s.finishedAt - s.T0, 10 * MIN);
});

console.log(`\n✅ ${pass} assertions OK — session live CLOCK-BASED (heure réelle).`);
