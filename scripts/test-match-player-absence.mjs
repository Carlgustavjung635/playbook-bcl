// Test : la joueuse peut se déclarer absente à un MATCH depuis le détail match.
// Réutilise la convoc liée (non récurrente → c.responses), notifie le coach,
// reste dans le détail match (pas de détour openEventInstance). Match passé → rien.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

// _rsvpStamp / _rsvpPresent horodatent la réponse RSVP (sans quoi un désistement
// n'a pas de date et ne peut pas entrer dans le feed de notifs) et écrivent un
// statut 'present' explicite au lieu de supprimer la ligne. Extraits eux aussi :
// matchSaveAbsence/matchRestorePresence les appellent.
// _effectiveConvocStatus délègue à _convocResp (v.91), qui lit les
// indisponibilités : ses dépendances doivent être extraites avec lui.
// v.97 : _convocResp délègue à resolveEffectivePresence, qui interroge les DEUX
// gisements d'indisponibilité (période saisie + statut médical de la fiche).
const src = ['_unavailMeta', '_unavailOn', '_medicalUnavailOn', '_unavailEffectiveOn', 'resolveEffectivePresence',
  '_convocRespRaw', '_convocResp', '_rsvpStamp', '_rsvpPresent', '_effectiveConvocStatus', '_matchConvoc', 'matchSaveAbsence', 'matchRestorePresence']
  .map(extractFn).join('\n\n');
function build(state, formValues = { 'ab-reason': 'Blessure', 'ab-msg': 'désolée' }) {
  const log = { notified: [], persisted: 0, closed: 0, rendered: 0 };
  const document = { getElementById: id => ({ value: formValues[id] || '' }) };
  const api = new Function('state', 'persist', 'closeModal', 'render', 'document', '_notifyCoachConvocResponse',
    src + '\nreturn { matchSaveAbsence, matchRestorePresence, _effectiveConvocStatus };'
  )(state, () => log.persisted++, () => log.closed++, () => log.rendered++, document,
    (c, d, prev, next) => log.notified.push([prev, next]));
  return { api, log };
}
function state(role = 'player', responses = {}) {
  return {
    auth: { role, playerId: 'pl' },
    matches: [{ id: 'm1', convocId: 'cv1', date: '2026-07-10', opponent: 'CA Pontacq' }],
    convocations: [{ id: 'cv1', matchId: 'm1', type: 'match', date: '2026-07-10', responses }],
  };
}

console.log('SCÉNARIO 1 — déclarer absente : écrit responses + notifie le coach');
{
  const s = state();
  const { api, log } = build(s);
  api.matchSaveAbsence('m1');
  t('c.responses[pid] = {status:absent, reason, message}', () => {
    const r = s.convocations[0].responses.pl;
    assert.strictEqual(r.status, 'absent');
    assert.strictEqual(r.reason, 'Blessure');
    assert.strictEqual(r.message, 'désolée');
  });
  t('push coach present→absent + persist + closeModal + render', () => {
    assert.deepStrictEqual(log.notified, [['present', 'absent']]);
    assert.ok(log.persisted >= 1 && log.closed >= 1 && log.rendered >= 1);
  });
}

console.log('SCÉNARIO 2 — revenir sur sa décision : statut present horodaté + notifie');
{
  const s = state('player', { pl: { status: 'absent', reason: 'Blessure' } });
  const { api, log } = build(s);
  api.matchRestorePresence('m1');
  // On n'EFFACE plus la ligne : on écrit un statut 'present' horodaté. Effacer
  // rendait le retour de présence invisible pour le coach (aucune trace, donc
  // aucune notif possible). Tous les lecteurs de l'effectif traitent déjà
  // `status === 'present'` exactement comme l'absence de ligne.
  t('c.responses[pid] porte un statut present horodaté', () => {
    const r = s.convocations[0].responses.pl;
    assert.strictEqual(r.status, 'present');
    assert.ok(Number.isFinite(r.at) && r.at > 0, 'horodatage manquant');
  });
  t('équivalent à « présente » pour les lecteurs d\'effectif', () => {
    const r = s.convocations[0].responses.pl;
    assert.ok(!r || r.status === 'present');       // idiome getMatchRoster / appel
    assert.ok(!(r && r.status === 'absent'));      // idiome comptage des absentes
  });
  t('_effectiveConvocStatus renvoie bien present', () => {
    assert.strictEqual(api._effectiveConvocStatus(s.convocations[0], '2026-07-10', 'pl'), 'present');
  });
  t('push coach absent→present', () => assert.deepStrictEqual(log.notified, [['absent', 'present']]));
}

console.log('SCÉNARIO 3 — gating rôle + convoc manquante');
{
  const s = state('coach');
  build(s).api.matchSaveAbsence('m1');
  t('coach → no-op (aucune réponse écrite)', () => assert.strictEqual(Object.keys(s.convocations[0].responses).length, 0));
}
{
  const s = state(); s.matches[0].convocId = null; // match sans convoc
  const { api } = build(s);
  api.matchSaveAbsence('m1'); // ne doit pas throw
  t('match sans convoc → no-op safe', () => assert.ok(true));
}

console.log('SCÉNARIO 4 — statut effectif (present par défaut)');
{
  const { api } = build(state());
  t('_effectiveConvocStatus → present si aucune réponse', () => {
    assert.strictEqual(api._effectiveConvocStatus({ responses: {} }, '2026-07-10', 'pl'), 'present');
  });
  t('_effectiveConvocStatus → absent si réponse absent', () => {
    assert.strictEqual(api._effectiveConvocStatus({ responses: { pl: { status: 'absent' } } }, '2026-07-10', 'pl'), 'absent');
  });
}

console.log('SCÉNARIO 5 — câblage UI dans renderMatchDetail (RSVP, match à venir seulement)');
{
  const rmd = extractFn('renderMatchDetail');
  t('bouton « Signaler mon absence » → matchDeclareAbsence', () => {
    assert.ok(/matchDeclareAbsence\('\$\{m\.id\}'\)/.test(rmd));
    assert.ok(/Signaler mon absence/.test(rmd));
  });
  t('bouton « Revenir sur ma décision » → matchRestorePresence', () => {
    assert.ok(/matchRestorePresence\('\$\{m\.id\}'\)/.test(rmd));
  });
  t('RSVP masqué pour un match passé (m.date < todayStr)', () => {
    assert.ok(/if \(m\.date < todayStr\) return '';/.test(rmd));
  });
  t('RSVP réservé à la joueuse (role player)', () => {
    // Le bloc RSVP (IIFE) commence par le gating player puis contient les 2 boutons.
    const rsvp = (rmd.match(/if \(state\.auth\.role !== 'player'\) return '';[\s\S]*?matchDeclareAbsence[\s\S]*?\}\)\(\)\}/) || [])[0] || '';
    assert.ok(rsvp && /matchDeclareAbsence/.test(rsvp) && /matchRestorePresence/.test(rsvp),
      'le bloc RSVP joueuse (gating + boutons absence/retour) est introuvable');
  });
}

console.log(`\n✅ ${pass} assertions OK — absence joueuse depuis le détail match.`);
