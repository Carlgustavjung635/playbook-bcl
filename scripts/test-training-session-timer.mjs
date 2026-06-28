// Test du chrono de session live d'entraînement (coach).
// Réimplémente la MACHINE À ÉTATS de index.html (sans DOM/audio/wakeLock), avec
// une horloge injectée `now`, et vérifie : transitions auto exo→reveal→exo,
// dernier exo→done, +temps, skip, pause/reprise (temps préservé hors pauses),
// dépassement (actual>planned), rattrapage backgrounding, log final.
// + garde-fous de présence du vrai code dans index.html.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN = 60000;

// --- Machine à états (miroir fidèle de window._liveSession + fonctions live*) ---
function makeSession(durationsMin, now0) {
  const exos = durationsMin.map((m, i) => ({ id: 'e' + i, title: 'Exo ' + (i + 1), plannedMs: m * MIN }));
  return {
    exos, idx: 0, phase: 'running',
    startedAt: now0, exoStartedAt: now0, endAt: now0 + exos[0].plannedMs, endedAt: 0,
    pausedAccumMs: 0, pauseStartedAt: 0, pausedRemaining: 0, results: [], stoppedEarly: false, finishedAt: 0,
  };
}
function recordCurrent(s, skipped, now) {
  const ex = s.exos[s.idx]; const end = s.endedAt || now;
  s.results.push({ title: ex.title, plannedMs: ex.plannedMs, actualMs: Math.max(0, end - s.exoStartedAt), skipped: !!skipped });
}
function finish(s, stoppedEarly, now) { s.phase = 'done'; s.stoppedEarly = !!stoppedEarly; s.finishedAt = now; }
function step(s, autostart, now) {
  s.idx++;
  if (s.idx >= s.exos.length) { finish(s, false, now); return; }
  s.endedAt = 0;
  if (autostart) { s.phase = 'running'; s.exoStartedAt = now; s.endAt = now + s.exos[s.idx].plannedMs; }
  else s.phase = 'reveal';
}
function exoEnded(s, now) {
  s.endedAt = now;
  const isLast = s.idx >= s.exos.length - 1;
  if (isLast) { recordCurrent(s, false, now); finish(s, false, now); return; }
  s.phase = 'reveal';
}
function tick(s, now) { if (s.phase === 'running' && now >= s.endAt) exoEnded(s, now); }
function advance(s, now) { recordCurrent(s, false, now); step(s, true, now); }
function skip(s, now) { s.endedAt = 0; recordCurrent(s, true, now); step(s, true, now); }
function addTime(s, min, now) {
  const add = min * MIN;
  if (s.phase === 'reveal') { s.phase = 'running'; s.endAt = now + add; s.endedAt = 0; }
  else if (s.phase === 'running') { s.endAt += add; }
}
function pause(s, now) { if (s.phase !== 'running') return; s.pausedRemaining = Math.max(0, s.endAt - now); s.pauseStartedAt = now; s.phase = 'paused'; }
function resume(s, now) { if (s.phase !== 'paused') return; s.pausedAccumMs += now - s.pauseStartedAt; s.pauseStartedAt = 0; s.endAt = now + s.pausedRemaining; s.phase = 'running'; }
function stop(s, now) { if (['running', 'paused', 'reveal'].includes(s.phase)) { if (!s.endedAt) s.endedAt = now; recordCurrent(s, false, now); } finish(s, true, now); }
function buildLog(s) {
  return {
    plannedMs: s.exos.reduce((a, e) => a + e.plannedMs, 0),
    actualMs: s.results.reduce((a, r) => a + r.actualMs, 0),
    exosTotal: s.exos.length, exosDone: s.results.filter(r => !r.skipped).length,
    skipped: s.results.filter(r => r.skipped).map(r => r.title), stoppedEarly: !!s.stoppedEarly,
  };
}
function elapsed(s, now) {
  const pausedNow = s.phase === 'paused' && s.pauseStartedAt ? now - s.pauseStartedAt : 0;
  return Math.max(0, now - s.startedAt - s.pausedAccumMs - pausedNow);
}

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }
const T0 = 1_800_000_000_000; // horloge de base fixe (déterministe)

console.log('SCÉNARIO 0 — code présent dans index.html');
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
t('moteur live présent (start/advance/skip/addTime/pause/resume/stop/close)', () => {
  ['function startLiveSession', 'function liveAdvance', 'function liveSkip', 'function liveAddTime',
   'function livePause', 'function liveResume', 'function liveStop', 'function closeLiveSession',
   'function _liveExoEnded', 'function _liveOnVisibility'].forEach(fn => assert.ok(html.includes(fn), 'manque ' + fn));
});
t('réutilise le moteur son chrono (playChronoSound/_chronoBeep, tension, flash)', () => {
  assert.ok(/_chronoBeep\(\)/.test(html) && /tensionTickFreq\(secLeft\)/.test(html) && /_chronoFlash\(\)/.test(html));
});
t('Wake Lock API câblé', () => assert.ok(/navigator\.wakeLock\.request\('screen'\)/.test(html)));
t('bouton « Démarrer la session live » sur le plan (coach)', () => assert.ok(/▶️ Démarrer la session live/.test(html) && /startLiveSession\('\$\{convocId\}'/.test(html)));
t('log local non synchronisé (K.sessionLogs)', () => assert.ok(/sessionLogs: 'pb8_session_logs'/.test(html)));

console.log('SCÉNARIO 1 — transition auto : exo termine → reveal du suivant');
t('à 0, exo non-dernier → phase reveal (pas de saut auto)', () => {
  const s = makeSession([15, 10, 20], T0);
  tick(s, T0 + 15 * MIN);
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.idx, 0); // on attend la décision coach
});
t('« OK lancer » → exo suivant en running, courant enregistré', () => {
  const s = makeSession([15, 10, 20], T0);
  tick(s, T0 + 15 * MIN);
  advance(s, T0 + 15 * MIN + 3000); // 3 s de décision
  assert.strictEqual(s.phase, 'running');
  assert.strictEqual(s.idx, 1);
  assert.strictEqual(s.results.length, 1);
  assert.strictEqual(s.results[0].actualMs, 15 * MIN, 'actual figé à l\'alarme, pas gonflé par la décision');
});

