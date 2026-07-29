// Test DÉDOUBLONNAGE DES CONVOCATIONS DE MATCH — convergence après sync.
//
// INCIDENT (2026-07-29) : 9 convocations de type 'match' en base pour 4 matchs.
// Conséquence visible : le désistement d'une joueuse était bien enregistré, mais
// l'écran match lisait une AUTRE convocation du même match (celle sans RSVP) —
// « j'ai eu la notif mais ce n'est pas enregistré ».
//
// Deux causes, toutes deux couvertes ici :
//   1. cleanupOrphanMatchConvocs tournait au premier render, donc AVANT
//      PbSync.fetchAll, puis le verrou _bootCleanupDone l'empêchait de repasser.
//      Les doublons du serveur arrivaient après et n'étaient jamais nettoyés.
//   2. sur un appareil au cache vide, « aucune candidate » faisait CRÉER une
//      convoc neuve par match → un doublon de plus à chaque nouvel appareil.
//
// Harnais : extraction des fonctions du vrai index.html (pas de vm complet — on
// veut piloter finement l'ordre sync/cleanup, que le boot réel ne permet pas).
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

const SRC = ['_matchConvocSig', '_matchSig', '_convocMatchSig', '_convocsForMatch', 'cleanupOrphanMatchConvocs']
  .map(extractFn).join('\n\n');

// Monte un bac à sable autour du sujet. `syncConvocFromMatch` est stubé pour
// tracer les créations (c'est exactement ce qu'on veut compter).
function build(state, { firstSyncDone = true } = {}) {
  const log = { created: [], persisted: 0, logs: [] };
  const win = { _pbFirstSyncDone: firstSyncDone };
  let seq = 0;
  const api = new Function('state', 'window', 'persist', 'console', 'syncConvocFromMatch', 'uid',
    SRC + '\nreturn { cleanupOrphanMatchConvocs, _convocsForMatch, _matchSig };'
  )(
    state, win, () => log.persisted++,
    { log: (...a) => log.logs.push(a.join(' ')), warn: () => {} },
    (m) => {                                   // stub de création
      const id = 'xNEW' + (++seq);
      state.convocations.push({ id, type: 'match', title: 'vs ' + m.opponent, date: m.date,
        teamTag: m.teamTag || 'e1', matchId: m.id, responses: {} });
      m.convocId = id;
      log.created.push(id);
    },
    () => 'xUID'
  );
  return { api, log, win };
}

// Décor calqué sur la production : 1 match, plusieurs convocs de même signature,
// le RSVP posé sur celle du plus petit id (= la survivante attendue).
function decor(convocIds, rsvpOn) {
  return {
    matches: [{ id: 'm1', date: '2026-09-09', opponent: 'Rejaumont (amical)', teamTag: 'e1', convocId: null }],
    convocations: convocIds.map(id => ({
      id, type: 'match', title: 'vs Rejaumont (amical)', date: '2026-09-09', teamTag: 'e1',
      responses: id === rsvpOn ? { pA: { status: 'absent', reason: 'Blessure', at: 1000 } } : {},
    })),
  };
}

// --- 1) le cas de production ------------------------------------------------
t('3 convocs pour 1 match → 1 seule survivante', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1', 'x1784794838567ahea'], 'x1783000115781tmq1');
  const { api } = build(s);
  api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 1, 'restant = ' + s.convocations.length);
});
t('la survivante est le PLUS PETIT id (règle partagée avec la migration SQL)', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1', 'x1784794838567ahea'], 'x1783000115781tmq1');
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations[0].id === 'x1783000115781tmq1', 'survivante = ' + s.convocations[0].id);
});
t('le match pointe sur la survivante (m.convocId)', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1783000115781tmq1');
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.matches[0].convocId === 'x1783000115781tmq1', 'convocId = ' + s.matches[0].convocId);
});
t('LE BUG D\'ORIGINE : le désistement reste lisible depuis le match', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1783000115781tmq1');
  build(s).api.cleanupOrphanMatchConvocs();
  const c = s.convocations.find(x => x.id === s.matches[0].convocId);
  ok(c && c.responses.pA && c.responses.pA.status === 'absent', 'absence introuvable depuis le match');
});
t('un RSVP posé sur un DOUBLON est récupéré, pas perdu', () => {
  // Ici l'absence est sur le plus GRAND id : elle doit migrer sur la survivante.
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1784847951280b4zu');
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 1, 'restant = ' + s.convocations.length);
  ok(s.convocations[0].responses.pA, 'RSVP perdu avec le doublon');
  ok(s.convocations[0].responses.pA.reason === 'Blessure', 'motif perdu');
});
t('la survivante garde SON RSVP en cas de conflit', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1783000115781tmq1');
  s.convocations.find(c => c.id === 'x1784847951280b4zu').responses = { pA: { status: 'present', at: 9 } };
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations[0].responses.pA.status === 'absent', 'la réponse du doublon a écrasé la survivante');
});

