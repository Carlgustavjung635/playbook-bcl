// Test de l'état vide de la home coach (chantier 3, page B).
// Vérifie : carte « Première saison ? » + CTA « + Créer un match » quand aucun
// match, FORME/HISTORIQUE sinon, « Tous → » masqué s'il n'y a rien à montrer,
// titre prépa sur 1 ligne (ellipsis) et sous-titre journalier sans répétition.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

const home = html.slice(html.indexOf('function renderHomeCoach()'), html.indexOf('function eventInstanceRow'));

console.log('SCÉNARIO 1 — distinction « première saison » vs « rien joué »');
t('hasAnyMatch calculé depuis seasonMatches.length', () => {
  assert.ok(/const seasonMatches = currentSeasonMatches\(\);/.test(home));
  assert.ok(/const hasAnyMatch = seasonMatches\.length > 0;/.test(home));
});

console.log('SCÉNARIO 2 — état vide : carte « Première saison ? » + CTA');
t('FORME/HISTORIQUE enveloppés dans ${!hasAnyMatch ? empty : normal}', () => {
  assert.ok(/\$\{!hasAnyMatch \? `[\s\S]*?Première saison \?[\s\S]*?` : `[\s\S]*?Forme[\s\S]*?Historique[\s\S]*?`\}/.test(home));
});
t('CTA « + Créer un match » → editMatch()', () => {
  // Le bouton CTA porte bien onclick="editMatch()" et le libellé attendu.
  assert.ok(/onclick="editMatch\(\)">\+ Créer un match<\/button>/.test(home));
});

console.log('SCÉNARIO 3 — « Tous → » masqué si rien, FORME présente sinon');
t('« Tous → » conditionné à recentMatches.length', () => {
  assert.ok(/\$\{recentMatches\.length \? `<button class="section-action" onclick="goSection\('matches'\)">Tous →<\/button>` : ''\}/.test(home));
});
t('FORME (Bilan saison / Win Rate) présente dans la branche normale', () => {
  assert.ok(/Bilan saison/.test(home) && /Win Rate/.test(home));
});

console.log('SCÉNARIO 4 — bloc prépa : titre 1 ligne + sous-titre dédupliqué');
t('titre prépa avec ellipsis (≥ 2 occurrences : daily + weekly)', () => {
  const n = (home.match(/text-overflow:ellipsis/g) || []).length;
  assert.ok(n >= 2, 'attendu ≥2, vu ' + n);
});
t('conteneur titre min-width:0 / boutons flex-shrink:0', () => {
  assert.ok(/min-width:0;flex:1/.test(home));
  assert.ok(/align-items:center;flex-shrink:0/.test(home));
});
t('sous-titre journalier : « exos aujourd\'hui » conditionnel (pas de « 0 exo »)', () => {
  assert.ok(/\$\{todayItems\.length \? `<span>\$\{todayItems\.length\} exo\$\{todayItems\.length>1\?'s':''\} aujourd'hui<\/span>` : ''\}/.test(home));
});

console.log(`\n✅ ${pass} assertions OK — état vide home coach + bloc prépa.`);
