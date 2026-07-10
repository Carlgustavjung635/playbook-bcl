// Test de l'écran Effectif unifié (2 onglets Saison en cours / Roster global) qui
// remplace les 2 anciennes portes ⚙. Statique (câblage) + exécution du corps roster.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

console.log('SCÉNARIO 1 — une seule entrée ⚙ + wrappers rétrocompat');
t('menu ⚙ : entrée unique « Effectif » → openEffectif', () => {
  assert.ok(/onclick="closeModal\(\);setTimeout\(\(\)=>openEffectif\('season'\),50\)">\s*👥 Effectif/.test(html));
});
t('anciens libellés de menu supprimés (hors commentaire)', () => {
  const noComments = html.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/👥 Effectif de la saison/.test(noComments));
  assert.ok(!/👤 Gérer les joueuses \(PIN/.test(noComments));
});
t('openSeasonRosterEditor / managePlayers = wrappers vers openEffectif', () => {
  assert.ok(/function openSeasonRosterEditor\(\) \{ openEffectif\('season'\); \}/.test(html));
  assert.ok(/function managePlayers\(\) \{ openEffectif\('roster'\); \}/.test(html));
});

console.log('SCÉNARIO 2 — openEffectif : 2 onglets + délégation aux 2 corps');
{
  const oe = extractFn(html, 'openEffectif');
  t('deux onglets segmented (Saison en cours / Roster global)', () => {
    assert.ok(/onclick="openEffectif\('season'\)">Saison en cours/.test(oe));
    assert.ok(/onclick="openEffectif\('roster'\)">Roster global/.test(oe));
  });
  t('délègue au bon corps selon l\'onglet', () => {
    assert.ok(/tab === 'roster' \? _effectifRosterBody\(\) : _effectifSeasonBody\(\)/.test(oe));
  });
  t('scroll + focus préservés sur l\'onglet roster', () => {
    assert.ok(/_modalScrollAttr\('players'\)/.test(oe) && /_restoreModalScroll\('players'\)/.test(oe));
    assert.ok(/pl-new-name/.test(oe));
  });
}

console.log('SCÉNARIO 3 — corps Roster global (exécuté) : indicateur saison + ajout');
{
  const body = extractFn(html, '_effectifRosterBody');
  const state = {
    currentSeasonId: 's1',
    players: [{ id: 'p1', name: 'Lea', num: 7, pin: '1234' }, { id: 'p2', name: 'Candice', num: 9, pin: '0000' }],
    seasonPlayers: [{ seasonId: 's1', playerId: 'p1', leftAt: '' }], // Lea dans la saison, Candice non
  };
  const POSTES = [1, 2, 3, 4, 5].map(n => ({ n, label: 'P' + n, short: 'P' + n }));
  const render = new Function('state', 'esc', '_lastSeenBadge', 'getCurrentSeason',
    'isScopedCoach', 'visiblePlayersForUser', '_seasonsLoaded', 'getSeasonPlayers',
    'PLAYER_POSTES', '_normPostes', '_postesBadges', '_ageFromDob',
    body + '\nreturn _effectifRosterBody();'
  )(state, s => String(s), () => ({ color: '#888', dot: '●', label: 'jamais vue' }), () => ({ id: 's1', status: 'active' }),
    () => false, a => a || [], () => false, () => [],
    POSTES, a => (Array.isArray(a) ? a.filter(n => n >= 1 && n <= 5) : []), () => '', () => null);
  t('liste les 2 joueuses + bouton + Ajouter', () => {
    assert.ok(render.includes('Lea') && render.includes('Candice'));
    assert.ok(/addNewPlayer\(\)/.test(render) && render.includes('+ Ajouter'));
  });
  t('indicateur « ✓ saison » pour Lea, « hors saison » pour Candice', () => {
    assert.ok(/✓ saison/.test(render));
    assert.ok(/hors saison/.test(render));
    // Candice (p2) doit précéder son tag hors-saison ; Lea son tag ✓ saison
    const iLea = render.indexOf('Lea'), iCand = render.indexOf('Candice');
    assert.ok(iLea >= 0 && iCand >= 0);
  });
  t('mention pédagogique « aussi ajoutée à la saison en cours »', () => {
    assert.ok(/aussi ajoutée à la saison en cours/.test(render));
  });
}

console.log('SCÉNARIO 4 — corps Saison (statique) : boutons + listes conservés');
{
  const b = extractFn(html, '_effectifSeasonBody');
  t('empty state si pas de saison', () => assert.ok(/Aucune saison sélectionnée/.test(b)));
  t('boutons Ajouter / Créer + retrait + réintégration conservés', () => {
    assert.ok(/openAddPlayersToSeasonModal\(\)/.test(b));
    assert.ok(/openCreateNewPlayerForSeason\(\)/.test(b));
    assert.ok(/removePlayerFromSeason\(/.test(b));
    assert.ok(/restorePlayerInSeason\(/.test(b));
  });
}

console.log(`\n✅ ${pass} assertions OK — écran Effectif unifié (onglets + rétrocompat).`);