// --- 2) CONVERGENCE : le nettoyage doit repasser APRÈS la sync --------------
t('après une sync qui ramène des doublons, un 2e passage reconverge', () => {
  const s = decor(['x1783000115781tmq1'], 'x1783000115781tmq1');
  const { api } = build(s);
  api.cleanupOrphanMatchConvocs();                       // passage « boot »
  ok(s.convocations.length === 1, 'état initial KO');
  // fetchAll : l'apply REMPLACE le tableau par les lignes distantes (doublons compris)
  s.convocations = ['x1784847951280b4zu', 'x1783000115781tmq1', 'x1784794838567ahea'].map(id => ({
    id, type: 'match', title: 'vs Rejaumont (amical)', date: '2026-09-09', teamTag: 'e1',
    responses: id === 'x1783000115781tmq1' ? { pA: { status: 'absent', at: 1 } } : {},
  }));
  api.cleanupOrphanMatchConvocs();                       // passage « post-sync »
  ok(s.convocations.length === 1, 'pas de reconvergence : ' + s.convocations.length);
  ok(s.convocations[0].id === 'x1783000115781tmq1', 'mauvaise survivante');
});
t('le nettoyage est IDEMPOTENT (rejouable sans effet ni écriture)', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1783000115781tmq1');
  const { api, log } = build(s);
  api.cleanupOrphanMatchConvocs();
  const after = log.persisted;
  api.cleanupOrphanMatchConvocs();
  api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 1, 'restant = ' + s.convocations.length);
  ok(log.persisted === after, 'écritures parasites : ' + (log.persisted - after));
});

// --- 3) ANTI-PROLIFÉRATION : ne rien créer avant la 1re sync ---------------
t('cache vide + sync PAS faite → aucune convoc créée', () => {
  const s = { matches: [{ id: 'm1', date: '2026-09-09', opponent: 'Rejaumont (amical)', teamTag: 'e1', convocId: null }],
    convocations: [{ id: 'xAutre', type: 'training', title: 'Entraînement', date: '2026-09-10' }] };
  const { api, log } = build(s, { firstSyncDone: false });
  api.cleanupOrphanMatchConvocs();
  ok(log.created.length === 0, 'convoc créée avant la sync : ' + log.created.join(','));
});
t('...puis après la sync, la convoc distante est ADOPTÉE (pas dupliquée)', () => {
  const s = { matches: [{ id: 'm1', date: '2026-09-09', opponent: 'Rejaumont (amical)', teamTag: 'e1', convocId: null }],
    convocations: [] };
  const { api, log, win } = build(s, { firstSyncDone: false });
  api.cleanupOrphanMatchConvocs();
  s.convocations = [{ id: 'xDistante', type: 'match', title: 'vs Rejaumont (amical)',
    date: '2026-09-09', teamTag: 'e1', responses: {} }];
  win._pbFirstSyncDone = true;
  api.cleanupOrphanMatchConvocs();
  ok(log.created.length === 0, 'doublon créé : ' + log.created.join(','));
  ok(s.convocations.length === 1 && s.matches[0].convocId === 'xDistante', 'adoption KO');
});
t('un match réellement sans convoc en a bien une APRÈS la sync', () => {
  const s = { matches: [{ id: 'm1', date: '2026-09-09', opponent: 'Rejaumont (amical)', teamTag: 'e1', convocId: null }],
    convocations: [] };
  const { api, log } = build(s, { firstSyncDone: true });
  api.cleanupOrphanMatchConvocs();
  ok(log.created.length === 1, 'aucune convoc créée alors qu\'il en manquait une');
});
t('base LOCALE vide + pas de sync → toujours aucune création', () => {
  // Pas d'exception pour « rien en local » : c'est exactement l'état d'un
  // appareil neuf, le cas qui fabriquait les doublons en production.
  const s = { matches: [{ id: 'm1', date: '2026-09-09', opponent: 'X', teamTag: 'e1', convocId: null }],
    convocations: [] };
  const { api, log } = build(s, { firstSyncDone: false });
  api.cleanupOrphanMatchConvocs();
  ok(log.created.length === 0, 'doublon fabriqué sur appareil neuf : ' + log.created.join(','));
});

