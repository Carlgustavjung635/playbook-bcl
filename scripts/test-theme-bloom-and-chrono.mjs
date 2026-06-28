// Test du thème « 🌸 Bloom » (féminin chic, clair) + chrono theme-aware.
// WCAG AA via parsing du vrai CSS ; chrono : .chrono-screen suit var(--chrono-bg)
// (sombre par défaut, clair en thèmes clairs) + couleurs d'état tokenisées.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
function parseTokens(b) { const o = {}; b.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, (_, k, v) => { o[k] = v.trim(); return ''; }); return o; }
const base = parseTokens((css.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '');
// Fusionne TOUS les blocs ciblant ce thème — y compris les sélecteurs groupés
// (ex : « daylight, chalk, bcl, bloom { --chrono-bg... } ») où l'id n'est pas
// immédiatement suivi de « { ».
function theme(id) {
  let merged = { ...base };
  let found = false;
  const re = /([^{}]+)\{([^}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    if (new RegExp('data-theme="' + id + '"').test(m[1])) { merged = { ...merged, ...parseTokens(m[2]) }; found = true; }
  }
  assert.ok(found, 'bloc ' + id);
  return merged;
}
function toRgb(v) { v = v.trim(); if (v.startsWith('#')) { let h = v.slice(1); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } const p = v.split(',').map(x => parseInt(x.trim(), 10)); return [p[0], p[1], p[2]]; }
function lum([r, g, b]) { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrast(a, b) { const la = lum(toRgb(a)), lb = lum(toRgb(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — Bloom existe (CSS + JS)');
t('bloc CSS + entrée THEMES clair', () => {
  assert.ok(/:root\[data-theme="bloom"\]\s*\{/.test(css));
  assert.ok(/id: 'bloom',\s*name: 'Bloom'/.test(html));
  assert.ok(/\{ id: 'bloom',[^}]*light: true \}/.test(html));
});

console.log('SCÉNARIO 2 — Bloom : féminin clair + WCAG AA');
const b = theme('bloom');
t('fond clair + surface blanche + chrome homogène (var(--bg))', () => {
  assert.ok(lum(toRgb(b['bg'])) > 0.7, 'bg pas clair');
  assert.strictEqual(b['surface'].toLowerCase(), '#ffffff');
  assert.strictEqual(b['nav-bg'], 'var(--bg)');
  assert.strictEqual(b['topbar-bg'], 'var(--bg)');
});
t('accent framboise/fuchsia vif', () => assert.strictEqual(b['accent-rgb'].replace(/\s/g, ''), '219,39,119'));
t('ink/bg, ink/surface, ink-2/surface ≥ 4.5', () => {
  assert.ok(contrast(b['ink'], b['bg']) >= 4.5, 'ink/bg ' + contrast(b['ink'], b['bg']).toFixed(2));
  assert.ok(contrast(b['ink'], b['surface']) >= 4.5);
  assert.ok(contrast(b['ink-2'], b['surface']) >= 4.5, 'ink-2/surface ' + contrast(b['ink-2'], b['surface']).toFixed(2));
});
t('accent/surface ≥ 3', () => assert.ok(contrast(b['accent-rgb'], b['surface']) >= 3.0, contrast(b['accent-rgb'], b['surface']).toFixed(2)));

console.log('SCÉNARIO 3 — chrono theme-aware (plus de fond noir en dur)');
t('.chrono-screen utilise var(--chrono-bg) (pas de gradient noir en dur)', () => {
  const m = css.match(/\.chrono-screen\s*\{([^}]*)\}/);
  assert.ok(m, '.chrono-screen introuvable');
  assert.ok(/background:\s*var\(--chrono-bg\)/.test(m[1]), 'fond pas tokenisé');
  assert.ok(!/#1a1a1a|#050505/.test(m[1]), 'gradient noir encore en dur');
});
t('états chrono tokenisés (--chrono-run/warn/done)', () => {
  assert.ok(/\.chrono-time\.is-running\s*\{\s*color:\s*var\(--chrono-run\)/.test(css));
  assert.ok(/\.chrono-time\.is-warn\s*\{\s*color:\s*var\(--chrono-warn\)/.test(css));
  assert.ok(/\.chrono-time\.is-done\s*\{\s*color:\s*var\(--chrono-done\)/.test(css));
});
t('base --chrono-bg SOMBRE (thèmes sombres gardent le tableau noir)', () => {
  assert.ok(/--chrono-bg:\s*radial-gradient\([^;]*#1a1a1a[^;]*#050505/.test(base['chrono-bg'] ? '' : '') || /--chrono-bg:\s*radial-gradient\([^;]*#1a1a1a/.test(css));
  assert.ok(/#1a1a1a/.test(base['chrono-bg'] || ''), 'base chrono-bg pas sombre');
});

console.log('SCÉNARIO 4 — chrono CLAIR : fond clair + chiffres d\'état lisibles (large text ≥ 3:1)');
['daylight', 'chalk', 'bcl', 'bloom'].forEach(id => {
  t(`${id} : --chrono-bg clair + run/warn/done ≥ 3:1 sur surface`, () => {
    const k = theme(id);
    // chrono-bg du thème clair référence var(--bg-1)/var(--bg) → clair
    assert.ok(/var\(--bg-1\)|var\(--bg\)/.test(k['chrono-bg']), `${id} chrono-bg pas clair`);
    ['chrono-run', 'chrono-warn', 'chrono-done'].forEach(tok => {
      assert.ok(contrast(k[tok], k['surface']) >= 3.0, `${id} ${tok}/surface = ${contrast(k[tok], k['surface']).toFixed(2)} < 3`);
    });
  });
});

console.log('SCÉNARIO 5 — sombres : chrono reste sombre (non régressé)');
['court', 'sunset', 'midnight'].forEach(id => {
  t(`${id} : --chrono-bg sombre`, () => {
    const k = id === 'court' ? base : theme(id);
    assert.ok(/#1a1a1a|#050505/.test(k['chrono-bg'] || base['chrono-bg']), `${id} chrono-bg pas sombre`);
  });
});

console.log(`\n✅ ${pass} assertions OK — Bloom + chrono theme-aware.`);
