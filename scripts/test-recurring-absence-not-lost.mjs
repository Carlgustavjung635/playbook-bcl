// Test SYNC — une absence sur un entraînement RÉCURRENT n'est jamais perdue.
//
// INCIDENT (2026-07-29) : Ophélie #1 s'est désistée de l'« Entraînement
// Mercredi » (récurrent, days:[3]). L'écran coach affichait « 20 Présentes ·
// 0 Absentes » et la base ne contenait RIEN — ni convocation_responses, ni
// instance_overrides. L'écriture avait disparu sans laisser de trace.
//
// Cause : `instance_overrides` est un jsonb MONOLITHIQUE, et l'apply de
// `convocations` le reprenait tel quel du serveur :
//     instanceOverrides: r.instance_overrides || {}
// Entre le clic de la joueuse et le flush (debounce 400 ms), il suffisait qu'un
// événement realtime sur `convocations` arrive — et il en part en rafale, un
// simple re-push touchant les 7 lignes suffit — pour que l'override local soit
// remplacé par le {} du serveur AVANT d'avoir été poussé.
//
// Contrairement aux MATCHS, dont les RSVP vivent dans `convocation_responses`
// (entité séparée, protégée depuis v.86), les occurrences récurrentes n'avaient
// aucune protection. D'où « ça marche pour les matchs, pas pour les entraînements ».
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

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
function extractApply(key) {
  const anchor = html.indexOf("key: '" + key + "'");
  assert.ok(anchor >= 0, 'entité introuvable : ' + key);
  const ai = html.indexOf('apply:', anchor);
  const open = html.indexOf('{', html.indexOf('=>', ai));
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(ai + 'apply:'.length, j + 1).trim(); }
  }
  throw new Error('accolades non équilibrées : ' + key);
}

const api = new Function(`
  const _lastConvocResponses = {};
  const _lastConvocResponsesByDate = {};
  ${extractFn('_mergeInstanceOverrides')}
  const applyConvocs = ${extractApply('convocations')};
  return { _mergeInstanceOverrides, applyConvocs };
`)();

const DATE = '2026-08-19';
// L'« Entraînement Mercredi » réel : récurrent, hebdomadaire, jour 3.
const ROW = (overrides) => ({
  id: 'x1782394775088v2hx', type: 'training', title: 'Entraînement Mercredi',
  date: DATE, time: '20:10', location: null, note: null,
  recurrence: { days: [3], type: 'weekly', until: '' },
  cancelled_instances: [], instance_overrides: overrides || {}, attachments: [],
  season_id: '2026-2027', team_tag: 'both', closed: false,
});
const ABSENCE = (at) => ({ status: 'absent', reason: 'Blessure', message: '', at: at || 2000 });
const conv = (s) => s.convocations[0];
const rsvp = (s, d, pid) => ((conv(s).instanceOverrides[d] || {}).responses || {})[pid];

// --- 1) LE BUG D'ORIGINE -----------------------------------------------------
t('absence déclarée en local, refetch avant le flush → elle SURVIT', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);                       // état initial synchronisé
  // la joueuse déclare son absence (saveInstanceAbsence, convoc récurrente)
  conv(s).instanceOverrides[DATE] = { responses: { pA: ABSENCE() } };
  // ...et un événement realtime arrive AVANT le flush : le serveur a encore {}
  api.applyConvocs(s, [ROW()]);
  ok(rsvp(s, DATE, 'pA'), 'absence perdue — c\'est le bug d\'origine');
  ok(rsvp(s, DATE, 'pA').status === 'absent', 'statut = ' + rsvp(s, DATE, 'pA').status);
  ok(rsvp(s, DATE, 'pA').reason === 'Blessure', 'motif perdu');
});
t('elle survit à plusieurs refetch d\'affilée', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);
  conv(s).instanceOverrides[DATE] = { responses: { pA: ABSENCE() } };
  api.applyConvocs(s, [ROW()]);
  api.applyConvocs(s, [ROW()]);
  api.applyConvocs(s, [ROW()]);
  ok(rsvp(s, DATE, 'pA'), 'absence perdue au bout de N refetch');
});
t('...et reste donc dans le dump, donc poussée en base', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);
  conv(s).instanceOverrides[DATE] = { responses: { pA: ABSENCE() } };
  api.applyConvocs(s, [ROW()]);
  // le dump envoie c.instanceOverrides tel quel
  ok(JSON.stringify(conv(s).instanceOverrides).includes('Blessure'), 'rien à pousser');
});

