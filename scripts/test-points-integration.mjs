// ============================================================================
// v.126 — Le score général, exécuté sur le CODE RÉEL d'index.html.
//
// Ce test n'est pas un doublon de test-points-system.mjs. Celui-là verrouille
// des fonctions pures RECOPIÉES ; celui-ci EXTRAIT les fonctions d'index.html
// et les exécute. Une réimplémentation donnerait un vert menteur le jour où
// quelqu'un touche index.html sans toucher au test (piège déjà payé sur
// test-auto-update.mjs, cf. v.110).
//
// CE QU'IL PROUVE :
//
//   1. QUE ÇA TOURNE. Le module référence une quinzaine d'helpers du fichier
//      (getConvocInstances, getSeasonPlayers, _challengeSeriesOf…). Un nom mal
//      orthographié ne se voit ni à la lecture, ni au contrôle de syntaxe — il
//      lève un ReferenceError au premier rendu de l'accueil joueuse.
//
//   2. LES DEUX DOUBLE-COMPTAGES. Le jeu de données contient EXPRÈS un défi
//      AUTO « Présences » avec un compteur, et une convocation de MATCH
//      clôturée. Ni l'un ni l'autre ne doit rapporter un point : les présences
//      sont déjà payées une fois, et un match se joue sur sélection. Si un jour
//      quelqu'un retire l'un des deux filtres, le total attendu saute.
//
//   3. LA PORTE UNIQUE. Le widget d'accueil, la timeline et le classement coach
//      doivent afficher LE MÊME nombre. Le test lit le HTML rendu par les trois
//      et compare — c'est la seule façon de détecter qu'une vue s'est remise à
//      compter dans son coin (et ignorerait donc les surcharges du coach).
//
//   4. QU'UNE INSTANCE NON CLÔTURÉE NE PAIE PAS. Avant la clôture, les RSVP
//      sont des intentions, pas des présences.
//
//   5. LA BANQUE NE FABRIQUE NI NE PERD DE POINTS (v.126). Récolter déplace un
//      montant du « en attente » vers le « encaissé » : les deux bougent, leur
//      SOMME jamais. Et un malus n'y passe pas — sinon il suffirait de ne pas
//      appuyer sur le bouton pour ne jamais le subir.
//
//   6. QUE LE BOUTON S'ÉTEINT. Un gain daté dans le FUTUR (défi encore ouvert)
//      n'est couvert par aucun repère avancé à « maintenant » : sans la liste
//      de rattrapage, il resterait en banque à vie et « Récolter » clignoterait
//      pour toujours sur des points déjà pris.
// ============================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '  ✓' : '  ✗'} ${label}`); if (!cond) failures++; };
const eq = (a, b, label) => ok(a === b, `${label}${a === b ? '' : ` (attendu ${b}, reçu ${a})`}`);

// --- Extraction par équilibrage d'accolades (même patron que test-player-attendance-hidden)
function extractFn(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`fonction ${name} introuvable dans index.html`);
  let depth = 0, i = html.indexOf('{', start);
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
  'pointsSourceMeta', 'pointsRules', 'challengePointsReward', '_pointsKey',
  'invalidatePointsCache', '_pointsAttendanceBySeason', '_pointsSeasonOf',
  '_derivePointsEntries', '_pointsMergeEntries', 'playerPointsEntries',
  'playerPointsTotal', 'playerPointsAllTime', 'playerPointsBySource',
  'playerPointsBetween', '_pointsDailySeries', 'playerPointsDaily',
  'seasonPointsRanking', 'playerPointsRank',
  '_pointsNextGoal', '_pointsSparkline', 'renderPointsPlayerCard',
  '_pointsHistoryBody', '_pointsRankingBody',
  '_challengeAttemptValue', '_challengeBetter', '_challengeProgressData', '_challengeProgressChart',
  // --- LA BANQUE (v.126) ---
  '_pointsHarvestId', 'pointsHarvestOf', '_pointsEntryClaimed', 'playerPointsSplit',
  'playerPointsClaimed', 'playerPointsBank', 'harvestPoints', '_animateHarvest',
  '_pointsSeenKey', '_pointsSeenTotal', '_setPointsSeenTotal',
  // Sérialisation (bloc <script type="module">) : c'est elle qui décide de ce
  // qu'on POUSSE en base et de ce qu'on lit d'une base pas encore migrée.
  '_pointsClampInt', '_dumpPointsLedgerRow', '_pointsLedgerFromRow',
  '_dumpPointsHarvestRow', '_pointsHarvestFromRow',
];

