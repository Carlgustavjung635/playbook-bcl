// Test de la ligne "Plays liés" refondue (détail match, côté coach).
// Avant : double-colonne de boutons empilés (▲/#/▼ à gauche, 📤/✎/✕ à droite)
// + badge PUBLIC redondant + pill type. Après : une ligne compacte
//   [preview] #N · Titre · type/note   📤/🔒   ⋮(menu)
// avec toggle visibilité fusionné (badge+bouton) et actions dans un kebab.
// On vérifie la structure, l'accès aux 4 actions via le menu, et la
// rétrocompat des handlers existants.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// Corps de renderMatchPrep (là où vit la ligne plays liés côté coach).
function fnBody(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'fonction introuvable : ' + name);
  const next = html.indexOf('\nfunction ', i + 1);
  return html.slice(i, next);
}
const prep = fnBody('renderMatchPrep');

console.log('SCÉNARIO 1 — structure de la ligne compacte');
t('conteneur .pl-row (remplace la div flex inline empilée)', () => {
  assert.ok(/class="pl-row"/.test(prep));
  // plus d'ancienne colonne de flèches empilées ▲/▼ inline
  assert.ok(!/movePlayLink\([^)]*\)"[^>]*>▲/.test(prep), 'flèche ▲ inline résiduelle');
});
t('preview du play à gauche (.pl-preview, image ou fallback catégorie)', () => {
  assert.ok(/img class="pl-preview"/.test(prep));
  assert.ok(/<div class="pl-preview"[^>]*>\$\{getCatShort\(p\.cat\)\}/.test(prep));
});
t('position #N en préfixe + titre en gras (.pl-num / .pl-title)', () => {
  assert.ok(/class="pl-num">#\$\{i \+ 1\} · <\/span>\$\{esc\(p\.title/.test(prep));
});
t('ligne 2 = type + note coach abrégée (.pl-sub, pas de pill OFF)', () => {
  assert.ok(/class="pl-sub">\$\{sub\}/.test(prep));
  assert.ok(/getCatLabel\(p\.cat\)/.test(prep));
  // l'ancien badge texte redondant à côté du titre a disparu (fusionné dans .pl-vis)
  assert.ok(!/'🔒 privé' : '📤 public'/.test(prep), 'badge texte PUBLIC/privé redondant résiduel');
});

console.log('SCÉNARIO 2 — toggle visibilité unique (fusion badge + bouton)');
t('un seul bouton .pl-vis → toggleMatchPlayVisibility (📤/🔒)', () => {
  const m = prep.match(/class="pl-vis" onclick="toggleMatchPlayVisibility\('\$\{m\.id\}','\$\{p\.id\}'\)"/);
  assert.ok(m, 'bouton visibilité .pl-vis absent');
  assert.ok(/\}\{isPrivate \? '🔒' : '📤'\}|isPrivate \? '🔒' : '📤'/.test(prep));
  // exactement 1 appel toggle dans la ligne (plus de badge + bouton séparés)
  const n = (prep.match(/toggleMatchPlayVisibility/g) || []).length;
  assert.strictEqual(n, 1, 'toggleMatchPlayVisibility appelé ' + n + '× (attendu 1)');
});

console.log('SCÉNARIO 3 — menu kebab : les 4 actions y sont accessibles');
t('kebab = <details class="pl-kebab"> avec summary ⋮', () => {
  assert.ok(/<details class="pl-kebab"/.test(prep));
  assert.ok(/<summary[^>]*>⋮<\/summary>/.test(prep));
  assert.ok(/class="pl-menu"/.test(prep));
});
t('⬆ Monter → movePlayLink(...,-1), désactivé si premier', () => {
  assert.ok(/isFirst \? 'disabled' : `onclick="movePlayLink\('\$\{m\.id\}','\$\{p\.id\}',-1\)"`[\s\S]*?⬆ Monter/.test(prep));
});
t('⬇ Descendre → movePlayLink(...,1), désactivé si dernier', () => {
  assert.ok(/isLast \? 'disabled' : `onclick="movePlayLink\('\$\{m\.id\}','\$\{p\.id\}',1\)"`[\s\S]*?⬇ Descendre/.test(prep));
});
t('✎ Éditer/Ajouter la note → editPlayLinkNote', () => {
  assert.ok(/onclick="editPlayLinkNote\('\$\{m\.id\}','\$\{p\.id\}'\)"[\s\S]*?la note/.test(prep));
});
t('🗑 Retirer du match → removePlayFromMatch (confirm + render)', () => {
  assert.ok(/class="danger" onclick="if\(confirm\('Retirer ce play du match \?'\)\)\{removePlayFromMatch\('\$\{m\.id\}','\$\{p\.id\}'\);render\(\)\}"[\s\S]*?🗑 Retirer du match/.test(prep));
});

console.log('SCÉNARIO 4 — rétrocompat : les handlers existent toujours');
t('les 4 fonctions handlers sont définies', () => {
  ['movePlayLink', 'toggleMatchPlayVisibility', 'editPlayLinkNote', 'removePlayFromMatch']
    .forEach(fn => assert.ok(new RegExp('function ' + fn + '\\(').test(html), fn + ' manquant'));
});

console.log('SCÉNARIO 5 — CSS de la ligne + menu overlay');
t('.pl-main : flex 1 1 0 + min-width 0 (titre ellipsé, pas de clip)', () => {
  const i = html.indexOf('.pl-main {');
  const r = html.slice(i, html.indexOf('}', i));
  assert.ok(/flex: 1 1 0/.test(r) && /min-width: 0/.test(r));
});
t('.pl-menu en overlay absolu (ne pousse pas la ligne)', () => {
  const i = html.indexOf('.pl-menu {');
  const r = html.slice(i, html.indexOf('}', i));
  assert.ok(/position: absolute/.test(r) && /z-index: 20/.test(r));
});

console.log(`\n✅ ${pass} assertions OK — ligne plays liés refondue (preview + kebab + toggle unique).`);