// --- 4) pas de dégât collatéral ---------------------------------------------
t('les convocations d\'ENTRAÎNEMENT ne sont jamais touchées', () => {
  const s = decor(['x1784847951280b4zu', 'x1783000115781tmq1'], 'x1783000115781tmq1');
  s.convocations.push({ id: 'xTr1', type: 'training', title: 'Entraînement', date: '2026-09-10', responses: {} });
  s.convocations.push({ id: 'xTr2', type: 'training', title: 'Entraînement', date: '2026-09-10', responses: {} });
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations.filter(c => c.type === 'training').length === 2, 'entraînements dédoublonnés à tort');
});
t('deux matchs le MÊME JOUR mais adversaires différents restent distincts', () => {
  const s = {
    matches: [
      { id: 'm1', date: '2026-09-09', opponent: 'Rejaumont', teamTag: 'e1', convocId: null },
      { id: 'm2', date: '2026-09-09', opponent: 'Juillan', teamTag: 'e1', convocId: null },
    ],
    convocations: [
      { id: 'xA', type: 'match', title: 'vs Rejaumont', date: '2026-09-09', teamTag: 'e1', responses: {} },
      { id: 'xB', type: 'match', title: 'vs Juillan', date: '2026-09-09', teamTag: 'e1', responses: {} },
    ],
  };
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 2, 'fusion abusive : ' + s.convocations.length);
});
t('même adversaire le même jour mais E1/E2 restent distincts', () => {
  const s = {
    matches: [
      { id: 'm1', date: '2026-09-09', opponent: 'Rejaumont', teamTag: 'e1', convocId: null },
      { id: 'm2', date: '2026-09-09', opponent: 'Rejaumont', teamTag: 'e2', convocId: null },
    ],
    convocations: [
      { id: 'xA', type: 'match', title: 'vs Rejaumont', date: '2026-09-09', teamTag: 'e1', responses: {} },
      { id: 'xB', type: 'match', title: 'vs Rejaumont', date: '2026-09-09', teamTag: 'e2', responses: {} },
    ],
  };
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 2, 'E1 et E2 fusionnés : ' + s.convocations.length);
});
t('une convocation orpheline (match supprimé) part', () => {
  const s = { matches: [], convocations: [
    { id: 'xOrph', type: 'match', title: 'vs Disparu', date: '2026-09-09', teamTag: 'e1', responses: {} }] };
  build(s).api.cleanupOrphanMatchConvocs();
  ok(s.convocations.length === 0, 'orpheline conservée');
});

// --- 5) câblage réel dans index.html ----------------------------------------
t('le nettoyage est bien rappelé après PbSync.fetchAll', () => {
  const i = html.indexOf('PbSync.fetchAll(state).then(');
  ok(i > 0, 'appel fetchAll introuvable');
  const after = html.slice(i, i + 900);
  ok(/cleanupOrphanMatchConvocs\(\)/.test(after), 'pas de nettoyage post-sync');
  ok(/_pbFirstSyncDone\s*=\s*true/.test(after), 'drapeau de 1re sync non posé');
});
t('le drapeau de 1re sync garde bien la création', () => {
  const src = extractFn('cleanupOrphanMatchConvocs');
  ok(/_pbFirstSyncDone/.test(src), 'garde absente de cleanupOrphanMatchConvocs');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
