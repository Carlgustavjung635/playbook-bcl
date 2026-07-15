// Test de l'état vide de la home coach (chantier 3, page B).
// Vérifie : carte « Première saison ? » + CTA « + Créer un match » quand aucun
// match, FORME/HISTORIQUE sinon, « Tous → » masqué s'il n'y a rien à montrer.
//
// SCÉNARIO 4 — HISTORIQUE : ce fichier vérifiait l'ellipsis du titre et le
// sous-titre du bloc « prépa estivale » (offseason) rendu par renderHomeCoach
// (PR #108). Ce bloc a été RETIRÉ de la home par la prépa « full package »
// (training_programs) : le module offseason existe toujours mais n'est plus
// rendu ici, donc ces assertions n'avaient plus de cible. Elles sont remplacées
// par une garde de non-régression : la home coach ne doit plus rappeler
// l'offseason, et doit rendre la nouvelle carte à la place.
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

console.log('SCÉNARIO 4 — la prépa estivale (offseason) n\'est plus sur la home coach');
t('aucun point d\'entrée offseason rendu par renderHomeCoach', () => {
  assert.ok(!/openOffseasonConfig/.test(home), 'CTA « Configurer la prépa estivale » encore rendu');
  assert.ok(!/openOffseasonDashboard/.test(home), 'carte engagement offseason encore rendue');
  assert.ok(!/renderProgramSelector\(\)/.test(home), 'sélecteur de programmes offseason encore rendu');
});
t('la prépa « full package » a pris sa place', () => {
  assert.ok(/\$\{renderTrainingCoachCard\(\)\}/.test(home), 'renderTrainingCoachCard absente de la home coach');
});
t('le module offseason reste dans le fichier (audit / restauration)', () => {
  assert.ok(/function renderProgramSelector\(\)/.test(html), 'renderProgramSelector supprimée');
  assert.ok(/function openOffseasonConfig\(/.test(html), 'openOffseasonConfig supprimée');
  assert.ok(/function renderPlayerProgramme\(\)/.test(html), 'renderPlayerProgramme supprimée');
});

console.log(`\n✅ ${pass} assertions OK — état vide home coach + retrait offseason.`);
