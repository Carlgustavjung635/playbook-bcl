// Test des 2 fixes Safari onglet :
//  #1 scroll des modales : .modal-bg en dvh (pas inset:0) + safe-area top ;
//     .modal max-height en dvh (fallback vh) → haut atteignable, bas hors barre.
//  #2 cache-buster : la bannière « Recharger » recharge avec ?v= (refetch HTML
//     mono-fichier → JS inline à jour) ; _cacheBustReload ajoute le paramètre.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '').replace(/\/\*[\s\S]*?\*\//g, '');
// Concatène les déclarations de TOUS les blocs d'un sélecteur (il peut y en
// avoir plusieurs : règle de base + surcharges media).
function rule(sel) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let out = '', m; while ((m = re.exec(css))) out += m[1] + ';';
  return out;
}

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — modale Safari mobile (dvh + safe-area)');
const mbg = rule('.modal-bg');
const modal = rule('.modal');
t('.modal-bg n\'utilise plus inset:0 (mappe le large viewport)', () => {
  assert.ok(!/inset:\s*0/.test(mbg), 'inset:0 résiduel → débordement Safari');
});
t('.modal-bg ancre top/left/right et impose une hauteur dvh (fallback vh)', () => {
  assert.ok(/top:\s*0/.test(mbg) && /left:\s*0/.test(mbg) && /right:\s*0/.test(mbg));
  assert.ok(/height:\s*100vh/.test(mbg), 'fallback vh manquant');
  assert.ok(/height:\s*100dvh/.test(mbg), 'hauteur dvh manquante');
});
t('.modal-bg dégage la safe-area en haut (notch hors PWA aussi)', () => {
  assert.ok(/padding-top:\s*env\(safe-area-inset-top\)/.test(mbg));
});
t('.modal a une max-height en dvh avec fallback vh', () => {
  assert.ok(/max-height:\s*92vh/.test(modal), 'fallback vh manquant');
  assert.ok(/max-height:\s*92dvh/.test(modal), 'max-height dvh manquante');
  // l'ordre compte : vh d'abord (fallback), dvh ensuite (override navigateurs récents)
  assert.ok(modal.indexOf('92vh') < modal.indexOf('92dvh'), 'dvh doit suivre vh');
});
t('.app utilise déjà dvh (cohérence, non régressé)', () => {
  assert.ok(/height:\s*100dvh/.test(rule('.app')));
});

console.log('SCÉNARIO 2 — cache-buster (Safari onglet, JS inline)');
// Réimplémentation fidèle de _cacheBustReload (partie URL).
function cacheBustUrl(href, v) {
  const u = new URL(href);
  u.searchParams.set('v', v || '0');
  return u.toString();
}
t('ajoute ?v=<version> à l\'URL', () => {
  assert.strictEqual(cacheBustUrl('https://playbook-bcl.netlify.app/', '2026-06-28.21'),
    'https://playbook-bcl.netlify.app/?v=2026-06-28.21');
});
t('remplace un ?v= existant (pas d\'accumulation)', () => {
  assert.strictEqual(cacheBustUrl('https://x/?v=old', 'new'), 'https://x/?v=new');
});
t('code : la bannière recharge via _cacheBustReload(version)', () => {
  assert.ok(/function _cacheBustReload\(v\)/.test(html));
  assert.ok(/searchParams\.set\('v',/.test(html) && /location\.replace\(/.test(html));
  assert.ok(/onclick="_cacheBustReload\('\$\{v\}'\)"/.test(html), 'bouton Recharger non câblé au cache-bust');
  assert.ok(!/onclick="location\.reload\(\)">Recharger/.test(html), 'ancien reload non cache-busté résiduel');
});
t('showUpdateBanner reçoit la version distante et l\'assainit', () => {
  assert.ok(/function showUpdateBanner\(remote\)/.test(html));
  assert.ok(/showUpdateBanner\(remote\)/.test(html));
  assert.ok(/replace\(\/\[\^\\w\.\\-\]\/g, ''\)/.test(html), 'version non assainie (injection onclick)');
});

console.log('SCÉNARIO 3 — markdown étendu bien présent (vérif anti-régression #96)');
t('mdToHtml étendu présent (heading + strip artefacts)', () => {
  assert.ok(/function mdStripArtefacts/.test(html) && /h: Math\.min\(heading\[1\]\.length, 3\)/.test(html));
});

console.log(`\n✅ ${pass} assertions OK — modale dvh Safari + cache-buster reload.`);
