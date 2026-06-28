// Test du thème BCL + défaut Chalk. Vérifie : présence CSS+JS du thème BCL,
// contraste WCAG AA, couleurs club (rouge accent / orange-2), et la logique de
// thème par défaut (Chalk pour un nouvel user, respect d'un choix existant).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

function parseTokens(block) { const o = {}; block.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, (_, k, v) => { o[k] = v.trim(); return ''; }); return o; }
const base = parseTokens((html.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '');
function themeTokens(id) { const m = html.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([\\s\\S]*?)\\}')); assert.ok(m, 'bloc CSS manquant ' + id); return { ...base, ...parseTokens(m[1]) }; }
function toRgb(v) { v = v.trim(); if (v.startsWith('#')) { let h = v.slice(1); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } const p = v.split(',').map(x => parseInt(x.trim(), 10)); return [p[0], p[1], p[2]]; }
function lum([r, g, b]) { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrast(a, b) { const la = lum(toRgb(a)), lb = lum(toRgb(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

// --- modèle fidèle de getThemeId / head anti-flicker ---
const DEFAULT_THEME = 'chalk';
const VALID = ['court', 'ocean', 'forest', 'rose', 'mono', 'sunset', 'midnight', 'hardwood', 'daylight', 'chalk', 'bcl'];
function getThemeId(map, key) { const id = map[key]; return VALID.includes(id) ? id : DEFAULT_THEME; }

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — le thème BCL existe (CSS + JS)');
t('bloc CSS :root[data-theme="bcl"]', () => assert.ok(/:root\[data-theme="bcl"\]\s*\{/.test(html)));
t('entrée THEMES { id: \'bcl\' } clair', () => {
  assert.ok(/\{ id: 'bcl',[^}]*light: true \}/.test(html));
  assert.ok(/id: 'bcl',\s*name: 'BCL'/.test(html));
});

console.log('SCÉNARIO 2 — couleurs du club');
const k = themeTokens('bcl');
t('accent = rouge Converse (196,30,58 = #c41e3a)', () => assert.strictEqual(k['accent-rgb'].replace(/\s/g, ''), '196,30,58'));
t('accent-2 = orange ballon (#ea580c)', () => assert.strictEqual(k['orange-2'].toLowerCase(), '#ea580c'));
t('fond clair (luminance haute) + surface blanche', () => {
  assert.ok(lum(toRgb(k['bg'])) > 0.7, 'bg pas clair');
  assert.strictEqual(k['surface'].toLowerCase(), '#ffffff');
});
t('chrome topbar/nav clair', () => {
  assert.ok(/255,\s*255,\s*255/.test(k['topbar-bg']) && /255,\s*255,\s*255/.test(k['nav-bg']));
});

console.log('SCÉNARIO 3 — contraste WCAG AA');
t('ink/bg ≥ 4.5', () => assert.ok(contrast(k['ink'], k['bg']) >= 4.5, contrast(k['ink'], k['bg']).toFixed(2)));
t('ink/surface ≥ 4.5', () => assert.ok(contrast(k['ink'], k['surface']) >= 4.5));
t('ink-2/surface ≥ 4.5', () => assert.ok(contrast(k['ink-2'], k['surface']) >= 4.5, contrast(k['ink-2'], k['surface']).toFixed(2)));
t('accent rouge/surface ≥ 3', () => assert.ok(contrast(k['accent-rgb'], k['surface']) >= 3.0, contrast(k['accent-rgb'], k['surface']).toFixed(2)));

console.log('SCÉNARIO 4 — défaut = Chalk');
t('DEFAULT_THEME = chalk dans le JS', () => assert.ok(/const DEFAULT_THEME = 'chalk';/.test(html)));
t('head anti-flicker par défaut chalk', () => assert.ok(/var t=\(map&&map\[key\]\)\|\|'chalk';/.test(html)));
t('plus aucun défaut court résiduel', () => {
  assert.ok(!/const DEFAULT_THEME = 'court';/.test(html));
  assert.ok(!/\|\|'court';/.test(html));
});

console.log('SCÉNARIO 5 — comportement du défaut (logique getThemeId)');
t('nouvel user (rien stocké) → Chalk', () => assert.strictEqual(getThemeId({}, 'coach:-'), 'chalk'));
t('identité jamais connectée (clé absente) → Chalk', () => assert.strictEqual(getThemeId({ 'player:42': 'ocean' }, 'coach:-'), 'chalk'));
t('choix existant respecté (ex: court) → on NE force PAS Chalk', () => assert.strictEqual(getThemeId({ 'coach:-': 'court' }, 'coach:-'), 'court'));
t('choix BCL respecté', () => assert.strictEqual(getThemeId({ 'coach:-': 'bcl' }, 'coach:-'), 'bcl'));
t('valeur invalide stockée → fallback Chalk', () => assert.strictEqual(getThemeId({ 'coach:-': 'zzz' }, 'coach:-'), 'chalk'));

console.log(`\n✅ ${pass} assertions OK — thème BCL + défaut Chalk.`);
