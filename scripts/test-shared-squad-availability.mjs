// Test : signal « 👥 elle est aussi dans le groupe dispo de l'autre équipe ».
// Deux écrans : la fiche de convocation (pastilles vertes) et l'écran de
// sélection de l'effectif du match.
//
// Ce signal dit ÉLIGIBLE, pas RETENUE. Il complète _lineupConflictBadge, qui
// ne parle que des joueuses déjà retenues en face ET dans une fenêtre de 3h —
// donc muet quand personne n'a encore composé (scénario 1) ET quand les deux
// matchs sont espacés de plus de 3h (scénario 2b). Ces deux trous sont la
// raison d'être du badge : les tests les rejouent explicitement.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// ⚠️ L'équilibrage d'accolades doit démarrer APRÈS la parenthèse fermante de
// la signature, sinon un paramètre déstructuré ({ team } …) coupe la fonction
// en plein milieu (SyntaxError obscure dans le vm).
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let p = 0, sigEnd = -1;
  for (let j = html.indexOf('(', start); j < html.length; j++) {
    if (html[j] === '(') p++;
    else if (html[j] === ')') { p--; if (p === 0) { sigEnd = j; break; } }
  }
  assert.ok(sigEnd > 0, 'signature déséquilibrée : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', sigEnd); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const src = ['_unavailMeta', '_unavailOn', '_medicalUnavailOn', '_unavailEffectiveOn', 'resolveEffectivePresence',
  '_convocRespRaw', '_convocResp', '_matchStartMin', '_lineupConflictsFor',
  '_matchDayConvoc', '_sharedPoolMatchesForDay', '_sharedPoolMatchesFor',
  '_sharedPoolTeamLabel', '_sharedPoolHint', '_sharedPoolBadge', '_sharedPoolChip']
  .map(extractFn).join('\n\n');

// getSeasonPlayers stubé sur les mêmes règles que le vrai (lien season_players
// porteur du team_tag, 'both' entrant dans les DEUX effectifs).
const tagMatches = (tag, want) => (!want || want === 'all') ? true : ((tag || 'e1') === want || tag === 'both');
function build(state, { scoped = false, multi = true } = {}) {
  const getSeasonPlayers = (seasonId, opts) => {
    const team = (opts && opts.team) || 'all';
    return (state.seasonPlayers || [])
      .filter(sp => sp.seasonId === seasonId && tagMatches(sp.teamTag, team))
      .map(sp => (state.players || []).find(p => p.id === sp.playerId))
      .filter(Boolean);
  };
  return new Function('state', 'getSeasonPlayers', '_seasonsLoaded', 'isMultiSquad', 'isScopedCoach', 'teamLabel', 'esc',
    src + '\nreturn { _sharedPoolMatchesForDay, _sharedPoolMatchesFor, _sharedPoolBadge, _sharedPoolChip, _lineupConflictsFor, _matchDayConvoc };'
  )(state, getSeasonPlayers, () => true, () => multi, () => scoped, (tg) => tg.toUpperCase(), x => String(x));
}

const players = [
  { id: 'a', num: 4, name: 'Lea' },   // E1 seule
  { id: 'b', num: 7, name: 'Mia' },   // E1 + E2 (both)
  { id: 'c', num: 9, name: 'Zoe' },   // E2 seule
];
const links = [
  { seasonId: 's1', playerId: 'a', teamTag: 'e1' },
  { seasonId: 's1', playerId: 'b', teamTag: 'both' },
  { seasonId: 's1', playerId: 'c', teamTag: 'e2' },
];
const baseMatches = () => [
  { id: 'm1', seasonId: 's1', date: '2026-10-04', time: '14:00', teamTag: 'e1', opponent: 'Alpha' },
  { id: 'm2', seasonId: 's1', date: '2026-10-04', time: '20:00', teamTag: 'e2', opponent: 'Beta' },
];
const st = (over = {}) => Object.assign({ players, seasonPlayers: links, currentSeasonId: 's1',
  convocations: [], matches: baseMatches() }, over);

