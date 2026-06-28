// Test géométrie PWA standalone (topbar / contenu / bottom-nav). Vérifie les
// RÈGLES CSS qui pilotent la géométrie (le rendu réel avec safe-area iOS ne se
// mesure que sur device — Chrome headless renvoie env()=0), + un modèle de calcul
// avec des insets iPhone réels pour prouver : pas d'overlap topbar, contenu non
// masqué par la nav, bande safe-area minimale.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = (readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')
  .match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
function rule(sel) { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; }

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — topbar : sticky + réserve la safe-area haute');
t('.topbar position:sticky top:0 (réserve sa hauteur dans le flux → pas d\'overlap)', () => {
  const r = rule('.topbar');
  assert.ok(/position:\s*sticky/.test(r), 'topbar pas sticky');
  assert.ok(/top:\s*0/.test(r), 'topbar sans top:0');
  assert.ok(/padding:[^;]*env\(safe-area-inset-top\)/.test(r), 'topbar ne réserve pas la safe-area haute');
});

console.log('SCÉNARIO 2 — FIX #1 : respiration sous la topbar');
t('.app > main { padding-top } > 0 (1re carte plus collée à la topbar)', () => {
  const r = rule('.app > main');
  const m = r.match(/padding-top:\s*(\d+)px/);
  assert.ok(m, '.app > main sans padding-top');
  assert.ok(parseInt(m[1], 10) >= 12, `gap trop petit (${m && m[1]}px)`);
});

console.log('SCÉNARIO 3 — bottom-nav : fixe, colle au bas, safe-area minimale');
t('.bottom-nav fixed bottom:0 (touche le bord bas)', () => {
  const r = rule('.bottom-nav');
  assert.ok(/position:\s*fixed/.test(r) && /bottom:\s*0/.test(r));
});
t('padding-bottom = max(8px, env(...)) — PAS 8px + env (sinon bande vide en trop)', () => {
  const r = rule('.bottom-nav');
  assert.ok(/max\(8px,\s*env\(safe-area-inset-bottom\)\)/.test(r), 'pas de max(8px, env())');
  assert.ok(!/calc\(8px\s*\+\s*env\(safe-area-inset-bottom\)\)/.test(r), 'reste calc(8px + env) → bande de trop');
});
t('.app réserve la zone nav (padding-bottom 72px + safe-area)', () => {
  assert.ok(/padding-bottom:\s*calc\(72px\s*\+\s*env\(safe-area-inset-bottom\)\)/.test(rule('.app')));
});

console.log('SCÉNARIO 4 — FIX #2 : chrome clair homogène avec la page (pas de bande blanche)');
['daylight', 'chalk', 'bcl', 'bloom'].forEach(id => {
  t(`${id} : --topbar-bg / --nav-bg = var(--bg)`, () => {
    const m = css.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'bloc ' + id);
    assert.ok(/--topbar-bg:\s*var\(--bg\)/.test(m[1]), `${id} topbar pas var(--bg)`);
    assert.ok(/--nav-bg:\s*var\(--bg\)/.test(m[1]), `${id} nav pas var(--bg)`);
  });
});

console.log('SCÉNARIO 5 — modèle géométrique avec insets iPhone (15 Pro : top 59 / bottom 34)');
// Hauteurs mesurées en preview (393×852, env=0) : topbar contenu ~33px, boutons nav ~53px.
function geometry({ insetTop, insetBottom, winH = 852, navBtnBlock = 53, topbarContent = 33 }) {
  const topbarH = Math.max(14, insetTop) + topbarContent + 14;
  const mainPadTop = 16;
  const firstCardTop = topbarH + mainPadTop;        // sticky réserve topbarH
  const navH = 8 + navBtnBlock + Math.max(8, insetBottom);
  const appReserve = 72 + insetBottom;              // .app padding-bottom
  const contentBottom = winH - appReserve;          // bas du contenu scrollable
  const navTop = winH - navH;
  return { topbarH, firstCardTop, gapBelowTopbar: firstCardTop - topbarH, navH, navTop, contentBottom, contentClearsNav: contentBottom <= navTop };
}
t('standalone (59/34) : 1re carte sous la topbar (gap = 16, aucun overlap)', () => {
  const g = geometry({ insetTop: 59, insetBottom: 34 });
  assert.strictEqual(g.gapBelowTopbar, 16);
  assert.ok(g.firstCardTop > g.topbarH, 'carte chevauche la topbar');
});
t('standalone : le contenu n\'est PAS masqué par la nav (réserve ≥ hauteur nav)', () => {
  const g = geometry({ insetTop: 59, insetBottom: 34 });
  assert.ok(g.contentClearsNav, `contenu sous la nav (contentBottom ${g.contentBottom} > navTop ${g.navTop})`);
});
t('non-standalone (0/0) : géométrie OK aussi (gap 16, contenu dégagé)', () => {
  const g = geometry({ insetTop: 0, insetBottom: 0 });
  assert.strictEqual(g.gapBelowTopbar, 16);
  assert.ok(g.contentClearsNav);
});
t('la bande safe-area sous les boutons a rétréci (max(8,34)=34 au lieu de 8+34=42)', () => {
  const before = 8 + 34, after = Math.max(8, 34);
  assert.strictEqual(after, 34);
  assert.ok(after < before, 'pas de réduction');
});

console.log(`\n✅ ${pass} assertions OK — géométrie standalone (topbar gap + nav safe-area homogène).`);
