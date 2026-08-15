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

const THEME_IDS = ['court', 'ocean', 'forest', 'rose', 'mono', 'sunset', 'midnight', 'hardwood', 'daylight', 'chalk', 'bcl', 'bloom'];

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — les 12 thèmes existent (JS THEMES <-> CSS)');
t('THEMES JS contient les 12 ids', () => {
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
['daylight', 'chalk', 'bcl', 'bloom'].forEach(id => {
  t(`${id} : chrome topbar/nav homogène avec le fond clair`, () => {
    const k = themeTokens(id);
    // Chrome = var(--bg) (opaque, = couleur de page) → pas de bande blanche qui
    // tranche avec le contenu (cf. fix standalone v2). Le fond doit rester clair.
    assert.strictEqual(k['topbar-bg'], 'var(--bg)', `${id} topbar-bg pas homogène`);
    assert.strictEqual(k['nav-bg'], 'var(--bg)', `${id} nav-bg pas homogène`);
    assert.ok(lum(toRgb(k['bg'])) > 0.7, `${id} bg pas assez clair`);
  });
});

console.log('SCÉNARIO 4 — thèmes sombres restent sombres');
['court', 'sunset', 'midnight', 'hardwood'].forEach(id => {
  t(`${id} : fond sombre`, () => assert.ok(lum(toRgb(themeTokens(id)['bg'])) < 0.1, `${id} bg pas sombre`));
});

console.log('SCÉNARIO 5 — voile plein écran (--overlay-bg) : le texte y est posé DIRECTEMENT');
// Régression « Message du coach illisible » : la modale broadcast/sondage est une
// prise d'écran totale qui pose titre + corps directement sur son voile, sans
// carte var(--bg-1) intermédiaire. Le voile était un noir EN DUR → sur les 4
// thèmes clairs (dont BCL, le DÉFAUT), var(--ink) sombre sur noir = invisible.
t('la modale broadcast ne code plus son voile en dur', () => {
  // Le noir historique ne doit plus survivre que comme VALEUR du token (défaut
  // sombre), jamais comme couleur posée directement sur un élément.
  const blacks = html.match(/[^\n]*rgba\(8\s*,\s*10\s*,\s*14[^\n]*/g) || [];
  blacks.forEach(l => assert.ok(/--overlay-bg\s*:/.test(l), 'voile noir en dur : ' + l.trim().slice(0, 90)));
  const overlay = html.match(/position:fixed;inset:0;z-index:9999;background:([^;]+);/);
  assert.ok(overlay, 'voile de la modale broadcast introuvable');
  assert.strictEqual(overlay[1], 'var(--overlay-bg)', 'le voile ne passe pas par le token');
});

// Le voile est semi-opaque : on COMPOSITE sur --bg (la page en dessous) avant de
// mesurer, sinon on juge une couleur que personne ne voit.
function overlayOver(k) {
  const m = k['overlay-bg'].match(/rgba?\(([^)]+)\)/);
  assert.ok(m, 'overlay-bg doit être une rgba()');
  const p = m[1].split(',').map(x => parseFloat(x.trim()));
  const a = p.length > 3 ? p[3] : 1;
  const bg = toRgb(k['bg']);
  return [0, 1, 2].map(i => Math.round(p[i] * a + bg[i] * (1 - a)));
}
function rgbHex(c) { return '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''); }

THEME_IDS.forEach(id => {
  t(`${id} : ink/voile ≥ 4.5, ink-2/voile ≥ 4.5, ink-3/voile ≥ 3`, () => {
    const k = themeTokens(id);
    assert.ok(k['overlay-bg'], `${id} n'a pas de --overlay-bg`);
    const ov = rgbHex(overlayOver(k));
    const cInk = contrast(k['ink'], ov);
    const cInk2 = contrast(k['ink-2'], ov);
    const cInk3 = contrast(k['ink-3'], ov);
    assert.ok(cInk >= 4.5, `${id} ink/voile = ${cInk.toFixed(2)} < 4.5`);
    assert.ok(cInk2 >= 4.5, `${id} ink-2/voile = ${cInk2.toFixed(2)} < 4.5`);
    assert.ok(cInk3 >= 3.0, `${id} ink-3/voile = ${cInk3.toFixed(2)} < 3.0`);
  });
});

t('le voile suit la clarté du thème (clair reste clair, sombre reste sombre)', () => {
  // Garde-fou de fond : un voile sombre sur un thème clair (ou l'inverse) est
  // exactement le bug d'origine — il repasserait le contraste seulement si on
  // inversait AUSSI les encres, ce qu'aucun thème ne fait.
  THEME_IDS.forEach(id => {
    const k = themeTokens(id);
    const lBg = lum(toRgb(k['bg'])), lOv = lum(overlayOver(k));
    assert.ok(Math.abs(lBg - lOv) < 0.15, `${id} : voile (${lOv.toFixed(3)}) trop loin du fond (${lBg.toFixed(3)})`);
  });
});

console.log(`\n✅ ${pass} assertions OK — 12 thèmes, contrastes WCAG AA vérifiés (clair + sombre).`);
