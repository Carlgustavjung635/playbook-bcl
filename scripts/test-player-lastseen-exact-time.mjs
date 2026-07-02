// Test de l'heure exacte de dernière connexion (tooltip title, Option A).
// _lastSeenBadge expose désormais `exact` = "DD/MM/YYYY à HH:mm" (FR), utilisé en
// title sur les badges des onglets Effectif (Saison + Roster).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}
const badge = new Function(extractFn('_lastSeenBadge') + '\nreturn _lastSeenBadge;')();

console.log('SCÉNARIO 1 — format exact "DD/MM/YYYY à HH:mm" (padding)');
t('2 juillet 2026 14:32 → "02/07/2026 à 14:32"', () => {
  const ms = new Date(2026, 6, 2, 14, 32, 0).getTime();
  assert.strictEqual(badge(ms).exact, '02/07/2026 à 14:32');
});
t('5 janvier 2026 09:05 → zéros de tête OK "05/01/2026 à 09:05"', () => {
  const ms = new Date(2026, 0, 5, 9, 5, 0).getTime();
  assert.strictEqual(badge(ms).exact, '05/01/2026 à 09:05');
});
t('minuit "00:00" formaté correctement', () => {
  const ms = new Date(2026, 11, 31, 0, 0, 0).getTime();
  assert.strictEqual(badge(ms).exact, '31/12/2026 à 00:00');
});

console.log('SCÉNARIO 2 — edge case : jamais vue');
t('lastSeenAt null → exact = "" (pas de tooltip)', () => {
  assert.strictEqual(badge(null).exact, '');
  assert.strictEqual(badge(null).label, 'jamais vue');
});
t('lastSeenAt 0 (falsy) → exact = ""', () => assert.strictEqual(badge(0).exact, ''));

console.log('SCÉNARIO 3 — le label court coexiste avec l\'heure exacte');
{
  const now = Date.now();
  const r = badge(now - 2 * 3600000); // il y a 2h
  t('label court "vue aujourd\'hui" + exact rempli', () => {
    assert.strictEqual(r.label, "vue aujourd'hui");
    assert.ok(/^\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}$/.test(r.exact));
  });
}

console.log('SCÉNARIO 4 — câblage : title=exact sur les 2 onglets Effectif');
t('onglet Saison (_effectifSeasonBody) : title "Dernière connexion : ${ls.exact}"', () => {
  const b = extractFn('_effectifSeasonBody');
  assert.ok(/\$\{ls\.exact \? ` title="Dernière connexion : \$\{ls\.exact\}"` : ''\}/.test(b));
});
t('onglet Roster (_effectifRosterBody) : title "Dernière connexion : ${ls.exact}"', () => {
  const b = extractFn('_effectifRosterBody');
  assert.ok(/\$\{ls\.exact \? ` title="Dernière connexion : \$\{ls\.exact\}"` : ''\}/.test(b));
});
t('pas de title vide quand jamais vue (conditionné à ls.exact)', () => {
  // Les 2 usages gardent le badge label même si exact === '' (title omis).
  assert.ok((html.match(/ls\.exact \? ` title="Dernière connexion/g) || []).length === 2);
});

console.log(`\n✅ ${pass} assertions OK — heure exacte dernière connexion (tooltip).`);