const src = [
  extractDecl('const POINTS_SOURCES = [', '\n];'),
  extractDecl('const POINTS_DEFAULT_RULES = {', '\n};'),
  // EXTRAIT, pas recopié : la dérivation de l'ardoise filtre sur cette liste, et
  // une valeur ajoutée au module Ardoise sans être répercutée ici donnerait un
  // vert menteur — c'est précisément le piège que ce fichier existe pour éviter.
  extractDecl('const ARDOISE_DONE_STATUSES = [', '];'),
  extractDecl('const _POINTS_SOURCE_TYPES_DB = [', '];'),
  extractDecl('const _POINTS_LEDGER_STATES_DB = [', '];'),
  'let _pointsMemo = { attendance: {} };',
  // Détection de schéma de `last_claimed_amount` (migration 20260816_002, feed
  // du groupe) : le dump ne pousse la colonne qu'après l'avoir vue revenir du
  // serveur, pour qu'une banque migrée SANS elle continue de se synchroniser.
  'let _pointsHarvestAmountCol = false;',
  "let _pointsHistoryFilter = 'all';",
].concat(FNS.map(extractFn)).join('\n');

// --- Jeu de données ---------------------------------------------------------
const SEASON = { id: 's1', name: '2026-2027', status: 'active', startDate: '2026-08-01', endDate: '2027-06-30' };
const PLAYERS = [
  { id: 'p1', num: 4, name: 'Alice' },
  { id: 'p2', num: 7, name: 'Bea' },
  { id: 'p3', num: 9, name: 'Carla' },
];

// Entraînement récurrent : deux instances CLÔTURÉES, une pas encore.
// Bea est explicitement absente le 10/08 → elle ne touche que 10 pts, pas 20.
const TRAINING = {
  id: 'cv1', type: 'training', title: 'Séance du lundi', teamTag: 'e1',
  _instances: [
    { date: '2026-08-03', closed: true, responses: {}, title: 'Séance du lundi' },
    { date: '2026-08-10', closed: true, responses: { p2: { status: 'absent' } }, title: 'Séance du lundi' },
    { date: '2026-08-17', closed: false, responses: {}, title: 'Séance du lundi' },
  ]
};
// PIÈGE VOLONTAIRE nº1 : une convocation de MATCH, clôturée. Doit rapporter 0.
const MATCH_CONVOC = {
  id: 'cvm', type: 'match', title: 'vs Toulouse', teamTag: 'e1',
  _instances: [{ date: '2026-08-12', closed: true, responses: {}, title: 'vs Toulouse' }]
};

const CHALLENGES = [
  { id: 'ch1', title: 'Free throws', scope: 'individual', mode: 'single', seasonId: 's1',
    pointsReward: 5, scores: { p1: 12, p2: 8 }, series: {}, endDate: '2026-09-01' },
  // PIÈGE VOLONTAIRE nº2 : un défi AUTO avec un compteur de présences bien
  // rempli. Le créditer paierait les mêmes séances une seconde fois.
  { id: 'chAuto', title: 'Présences', scope: 'season', autoCount: true, seasonId: 's1',
    pointsReward: 50, scores: { p1: 2, p2: 1 }, series: {} },
  // Défi COLLECTIF : compteur d'équipe, aucune attribution individuelle possible.
  { id: 'chCol', title: '100 paniers', scope: 'collective', seasonId: 's1',
    pointsReward: 30, scores: { p1: 40 }, series: {} },
  // Défi à 0 point : elle y a un score, il ne rapporte rien. C'est un réglage.
  { id: 'chFree', title: 'Défi pour le fun', scope: 'individual', mode: 'single', seasonId: 's1',
    pointsReward: 0, scores: { p1: 99 }, series: {}, endDate: '2026-09-01' },
];

