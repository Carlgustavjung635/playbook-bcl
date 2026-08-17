// Smoke test : le moteur de tirage RÉEL d'index.html, nourri des 25 exos de la
// migration 20260816_005. Aucune base touchée, aucun DOM — on extrait les
// fonctions pures du casino et on les fait tourner.
import fs from 'fs';
import vm from 'vm';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^/([A-Za-z]:)/, '$1');
const src = fs.readFileSync(ROOT + '/index.html', 'utf8');
const sql = fs.readFileSync(ROOT + '/supabase/migrations/20260816_005_ardoise_seed_exos.sql', 'utf8');

// --- extraction : brace-matching qui SAIT ignorer chaînes, template literals
// (imbriqués) et commentaires. Un compteur naïf de `{` casse sur `${...}`.
function matchBlock(s, start, open, close) {
  let i = start, depth = 0, tpl = [];
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (!tpl.length && (c === '"' || c === "'")) {          // chaîne simple
      i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } i++; continue;
    }
    if (c === '`') { tpl.push('tpl'); i++; continue; }
    if (tpl.length) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { tpl.pop(); i++; continue; }
      if (c === '$' && n === '{') { tpl.push('expr'); i += 2; continue; }
      if (c === '}' && tpl[tpl.length - 1] === 'expr') { tpl.pop(); i++; continue; }
      i++; continue;
    }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = s.indexOf('*/', i) + 2; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return i + 1; }
    i++;
  }
  throw new Error('bloc non refermé');
}
function grabFn(name) {
  const sig = src.indexOf('\nfunction ' + name + '(');
  if (sig < 0) throw new Error('fonction introuvable : ' + name);
  const body = src.indexOf('{', src.indexOf(')', sig));
  return src.slice(sig + 1, matchBlock(src, body, '{', '}'));
}
function grabConst(name, open, close) {
  const at = src.indexOf('\nconst ' + name + ' =');
  if (at < 0) throw new Error('const introuvable : ' + name);
  const b = src.indexOf(open, at);
  return src.slice(at + 1, matchBlock(src, b, open, close)) + ';';
}

// --- les 25 exos, lus DANS LA MIGRATION (pas réécrits à la main ici)
const seeded = [...sql.matchAll(
  /\('(seed-ard-[a-z0-9-]+)',\s*'((?:[^']|'')*)',\s*'(\w+)',\s*(\d+|null),\s*(\d+|null),\s*(\d+|null),\s*(\d+),/g
)].map(m => ({
  id: m[1], name: m[2].replace(/''/g, "'"), category: m[3],
  defaultSets: m[4] === 'null' ? null : +m[4],
  defaultReps: m[5] === 'null' ? null : +m[5],
  defaultDurationSec: m[6] === 'null' ? null : +m[6],
  defaultRestSec: +m[7], deletedAt: null
}));

const sandbox = {
  state: { exoTemplates: seeded, ardoiseAssignments: [] },
  ardoiseRules: () => ({ exosPerSpin: 4, cardioAlways: true, randomSeedIsolation: true }),
  console
};
vm.createContext(sandbox);
const code = [
  grabConst('ARDOISE_REELS', '[', ']'),
  grabConst('ARDOISE_REEL_IDS', '[', ']'),
  grabConst('ARDOISE_JACKPOT_NAMES', '[', ']'),
  // Les helpers du tirage. On tente large : ce qui n'existe pas est ignoré,
  // ce qui manque vraiment se signalera par un ReferenceError à l'exécution.
  ...['_ardHash', '_ardRng', '_ardPick', '_ardShuffle', '_ardTitle', '_ardProgramTitle',
      '_ardDoseOf', 'ardoiseReelPool', 'ardoiseReelCounts', 'ardoiseLibraryReady',
      'ardoiseDrawProgram'].map(n => { try { return grabFn(n); } catch (e) { return ''; } })
].join('\n');
// Un `const` de haut niveau vit dans la portée LEXICALE globale du contexte, pas
// sur l'objet sandbox : on le ressort par une expression évaluée dans ce contexte.
vm.runInContext(code + '\nglobalThis.__exports = { ARDOISE_REELS, ARDOISE_REEL_IDS };', sandbox);
const { ardoiseReelCounts, ardoiseLibraryReady, ardoiseDrawProgram } = sandbox;
const { ARDOISE_REEL_IDS } = sandbox.__exports;