console.log('SCÉNARIO 2 — dernier exo → session terminée');
t('le dernier exo qui finit → done + enregistré', () => {
  const s = makeSession([5, 5], T0);
  tick(s, T0 + 5 * MIN); advance(s, T0 + 5 * MIN);   // exo1 fini, lance exo2
  tick(s, T0 + 10 * MIN);                              // exo2 fini → done
  assert.strictEqual(s.phase, 'done');
  assert.strictEqual(s.results.length, 2);
});

console.log('SCÉNARIO 3 — +temps (déborder)');
t('+2 min en running prolonge l\'exo courant', () => {
  const s = makeSession([10], T0);
  addTime(s, 2, T0 + 1 * MIN);
  assert.strictEqual(s.endAt, T0 + 10 * MIN + 2 * MIN);
  tick(s, T0 + 11 * MIN); assert.strictEqual(s.phase, 'running'); // pas encore fini
  tick(s, T0 + 12 * MIN); assert.strictEqual(s.phase, 'done');
});
t('+5 min depuis le reveal reprend l\'exo courant (running)', () => {
  const s = makeSession([10, 8], T0);
  tick(s, T0 + 10 * MIN);                 // → reveal
  addTime(s, 5, T0 + 10 * MIN + 2000);    // reprendre courant
  assert.strictEqual(s.phase, 'running');
  assert.strictEqual(s.idx, 0);
  assert.strictEqual(s.endAt, T0 + 10 * MIN + 2000 + 5 * MIN);
});

console.log('SCÉNARIO 4 — skip');
t('skip marque l\'exo skippé et lance le suivant', () => {
  const s = makeSession([15, 10], T0);
  skip(s, T0 + 4 * MIN);
  assert.strictEqual(s.results[0].skipped, true);
  assert.strictEqual(s.results[0].actualMs, 4 * MIN);
  assert.strictEqual(s.phase, 'running');
  assert.strictEqual(s.idx, 1);
});

console.log('SCÉNARIO 5 — pause / reprise (temps écoulé hors pauses)');
t('pause puis reprise : remaining préservé, écoulé exclut la pause', () => {
  const s = makeSession([10], T0);
  pause(s, T0 + 3 * MIN);                       // reste 7 min
  assert.strictEqual(s.pausedRemaining, 7 * MIN);
  assert.strictEqual(elapsed(s, T0 + 5 * MIN), 3 * MIN, 'écoulé gelé pendant la pause');
  resume(s, T0 + 5 * MIN);                       // 2 min de pause
  assert.strictEqual(s.endAt, T0 + 5 * MIN + 7 * MIN);
  assert.strictEqual(elapsed(s, T0 + 6 * MIN), 4 * MIN, 'la pause de 2 min ne compte pas');
});

console.log('SCÉNARIO 6 — dépassement (actual > planned)');
t('un exo qui dure plus longtemps que prévu enregistre le réel', () => {
  const s = makeSession([10, 10], T0);
  addTime(s, 5, T0 + 1 * MIN);          // prolonge → 15 min
  tick(s, T0 + 15 * MIN);               // reveal
  advance(s, T0 + 15 * MIN);
  assert.strictEqual(s.results[0].actualMs, 15 * MIN);
  assert.strictEqual(s.results[0].plannedMs, 10 * MIN); // dépassement +5
});

console.log('SCÉNARIO 7 — backgrounding : alarme rattrapée (un seul exo)');
t('tick longtemps après endAt → exoEnded une fois → reveal (pas de saut multiple)', () => {
  const s = makeSession([10, 10, 10], T0);
  tick(s, T0 + 35 * MIN);   // 25 min après la fin de l'exo 1 (app en arrière-plan)
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.idx, 0, 'se fige en reveal → un seul exo dépassé');
});

console.log('SCÉNARIO 8 — log final');
t('stop en cours → log avec réel/planifié, skipped, stoppedEarly', () => {
  const s = makeSession([10, 10, 10], T0);   // planifié 30 min
  skip(s, T0 + 2 * MIN);                       // exo1 skippé
  stop(s, T0 + 2 * MIN + 4 * MIN);             // arrêt pendant exo2 (4 min faites)
  const log = buildLog(s);
  assert.strictEqual(log.plannedMs, 30 * MIN);
  assert.strictEqual(log.actualMs, 2 * MIN + 4 * MIN); // skip(2) + exo2(4)
  assert.deepStrictEqual(log.skipped, ['Exo 1']);
  assert.strictEqual(log.exosDone, 1);          // exo2 compté fait, exo1 skippé
  assert.strictEqual(log.stoppedEarly, true);
});
t('session complète dans les temps → diff ~0', () => {
  const s = makeSession([5, 5], T0);
  tick(s, T0 + 5 * MIN); advance(s, T0 + 5 * MIN);
  tick(s, T0 + 10 * MIN);
  const log = buildLog(s);
  assert.strictEqual(log.actualMs, log.plannedMs);
  assert.strictEqual(log.stoppedEarly, false);
});

console.log(`\n✅ ${pass} assertions OK — chrono de session live d'entraînement.`);
