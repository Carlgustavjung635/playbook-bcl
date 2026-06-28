// Vérifie les CONTRASTES WCAG AA des 10 thèmes — en parsant le VRAI CSS de
// index.html (pas une copie). Garantit que texte/fond restent lisibles, y
// compris sur les nouveaux thèmes clairs (Daylight, Chalk).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// --- parsing CSS ---
function parseTokens(block) {
  const out = {};
  block.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, (_, k, v) => { out[k] = v.trim(); return ''; });
  return out;
}
const baseBlock = (html.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '';
const base = parseTokens(baseBlock);
function themeTokens(id) {
  if (id === 'court') return { ...base }; // défaut = base, aucun override
  const m = html.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(m, `bloc CSS manquant pour le thème "${id}"`);
  return { ...base, ...parseTokens(m[1]) };
}

// --- couleurs / contraste WCAG ---
function toRgb(v) {
  v = v.trim();
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const p = v.split(',').map(x => parseInt(x.trim(), 10)); // "r, g, b"
  return [p[0], p[1], p[2]];
}
function lum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = lum(toRgb(a)), lb = lum(toRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEME_IDS = ['court', 'ocean', 'forest', 'rose', 'mono', 'sunset', 'midnight', 'hardwood', 'daylight', 'chalk', 'bcl'];

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — les 11 thèmes existent (JS THEMES <-> CSS)');
t('THEMES JS contient les 11 ids', () => {
  const arr = (html.match(/const THEMES = \[([\s\S]*?)\];/) || [])[1] || '';
  THEME_IDS.forEach(id => assert.ok(arr.includes(`id: '${id}'`), `THEMES manque ${id}`));
});

console.log('SCÉNARIO 2 — contraste WCAG AA texte/fond par thème');
THEME_IDS.forEach(id => {
  t(`${id} : ink/bg, ink/surface, ink-2/surface ≥ 4.5 ; accent/surface ≥ 3`, () => {
    const k = themeTokens(id);
    const cInkBg = contrast(k['ink'], k['bg']);
    const cInkSurf = contrast(k['ink'], k['surface']);
    const cInk2Surf = contrast(k['ink-2'], k['surface']);
    const cAccentSurf = contrast(k['accent-rgb'], k['surface']);
    assert.ok(cInkBg >= 4.5, `${id} ink/bg = ${cInkBg.toFixed(2)} < 4.5`);
    assert.ok(cInkSurf >= 4.5, `${id} ink/surface = ${cInkSurf.toFixed(2)} < 4.5`);
    assert.ok(cInk2Surf >= 4.5, `${id} ink-2/surface = ${cInk2Surf.toFixed(2)} < 4.5`);
    assert.ok(cAccentSurf >= 3.0, `${id} accent/surface = ${cAccentSurf.toFixed(2)} < 3.0`);
  });
});

console.log('SCÉNARIO 3 — thèmes clairs : chrome topbar/nav clair (texte ink lisible)');
['daylight', 'chalk'].forEach(id => {
  t(`${id} définit --topbar-bg / --nav-bg clairs`, () => {
    const k = themeTokens(id);
    assert.ok(/255,\s*255,\s*255/.test(k['topbar-bg']), `${id} topbar-bg pas clair`);
    assert.ok(/255,\s*255,\s*255/.test(k['nav-bg']), `${id} nav-bg pas clair`);
    // fond réellement clair (luminance haute)
    assert.ok(lum(toRgb(k['bg'])) > 0.7, `${id} bg pas assez clair`);
  });
});

console.log('SCÉNARIO 4 — thèmes sombres restent sombres');
['court', 'sunset', 'midnight', 'hardwood'].forEach(id => {
  t(`${id} : fond sombre`, () => assert.ok(lum(toRgb(themeTokens(id)['bg'])) < 0.1, `${id} bg pas sombre`));
});

console.log(`\n✅ ${pass} assertions OK — 11 thèmes, contrastes WCAG AA vérifiés (clair + sombre).`);
