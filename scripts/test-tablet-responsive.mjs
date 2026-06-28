// Test responsive tablette — vérifie en PARSANT le vrai CSS de index.html que :
//  1) le mobile (<768px) est INCHANGÉ (base .app max-width:480, aucune nouvelle
//     règle tablette hors media query min-width) ;
//  2) les optimisations tablette sont bien gatées en min-width:768/1024.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
// Extrait le <style> (1er bloc style du head).
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
assert.ok(css.length > 1000, 'CSS introuvable');

// Concatène le contenu de TOUS les blocs @media (min-width: Npx) { ... }
// (il y en a plusieurs séparés ; équilibrage d'accolades).
function mediaBlock(minPx) {
  const re = new RegExp('@media\\s*\\(min-width:\\s*' + minPx + 'px\\)\\s*\\{', 'g');
  let out = '', m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length, depth = 1, start = i;
    for (; i < css.length && depth > 0; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
    out += css.slice(start, i - 1) + '\n';
    re.lastIndex = i;
  }
  return out;
}
// Le bloc de base d'un sélecteur (hors toute media query) : on neutralise les
// media queries puis on lit la 1re déclaration du sélecteur.
const cssNoMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
function baseRule(sel) {
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(cssNoMedia);
  return m ? m[1] : '';
}

const b768 = mediaBlock(768);
const b1024 = mediaBlock(1024);

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — MOBILE INCHANGÉ (<768px)');
t('.app base garde max-width:480px (mobile)', () => {
  assert.match(baseRule('.app'), /max-width:\s*480px/);
});
t('.stat-grid base garde 2 colonnes (mobile)', () => {
  assert.match(baseRule('.stat-grid'), /repeat\(2,\s*1fr\)/);
});
t('.theme-grid base reste en flex column (mobile)', () => {
  assert.match(baseRule('.theme-grid'), /flex-direction:\s*column/);
});
t('aucune media query max-width n\'a été ajoutée pour rétrécir le mobile (<768)', () => {
  // Les seules max-width existantes sont 359 (nav) et 480/640 (modale) — pré-existantes.
  const maxQueries = (css.match(/@media\s*\(max-width:\s*(\d+)px\)/g) || []);
  maxQueries.forEach(q => {
    const px = Number(q.match(/(\d+)/)[1]);
    assert.ok([359, 480, 640].includes(px), 'media max-width inattendue: ' + q);
  });
});

console.log('SCÉNARIO 2 — TABLETTE : élargissement gaté min-width');
t('768px → .app max-width:720px', () => assert.match(b768, /\.app\s*\{[^}]*max-width:\s*720px/));
t('1024px → .app max-width:940px', () => assert.match(b1024, /\.app\s*\{[^}]*max-width:\s*940px/));
t('768px → bottom-nav 720 ; 1024px → 940', () => {
  assert.match(b768, /\.bottom-nav\s*\{[^}]*max-width:\s*720px/);
  assert.match(b1024, /\.bottom-nav\s*\{[^}]*max-width:\s*940px/);
});
t('chrono-fab repositionné par palier (360 puis 470)', () => {
  assert.match(b768, /\.chrono-fab\s*\{[^}]*50%\s*-\s*360px/);
  assert.match(b1024, /\.chrono-fab\s*\{[^}]*50%\s*-\s*470px/);
});

console.log('SCÉNARIO 3 — TABLETTE : enrichissements gatés min-width:768');
t('stat-grid 4 colonnes en tablette', () => assert.match(b768, /\.stat-grid\s*\{[^}]*repeat\(4,\s*1fr\)/));
t('pickers (theme-grid) en 2 colonnes en tablette', () => assert.match(b768, /\.theme-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/));
t('modale plus large (600) à ≥1024', () => assert.match(b1024, /\.modal\s*\{[^}]*max-width:\s*600px/));

console.log('SCÉNARIO 4 — cohérence : la règle de BASE (mobile) n\'a pas l\'enrichissement tablette');
t('base .stat-grid n\'est PAS en 4 colonnes (4 cols = tablette only)', () => {
  assert.ok(!/repeat\(4,/.test(baseRule('.stat-grid')), 'la base stat-grid passe en 4 cols → casserait le mobile');
});
t('base .theme-grid n\'a PAS de grid-template-columns (grid = tablette only)', () => {
  assert.ok(!/grid-template-columns/.test(baseRule('.theme-grid')), 'la base theme-grid devient grid → casserait le mobile');
});

console.log(`\n✅ ${pass} assertions OK — tablette optimisée (768/1024), mobile <768 intact.`);
