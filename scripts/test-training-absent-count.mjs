// ============================================================================
// v.133 — « X absentes » faux sur la fiche d'un ENTRAÎNEMENT côté coach.
//
// Le compteur du MATCH était juste, celui de l'ENTRAÎNEMENT non. Raison : la
// vue match passe par getMatchRoster(), qui scope l'effectif sur l'équipe du
// match ({ team: 'e1' | 'e2' }). Les vues de convocation, elles, appelaient
// getSeasonPlayers(seasonId) SANS `team` — or son défaut est 'all'. Sur un
// entraînement E1, tout l'effectif E2 entrait donc dans le calcul, et chaque
// joueuse E2 en indisponibilité (blessure, vacances…) était comptée « absente »
// de l'entraînement E1 : le compteur gonflait tout seul.
//
// Deuxième divergence, même famille : l'effectif suivait `c.seasonId` (la
// saison de la CONVOC) alors que la clôture _applyConvocClosure crédite la
// saison de la DATE de l'instance. Sur une série récurrente qui franchit le
// 1er septembre, la fiche affichait l'effectif de l'ancienne saison pendant que
// la clôture créditait la nouvelle.
//
// Ce test EXÉCUTE le vrai code d'index.html (extraction par équilibrage
// d'accolades) — il ne recopie aucun helper : une régression dans index.html
// doit faire rougir ce fichier, pas passer sous une copie devenue fausse.
// Il rejoue aussi l'ANCIENNE expression à côté de la nouvelle, pour prouver
// que le scénario distinguait bien les deux (sinon le vert ne vaut rien).
// ============================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '  ✓' : '  ✗'} ${label}`); if (!cond) failures++; };
const eq = (a, b, label) => ok(a === b, `${label}${a === b ? '' : ` (attendu ${JSON.stringify(b)}, reçu ${JSON.stringify(a)})`}`);

function extractFn(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`fonction ${name} introuvable dans index.html`);
  // Le corps commence APRÈS la parenthèse fermante de la signature : partir du
  // premier « { » rencontré coupe getSeasonPlayers(seasonId, { includeLeft… })
  // en plein milieu de ses paramètres déstructurés — et le vm rend alors une
  // SyntaxError obscure au lieu de la fonction demandée.
  let p = html.indexOf('(', start), pd = 0, j = p;
  for (; j < html.length; j++) {
    if (html[j] === '(') pd++;
    else if (html[j] === ')') { pd--; if (pd === 0) break; }
  }
  let depth = 0, i = html.indexOf('{', j);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`accolades non équilibrées pour ${name}`);
}
function extractDecl(head, closer) {
  const start = html.indexOf(head);
  if (start < 0) throw new Error(`déclaration ${head} introuvable`);
  const end = html.indexOf(closer, start);
  if (end < 0) throw new Error(`fin de ${head} introuvable`);
  return html.slice(start, end + closer.length);
}

const FNS = [
  'teamTagMatches', 'getSeasonPlayers',
  '_seasonsLoaded', 'getSeasonIdForDate', 'getActiveSeasonId',
  'seasonIdForConvocInstance',
  'convocInstanceRoster',            // ← la porte unique introduite par le fix
  'isoDate', '_unavailOn', '_medicalUnavailOn', '_unavailEffectiveOn', '_unavailMeta',
  'resolveEffectivePresence', '_convocRespRaw', '_convocResp',
  'getMatchRoster',
];

const src = [
  extractDecl('const UNAVAIL_REASONS = [', '\n];'),
  extractDecl('const UNAVAIL_LABEL =', "'INDISPO';"),
].concat(FNS.map(extractFn)).join('\n');

