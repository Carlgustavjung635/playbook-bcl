// ============================================================
// v.111 — La joueuse ne voit plus le NOMBRE d'absentes sur un entraînement.
//
// Ce test extrait le CODE RÉEL de index.html (heroCard + openEventInstance) et
// l'exécute avec des stubs. Il ne réimplémente RIEN : une réimplémentation
// donnerait un vert menteur le jour où quelqu'un touche à index.html sans
// toucher au test (piège déjà payé sur test-auto-update.mjs, cf. v.110).
//
// Matrice vérifiée :
//   joueuse + entraînement → « Présentes » OUI, « Absentes » NON
//   coach   + entraînement → les deux (vue coach INTACTE)
//   joueuse + match        → les deux (vue match INTACTE)
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};

// --- Extraction d'une fonction top-level par équilibrage d'accolades ---------
// Naïf sur les accolades en littéral, mais suffisant ici : on part de
// `function nom(` et on s'arrête à l'accolade fermante de même profondeur.
function extractFn(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`fonction ${name} introuvable dans index.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`accolades non équilibrées pour ${name}`);
}

// --- Stubs -------------------------------------------------------------------
const PLAYERS = [
  { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Chloe' }, { id: 'p4', name: 'Dina' },
];
const ABSENT_IDS = new Set(['p3', 'p4']); // 2 absentes → chiffre non nul, donc visible s'il n'est pas masqué

function makeEnv(role, type) {
  const conv = {
    id: 'c1', title: 'Séance du mardi', type, date: '2026-08-11', time: '19:00',
    seasonId: 's1', cancelledInstances: [], responses: {},
  };
  const captured = { html: null };
  const env = {
    state: {
      auth: { role, playerId: 'p1' },
      players: PLAYERS,
      convocations: [conv],
      currentSeasonId: 's1',
      matches: [],
    },
    esc: s => String(s == null ? '' : s),
    formatDate: d => String(d),
    daysUntil: () => 2,
    isoDate: () => '2026-08-09',
    currentSeasonPlayers: () => PLAYERS,
    getSeasonPlayers: () => PLAYERS,
    _seasonsLoaded: () => true,
    _convocResp: (c, dateStr, pid) => ({
      status: ABSENT_IDS.has(pid) ? 'absent' : 'present',
      auto: false, reason: '', motif: '', message: '', unavail: {},
    }),
    makeConvocInstance: (c) => ({ ...c, attachments: [], closed: false }),
    getTrainingPlan: () => ({ exercises: [], validated: false }),
    getTrainingGuests: () => [],
    renderAttachments: () => '',
    openModal: h => { captured.html = h; },
    INJURY_STATUS: {},
    _unavailMeta: () => ({ icon: '' }),
    _unavailRangeLabel: () => '',
    _autoCloseEnabled: () => false,
    _isTrainingOverdue: () => false,
    getMatchRoster: () => [],
    getMatchRdvTime: () => '',
  };
  return { env, captured, conv };
}

function run(fnName, role, type, invoke) {
  const { env, captured } = makeEnv(role, type);
  const names = Object.keys(env);
  const body = `${extractFn(fnName)}\nreturn ${fnName};`;
  const fn = new Function(...names, body)(...names.map(n => env[n]));
  const ret = invoke(fn, env);
  return captured.html != null ? captured.html : ret;
}

// --- 1. openEventInstance (écran de détail entraînement) ---------------------
console.log("\nopenEventInstance — détail d'un entraînement");
{
  const playerHtml = run('openEventInstance', 'player', 'training', f => f('c1', '2026-08-11'));
  ok(playerHtml.includes('Présentes'), 'joueuse : « Présentes » toujours affiché');
  ok(!playerHtml.includes('>Absentes<'), 'joueuse : compteur « Absentes » MASQUÉ');

  const coachHtml = run('openEventInstance', 'coach', 'training', f => f('c1', '2026-08-11'));
  ok(coachHtml.includes('Présentes'), 'coach : « Présentes » affiché');
  ok(coachHtml.includes('>Absentes<'), 'coach : compteur « Absentes » INTACT');
  ok(coachHtml.includes('Chloe') && coachHtml.includes('Dina'), 'coach : noms des absentes INTACTS');
}

console.log("\nopenEventInstance — détail d'un match (ne doit RIEN changer)");
{
  const playerHtml = run('openEventInstance', 'player', 'match', f => f('c1', '2026-08-11'));
  ok(playerHtml.includes('>Absentes<'), 'joueuse + match : compteur « Absentes » INCHANGÉ');
}

// --- 2. heroCard (page d'accueil) -------------------------------------------
console.log('\nheroCard — carte « prochain événement »');
{
  const ev = { id: 'c1', title: 'Séance du mardi', date: '2026-08-11', time: '19:00', type: 'training' };
  const playerHtml = run('heroCard', 'player', 'training', f => f(ev));
  ok(!/\d+\s*absente/.test(playerHtml), 'joueuse : « ⚠ N absentes » MASQUÉ sur entraînement');

  const coachHtml = run('heroCard', 'coach', 'training', f => f(ev));
  ok(/2 absentes/.test(coachHtml), 'coach : « ⚠ 2 absentes » INTACT sur entraînement');

  const evMatch = { ...ev, type: 'match' };
  const playerMatchHtml = run('heroCard', 'player', 'match', f => f(evMatch));
  ok(/2 absentes/.test(playerMatchHtml), 'joueuse + match : « ⚠ 2 absentes » INCHANGÉ');
}

// --- 3. Garde statique : le compteur reste bien gardé ------------------------
console.log('\nGarde statique');
{
  const guards = html.match(/const hideAbsentCount = state\.auth\.role === 'player'/g) || [];
  ok(guards.length === 2, `2 gardes hideAbsentCount attendues, ${guards.length} trouvée(s)`);
}

console.log(failures === 0 ? '\n✅ Tous les tests passent' : `\n❌ ${failures} test(s) en échec`);
process.exit(failures ? 1 : 0);
