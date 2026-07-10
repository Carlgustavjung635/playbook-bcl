// Test du branding logo BCL (chantier C) : les PNG générés existent, sont des
// PNG RGBA (transparence = color type 6) aux bonnes dimensions, et l'emoji 🏀
// des orbes club (auth-logo / topbar-orb) a bien été remplacé par <img>.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Lit l'entête PNG : signature + IHDR (largeur, hauteur, color type).
function pngInfo(rel) {
  const b = readFileSync(join(ROOT, rel));
  const sig = b.slice(0, 8).toString('hex');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  const colorType = b[25]; // 6 = RGBA (truecolor + alpha)
  return { isPng: sig === '89504e470d0a1a0a', width, height, colorType };
}

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — assets logo transparents (PNG RGBA)');
for (const [rel, size] of [['assets/bcl-logo-32.png', 32], ['assets/bcl-logo-64.png', 64], ['assets/bcl-logo-128.png', 128], ['assets/bcl-logo-256.png', 256]]) {
  t(`${rel} : PNG ${size}×${size} avec canal alpha`, () => {
    assert.ok(existsSync(join(ROOT, rel)), 'fichier manquant');
    const i = pngInfo(rel);
    assert.ok(i.isPng, 'signature PNG invalide');
    assert.strictEqual(i.width, size); assert.strictEqual(i.height, size);
    assert.strictEqual(i.colorType, 6, 'pas RGBA → pas de transparence');
  });
}

console.log('SCÉNARIO 2 — icônes PWA / favicon régénérées au logo');
for (const [rel, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  t(`${rel} : ${size}×${size}`, () => {
    const i = pngInfo(rel);
    assert.ok(i.isPng); assert.strictEqual(i.width, size); assert.strictEqual(i.height, size);
  });
}

console.log('SCÉNARIO 3 — câblage UI (emoji club → logo)');
t('7 <img class="brand-logo"> (5 auth-logo dont sélecteur coach + 2 topbar-orb)', () => {
  assert.strictEqual((html.match(/class="brand-logo"/g) || []).length, 7);
});
t('plus aucun 🏀 dans auth-logo / topbar-orb', () => {
  assert.ok(!/class="auth-logo"[^>]*>🏀/.test(html));
  assert.ok(!/class="topbar-orb">🏀/.test(html));
});
t('CSS .brand-logo (disque blanc, contain, rond)', () => {
  assert.ok(/\.auth-logo img\.brand-logo, \.topbar-orb img\.brand-logo \{[^}]*object-fit: contain[^}]*background: #fff/.test(html));
});
t('auth-logo pointe le 256, topbar-orb le 64', () => {
  assert.ok(/class="auth-logo"[\s\S]{0,90}bcl-logo-256\.png/.test(html));
  assert.ok(/class="topbar-orb"><img class="brand-logo" src="\/assets\/bcl-logo-64\.png"/.test(html));
});

console.log('SCÉNARIO 4 — 🏀 conservé pour le basket générique (conservateur)');
t('l\'emoji reste présent ailleurs (FFBB, gages, chips match, défis…)', () => {
  assert.ok((html.match(/🏀/g) || []).length >= 8, 'le 🏀 générique ne doit pas être supprimé partout');
});

console.log(`\n✅ ${pass} assertions OK — branding logo BCL (transparence + câblage).`);