function makeState(extra) {
  return Object.assign({
    auth: { role: 'player', playerId: 'p1' },
    currentSeasonId: 's1',
    seasons: [SEASON],
    players: PLAYERS,
    convocations: [TRAINING, MATCH_CONVOC],
    challenges: JSON.parse(JSON.stringify(CHALLENGES)),
    trainingCompletions: [
      { id: 'tc1', playerId: 'p1', datePlanned: '2026-08-05', dateCompleted: Date.parse('2026-08-05T18:00:00Z'), pointsTotal: 40 },
      // Séance supprimée : ne compte pas.
      { id: 'tc2', playerId: 'p1', datePlanned: '2026-08-06', pointsTotal: 30, deletedAt: 123 },
    ],
    gageDraws: [
      { id: 'gd1', playerId: 'p1', status: 'coach_confirmed', seasonId: 's1', confirmedAt: Date.parse('2026-08-11T10:00:00Z') },
      // Accepté mais pas confirmé : ne rapporte rien tant que le coach n'atteste pas.
      { id: 'gd2', playerId: 'p1', status: 'accepted', seasonId: 's1', completedAt: Date.parse('2026-08-11T10:00:00Z') },
    ],
    ardoiseAssignments: [],
    pointsLedger: [],
    pointsHarvests: [],
    pointsRules: null,
  }, extra || {});
}

