// Test des alertes ambiantes de déroulé d'entraînement (coach, sans overlay).
// Réimplémente la logique de _ambientCheck (transitions = début + durées cumulées,
// déclenchement quand wm < heure_de_fin <= now) avec horloge/watermark injectés.
// + garde-fous de présence du code + retrait du capture caméra (chantier B).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN = 60000;
const WINDOW = 3 * 3600000;
const T = 1_800_000_000_000; // "20:00" fictif

function transitions(startMs, exos) {
  const out = []; let t = startMs;
  for (let i = 0; i < exos.length; i++) { t += exos[i].plannedMs; out.push({ end: t, current: exos[i].title, next: exos[i + 1] ? exos[i + 1].title : null }); }
  return out;
}
function eligible(tr, now) { return !!tr.time && !tr.closed && tr.exos.length > 0 && tr.startMs <= now && now - tr.startMs <= WINDOW; }
function check(trainings, wm, now) {
  const fired = [];
  trainings.filter(tr => eligible(tr, now)).forEach(tr =>
    transitions(tr.startMs, tr.exos).forEach(x => { if (x.end > wm && x.end <= now) fired.push({ current: x.current, next: x.next }); }));
  return fired;
}
const mk = (over, exosMin) => ({ time: '20:00', closed: false, startMs: T, exos: exosMin.map((m, i) => ({ title: 'Exo ' + (i + 1), plannedMs: m * MIN })), ...over });

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 0 — code présent dans index.html');
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
t('moteur ambiant (_ambientCheck/_ambientStart/_ambientFireAlert/watermark)', () => {
  ['function _ambientCheck', 'function _ambientStart', 'function _ambientFireAlert', 'function _ambientTrainingsToday', 'window._ambientWatermark'].forEach(s => assert.ok(html.includes(s), 'manque ' + s));
});
t('check chaque minute (60000) + démarré au boot + rattrapage visibilitychange', () => {
  assert.ok(/setInterval\(\(\) => \{ try \{ _ambientCheck\(\); \} catch \(e\) \{\} \}, 60000\)/.test(html));
  assert.ok(/try \{ _ambientStart\(\); \} catch/.test(html));
  assert.ok(/try \{ _ambientCheck\(\); \} catch \(e\) \{\} \/\/ rattrape/.test(html));
});
t('gate coach + plan read-only + son chrono + anti-doublon session live', () => {
  assert.ok(/state\.auth\.role === 'coach'/.test(html));
  assert.ok(/getTrainingPlan\(c\.id, inst\.date\)/.test(html));
  assert.ok(/playChronoSound\(getChronoSound\(\)\)/.test(html));
  assert.ok(/if \(window\._liveSession\) \{ window\._ambientWatermark = Date\.now\(\); return; \}/.test(html));
});
t('bannière HAUT auto-dismiss 10s', () => assert.ok(/ambient-alert/.test(html) && /\}, 10000\)/.test(html)));

console.log('SCÉNARIO 1 — transitions dérivées de l\'heure de début');
t('20:00 + exos 20/15 → fins à +20min (exo2) et +35min (fin)', () => {
  const tr = transitions(T, mk({}, [20, 15]).exos);
  assert.strictEqual(tr[0].end, T + 20 * MIN); assert.strictEqual(tr[0].next, 'Exo 2');
  assert.strictEqual(tr[1].end, T + 35 * MIN); assert.strictEqual(tr[1].next, null); // dernier → fin de séance
});

console.log('SCÉNARIO 2 — déclenchement quand l\'horloge franchit une transition');
t('now franchit 20:20 → 1 alerte (termine exo1, passe à exo2)', () => {
  const trs = [mk({}, [20, 15])];
  const fired = check(trs, T + 19 * MIN, T + 20 * MIN + 5000); // wm avant, now juste après
  assert.strictEqual(fired.length, 1);
  assert.deepStrictEqual(fired[0], { current: 'Exo 1', next: 'Exo 2' });
});
t('rien à 20:10 (aucune transition encore franchie)', () => {
  assert.strictEqual(check([mk({}, [20, 15])], T, T + 10 * MIN).length, 0);
});
t('watermark avance → pas de re-déclenchement à la minute suivante', () => {
  const trs = [mk({}, [20, 15])];
  const now1 = T + 20 * MIN + 5000;
  assert.strictEqual(check(trs, T + 19 * MIN, now1).length, 1);  // 1er passage
  assert.strictEqual(check(trs, now1, now1 + 60000).length, 0);  // wm=now1 → plus rien
});

