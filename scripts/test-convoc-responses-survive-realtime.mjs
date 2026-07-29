// Test SYNC RSVP — les absences survivent à un événement realtime sur `convocations`.
//
// INCIDENT (2026-07-29) : « je ne vois plus l'absence d'Ophélie ». Les 2 lignes
// étaient intactes en base, et l'écran convoc les affiche correctement quand on
// lui donne la bonne donnée. Le trou était dans la SYNC.
//
// Les RSVP ne vivent pas dans `convocations` mais dans `convocation_responses` :
// deux entités PbSync distinctes, donc deux canaux realtime indépendants. Or
// subscribeAll rejoue UNIQUEMENT l'entité qui a changé. L'apply de
// `convocations` reconduisait les RSVP depuis le seul état local — ce qui marche
// tant que le client connaît déjà la convocation, mais tombe à {} dès que la
// ligne lui est INCONNUE. C'est exactement ce que produit un dédoublonnage : la
// survivante peut être un id que ce client n'avait pas en cache. Les RSVP
// disparaissaient alors de l'écran jusqu'au prochain rechargement complet.
//
// Les apply vivent dans le bloc <script type="module"> : on les extrait du
// source et on les évalue à part (même approche que test-training-programs §8).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

// Extrait une fonction nommée (comptage d'accolades).
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') { depth++; began = true; }
    else if (html[j] === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

// Extrait le corps de `apply:` de l'entité `key` (comptage d'accolades).
function extractApply(key) {
  const anchor = html.indexOf("key: '" + key + "'");
  assert.ok(anchor >= 0, 'entité introuvable : ' + key);
  const ai = html.indexOf('apply:', anchor);
  assert.ok(ai >= 0, 'apply introuvable pour ' + key);
  const open = html.indexOf('{', html.indexOf('=>', ai));
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(ai + 'apply:'.length, j + 1).trim(); }
  }
  throw new Error('accolades non équilibrées : ' + key);
}

// Reconstruit les deux apply dans une portée partageant _lastConvocResponses,
// exactement comme dans le bloc module.
const factory = new Function(`
  const _lastConvocResponses = {};
  ${extractFn('_mergeInstanceOverrides')}
  const applyConvocs = ${extractApply('convocations')};
  const applyResponses = ${extractApply('convocationResponses')};
  return { applyConvocs, applyResponses, _lastConvocResponses };
`);

const CONVOC_ROW = {
  id: 'x1783000115781tmq1', type: 'match', title: 'vs Rejaumont (amical)', date: '2026-09-09',
  time: '19:30', location: null, note: null, recurrence: null, cancelled_instances: [],
  instance_overrides: {}, attachments: [], season_id: '2026-2027', team_tag: 'e1', closed: false,
};
const RESP_ROW = {
  convocation_id: 'x1783000115781tmq1', player_id: 'pA', instance_date: '2026-09-09',
  status: 'absent', reason: 'Blessure', late_minutes: null,
  updated_at: '2026-07-29T07:46:18.651826+00:00',
};
const conv = (state) => state.convocations.find(c => c.id === 'x1783000115781tmq1');

// --- 1) le chemin nominal ---------------------------------------------------
t('fetchAll : convocations puis responses → l\'absence est là', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  ok(conv(state).responses.pA, 'RSVP absent');
  ok(conv(state).responses.pA.status === 'absent', 'statut = ' + conv(state).responses.pA.status);
  ok(conv(state).responses.pA.reason === 'Blessure', 'motif perdu');
});
t('l\'horodatage est reconstruit depuis updated_at (feed coach)', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  ok(Number.isFinite(conv(state).responses.pA.at), 'at non reconstruit');
});

// --- 2) LE BUG : realtime sur `convocations` SEUL ---------------------------
t('realtime convocations seul : l\'absence survit (convoc déjà connue)', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  api.applyConvocs(state, [CONVOC_ROW]);          // événement realtime, responses PAS rejouées
  ok(conv(state).responses.pA, 'RSVP effacé par un simple refetch de convocations');
});
t('LE CAS RÉEL : la convoc est INCONNUE du client → l\'absence survit quand même', () => {
  // Après dédoublonnage, la survivante peut être un id que ce client n'avait pas.
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  // Le client perd la ligne de son état local (dédoublonnage / purge / autre id)
  state.convocations = [];
  api.applyConvocs(state, [CONVOC_ROW]);          // realtime : la ligne « revient »
  ok(conv(state), 'convocation absente après refetch');
  ok(conv(state).responses.pA, 'RSVP perdu — c\'est le bug d\'origine');
  ok(conv(state).responses.pA.reason === 'Blessure', 'motif perdu');
});
t('le relais n\'invente rien : convoc jamais vue → responses vides', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [{ ...CONVOC_ROW, id: 'xJamaisVue' }]);
  ok(JSON.stringify(state.convocations[0].responses) === '{}', 'RSVP fabriqués : ' + JSON.stringify(state.convocations[0].responses));
});

// --- 3) l'état local reste prioritaire (écriture locale non flushée) --------
t('un RSVP posé en local n\'est pas écrasé par le relais', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  // la joueuse revient sur sa décision, pas encore flushé
  conv(state).responses.pA = { status: 'present', reason: '', at: 9e12 };
  api.applyConvocs(state, [CONVOC_ROW]);
  ok(conv(state).responses.pA.status === 'present', 'écriture locale écrasée : ' + conv(state).responses.pA.status);
});

// --- 4) le relais suit les mises à jour --------------------------------------
t('le relais reflète le dernier état connu, pas le premier', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW]);
  api.applyResponses(state, [{ ...RESP_ROW, status: 'present', reason: null }]);
  state.convocations = [];
  api.applyConvocs(state, [CONVOC_ROW]);
  ok(conv(state).responses.pA.status === 'present', 'état périmé servi : ' + conv(state).responses.pA.status);
});
t('plusieurs joueuses sur la même convoc', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  api.applyResponses(state, [RESP_ROW, { ...RESP_ROW, player_id: 'pB', status: 'present', reason: null }]);
  state.convocations = [];
  api.applyConvocs(state, [CONVOC_ROW]);
  ok(Object.keys(conv(state).responses).length === 2, 'joueuses perdues : ' + JSON.stringify(conv(state).responses));
});
t('deux convocations ne mélangent pas leurs RSVP', () => {
  const api = factory();
  const other = { ...CONVOC_ROW, id: 'xAutre', title: 'vs Juillan', date: '2026-05-23' };
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW, other]);
  api.applyResponses(state, [RESP_ROW]);
  state.convocations = [];
  api.applyConvocs(state, [CONVOC_ROW, other]);
  ok(conv(state).responses.pA, 'RSVP perdu sur la bonne convoc');
  const o = state.convocations.find(c => c.id === 'xAutre');
  ok(JSON.stringify(o.responses) === '{}', 'RSVP fuité sur une autre convocation : ' + JSON.stringify(o.responses));
});

// --- 5) le reste de l'apply convocations n'a pas bougé ----------------------
t('les autres champs de la convocation restent corrects', () => {
  const api = factory();
  const state = { convocations: [] };
  api.applyConvocs(state, [CONVOC_ROW]);
  const c = conv(state);
  ok(c.type === 'match' && c.title === 'vs Rejaumont (amical)', 'titre/type KO');
  ok(c.teamTag === 'e1', 'teamTag = ' + c.teamTag);
  ok(c.seasonId === '2026-2027', 'seasonId = ' + c.seasonId);
  ok(c.closed === false, 'closed = ' + c.closed);
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
