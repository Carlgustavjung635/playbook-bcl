// Harnais — « Annuler la dernière action » ne changeait pas le score global.
// ---------------------------------------------------------------------------
// Ce test n'écrit PAS une copie de la logique : il EXTRAIT les fonctions réelles
// d'index.html (liveActionFor / recalcMatchScore / undoLastAction / helpers) et
// les exécute avec des bouchons. Une copie « fidèle » aurait justement raté le
// bug, qui tient à un seul caractère de différence entre `increment` (paramètre
// brut) et `inc` (valeur normalisée par `increment || 1`).
//
// Baseline : rejouer ce fichier contre le SHA d'AVANT le correctif doit faire
// ÉCHOUER les scénarios 1 à 4 (score inchangé après annulation).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');

// --- extraction par équilibrage d'accolades (le seul moyen sûr sur ce fichier)
function extract(decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error('introuvable dans index.html : ' + decl);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('accolades non équilibrées pour ' + decl);
}
const LINE_MADE_KEYS = /const LIVE_MADE_KEYS = \[[^\]]*\];/.exec(src);

const code = [
  LINE_MADE_KEYS ? LINE_MADE_KEYS[0] : "const LIVE_MADE_KEYS = [];",
  src.includes('function _liveEntryIsMade') ? extract('function _liveEntryIsMade') : 'function _liveEntryIsMade(){return false}',
  extract('function liveActionFor(playerId, key, increment)'),
  extract('function recalcMatchScore(m)'),
  extract('function undoLastAction()'),
].join('\n');

// --- bouchons ---------------------------------------------------------------
const K = { liveSession: 'live' };
const state = {
  matches: [], players: [{ id: 'p1', num: 7, name: 'Test' }],
  live: { matchId: 'm1', selectedPlayer: 'p1', log: [] },
};
const save = () => {}, persist = () => {}, render = () => {};
const pushLiveScore = () => {};
const window = { PbStore: null };
const { liveActionFor, undoLastAction, recalcMatchScore } =
  new Function('state', 'K', 'save', 'persist', 'render', 'pushLiveScore', 'window',
    code + '\nreturn { liveActionFor, undoLastAction, recalcMatchScore };')
    (state, K, save, persist, render, pushLiveScore, window);

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`  ✅ ${label} = ${got}`); }
  else { fail++; console.log(`  ❌ ${label} = ${got} (attendu ${want})`); }
}
function fresh() {
  state.matches = [{ id: 'm1', scoreUs: 0, scoreOpp: 0, playerStats: {} }];
  state.live = { matchId: 'm1', selectedPlayer: 'p1', log: [] };
  return state.matches[0];
}

// --- scénarios --------------------------------------------------------------
for (const [key, pts, attKey] of [['p2i', 2, 'p2iA'], ['p2e', 2, 'p2eA'], ['p3', 3, 'p3A'], ['ft', 1, 'ftA']]) {
  console.log(`\nSCÉNARIO — tir réussi ${key} marqué puis ANNULÉ`);
  const m = fresh();
  liveActionFor('p1', key);
  eq(`score après le panier`, m.scoreUs, pts);
  undoLastAction();
  eq(`score après annulation`, m.scoreUs, 0);
  eq(`pts joueuse`, m.playerStats.p1.pts, 0);
  eq(`${key} (réussis)`, m.playerStats.p1[key], 0);
  eq(`${attKey} (tentatives)`, m.playerStats.p1[attKey], 0);
  eq(`journal vidé`, state.live.log.length, 0);
}

console.log('\nSCÉNARIO — contre-attaque (CA) marquée puis ANNULÉE');
{
  const m = fresh();
  liveActionFor('p1', 'ca');
  eq('score après la CA', m.scoreUs, 2);
  undoLastAction();
  eq('score après annulation', m.scoreUs, 0);
  eq('ca', m.playerStats.p1.ca, 0);
  eq('p2i dérivé', m.playerStats.p1.p2i, 0);
  eq('p2iA dérivé', m.playerStats.p1.p2iA, 0);
}

console.log('\nSCÉNARIO — un tir RATÉ annulé ne doit PAS toucher au score');
{
  const m = fresh();
  liveActionFor('p1', 'p3');          // +3
  liveActionFor('p1', 'p3A', 1);      // raté, +0
  eq('score après les deux', m.scoreUs, 3);
  undoLastAction();                    // annule le raté
  eq('score inchangé', m.scoreUs, 3);
  eq('p3A revenu à 0', m.playerStats.p1.p3A, 1); // 1 = la tentative du tir réussi
}

console.log('\nSCÉNARIO — stat non chiffrante (rebond) annulée');
{
  const m = fresh();
  liveActionFor('p1', 'p2i');
  liveActionFor('p1', 'reb', 1);
  undoLastAction();
  eq('score intact', m.scoreUs, 2);
  eq('rebond retiré', m.playerStats.p1.reb, 0);
}

console.log('\nSCÉNARIO — entrée LEGACY (journal écrit avant le correctif : pas de champ `made`)');
{
  const m = fresh();
  liveActionFor('p1', 'p2i');
  delete state.live.log[0].made;       // exactement ce qu'un localStorage d'avant contient
  undoLastAction();
  eq('score après annulation', m.scoreUs, 0);
  eq('pts joueuse', m.playerStats.p1.pts, 0);
  eq('p2iA', m.playerStats.p1.p2iA, 0);
}

console.log('\nSCÉNARIO — score adverse : +3 puis annulation');
{
  const m = fresh();
  state.live.log.push({ label: 'Adversaire +3', value: 3, playerId: null, key: 'opp', inc: 3 });
  m.scoreOpp = 3;
  undoLastAction();
  eq('scoreOpp', m.scoreOpp, 0);
}

console.log('\nSCÉNARIO — journal vide / match introuvable : aucune casse, rien de perdu');
{
  fresh();
  undoLastAction();                                  // journal vide
  eq('journal toujours vide', state.live.log.length, 0);
  liveActionFor('p1', 'p2i');
  state.live.matchId = 'inconnu';
  undoLastAction();                                  // match introuvable
  eq("l'entrée n'a PAS été consommée", state.live.log.length, 1);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} assertions OK, ${fail} en échec.`);
process.exit(fail === 0 ? 0 : 1);
