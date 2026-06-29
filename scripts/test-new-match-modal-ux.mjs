// Test du refactor UX de la modale « Nouveau match » (chantier 3, page A).
// Vérifie : score masqué à la création (révélé en édition seulement), toggle pill
// 🏠/🚗 au lieu du dropdown, sous-bloc Déplacement conditionnel à l'extérieur,
// ordre logique des sections, layout Date(large)/Heure(compact), et le
// comportement réel des helpers setMatchHome / revealScoreFields.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

const editBlock = html.slice(html.indexOf('function editMatch(id)'), html.indexOf('function setMatchHome'));

console.log('SCÉNARIO 1 — score masqué à la création, révélé en édition');
t('les champs score sont dans une branche ${isNew ? \'\' : ...}', () => {
  // Le bloc score (m-us / m-them) ne doit exister que si !isNew.
  assert.ok(/\$\{isNew \? '' : `[\s\S]*?id="m-us"[\s\S]*?id="m-them"[\s\S]*?`\}/.test(editBlock));
});
t('les champs score sont positionnés DANS la branche édition', () => {
  // m-us/m-them apparaissent après le marqueur ${isNew ? '' : (= jamais dans le
  // tronc commun rendu à la création).
  const guard = editBlock.indexOf("${isNew ? '' :");
  assert.ok(guard >= 0, 'marqueur isNew absent');
  assert.ok(editBlock.indexOf('id="m-us"') > guard);
  assert.ok(editBlock.indexOf('id="m-them"') > guard);
});
t('toggle « 🏆 Saisir le score » repliable (caché si pas de score)', () => {
  assert.ok(/revealScoreFields\(\)/.test(editBlock));
  assert.ok(/id="m-score-fields" style="display:\$\{\(m\.scoreUs > 0 \|\| m\.scoreOpp > 0\)/.test(editBlock));
});

console.log('SCÉNARIO 2 — toggle pill 🏠/🚗 (plus de dropdown)');
t('input caché m-home (plus de <select id="m-home">)', () => {
  assert.ok(/<input type="hidden" id="m-home"/.test(editBlock));
  assert.ok(!/<select id="m-home">/.test(editBlock));
});
t('deux pills segmented 🏠 Domicile / 🚗 Extérieur', () => {
  assert.ok(/id="m-home-dom"[^>]*onclick="setMatchHome\(true\)"[^>]*>🏠 Domicile/.test(editBlock));
  assert.ok(/id="m-home-ext"[^>]*onclick="setMatchHome\(false\)"[^>]*>🚗 Extérieur/.test(editBlock));
});

console.log('SCÉNARIO 3 — sous-bloc Déplacement conditionnel à l\'extérieur');
t('m-deplacement masqué quand domicile (display dépend de m.home)', () => {
  assert.ok(/id="m-deplacement"[^>]*display:\$\{m\.home \? 'none' : 'block'\}/.test(editBlock));
});
t('contient bien Heure RDV + Lieu RDV', () => {
  assert.ok(/id="m-rdv-time"/.test(editBlock) && /id="m-rdv-place"/.test(editBlock));
});

console.log('SCÉNARIO 4 — layout & ordre des sections');
t('Date large / Heure compacte (grid 1.5fr 1fr)', () => {
  assert.ok(/grid-template-columns:1\.5fr 1fr[\s\S]*?id="m-date"[\s\S]*?id="m-time"/.test(editBlock));
});
t('Adversaire en pleine largeur (un .fld simple, pas de fld-row)', () => {
  assert.ok(/<div class="fld"><input id="m-opp"/.test(editBlock));
});
t('ordre Quand → Où → Adversaire → Déplacement → Notes → Score', () => {
  const idx = s => editBlock.indexOf(s);
  const quand = idx('>Quand<');
  const ou = idx('>Où<');
  const adv = idx('>Adversaire<');
  const dep = idx('id="m-deplacement"');
  const notes = idx('id="m-notes"');
  const score = idx('id="m-score-fields"');
  assert.ok(quand >= 0 && quand < ou, 'Quand avant Où');
  assert.ok(ou < adv, 'Où avant Adversaire');
  assert.ok(adv < dep, 'Adversaire avant Déplacement');
  assert.ok(dep < notes, 'Déplacement avant Notes');
  assert.ok(notes < score, 'Notes avant Score');
});

console.log('SCÉNARIO 5 — comportement réel des helpers (sandbox)');
{
  // Extraction de setMatchHome + revealScoreFields.
  const src = html.slice(html.indexOf('function setMatchHome'), html.indexOf('function saveMatch'));
  const els = {
    'm-home': { value: 'true' },
    'm-home-dom': { classList: mkCls() },
    'm-home-ext': { classList: mkCls() },
    'm-deplacement': { style: { display: 'none' } },
    'm-score-fields': { style: { display: 'none' } },
    'm-score-toggle': { removed: false, remove() { this.removed = true; delete els['m-score-toggle']; } },
    'm-us': { focused: false, focus() { this.focused = true; } },
  };
  function mkCls() { const set = new Set(); return { toggle: (c, on) => { on ? set.add(c) : set.delete(c); }, has: c => set.has(c) }; }
  const document = { getElementById: id => els[id] || null };
  const fn = new Function('document', src + '\nreturn { setMatchHome, revealScoreFields };')(document);

  fn.setMatchHome(false); // extérieur
  t('setMatchHome(false) : m-home=false + déplacement visible + pill ext active', () => {
    assert.strictEqual(els['m-home'].value, 'false');
    assert.strictEqual(els['m-deplacement'].style.display, 'block');
    assert.ok(els['m-home-ext'].classList.has('active'));
    assert.ok(!els['m-home-dom'].classList.has('active'));
  });
  fn.setMatchHome(true); // domicile
  t('setMatchHome(true) : m-home=true + déplacement masqué + pill dom active', () => {
    assert.strictEqual(els['m-home'].value, 'true');
    assert.strictEqual(els['m-deplacement'].style.display, 'none');
    assert.ok(els['m-home-dom'].classList.has('active'));
  });
  fn.revealScoreFields();
  t('revealScoreFields : champs score affichés + toggle retiré', () => {
    assert.strictEqual(els['m-score-fields'].style.display, 'block');
    assert.ok(!els['m-score-toggle']);
  });
}

console.log(`\n✅ ${pass} assertions OK — refactor UX modale Nouveau match.`);