console.log('SCÉNARIO 1 — E1 et E2 le même jour, personne encore retenue');
{
  const api = build(st());
  t('Mia (both) est signalée sur le match E1', () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm1').map(x => x.id), ['m2']);
    assert.match(api._sharedPoolBadge('b', 'm1'), /aussi dispo E2/);
  });
  t("Mia est signalée aussi dans l'autre sens (match E2 → E1)", () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm2').map(x => x.id), ['m1']);
    assert.match(api._sharedPoolBadge('b', 'm2'), /aussi dispo E1/);
  });
  t("Lea (E1 seule) n'est pas signalée", () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('a', 'm1'), []);
    assert.strictEqual(api._sharedPoolBadge('a', 'm1'), '');
  });
  // PREUVE DU GAIN #1 : l'ancien signal est MUET tant que personne n'a composé.
  t('ANCIEN comportement rejoué : _lineupConflictsFor vide → aucun signal', () => {
    assert.deepStrictEqual(api._lineupConflictsFor('b', 'm1'), []);
  });
}

console.log('SCÉNARIO 2a — déjà retenue en face À MOINS DE 3H : le conflit dur PRIME');
{
  const ms = baseMatches();
  ms[1].time = '15:00';              // 1h d'écart → le badge de conflit s'affiche
  ms[1].roster = { included: ['b'] };
  const api = build(st({ matches: ms }));
  t('le conflit dur parle…', () => {
    assert.deepStrictEqual(api._lineupConflictsFor('b', 'm1').map(x => x.id), ['m2']);
  });
  t('…donc pas de second badge sur la même ligne', () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm1'), []);
    assert.strictEqual(api._sharedPoolBadge('b', 'm1'), '');
  });
}

console.log('SCÉNARIO 2b — déjà retenue en face à PLUS DE 3H : le trou que le badge bouche');
{
  const ms = baseMatches();           // 14:00 vs 20:00 → hors fenêtre de conflit
  ms[1].roster = { included: ['b'] };
  const api = build(st({ matches: ms }));
  // PREUVE DU GAIN #2 : sans ce badge, le coach E1 ne voyait RIEN alors que
  // le coach E2 l'avait déjà mise sur sa feuille de match.
  t('ANCIEN comportement rejoué : conflit muet malgré la double sélection', () => {
    assert.deepStrictEqual(api._lineupConflictsFor('b', 'm1'), []);
  });
  t('le badge prend le relais et signale quand même', () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm1').map(x => x.id), ['m2']);
  });
}

console.log("SCÉNARIO 3 — indisponible pour l'autre match : pas de signal mensonger");
{
  const api = build(st({ convocations: [
    { type: 'match', date: '2026-10-04', teamTag: 'e2', responses: { b: { status: 'absent', reason: 'exams' } } },
  ] }));
  t('Mia absente à la convoc E2 → pas signalée sur le match E1', () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm1'), []);
  });
}
{
  const api = build(st({ convocations: [
    { type: 'match', date: '2026-10-04', teamTag: 'e1', responses: { b: { status: 'absent' } } },
    { type: 'match', date: '2026-10-04', teamTag: 'e2', responses: {} },
  ] }));
  t('absente en E1 mais dispo en E2 → toujours signalée (la bonne convoc est lue)', () => {
    assert.deepStrictEqual(api._sharedPoolMatchesFor('b', 'm1').map(x => x.id), ['m2']);
  });
  t("_matchDayConvoc scope bien sur l'équipe demandée", () => {
    assert.strictEqual(api._matchDayConvoc('2026-10-04', 'e2').teamTag, 'e2');
    assert.strictEqual(api._matchDayConvoc('2026-10-04', 'e1').teamTag, 'e1');
    assert.strictEqual(api._matchDayConvoc('2026-10-05', 'e1'), null);
  });
}

console.log('SCÉNARIO 4 — mono-équipe : no-op STRICT (golden path intact)');
{
  const ms = baseMatches();
  ms[1].teamTag = 'e1';
  const api = build(st({ matches: ms }), { multi: false });
  t('deux matchs E1 le même jour → aucun signal', () => {
    assert.strictEqual(api._sharedPoolBadge('b', 'm1'), '');
    assert.strictEqual(api._sharedPoolBadge('a', 'm1'), '');
  });
}
{
  const ms = baseMatches();
  delete ms[0].teamTag; delete ms[1].teamTag; // tags absents → fallback 'e1'
  const api = build(st({ matches: ms }), { multi: false });
  t("tags absents (data d'avant le multi-effectif) → aucun signal", () => {
    assert.strictEqual(api._sharedPoolBadge('b', 'm1'), '');
    assert.strictEqual(api._sharedPoolChip('b', '2026-10-04', undefined).mark, '');
  });
}