// --- 2) le distant reste autoritaire quand il est plus récent ---------------
t('le distant gagne s\'il est plus récent (LWW sur `at`)', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  conv(s).instanceOverrides[DATE].responses.pA = { status: 'present', at: 500 };  // local PLUS VIEUX
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  ok(rsvp(s, DATE, 'pA').status === 'absent', 'le local périmé a gagné');
});
t('le local gagne s\'il est plus récent', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  conv(s).instanceOverrides[DATE].responses.pA = { status: 'present', at: 9000 };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  ok(rsvp(s, DATE, 'pA').status === 'present', 'la décision la plus récente a été écrasée');
});
t('sans horodatage des deux côtés, le distant fait autorité', () => {
  // Chaque appel reçoit un objet distant NEUF : PostgREST renvoie de nouveaux
  // objets à chaque fetch, et réutiliser la même référence ferait muter le
  // « distant » en même temps que le local (le test se mentirait à lui-même).
  const remote = () => ({ [DATE]: { responses: { pA: { status: 'absent', reason: 'Vacances' } } } });
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW(remote())]);
  conv(s).instanceOverrides[DATE].responses.pA = { status: 'present' };
  api.applyConvocs(s, [ROW(remote())]);
  ok(rsvp(s, DATE, 'pA').status === 'absent', 'statut = ' + rsvp(s, DATE, 'pA').status);
});

// --- 3) pas de perte croisée -------------------------------------------------
t('une absence déclarée par UNE AUTRE joueuse est conservée', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);
  conv(s).instanceOverrides[DATE] = { responses: { pA: ABSENCE() } };
  // le serveur, lui, connaît celle de pB
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pB: ABSENCE(3000) } } })]);
  ok(rsvp(s, DATE, 'pA'), 'absence locale perdue');
  ok(rsvp(s, DATE, 'pB'), 'absence distante perdue');
});
t('deux dates différentes ne se marchent pas dessus', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);
  conv(s).instanceOverrides['2026-08-26'] = { responses: { pA: ABSENCE() } };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pB: ABSENCE(3000) } } })]);
  ok(rsvp(s, '2026-08-26', 'pA'), 'occurrence locale perdue');
  ok(rsvp(s, DATE, 'pB'), 'occurrence distante perdue');
});
t('les autres contenus d\'une occurrence ne sont pas écrasés', () => {
  // instanceOverrides porte aussi le plan d'entraînement et la feuille d'appel.
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW({ [DATE]: { plan: { validated: true } } })]);
  conv(s).instanceOverrides[DATE].callSheet = { arrivals: { pA: '20:05' } };
  api.applyConvocs(s, [ROW({ [DATE]: { plan: { validated: true } } })]);
  ok(conv(s).instanceOverrides[DATE].plan.validated === true, 'plan distant perdu');
  ok(conv(s).instanceOverrides[DATE].callSheet, 'feuille d\'appel locale perdue');
});

// --- 4) un « retour de présence » n'est pas ressuscité en absence -----------
t('repasser présente écrase bien l\'absence (statut present horodaté)', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  // restoreInstancePresent écrit un statut, il ne SUPPRIME plus la ligne — sans
  // quoi la fusion ferait réapparaître l'absence à chaque refetch.
  conv(s).instanceOverrides[DATE].responses.pA = { status: 'present', reason: '', message: '', at: 5000 };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE(1000) } } })]);
  ok(rsvp(s, DATE, 'pA').status === 'present', 'l\'absence est revenue d\'entre les morts');
});

// --- 5) robustesse -----------------------------------------------------------
t('overrides vides des deux côtés → {}', () => {
  ok(JSON.stringify(api._mergeInstanceOverrides({}, {})) === '{}');
  ok(JSON.stringify(api._mergeInstanceOverrides(null, undefined)) === '{}');
});
t('une valeur non-objet ne fait pas planter la fusion', () => {
  ok(JSON.stringify(api._mergeInstanceOverrides('nope', 42)) === '{}');
});
t('une convocation inconnue du client prend le distant tel quel', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW({ [DATE]: { responses: { pA: ABSENCE() } } })]);
  ok(rsvp(s, DATE, 'pA'), 'override distant ignoré');
});
t('les champs simples de la convocation restent corrects', () => {
  const s = { convocations: [] };
  api.applyConvocs(s, [ROW()]);
  ok(conv(s).type === 'training' && conv(s).teamTag === 'both', 'type/équipe KO');
  ok(conv(s).recurrence && conv(s).recurrence.days[0] === 3, 'récurrence perdue');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