// --- assertions
let ko = 0;
const ok = (label, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  ÉCHEC') + ' ' + label + (extra ? '  → ' + extra : ''));
  if (!cond) ko++;
};

console.log('\n--- Bibliothèque seedée ---');
ok('25 exos parsés depuis la migration', seeded.length === 25, seeded.length + ' exos');
const counts = ardoiseReelCounts();
ARDOISE_REEL_IDS.forEach(id => ok('rouleau ' + id + ' garni (5)', counts[id] === 5, counts[id] + ' exos'));
ok('ardoiseLibraryReady() = true', ardoiseLibraryReady() === true);

console.log('\n--- 500 tirages preview (graines aléatoires, comme le bouton coach) ---');
const seen = new Set();
let cardioHits = 0, badLen = 0, badCat = 0, dupInProgram = 0, missingDose = 0;
for (let i = 0; i < 500; i++) {
  const p = ardoiseDrawProgram('preview:' + Date.now() + ':' + Math.random() + ':' + i, { exclude: null });
  if (!p || p.items.length !== 4) { badLen++; continue; }
  if (p.items.some(it => ARDOISE_REEL_IDS.indexOf(it.category) === -1)) badCat++;
  if (new Set(p.items.map(it => it.exo_id)).size !== 4) dupInProgram++;
  if (p.items.some(it => !it.name || (!it.reps && !it.duration_sec))) missingDose++;
  if (p.items.some(it => it.category === 'cardio')) cardioHits++;
  seen.add(p.items.map(it => it.exo_id).sort().join('|'));
}
ok('500/500 programmes de 4 exos', badLen === 0, badLen + ' hors format');
ok('aucune catégorie hors rouleau', badCat === 0);
ok('aucun exo répété dans un même programme', dupInProgram === 0);
ok('chaque exo porte nom + dose (reps ou durée)', missingDose === 0);
ok('cardio_always respecté (100 %)', cardioHits === 500, cardioHits + '/500');
ok('programmes distincts > 100', seen.size > 100, seen.size + ' combinaisons vues');

console.log('\n--- Déterminisme (la dette rejoue son tirage) ---');
const a = ardoiseDrawProgram('ard:demo-1', { exclude: null });
const b = ardoiseDrawProgram('ard:demo-1', { exclude: null });
ok('même graine → même programme', JSON.stringify(a) === JSON.stringify(b),
   a.items.map(i => i.name).join(' · '));
ok('graine différente → programme différent',
   JSON.stringify(a) !== JSON.stringify(ardoiseDrawProgram('ard:demo-2', { exclude: null })));

console.log('\n--- random_seed_isolation (2 dettes d\'affilée) ---');
const prev = new Set(a.items.map(i => i.exo_id));
const next = ardoiseDrawProgram('ard:demo-3', { exclude: prev });
ok('le tirage suivant ne repioche aucun exo du précédent',
   next.items.every(i => !prev.has(i.exo_id)),
   next.items.map(i => i.name).join(' · '));

console.log('\n--- Exemple de programme tiré ---');
a.items.forEach(i => console.log('   ' + i.category.padEnd(9) + ' ' + i.name +
  '  → ' + (i.sets || 1) + '×' + (i.reps ? i.reps : i.duration_sec + 's')));
console.log('   titre : ' + a.title);

console.log(ko ? '\n=== ' + ko + ' ÉCHEC(S) ===' : '\n=== TOUT PASSE ===');
process.exit(ko ? 1 : 0);
