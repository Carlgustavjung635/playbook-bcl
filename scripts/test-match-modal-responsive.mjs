// Test des règles CSS responsive de la modale (mobile-first) : header/footer
// sticky, scroll interne, safe-area iOS, 100dvh, inputs 16px anti-zoom,
// min-width:0 anti-débordement, media queries petit mobile / tablette.
// Non-régression : on vérifie que les autres modales gardent la safe-area.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// Extrait le corps { ... } d'un sélecteur CSS. `from` permet d'ancrer la
// recherche après un offset (certains sélecteurs comme `.modal` existent en
// double — une variante media-query `.modal { max-width: 600px }` en amont).
function cssRule(selector, from = 0) {
  const i = html.indexOf(selector + ' {', from);
  assert.ok(i >= 0, 'règle CSS introuvable : ' + selector);
  const start = html.indexOf('{', i);
  const end = html.indexOf('}', start);
  return html.slice(start + 1, end);
}
// Offset de la section MODAL principale (après la 1re occurrence media-query).
const MODAL_SECTION = html.indexOf('/* ========== MODAL ========== */');

console.log('SCÉNARIO 1 — hauteur dynamique + pas de recouvrement topbar iOS');
t('.modal-bg : 100dvh + padding-top safe-area', () => {
  const r = cssRule('.modal-bg');
  assert.ok(/height: 100vh; height: 100dvh/.test(r));
  assert.ok(/padding-top: env\(safe-area-inset-top\)/.test(r));
});
t('.modal : max-height 92dvh + scroll interne tactile', () => {
  const r = cssRule('.modal', MODAL_SECTION);
  assert.ok(/max-height: 92vh; max-height: 92dvh/.test(r));
  assert.ok(/overflow-y: auto/.test(r));
  assert.ok(/-webkit-overflow-scrolling: touch/.test(r) && /overscroll-behavior: contain/.test(r));
});

console.log('SCÉNARIO 2 — header + footer sticky');
t('.modal-header : sticky top + fond opaque', () => {
  const r = cssRule('.modal-header');
  assert.ok(/position: sticky; top: 0/.test(r) && /z-index: 3/.test(r));
  assert.ok(/background: var\(--bg-2\)/.test(r));
});
t('.modal-footer : sticky bottom + safe-area + ombre', () => {
  const r = cssRule('.modal-footer');
  assert.ok(/position: sticky; bottom: 0/.test(r) && /z-index: 3/.test(r));
  assert.ok(/padding-bottom: max\(12px, calc\(env\(safe-area-inset-bottom\)/.test(r));
  assert.ok(/box-shadow: 0 -2px 10px/.test(r));
  assert.ok(/background: var\(--bg-2\)/.test(r));
});

console.log('SCÉNARIO 3 — safe-area conservée pour les modales SANS footer');
t('.modal-body:last-child porte la safe-area basse', () => {
  assert.ok(/\.modal-body:last-child \{ padding-bottom: max\(18px, calc\(env\(safe-area-inset-bottom\)/.test(html));
});

console.log('SCÉNARIO 4 — inputs : anti-zoom iOS + anti-débordement');
t('inputs à 16px (pas 15px) → pas de zoom auto iOS au focus', () => {
  const r = cssRule('input:not([type="checkbox"]):not([type="radio"]), textarea, select');
  assert.ok(/font-size: 16px/.test(r));
  assert.ok(!/font-size: 15px/.test(r));
  assert.ok(/min-width: 0/.test(r));
});
t('.fld : min-width 0 (permet aux colonnes date/heure de rétrécir sans clipper)', () => {
  assert.ok(/\.fld \{ margin-bottom: 12px; min-width: 0; \}/.test(html));
});

console.log('SCÉNARIO 5 — media queries petit mobile / tablette');
t('@media max-width:400px : paddings resserrés (header/body/footer/section)', () => {
  // Il existe 2 blocs @media 400px (fld-row + modale) : on cible celui de la modale.
  const i = html.indexOf('@media (max-width: 400px) {\n    .modal-header');
  assert.ok(i >= 0, 'bloc @media 400px modale absent');
  const block = html.slice(i, i + 400);
  assert.ok(/\.modal-body \{ padding: 14px 16px; \}/.test(block));
  assert.ok(/\.mm-section \{ margin: 14px 0 8px; \}/.test(block));
});
t('@media min-width:768px : modale plus aérée', () => {
  const i = html.indexOf('@media (min-width: 768px) {\n    .modal-body { padding: 22px 24px; }');
  assert.ok(i >= 0, 'media tablette modale absente');
});

console.log('SCÉNARIO 6 — footer match : Enregistrer proéminent (pleine largeur)');
t('modale match : bouton Enregistrer flex:1 (Annuler compact)', () => {
  const em = html.slice(html.indexOf('function editMatch('), html.indexOf('function setMatchHome'));
  assert.ok(/btn btn-primary" style="flex:1 1 0" onclick="saveMatch/.test(em));
  assert.ok(/btn btn-secondary" style="flex:0 0 auto" onclick="closeModal/.test(em));
});

console.log('SCÉNARIO 7 — non-régression : le pill/segmented n\'est pas cassé');
t('.segmented-btn conserve flex:1 (équi-parts)', () => {
  assert.ok(/\.segmented-btn \{[\s\S]*?flex: 1;/.test(html));
});

console.log('SCÉNARIO 8 — Date/Heure & score : stack 1 colonne sur mobile étroit (<400px)');
t('.fld-row.mm-when : ratio 3fr/2fr au-dessus de 400px (Date > Heure)', () => {
  assert.ok(/\.fld-row\.mm-when \{ grid-template-columns: 3fr 2fr; \}/.test(html));
});
t('@media max-width:400px : mm-when + mm-score forcés en 1 colonne', () => {
  const i = html.indexOf('@media (max-width: 400px) {\n    .fld-row.mm-when, .fld-row.mm-score');
  assert.ok(i >= 0, 'règle stack <400px absente');
  const block = html.slice(i, i + 140);
  assert.ok(/\.fld-row\.mm-when, \.fld-row\.mm-score \{ grid-template-columns: 1fr;/.test(block));
});
t('modale match : Date/Heure via classe mm-when SANS style inline (sinon la media query serait battue)', () => {
  const em = html.slice(html.indexOf('function editMatch('), html.indexOf('function setMatchHome'));
  assert.ok(/<div class="fld-row mm-when">/.test(em), 'row Date/Heure doit porter la classe mm-when');
  // plus aucun grid-template-columns inline sur une fld-row de la modale match
  assert.ok(!/class="fld-row"[^>]*style="[^"]*grid-template-columns/.test(em), 'style inline grid-template-columns résiduel');
  assert.ok(/<div class="fld-row mm-score">/.test(em), 'row score doit porter la classe mm-score');
});

console.log(`\n✅ ${pass} assertions OK — responsive modale (sticky footer + safe-area + dvh + stack étroit).`);