// --- Contexte d'exécution (stubs des helpers d'index.html) -------------------
function makeCtx(state, opts) {
  opts = opts || {};
  const store = {};
  // Journal des effets de bord : c'est lui qui prouve qu'une récolte ÉCRIT et
  // ANNONCE, même quand toute la mise en scène est désactivée.
  const calls = { persist: 0, render: 0, toasts: [], push: [] };
  const ctx = {
    state,
    console,
    Date, Math, Number, String, Object, Array, Set, Map, JSON, isNaN, parseInt, parseFloat,
    calls,
    persist: () => { calls.persist++; },
    render: () => { calls.render++; },
    showToast: t => { calls.toasts.push(String(t)); },
    // La carte n'est pas dans le DOM (il n'y a pas de DOM) : `_animateHarvest`
    // doit donc prendre son repli — le même que celui de prefers-reduced-motion.
    document: { getElementById: () => null },
    window: {
      matchMedia: () => ({ matches: !!opts.reducedMotion }),
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 0 },
    K: { pointsSeen: 'pb8_points_seen' },
    load: (k, d) => (k in store ? store[k] : d),
    save: (k, v) => { store[k] = v; },
    esc: s => String(s == null ? '' : s),
    isoDate: d => new Date(d).toISOString().slice(0, 10),
    formatDate: d => String(d),
    _seasonsLoaded: () => true,
    getActiveSeasonId: () => 's1',
    getCurrentSeason: () => SEASON,
    getSeasonIdForDate: dateStr => (dateStr && dateStr >= SEASON.startDate && dateStr <= SEASON.endDate) ? 's1' : null,
    getSeasonPlayers: (sid, o) => ((o && o.team === 'e2') ? [] : PLAYERS),
    getConvocInstances: (c, from, to) => (c._instances || []).filter(i => i.date >= from && i.date <= to),
    effectiveTeamFilter: () => 'all',
    _challengeSeriesOf: (c, pid) => (((c || {}).series || {})[pid] || []),
    _recomputeChallengeAggregate: (c, pid) => ((c.scores || {})[pid] || 0),
    _fmtChallengeScore: (c, v) => String(v),
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

console.log('\n— Dérivation : ce qui compte, et ce qui ne compte pas —');
{
  const ctx = makeCtx(makeState());
  const entries = ctx.playerPointsEntries('p1', 's1');
  const bySource = ctx.playerPointsBySource('p1', 's1');

  eq(bySource.training_attendance || 0, 20, 'p1 : 2 entraînements clôturés × 10');
  eq(bySource.training_completion || 0, 40, 'p1 : la séance de prépa validée (la supprimée est ignorée)');
  eq(bySource.challenge_score || 0, 5, 'p1 : UN seul défi rapporte (auto, collectif et 0 pt écartés)');
  eq(bySource.gage_done || 0, 15, 'p1 : le gage CONFIRMÉ (l\'accepté ne paie pas)');
  eq(ctx.playerPointsTotal('p1', 's1'), 80, 'p1 : total de saison');

  // Le piège nº2, énoncé à l'endroit : si le défi AUTO passait, on lirait +50.
  ok(!entries.some(e => e.sourceId === 'chAuto'), 'le défi AUTO ne verse rien (les présences sont déjà payées)');
  ok(!entries.some(e => e.sourceId === 'chCol'), 'le défi COLLECTIF ne verse rien (pas d\'attribution individuelle)');
  ok(!entries.some(e => e.sourceId === 'chFree'), 'un défi réglé à 0 ne verse rien');
  // Le piège nº1 : la convoc de match est clôturée, elle ne doit produire
  // AUCUNE entrée de présence.
  ok(!entries.some(e => String(e.sourceId || '').startsWith('cvm')), 'un match clôturé ne rapporte aucune présence');
  ok(!entries.some(e => String(e.sourceId || '').includes('2026-08-17')), 'une instance NON clôturée ne rapporte rien');

  eq(ctx.playerPointsTotal('p2', 's1'), 15, 'p2 : 1 présence (absente le 10/08) + 1 défi');
  eq(ctx.playerPointsTotal('p3', 's1'), 20, 'p3 : 2 présences, rien d\'autre');
}

console.log('\n— Barème : changer une valeur recalcule le passé —');
{
  const ctx = makeCtx(makeState({ pointsRules: { attendancePoints: 25, challengeDefaultPoints: 5, gageDonePoints: 15 } }));
  eq(ctx.playerPointsBySource('p1', 's1').training_attendance, 50, 'présence à 25 → 2 × 25, rétroactivement');
  eq(ctx.playerPointsTotal('p3', 's1'), 50, 'p3 suit le nouveau barème');
}
{
  const ctx = makeCtx(makeState({ pointsRules: { attendancePoints: 0, challengeDefaultPoints: 5, gageDonePoints: 15 } }));
  eq(ctx.playerPointsTotal('p3', 's1'), 0, 'présence à 0 : plus aucune entrée de présence');
}

console.log('\n— Surcharge du coach, sur le vrai chemin de lecture —');
{
  const st = makeState({
    pointsLedger: [
      { id: 'x1', playerId: 'p1', seasonId: 's1', pointsDelta: 0, sourceType: 'training_attendance',
        sourceId: 'cv1|2026-08-03', reason: 'Arrivée après la fin', createdAt: Date.parse('2026-08-20T10:00:00Z') },
      { id: 'x2', playerId: 'p1', seasonId: 's1', pointsDelta: 20, sourceType: 'manual_adjustment',
        sourceId: null, reason: 'A encadré l\'échauffement', createdAt: Date.parse('2026-08-21T10:00:00Z') },
      // Ligne soft-supprimée : ne compte plus.
      { id: 'x3', playerId: 'p1', seasonId: 's1', pointsDelta: 500, sourceType: 'manual_adjustment',
        sourceId: null, reason: 'Annulé', createdAt: 1, deletedAt: 2 },
    ]
  });
  const ctx = makeCtx(st);
  eq(ctx.playerPointsTotal('p1', 's1'), 90, 'surcharge à 0 (−10) + ajustement (+20) = 80 − 10 + 20');
  eq(ctx.playerPointsTotal('p2', 's1'), 15, 'la surcharge de p1 ne touche pas p2');
  // Le ledger d'une AUTRE saison ne doit pas fuiter dans celle-ci.
  const ctx2 = makeCtx(makeState({
    pointsLedger: [{ id: 'x9', playerId: 'p1', seasonId: 's0', pointsDelta: 999, sourceType: 'manual_adjustment', sourceId: null, createdAt: 1 }]
  }));
  eq(ctx2.playerPointsTotal('p1', 's1'), 80, 'un ajustement d\'une autre saison ne fuite pas');
}

console.log('\n— Ardoise : le contrat de reprise avec le chantier parallèle —');
{
  // Le module Ardoise n'a AUCUNE dérivation ici. Il insère ses lignes, et elles
  // doivent compter partout sans qu'une ligne de ce module-ci ne bouge.
  const ctx = makeCtx(makeState({
    pointsLedger: [{ id: 'x4', playerId: 'p1', seasonId: 's1', pointsDelta: 20, sourceType: 'ardoise_done',
      sourceId: 'as1', reason: 'Ardoise du 12/08', createdAt: Date.parse('2026-08-12T20:00:00Z') }]
  }));
  eq(ctx.playerPointsTotal('p1', 's1'), 100, 'une ligne ardoise entre dans le total');
  eq(ctx.playerPointsBySource('p1', 's1').ardoise_done, 20, '… et dans la répartition par source');
}

console.log('\n— Classement coach —');
{
  const ctx = makeCtx(makeState({ auth: { role: 'coach', playerId: null } }));
  const rank = ctx.seasonPointsRanking('s1', {});
  eq(rank.length, 3, '3 joueuses classées');
  eq(rank[0].player.id, 'p1', 'p1 en tête (80)');
  eq(rank[1].player.id, 'p3', 'p3 deuxième (20)');
  eq(rank[2].player.id, 'p2', 'p2 troisième (15)');
  const r = ctx.playerPointsRank('p3', 's1');
  eq(r.rank, 2, 'rang de p3');
  eq(r.of, 3, 'sur 3');
  const goal = ctx._pointsNextGoal('p3', 's1');
  eq(goal.done, false, 'p3 a encore un objectif');
  eq(goal.target, 80, 'p3 vise celle juste devant (p1, 80)');
  const first = ctx._pointsNextGoal('p1', 's1');
  eq(first.done, true, 'la première n\'a plus d\'objectif');
}

// Depuis la v.126, « le même nombre » demande une phrase de plus : le widget et
// la timeline montrent le score ENCAISSÉ, le classement coach le TOTAL gagné.
// Les deux ne coïncident qu'une fois la banque récoltée — et ils DOIVENT
// coïncider à ce moment-là, sinon c'est qu'une vue s'est remise à compter dans
// son coin (et ignorerait donc les surcharges du coach).
console.log('\n— Rendu : les trois vues se rejoignent après la récolte —');
{
  const ctx = makeCtx(makeState(), { reducedMotion: true });
  const total = ctx.playerPointsTotal('p1', 's1');

  // AVANT la récolte : le widget dit 0 et le classement dit 80. C'est voulu.
  ok(ctx.renderPointsPlayerCard().includes('id="pts-value">0<'), 'avant récolte, le widget affiche le score encaissé (0)');

  ctx.harvestPoints();

  const card = ctx.renderPointsPlayerCard();
  ok(typeof card === 'string' && card.length > 0, 'le widget d\'accueil rend du HTML');
  ok(card.includes(`id="pts-value">${total}<`), `le widget affiche ${total} une fois récolté`);
  ok(card.includes('id="pts-card"'), 'le widget porte l\'ancre de l\'animation');
  ok(card.includes('openPointsHistory()'), 'le widget mène à l\'historique');

  const body = ctx._pointsHistoryBody();
  ok(body.includes(`>${total}<`), 'la timeline affiche le même total');
  ok(body.includes('Présence entraînement'), 'la timeline nomme les sources');

  // Vue coach : même state (repère de récolte compris), autre rôle.
  const ctxC = makeCtx(Object.assign(makeState({ auth: { role: 'coach', playerId: null } }),
    { pointsHarvests: ctx.state.pointsHarvests }));
  const rankHtml = ctxC._pointsRankingBody();
  ok(rankHtml.includes(`>${total}</div>`), 'le classement coach affiche le même total');
  ok(rankHtml.includes('openPointsAdjust(\'p1\')'), 'le classement offre l\'ajustement manuel');

  // Une joueuse sans effectif ne doit pas faire planter le widget.
  const ctxEmpty = makeCtx(makeState({ auth: { role: 'player', playerId: 'inconnue' } }));
  ok(typeof ctxEmpty.renderPointsPlayerCard() === 'string', 'widget d\'une joueuse hors effectif : pas de crash');
  // Rôle coach → le widget joueuse ne s'affiche pas du tout.
  eq(ctxC.renderPointsPlayerCard(), '', 'le widget joueuse est vide côté coach');
}

console.log('\n— Courbe 7 jours et progression sur les défis —');
{
  const ctx = makeCtx(makeState());
  const daily = ctx.playerPointsDaily('p1', 's1', 7);
  eq(daily.length, 7, '7 jours de série');
  eq(daily[6].total, ctx.playerPointsTotal('p1', 's1'), 'la fin de la courbe == le total');
  ok(typeof ctx._pointsSparkline(daily) === 'string', 'la mini-courbe rend du HTML');

  const st = makeState();
  // Trois tentatives chronométrées, de plus en plus rapides : la dernière EST
  // le record. Le badge doit apparaître, et la barre la plus haute doit être
  // celle de la meilleure perf (échelle inversée pour un chrono).
  st.challenges.push({
    id: 'chT', title: 'Navette', scope: 'individual', mode: 'timed', lowerIsBetter: true,
    aggregate: 'best', seasonId: 's1', pointsReward: 5, scores: { p1: 9000 },
    series: { p1: [
      { id: 's1a', durationMs: 12000, createdAt: 1000 },
      { id: 's1b', durationMs: 10000, createdAt: 2000 },
      { id: 's1c', durationMs: 9000,  createdAt: 3000 },
    ] }
  });
  const ctx2 = makeCtx(st);
  const data = ctx2._challengeProgressData('p1');
  const nav = data.find(d => d.c.id === 'chT');
  ok(!!nav, 'la navette apparaît dans la progression');
  eq(nav.best, 9000, 'record = la plus RAPIDE (chrono)');
  eq(nav.last, 9000, 'dernier essai');
  eq(nav.isRecord, true, 'la dernière tentative est un record');
  eq(nav.count, 3, '3 tentatives');
  ok(!data.some(d => d.c.id === 'chAuto'), 'les défis auto restent hors de la progression perso');
  ok(!data.some(d => d.c.id === 'chCol'), 'les défis collectifs aussi');
  // Un défi réglé à 0 point reste dans la PROGRESSION : il ne rapporte rien,
  // mais elle l'a fait — l'écran raconte ses perfs, pas ses points.
  ok(data.some(d => d.c.id === 'chFree'), 'un défi à 0 pt reste dans sa progression');
  const chart = ctx2._challengeProgressChart(nav.c, nav.attempts);
  ok(chart.includes('height:100%'), 'la meilleure perf est la barre la plus haute (chrono inversé)');

  // Un premier essai n'est pas un record, c'est un point de départ.
  const st2 = makeState();
  st2.challenges.push({ id: 'chOne', title: 'Un seul essai', scope: 'individual', mode: 'series',
    seriesSize: 10, aggregate: 'best', seasonId: 's1', pointsReward: 5, scores: { p1: 7 },
    series: { p1: [{ id: 'o1', made: 7, attempts: 10, createdAt: 1000 }] } });
  const one = makeCtx(st2)._challengeProgressData('p1').find(d => d.c.id === 'chOne');
  eq(one.isRecord, false, 'une seule tentative n\'est pas un record');
}

// ============================================================================
// LA BANQUE (v.126) — sur le vrai chemin de lecture et d'écriture
// ----------------------------------------------------------------------------
// Les quatre choses qui doivent tenir, et qui casseraient en silence :
//   1. sans repère, TOUT est en banque et le score affiché est zéro — mais le
//      TOTAL (donc le classement) est inchangé ;
//   2. récolter déplace la banque vers le score sans rien créer ni perdre ;
//   3. un MALUS ne passe jamais par la banque, quoi qu'en dise la base ;
//   4. un gain daté dans le FUTUR (défi encore ouvert) doit pouvoir être
//      récolté — sinon le bouton ne s'éteint jamais.
// ============================================================================
console.log('\n— La banque : ce qui est encaissé et ce qui attend —');
{
  const ctx = makeCtx(makeState());
  const split = ctx.playerPointsSplit('p1', 's1');
  eq(split.total, 80, 'le total (classement) est inchangé par la banque');
  eq(split.score, 0, 'sans repère, rien n\'est encore encaissé');
  eq(split.bank, 80, '… et tout attend dans la banque');
  // Le classement lit le TOTAL : une joueuse qui ne récolte pas ne doit pas
  // dégringoler (ce serait publier son assiduité de connexion à l'équipe).
  eq(ctx.seasonPointsRanking('s1')[0].total, 80, 'le classement coach ignore la banque');

  // La carte annonce le score encaissé ET la banque, et le bouton est actif.
  const card = ctx.renderPointsPlayerCard();
  ok(card.includes('pts-harvest-btn'), 'la carte porte le bouton Récolter');
  ok(!/pts-harvest-btn[^>]*disabled/.test(card), 'banque pleine → bouton actif');
  ok(card.includes('>+80<'), 'la carte affiche le montant en banque');
}

console.log('\n— Récolter : la banque passe au score, rien ne se crée —');
{
  const st = makeState();
  const ctx = makeCtx(st, { reducedMotion: true });
  ctx.harvestPoints();

  const after = ctx.playerPointsSplit('p1', 's1');
  eq(after.score, 80, 'tout est passé au score');
  eq(after.bank, 0, 'la banque est vide');
  eq(after.total, 80, 'le total n\'a pas bougé d\'un point');
  eq(st.pointsHarvests.length, 1, 'un seul repère écrit');
  eq(st.pointsHarvests[0].id, 'p1|s1', 'id déterministe (idempotent entre appareils)');
  eq(st.pointsHarvests[0].claimedTotal, 80, 'le cumul récolté est mémorisé');
  ok(ctx.calls.persist >= 1, 'la récolte PERSISTE avant toute animation');
  ok(ctx.calls.toasts.some(t => t.includes('+80 pts récoltés')), 'le gain est annoncé même sans animation');

  // Récolter deux fois ne double rien : la garde du montant à zéro tient.
  const persistBefore = ctx.calls.persist;
  ctx.harvestPoints();
  eq(ctx.calls.persist, persistBefore, 'une banque vide n\'écrit rien');
  eq(ctx.playerPointsSplit('p1', 's1').score, 80, '… et le score ne double pas');

  const card = ctx.renderPointsPlayerCard();
  ok(/pts-harvest-btn[^>]*disabled/.test(card), 'banque à 0 → bouton grisé');
}

console.log('\n— prefers-reduced-motion : le mouvement part, l\'information reste —');
{
  const st = makeState();
  const ctx = makeCtx(st, { reducedMotion: true });
  ctx.harvestPoints();
  // Le repli DOIT quand même écrire, rendre et annoncer. Une récolte qui ne
  // ferait rien parce que la personne a demandé moins d'animations serait un
  // bouton mort pour elle seule.
  eq(st.pointsHarvests.length, 1, 'la récolte écrit bel et bien');
  ok(ctx.calls.render >= 1, 'l\'écran est re-rendu tout de suite');
  ok(ctx.calls.toasts.some(t => t.includes('récoltés')), 'le résultat est annoncé par un toast');
}

console.log('\n— Un malus ne passe jamais par la banque —');
{
  // Ligne écrite 'pending' EXPRÈS : c'est le cas d'une version antérieure du
  // front, ou d'une base trafiquée. La lecture doit la traiter en encaissée.
  const st = makeState({ pointsLedger: [
    { id: 'l1', playerId: 'p1', seasonId: 's1', pointsDelta: -30, sourceType: 'manual_adjustment',
      reason: 'retard', state: 'pending', createdAt: Date.parse('2026-08-12T10:00:00Z') },
    { id: 'l2', playerId: 'p1', seasonId: 's1', pointsDelta: 25, sourceType: 'manual_adjustment',
      reason: 'a encadré l\'échauffement', state: 'pending', createdAt: Date.parse('2026-08-12T11:00:00Z') },
  ] });
  const ctx = makeCtx(st);
  const split = ctx.playerPointsSplit('p1', 's1');
  eq(split.score, -30, 'le malus est déjà sur le score, sans avoir été récolté');
  eq(split.bank, 105, 'le bonus, lui, attend dans la banque (80 dérivés + 25)');
  eq(split.total, 75, 'le total reste 80 − 30 + 25');
}

console.log('\n— Un gain daté dans le futur se récolte quand même —');
{
  // `ch1` finit le 2026-09-01 : son horodatage est dans le futur du test.
  // Avancer le repère à « maintenant » ne le couvrirait jamais → sans la liste
  // de rattrapage, il resterait en banque à vie.
  const st = makeState();
  const ctx = makeCtx(st, { reducedMotion: true });
  ctx.harvestPoints();
  const keys = st.pointsHarvests[0].claimedKeys;
  ok(keys.includes('challenge_score|ch1'), 'la clé du défi encore ouvert est mémorisée');
  eq(ctx.playerPointsSplit('p1', 's1').bank, 0, 'la banque s\'éteint vraiment');
  // Et la liste ne garde QUE l'irrattrapable : les présences passées sont
  // couvertes par le repère, les mémoriser ferait enfler le jsonb sans fin.
  ok(!keys.some(k => k.startsWith('training_attendance')), 'les gains datés ne polluent pas la liste');
}

console.log('\n— Le rattrapage rétroactif du coach n\'a pas à être récolté —');
{
  const st = makeState();
  const ctx = makeCtx(st, { reducedMotion: true });
  ctx.harvestPoints();
  eq(ctx.playerPointsSplit('p1', 's1').bank, 0, 'banque vide après récolte');
  // Le coach saisit APRÈS coup une séance d'il y a une semaine (v.122). Elle
  // porte la date de la SÉANCE, donc elle passe sous le repère : elle rejoint
  // le score directement, sans redemander un clic pour un oubli ancien.
  st.trainingCompletions.push({
    id: 'tc3', playerId: 'p1', datePlanned: '2026-08-04',
    dateCompleted: Date.parse('2026-08-04T18:00:00Z'), pointsTotal: 30,
  });
  ctx.invalidatePointsCache();
  const after = ctx.playerPointsSplit('p1', 's1');
  eq(after.bank, 0, 'la validation rétroactive ne retombe pas dans la banque');
  eq(after.score, 110, '… elle rejoint le score directement');
}

console.log('\n— L\'ardoise entre dans le score par DÉRIVATION —');
{
  const st = makeState({ ardoiseAssignments: [
    { id: 'a1', playerId: 'p1', status: 'done_validated', pointsAwarded: 20, seasonId: 's1',
      validatedAt: Date.parse('2026-08-09T10:00:00Z') },
    // Pas encore réglée : ne rapporte rien.
    { id: 'a2', playerId: 'p1', status: 'in_progress', pointsAwarded: 0, seasonId: 's1',
      assignedAt: Date.parse('2026-08-09T10:00:00Z') },
    // Supprimée par le coach : n'existe plus pour l'application.
    { id: 'a3', playerId: 'p1', status: 'done_validated', pointsAwarded: 50, seasonId: 's1',
      validatedAt: Date.parse('2026-08-09T10:00:00Z'), deletedAt: 999 },
  ] });
  const ctx = makeCtx(st);
  eq(ctx.playerPointsBySource('p1', 's1').ardoise_done || 0, 20, 'seule l\'ardoise VALIDÉE compte');
  eq(ctx.playerPointsTotal('p1', 's1'), 100, '… et elle entre dans le total de saison');
}

// ============================================================================
// SÉRIALISATION — le contrat avec une base pas encore migrée
// ----------------------------------------------------------------------------
// C'est le mode de panne le plus discret de ce dépôt : une valeur hors CHECK
// fait échouer TOUT le lot d'upsert de la table, et le lot est rejoué
// indéfiniment — la synchro gèle pour tout le monde, sans message d'erreur.
// L'asymétrie testée ici est délibérée : à l'ÉCRITURE, une valeur inconnue
// tombe sur 'pending' (un point qui attend se rattrape d'un clic) ; à la
// LECTURE, une colonne ABSENTE se lit 'claimed' (sinon, le jour du déploiement,
// tous les ajustements déjà comptés retomberaient dans la banque d'un coup).
// ============================================================================
console.log('\n— Sérialisation : le jour où la base n\'a pas encore la colonne —');
{
  const ctx = makeCtx(makeState());

  // LECTURE d'une ligne d'avant la migration : pas de `state` du tout.
  const legacy = ctx._pointsLedgerFromRow({
    id: 'l0', player_id: 'p1', season_id: 's1', points_delta: 20,
    source_type: 'manual_adjustment', created_at: '2026-08-01T10:00:00Z',
  });
  eq(legacy.state, 'claimed', 'ligne sans colonne state → déjà encaissée');
  eq(legacy.claimedAt, null, '… et sans horodatage de récolte');

  // ÉCRITURE : un état farfelu ne doit JAMAIS partir tel quel vers le CHECK.
  const dumped = ctx._dumpPointsLedgerRow({
    id: 'l1', playerId: 'p1', seasonId: 's1', pointsDelta: 20,
    sourceType: 'manual_adjustment', state: 'n\'importe quoi', updatedAt: 1,
  });
  eq(dumped.state, 'pending', 'état inconnu → pending (jamais envoyé au CHECK)');
  eq(ctx._dumpPointsLedgerRow({ id: 'l2', state: 'claimed', claimedAt: 0 }).claimed_at, null,
     'claimedAt à 0 ne fabrique pas une date de 1970');

  // Le repère : le jsonb est BORNÉ, sinon il enfle jusqu'à faire échouer le lot.
  const big = ctx._dumpPointsHarvestRow({
    id: 'p1|s1', playerId: 'p1', seasonId: 's1', claimedThrough: 1,
    claimedKeys: new Array(400).fill('training_attendance|cv1|2026-08-03'),
    claimedTotal: 80, updatedAt: 1,
  });
  eq(big.claimed_keys.length, 200, 'la liste de rattrapage est bornée à 200 clés');
  eq(ctx._pointsHarvestFromRow({ id: 'p1|s1', claimed_keys: null }).claimedKeys.length, 0,
     'un jsonb nul se lit comme une liste vide, pas comme un crash');
  eq(ctx._pointsHarvestFromRow({ id: 'p1|s1' }).claimedThrough, 0,
     'un repère sans date vaut zéro : tout est en banque, rien n\'est perdu');
}

console.log('');
if (failures) { console.error(`✗ ${failures} assertion(s) en échec`); process.exit(1); }
console.log('✅ test-points-integration : code réel d\'index.html, tout passe');
