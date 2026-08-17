// ---------------------------------------------------------------------------
// L'HÉRITAGE D'UNE INDISPONIBILITÉ NE DOIT PAS ÊTRE CASSÉ PAR UNE RÉPONSE
// DONNÉE SUR UNE AUTRE DATE.
// ---------------------------------------------------------------------------
// Scénario vécu (Emma Bianchini, 2026-08-17) : une joueuse indisponible toute la
// fin août apparaissait DISPO le 26 août. La table `convocation_responses` est
// clé sur (convocation, joueuse, instance_date), mais l'état client repliait
// tout sur la seule joueuse, et `_convocResp` resservait cette réponse sur
// n'importe quelle date de la convocation. Une réponse manuelle donnée UNE fois
// éteignait donc l'héritage sur TOUTES les autres dates — une réponse explicite
// primant toujours sur le dérivé.
//
// Règle vérifiée ici, dans les deux sens :
//   • réponse manuelle sur la date D  → elle vaut sur D, et SEULEMENT sur D ;
//   • aucune réponse sur la date E    → l'indisponibilité reprend la main sur E.
//
// Les fonctions sont extraites de index.html et évaluées, pas grepées : un test
// qui se contente de chercher une chaîne ne prouve rien sur le comportement.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// PB_INDEX permet de rejouer ce test contre un index.html d'une AUTRE révision.
// C'est la seule façon de prouver qu'il vaut quelque chose : rejoué contre le
// SHA d'AVANT le correctif, il DOIT échouer.
const SRC = readFileSync(process.env.PB_INDEX || join(ROOT, 'index.html'), 'utf8');

// --- extraction d'une déclaration `function nom(` jusqu'à son accolade fermante
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fonction introuvable dans index.html : ${name}`);
  let i = SRC.indexOf('{', start), depth = 0, inS = null, prev = '';
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (inS) {
      if (ch === inS && prev !== '\\') inS = null;
    } else if (ch === '"' || ch === "'" || ch === '`') inS = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
    prev = ch;
  }
  throw new Error(`accolade fermante introuvable pour ${name}`);
}

// `_convocRespRaw` n'existe qu'À PARTIR du correctif : on ne l'exige pas, sinon
// le test planterait sur l'ancienne révision au lieu d'y ÉCHOUER proprement.
const NEEDED = [
  '_convocResp', 'resolveEffectivePresence',
  '_unavailOn', '_medicalUnavailOn', '_unavailEffectiveOn', '_unavailMeta',
];
const OPTIONAL = ['_convocRespRaw'];
const src = [
  ...OPTIONAL.filter(n => SRC.includes(`function ${n}(`)),
  ...NEEDED,
].map(extractFn).join('\n');

// Constantes lues dans index.html (jamais recopiées à la main : si la liste des
// motifs change là-bas, ce test doit suivre ou casser).
const UNAVAIL_REASONS = eval(
  SRC.slice(SRC.indexOf('const UNAVAIL_REASONS = ['))
     .match(/\[[\s\S]*?\];/)[0].slice(0, -1));
const UNAVAIL_LABEL = SRC.match(/const UNAVAIL_LABEL = '([^']+)'/)[1];

const state = { players: [], playerUnavailabilities: [] };
const isoDate = (d) => d.toISOString().slice(0, 10);
const ctx = { state, isoDate, UNAVAIL_REASONS, UNAVAIL_LABEL };
const make = new Function(
  ...Object.keys(ctx),
  `${src}\n return { _convocResp, resolveEffectivePresence };`);
const { _convocResp } = make(...Object.values(ctx));

// --- scénario -------------------------------------------------------------
const EMMA = 'emma';
const D19 = '2026-08-19';   // elle a répondu « absente · Travail / études »
const D26 = '2026-08-26';   // elle n'a RIEN répondu → l'indispo doit reprendre

