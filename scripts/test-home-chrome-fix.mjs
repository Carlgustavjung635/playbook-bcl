// Test des 2 fixes d'affichage home (thème clair) :
//  #1 topbar : chrome OPAQUE en thème clair → le contenu ne transparaît plus
//     sous la barre translucide (effet "DIFFUSER coupé/superposé").
//  #2 bottom-nav : chrome OPAQUE → plus de bande bi-ton (backdrop-filter qui
//     échantillonne des fonds différents) sous la nav en clair.
//  + html suit le thème (plus de #000 en dur qui faisait une bande noire au
//     rebond / dans la safe-area sur les thèmes clairs).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = (readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')
  .match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
function themeBlock(id) { const m = css.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([\\s\\S]*?)\\}')); return m ? m[1] : ''; }
function token(block, name) { const m = block.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);')); return m ? m[1].trim() : ''; }
// alpha d'une valeur rgba()/rgb()/hex (1 si opaque)
function alpha(v) { const m = v.match(/rgba?\(([^)]+)\)/); if (!m) return v.startsWith('#') ? 1 : 1; const p = m[1].split(',').map(s => s.trim()); return p.length >= 4 ? parseFloat(p[3]) : 1; }

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — thèmes CLAIRS : chrome topbar/nav OPAQUE');
['daylight', 'chalk', 'bcl'].forEach(id => {
  t(`${id} : --topbar-bg et --nav-bg opaques (alpha = 1)`, () => {
    const b = themeBlock(id);
    const tb = token(b, 'topbar-bg'), nv = token(b, 'nav-bg');
    assert.ok(/255,\s*255,\s*255/.test(tb), `${id} topbar pas blanc`);
    assert.ok(/255,\s*255,\s*255/.test(nv), `${id} nav pas blanc`);
    assert.strictEqual(alpha(tb), 1, `${id} topbar pas opaque (${tb})`);
    assert.strictEqual(alpha(nv), 1, `${id} nav pas opaque (${nv})`);
  });
});

console.log('SCÉNARIO 2 — thèmes SOMBRES : chrome reste translucide (non régressé)');
['sunset', 'midnight', 'hardwood'].forEach(id => {
  t(`${id} : topbar/nav translucides (effet verre conservé)`, () => {
    const b = themeBlock(id);
    assert.ok(alpha(token(b, 'topbar-bg')) < 1, `${id} topbar devenu opaque`);
    assert.ok(alpha(token(b, 'nav-bg')) < 1, `${id} nav devenu opaque`);
  });
});

console.log('SCÉNARIO 3 — html suit le thème (plus de #000 en dur)');
t('html { background: var(--bg) } (pas #000000)', () => {
  assert.ok(/html\s*\{[^}]*background:\s*var\(--bg\)/.test(css), 'html ne suit pas le thème');
  assert.ok(!/html\s*\{\s*background:\s*#000000/.test(css), 'html force encore #000');
});

console.log('SCÉNARIO 4 — la nav remplit bien sa safe-area (fond homogène)');
t('.bottom-nav peint le fond jusque dans le padding safe-area (border-box)', () => {
  const m = css.match(/\.bottom-nav\s*\{([^}]*)\}/);
  assert.ok(m, 'règle .bottom-nav introuvable');
  const b = m[1];
  assert.ok(/background:\s*var\(--nav-bg\)/.test(b), 'nav sans fond var(--nav-bg)');
  assert.ok(/env\(safe-area-inset-bottom\)/.test(b), 'nav ne réserve pas la safe-area bas');
  assert.ok(!/background-clip:\s*content/.test(b), 'background-clip content-box laisserait la safe-area non peinte');
});

console.log(`\n✅ ${pass} assertions OK — topbar/nav opaques en clair + html thémé.`);