// --- Jeu de données ---------------------------------------------------------
// Deux saisons consécutives (fenêtre BCL : 1er sept. → 30 juin) pour éprouver
// la série récurrente qui franchit la frontière.
const SEASONS = [
  { id: 's1', name: '2026-2027', status: 'active', startDate: '2026-09-01', endDate: '2027-06-30' },
  { id: 's2', name: '2027-2028', status: 'draft',  startDate: '2027-09-01', endDate: '2028-06-30' },
];
const PLAYERS = [
  { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bea' }, { id: 'p3', name: 'Carla' },
  { id: 'p4', name: 'Dina' },  { id: 'p5', name: 'Eva' },
  { id: 'q1', name: 'Flo' },   { id: 'q2', name: 'Gaby' }, { id: 'q3', name: 'Hana' },
  { id: 'q4', name: 'Ines' },
];
const link = (seasonId, playerId, teamTag) => ({ seasonId, playerId, teamTag, joinedAt: '2026-09-01', leftAt: '' });
const SEASON_PLAYERS = [
  // s1 : 5 joueuses en E1, 4 en E2
  link('s1', 'p1', 'e1'), link('s1', 'p2', 'e1'), link('s1', 'p3', 'e1'),
  link('s1', 'p4', 'e1'), link('s1', 'p5', 'e1'),
  link('s1', 'q1', 'e2'), link('s1', 'q2', 'e2'), link('s1', 'q3', 'e2'), link('s1', 'q4', 'e2'),
  // s2 : l'effectif E1 a fondu à 2 (c'est ce qui rend la 2e divergence visible)
  link('s2', 'p1', 'e1'), link('s2', 'p2', 'e1'),
  link('s2', 'q1', 'e2'), link('s2', 'q2', 'e2'),
];

const DATE = '2026-10-07';          // mercredi, dans s1
const DATE_S2 = '2027-10-06';       // même série, saison suivante

// Indisponibilités : 1 joueuse E1 (légitime) + 2 joueuses E2 (hors sujet pour
// un entraînement E1 — c'est exactement ce qui gonflait le compteur).
// Forme réelle de la collection : state.playerUnavailabilities, bornes
// startsAt/endsAt, soft-delete deletedAt (cf. _unavailOn dans index.html).
const UNAVAILABILITIES = [
  { id: 'u1', playerId: 'p5', reason: 'blessure', startsAt: '2026-10-01', endsAt: '2026-10-31', notes: '' },
  { id: 'u2', playerId: 'q1', reason: 'vacances', startsAt: '2026-10-05', endsAt: '2026-10-12', notes: '' },
  { id: 'u3', playerId: 'q2', reason: 'exams',    startsAt: '2026-09-15', endsAt: '2026-12-20', notes: '' },
];

// Entraînement E1. p2 s'est déclarée absente à la main.
const TRAINING = {
  id: 'c-train', type: 'training', title: 'Entraînement E1', date: DATE, time: '19:00',
  seasonId: 's1', teamTag: 'e1', responses: { p2: { status: 'absent', reason: 'Travail' } },
};
// Match E1 le même jour + sa convoc (le compteur qui, lui, marchait déjà).
const MATCH_CONVOC = {
  id: 'c-match', type: 'match', title: 'vs Rivales', date: DATE,
  seasonId: 's1', teamTag: 'e1', responses: { p2: { status: 'absent', reason: 'Travail' } },
};
const MATCH = { id: 'm1', date: DATE, opponent: 'Rivales', seasonId: 's1', teamTag: 'e1' };

// Série récurrente qui franchit la frontière de saison : créée en s1, jouée en s2.
const RECURRENT = {
  id: 'c-rec', type: 'training', title: 'Entraînement hebdo E1', date: DATE,
  seasonId: 's1', teamTag: 'e1', recurrence: 'weekly', responses: {}, instanceOverrides: {},
};

const state = {
  seasons: SEASONS, currentSeasonId: 's1',
  players: PLAYERS, seasonPlayers: SEASON_PLAYERS,
  playerUnavailabilities: UNAVAILABILITIES,
  convocations: [TRAINING, MATCH_CONVOC, RECURRENT],
  matches: [MATCH],
  team: { multiSquad: true },
  teamFilter: 'all',
  auth: { role: 'coach' },
};

const ctx = { state, console, Date, JSON, Math, Array, Object, String, Number, Boolean };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'index.inline.js' });
const {
  convocInstanceRoster, getSeasonPlayers, _convocResp, getMatchRoster,
  seasonIdForConvocInstance, _seasonsLoaded,
} = ctx;

const absentsIn = (pool, c, d) => pool.filter(p => _convocResp(c, d, p.id).status === 'absent');
// L'ANCIENNE expression, telle qu'elle était dans openEventInstance / openCallSheet
// / convocCard avant le fix. Rejouée ici pour prouver que le scénario sépare
// bien les deux comportements — un test qui passerait aussi AVANT ne prouve rien.
const legacyPool = (c) => {
  const sid = c.seasonId || state.currentSeasonId;
  return _seasonsLoaded() && sid ? getSeasonPlayers(sid) : (state.players || []);
};

console.log('\n=== 1. Le bug : entraînement E1, les indispos E2 gonflaient le compteur ===');
{
  const legacy = absentsIn(legacyPool(TRAINING), TRAINING, DATE);
  const fixed = absentsIn(convocInstanceRoster(TRAINING, DATE), TRAINING, DATE);
  eq(legacyPool(TRAINING).length, 9, 'AVANT : effectif = tout le club (E1+E2)');
  eq(legacy.length, 4, 'AVANT : 4 « absentes » (p2 + p5 + q1 et q2, qui sont E2)');
  ok(legacy.some(p => p.id === 'q1') && legacy.some(p => p.id === 'q2'),
    'AVANT : des joueuses E2 étaient bien comptées sur un entraînement E1');
  eq(convocInstanceRoster(TRAINING, DATE).length, 5, 'APRÈS : effectif = E1 seul (5)');
  eq(fixed.length, 2, 'APRÈS : 2 absentes (p2 déclarée + p5 blessée) — les E2 sont sorties');
  ok(!fixed.some(p => p.id.startsWith('q')), 'APRÈS : plus aucune joueuse E2 dans les absentes');
  ok(legacy.length !== fixed.length, 'le scénario DISTINGUE bien avant/après (sinon vert menteur)');
}