state.players = [{ id: EMMA, name: 'Emma Bianchini', injury: null }];
state.playerUnavailabilities = [{
  id: 'u1', playerId: EMMA, startsAt: '2026-08-01', endsAt: '2026-08-31',
  reason: 'perso', notes: '', deletedAt: null,
}];

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label} → ${got}${ok ? '' : ` (attendu ${want})`}`);
  ok ? pass++ : fail++;
};

// ===========================================================================
console.log('\n1. Convoc RÉCURRENTE, réponse manuelle sur le 19 via instanceOverrides');
// C'est la forme réelle en base pour « Entraînement Mercredi ».
const rec = {
  id: 'c1', date: D19, recurrence: { freq: 'weekly' },
  instanceOverrides: {
    [D19]: { responses: { [EMMA]: { status: 'absent', reason: 'Travail / études' } } },
    // Le 26 a bien un override (d'autres joueuses ont répondu) mais Emma n'y est pas.
    [D26]: { responses: { autre: { status: 'absent', reason: 'Vacances' } } },
  },
  responses: {}, responsesByDate: {},
};
check('19 août : sa réponse manuelle', _convocResp(rec, D19, EMMA).status, 'absent');
check('19 août : motif manuel conservé', _convocResp(rec, D19, EMMA).reason, 'Travail / études');
check('19 août : marquée NON dérivée', _convocResp(rec, D19, EMMA).auto, false);
check('26 août : indispo héritée', _convocResp(rec, D26, EMMA).status, 'absent');
check('26 août : dérivée de l\'indispo', _convocResp(rec, D26, EMMA).source, 'unavailability');
check('26 août : badge INDISPO nu', _convocResp(rec, D26, EMMA).motif, UNAVAIL_LABEL);

// ===========================================================================
console.log('\n2. LE BUG — une réponse « présente » à plat ne doit pas fuir sur les autres dates');
// `c.responses` est le repli à plat de convocation_responses. Avant le fix, il
// était lu SANS filtre de date : ce « présente » (donné le 19) éteignait
// l'indisponibilité le 26, le 2 septembre, et sur toute la série.
const leak = {
  id: 'c2', date: D19, recurrence: { freq: 'weekly' },
  instanceOverrides: {},
  responses: { [EMMA]: { status: 'present', reason: '', instanceDate: D19 } },
  responsesByDate: { [D19]: { [EMMA]: { status: 'present', reason: '', instanceDate: D19 } } },
};
check('19 août : « présente » explicite respecté', _convocResp(leak, D19, EMMA).status, 'present');
check('26 août : indispo INTACTE (le bug)', _convocResp(leak, D26, EMMA).status, 'absent');
check('26 août : bien dérivée', _convocResp(leak, D26, EMMA).source, 'unavailability');
check('2 sept. : hors période, présente', _convocResp(leak, '2026-09-02', EMMA).status, 'present');

// ===========================================================================
console.log('\n3. Réponse à plat SANS instanceDate → vaut pour la date propre, pas la série');
// Les écritures locales (saveAbsence / markPresent) ne datent pas leur réponse :
// elle vaut pour c.date. Elle ne doit pas déborder sur les autres occurrences.
const undated = {
  id: 'c3', date: D19, recurrence: { freq: 'weekly' },
  instanceOverrides: {},
  responses: { [EMMA]: { status: 'present', reason: '' } },
  responsesByDate: {},
};
check('19 août (= c.date) : réponse appliquée', _convocResp(undated, D19, EMMA).status, 'present');
check('26 août : indispo héritée', _convocResp(undated, D26, EMMA).status, 'absent');

// ===========================================================================
console.log('\n4. Convoc NON récurrente (match) — comportement inchangé');
const match = {
  id: 'c4', date: '2026-08-29', recurrence: null,
  instanceOverrides: {},
  responses: { [EMMA]: { status: 'absent', reason: 'Travail / études' } },
  responsesByDate: {},
};
check('29 août : réponse manuelle lue', _convocResp(match, '2026-08-29', EMMA).status, 'absent');
check('29 août : motif conservé', _convocResp(match, '2026-08-29', EMMA).reason, 'Travail / études');
check('dateISO omis → retombe sur c.date', _convocResp(match, null, EMMA).status, 'absent');

// ===========================================================================
console.log('\n5. Sans indisponibilité ni réponse → présente par défaut');
state.playerUnavailabilities = [];
check('26 août : présente par défaut', _convocResp(rec, D26, EMMA).status, 'present');
check('26 août : source par défaut', _convocResp(rec, D26, EMMA).source, 'default');

console.log(`\n${fail ? '✗' : '✓'} ${pass} assertion(s) OK, ${fail} échec(s)\n`);
process.exit(fail ? 1 : 0);
