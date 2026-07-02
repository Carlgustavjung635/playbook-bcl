// Test du refactor UX de la modale match (éditer/nouveau) : sections ordonnées,
// pill E1/E2 (au lieu d'un select), score repliable et discret (édition seule),
// logistique regroupée. Rétrocompat : les IDs lus par saveMatch sont préservés.
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

const em = extractFn('editMatch');

console.log('SCÉNARIO 1 — sections ordonnées (Quand → Où → Adversaire → Logistique → Notes → Résultat)');
t('les 6 en-têtes .mm-section présents dans le bon ordre', () => {
  const order = ['🗓 Quand', '📍 Où', '🆚 Adversaire', '⏰ Logistique', '📝 Notes', '🏆 Résultat'];
  let last = -1;
  for (const s of order) {
    const i = em.indexOf('mm-section">' + s);
    assert.ok(i > last, 'section mal ordonnée ou absente : ' + s);
    last = i;
  }
});
t('CSS .mm-section défini (titre + border-bottom)', () => {
  assert.ok(/\.mm-section \{[\s\S]*?border-bottom: 1px solid/.test(html));
});

console.log('SCÉNARIO 2 — Équipe = pill E1/E2 (plus de <select>)');
t('la modale match utilise _matchTeamPill (pas renderTeamTagField)', () => {
  assert.ok(/\$\{_matchTeamPill\(/.test(em));
  assert.ok(!/renderTeamTagField\('m-team'/.test(em));
});
t('_matchTeamPill : hidden m-team + 2 pills segmented + setMatchTeam', () => {
  const p = extractFn('_matchTeamPill');
  assert.ok(/id="m-team"/.test(p) && /class="segmented"/.test(p));
  assert.ok(/setMatchTeam\('e1'\)/.test(p) && /setMatchTeam\('e2'\)/.test(p));
});

console.log('SCÉNARIO 3 — Score discret + repliable + édition seulement');
t('bouton score = btn-ghost (pas btn-secondary btn-block)', () => {
  assert.ok(/id="m-score-toggle" class="btn btn-ghost btn-block"/.test(em));
  assert.ok(!/id="m-score-toggle" class="btn btn-secondary/.test(em));
});
t('score gardé dans la branche édition ${isNew ? \'\' : ...} sous « Résultat »', () => {
  const guard = em.indexOf("${isNew ? '' :");
  assert.ok(guard >= 0);
  assert.ok(em.indexOf('id="m-us"') > guard && em.indexOf('mm-section">🏆 Résultat') > guard);
});
t('le bouton score n\'est PAS dans le modal-footer', () => {
  const footer = em.slice(em.indexOf('modal-footer'));
  assert.ok(!/m-score-toggle/.test(footer));
  assert.ok(/saveMatch\(/.test(footer)); // le footer garde bien Enregistrer
});

console.log('SCÉNARIO 4 — Logistique : RDV heure compacte + lieu conditionnel');
t('hint RDV compact (sans « Ajuste si besoin »)', () => {
  assert.ok(/Vide = auto 1h avant/.test(em));
  assert.ok(!/Ajuste si besoin/.test(em));
});
t('Lieu de RDV (m-rdv-place) présent, dans #m-deplacement', () => {
  assert.ok(/id="m-deplacement"[\s\S]*?id="m-rdv-place"/.test(em));
});
t('m-deplacement visible si extérieur OU si lieu déjà saisi', () => {
  assert.ok(/display:\$\{\(m\.home && !\(m\.rdvPlace \|\| ''\)\.trim\(\)\) \? 'none' : 'block'\}/.test(em));
});

console.log('SCÉNARIO 5 — comportement (sandbox)');
{
  // _matchTeamPill : multi off → '' ; multi on → pills
  const mk = (multi) => new Function('state', 'esc', 'isMultiSquad', 'teamLabel',
    extractFn('_matchTeamPill') + '\nreturn _matchTeamPill;'
  )({ team: {} }, s => String(s), () => multi, (tag, short) => (tag === 'e2' ? 'E2' : 'E1'));
  t('mono-équipe → pas de champ Équipe', () => assert.strictEqual(mk(false)('e1'), ''));
  t('multi-équipe → pills E1/E2, e2 actif si currentTag=e2', () => {
    const out = mk(true)('e2');
    assert.ok(/id="m-team" value="e2"/.test(out));
    assert.ok(/id="m-team-e2" class="segmented-btn active"/.test(out));
  });
}
{
  // setMatchTeam met à jour le hidden + l'état actif
  const els = { 'm-team': { value: 'e1' }, 'm-team-e1': { classList: cls() }, 'm-team-e2': { classList: cls() } };
  function cls() { const s = new Set(); return { toggle: (c, on) => { on ? s.add(c) : s.delete(c); }, has: c => s.has(c) }; }
  const fn = new Function('document', extractFn('setMatchTeam') + '\nreturn setMatchTeam;')({ getElementById: id => els[id] });
  fn('e2');
  t('setMatchTeam(e2) → hidden=e2 + pill e2 active', () => {
    assert.strictEqual(els['m-team'].value, 'e2');
    assert.ok(els['m-team-e2'].classList.has('active') && !els['m-team-e1'].classList.has('active'));
  });
}
{
  // setMatchHome : lieu RDV visible à domicile SI déjà saisi
  function build(placeVal) {
    const dep = { style: { display: '' } };
    const els = { 'm-home': { value: '' }, 'm-home-dom': { classList: { toggle() {} } }, 'm-home-ext': { classList: { toggle() {} } }, 'm-deplacement': dep, 'm-rdv-place': { value: placeVal } };
    const fn = new Function('document', extractFn('setMatchHome') + '\nreturn setMatchHome;')({ getElementById: id => els[id] });
    return { fn, dep };
  }
  const a = build(''); a.fn(true);
  t('domicile + lieu vide → déplacement masqué', () => assert.strictEqual(a.dep.style.display, 'none'));
  const b = build('parking club'); b.fn(true);
  t('domicile + lieu saisi → déplacement visible', () => assert.strictEqual(b.dep.style.display, 'block'));
  const c = build(''); c.fn(false);
  t('extérieur → déplacement visible', () => assert.strictEqual(c.dep.style.display, 'block'));
}

console.log('SCÉNARIO 6 — rétrocompat saveMatch (lit m-team / IDs préservés)');
t('saveMatch lit toujours m-team (value e1/e2 du hidden)', () => {
  const sm = extractFn('saveMatch');
  assert.ok(/getElementById\('m-team'\)/.test(sm));
  assert.ok(/sel\.value === 'e2' \? 'e2' : 'e1'/.test(sm));
});
t('IDs critiques toujours présents dans la modale', () => {
  for (const id of ['m-date', 'm-time', 'm-home', 'm-place', 'm-opp', 'm-rdv-time', 'm-rdv-place', 'm-notes']) {
    assert.ok(em.includes('id="' + id + '"'), 'ID manquant : ' + id);
  }
});

console.log(`\n✅ ${pass} assertions OK — refactor UX modale match.`);