console.log('SCÉNARIO 5 — jour différent : le signal est bien scopé à la date');
{
  const ms = baseMatches();
  ms[1].date = '2026-10-11';
  const api = build(st({ matches: ms }));
  t('match E2 un autre jour → aucun signal', () => {
    assert.strictEqual(api._sharedPoolBadge('b', 'm1'), '');
    assert.strictEqual(api._sharedPoolChip('b', '2026-10-04', 'e1').mark, '');
  });
}

console.log('SCÉNARIO 6 — coach non-admin : le signal oui, le détail non');
{
  const admin = build(st(), { scoped: false });
  const coach = build(st(), { scoped: true });
  t("admin : l'infobulle nomme l'adversaire et l'heure", () => {
    const b = admin._sharedPoolBadge('b', 'm1');
    assert.match(b, /Beta/);
    assert.match(b, /20:00/);
  });
  t('coach scopé : signal présent, MAIS ni adversaire ni heure', () => {
    const b = coach._sharedPoolBadge('b', 'm1');
    assert.match(b, /aussi dispo E2/);
    assert.doesNotMatch(b, /Beta/);
    assert.doesNotMatch(b, /20:00/);
  });
  t('même règle sur la pastille de convocation', () => {
    assert.match(admin._sharedPoolChip('b', '2026-10-04', 'e1').hint, /Beta/);
    assert.doesNotMatch(coach._sharedPoolChip('b', '2026-10-04', 'e1').hint, /Beta/);
  });
}

console.log('SCÉNARIO 7 — fiche de convocation (pastilles vertes)');
{
  const api = build(st());
  t('Mia : pastille marquée 👥', () => {
    const chip = api._sharedPoolChip('b', '2026-10-04', 'e1');
    assert.match(chip.mark, /👥/);
    assert.match(chip.hint, /Dispo aussi pour/);
  });
  t('Lea (E1 seule) : pastille nue', () => {
    assert.deepStrictEqual(api._sharedPoolChip('a', '2026-10-04', 'e1'), { mark: '', hint: '' });
  });
  t("convoc commune ('both', entraînement partagé) → aucun signal", () => {
    assert.strictEqual(api._sharedPoolChip('b', '2026-10-04', 'both').mark, '');
  });
}

console.log('SCÉNARIO 8 — câblage dans les deux écrans');
{
  const fnBody = (name) => {
    const start = html.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' introuvable');
    return html.slice(start, html.indexOf('\nfunction ', start + 10));
  };
  const roster = fnBody('openRosterManager');
  t('effectif du match : _sharedPoolBadge dans les 2 listes', () => {
    assert.strictEqual(roster.split('_sharedPoolBadge(p.id, matchId)').length - 1, 2);
  });
  t('effectif du match : les 2 appels à _lineupConflictBadge sont intacts', () => {
    assert.strictEqual(roster.split('_lineupConflictBadge(p.id, matchId)').length - 1, 2);
  });
  const inst = fnBody('openEventInstance');
  t('fiche de convocation : _sharedPoolChip câblé sur les pastilles', () => {
    assert.strictEqual(inst.split('_sharedPoolChip(p.id, dateStr, c.teamTag)').length - 1, 1);
    assert.match(inst, /\$\{shared\.mark\}/);
  });
  t("fiche de convocation : l'infobulle médicale n'a pas été écrasée", () => {
    assert.match(inst, /shared\.hint\]\.filter\(Boolean\)/);
  });
}

console.log('SCÉNARIO 9 — version bumpée des DEUX côtés (procédure PWA)');
{
  const v = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).v;
  const m = html.match(/const APP_VERSION = '([^']+)'/);
  t('version.json === APP_VERSION', () => {
    assert.ok(m, 'APP_VERSION introuvable');
    assert.strictEqual(m[1], v);
  });
}

console.log('\n✅ ' + pass + ' assertions vertes');