console.log('SCÉNARIO 3 — boot : ne rejoue pas les transitions déjà passées');
t('watermark = now au boot → aucune alerte rétroactive', () => {
  const now = T + 40 * MIN; // séance déjà bien avancée
  assert.strictEqual(check([mk({}, [20, 15])], now, now).length, 0);
});

console.log('SCÉNARIO 4 — rattrapage arrière-plan (transitions franchies pendant l\'absence)');
t('retour après 2 transitions → les 2 alertes remontent', () => {
  const fired = check([mk({}, [20, 15])], T + 5 * MIN, T + 40 * MIN); // wm avant tout, now après tout
  assert.strictEqual(fired.length, 2);
  assert.strictEqual(fired[1].next, null); // dernière = fin de séance
});

console.log('SCÉNARIO 5 — éligibilité');
t('entraînement pas encore commencé (début futur) → ignoré', () => {
  assert.strictEqual(check([mk({ startMs: T + 30 * MIN }, [20])], T - 60000, T + 10 * MIN).length, 0);
});
t('commencé depuis > 3h → hors fenêtre, ignoré', () => {
  const now = T + 4 * 3600000;
  assert.strictEqual(check([mk({}, [20])], T, now).length, 0);
});
t('clôturé ou sans exo → ignoré', () => {
  assert.strictEqual(check([mk({ closed: true }, [20])], T + 19 * MIN, T + 21 * MIN).length, 0);
  assert.strictEqual(check([mk({}, [])], T + 19 * MIN, T + 21 * MIN).length, 0);
});
t('deux entraînements (E1/E2) le même jour → surveillés tous les deux', () => {
  const e1 = mk({}, [20]);                              // fin T+20
  const e2 = mk({ startMs: T + 5 * MIN }, [10]);        // fin T+15
  const fired = check([e1, e2], T, T + 25 * MIN);
  assert.strictEqual(fired.length, 2);
});

console.log('SCÉNARIO 6 — chantier B : photo profil joueuse caméra OU galerie');
t('plus aucun capture="user" (l\'OS propose Caméra / Bibliothèque)', () => {
  assert.ok(!/capture="user"/.test(html), 'capture="user" est revenu : la galerie serait interdite');
  assert.ok(/onchange="changeMyPhoto\(event\)"/.test(html), 'input photo joueuse présent');
  // L'assertion couvrait à l'origine TOUT le fichier, parce qu'il n'y avait
  // alors qu'un seul <input type="file"> image. Depuis la v.106, la preuve de
  // pintade en a un second, et celui-là DOIT forcer l'appareil photo : une
  // photo tirée de la galerie n'est pas une preuve. On garde donc la règle —
  // aucun input ne force la caméra — avec cette exception nommée, plutôt que de
  // laisser la garde s'éteindre pour tout le monde.
  const captures = [...html.matchAll(/<input[^>]*capture="[^"]*"[^>]*>/g)].map(m => m[0]);
  captures.forEach(tag => {
    assert.ok(/submitPintadeProof\(event\)/.test(tag),
      'un input force la caméra sans être la preuve de pintade : ' + tag.slice(0, 160));
  });
  assert.strictEqual(captures.length, 1, 'exactement un input caméra-only attendu (la preuve de pintade)');
});
t('bouton session live relabel « option » (le défaut = alertes ambiantes)', () => {
  assert.ok(/Mode session live plein écran \(option\)/.test(html));
  assert.ok(/se déclenchent déjà automatiquement/.test(html));
});

console.log(`\n✅ ${pass} assertions OK — alertes ambiantes + photo caméra/galerie.`);