console.log('\n=== 2. Parité avec le MATCH (la vue qui, elle, était juste) ===');
{
  const trainRoster = convocInstanceRoster(TRAINING, DATE);
  const matchRoster = getMatchRoster(MATCH);          // scopé équipe depuis toujours
  const trainPresent = trainRoster.filter(p => _convocResp(TRAINING, DATE, p.id).status === 'present');
  eq(trainPresent.length, matchRoster.length,
    'même effectif E1, mêmes indispos → entraînement et match comptent pareil');
  eq(matchRoster.map(p => p.id).sort().join(','), trainPresent.map(p => p.id).sort().join(','),
    'et ce sont exactement les mêmes joueuses');
}

console.log('\n=== 3. Convoc E2 : le compteur suit son équipe, pas le club ===');
{
  const e2Training = { ...TRAINING, id: 'c-e2', teamTag: 'e2', responses: {} };
  const roster = convocInstanceRoster(e2Training, DATE);
  eq(roster.length, 4, 'effectif E2 = 4');
  ok(roster.every(p => p.id.startsWith('q')), 'aucune joueuse E1 dans une convoc E2');
  eq(absentsIn(roster, e2Training, DATE).length, 2, 'ses 2 indispos (q1, q2) et rien d’autre');
}

console.log('\n=== 4. teamTag "both" : convoc commune → tout l’effectif, volontairement ===');
{
  const both = { ...TRAINING, id: 'c-both', teamTag: 'both', responses: {} };
  eq(convocInstanceRoster(both, DATE).length, 9, 'les deux équipes réunies');
}

console.log('\n=== 5. Mono-équipe (multiSquad off) : le fix est un no-op ===');
{
  const saved = state.team.multiSquad;
  state.team.multiSquad = false;
  eq(convocInstanceRoster(TRAINING, DATE).length, 5,
    'les liens sans tag valent e1 → aucun effectif perdu');
  const noTag = { ...TRAINING, id: 'c-notag', teamTag: undefined };
  eq(convocInstanceRoster(noTag, DATE).length, 5, 'convoc sans teamTag (rétrocompat) → e1');
  state.team.multiSquad = saved;
}

console.log('\n=== 6. Série récurrente franchissant le 1er septembre ===');
{
  eq(seasonIdForConvocInstance(RECURRENT, DATE_S2), 's2',
    "l'instance appartient à la saison de sa DATE, pas à celle de la convoc");
  eq(legacyPool(RECURRENT).length, 9, 'AVANT : effectif de s1 (et tout le club)');
  const fixedRoster = convocInstanceRoster(RECURRENT, DATE_S2);
  eq(fixedRoster.length, 2, 'APRÈS : effectif E1 de s2 (2 joueuses)');
  eq(fixedRoster.map(p => p.id).sort().join(','), 'p1,p2', 'et ce sont les bonnes');
  ok(!fixedRoster.some(p => p.id === 'p5'),
    'une joueuse partie en fin de saison ne compte plus dans la nouvelle');
}

console.log('\n=== 7. Convoc absente / effectif non chargé : pas de crash ===');
{
  eq(convocInstanceRoster(null, DATE).length, 0, 'convoc null → effectif vide, pas d’exception');
  const savedSeasons = state.seasons;
  state.seasons = [];
  eq(convocInstanceRoster(TRAINING, DATE).length, PLAYERS.length,
    'saisons non chargées → repli sur state.players (comportement historique)');
  state.seasons = savedSeasons;
}

console.log('\n=== 8. Garde de non-régression : toutes les vues passent par la porte unique ===');
{
  // Le fix ne vaut que si AUCUNE vue ne recalcule l'effectif dans son coin. On
  // vérifie que les 5 consommateurs citent bien le helper, et qu'il ne reste
  // aucun getSeasonPlayers(_seasonId) NU (sans `team`) dans une vue de convoc.
  const bodyOf = (name) => extractFn(name);
  ['openEventInstance', 'openCallSheet', 'convocCard', '_applyConvocClosure'].forEach(fn => {
    ok(bodyOf(fn).includes('convocInstanceRoster('), `${fn}() passe par convocInstanceRoster()`);
  });
  // Les commentaires du fix CITENT currentSeasonPlayers() pour expliquer ce
  // qu'on a retiré : on ne teste donc que le code, commentaires ôtés.
  const codeOnly = (name) => extractFn(name)
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(codeOnly('heroCard').includes('convocInstanceRoster('),
    'heroCard() aussi (il suivait la pillule de la topbar, pas l’équipe de l’événement)');
  ok(!codeOnly('heroCard').includes('currentSeasonPlayers('),
    'heroCard() n’utilise plus currentSeasonPlayers() pour ce décompte');
  ['openEventInstance', 'openCallSheet', 'convocCard'].forEach(fn => {
    ok(!/getSeasonPlayers\(\s*_seasonId\s*\)/.test(bodyOf(fn)),
      `${fn}() n'appelle plus getSeasonPlayers(_seasonId) sans scope équipe`);
  });
}

console.log(failures === 0
  ? '\n✅ TOUT PASSE — le compteur d’absentes de l’entraînement compte comme celui du match.'
  : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
