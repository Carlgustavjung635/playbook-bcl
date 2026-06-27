// Test de la visibilité du mini-guide joueuse gatée par le changement de PIN.
// Reproduit fidèlement playerPinIsDefault / shouldShowPlayerGuide de index.html.
// Règle : guide visible tant que PIN par défaut ('0000') ; masqué dès qu'il est
// changé ; rappel manuel via _guideForceShow (session). Aucun flag ni migration.
import assert from 'node:assert';

let state;
function currentPlayer() {
  if (!state.auth || state.auth.role !== 'player') return null;
  return (state.players || []).find(p => p.id === state.auth.playerId) || null;
}

// --- SUJET DU TEST (extrait fidèle de index.html) ---
function playerPinIsDefault() {
  if (!state.auth || state.auth.role !== 'player') return false;
  const p = (typeof currentPlayer === 'function') ? currentPlayer() : null;
  return !p || p.pin == null || p.pin === '0000';
}
function shouldShowPlayerGuide() {
  return state._guideForceShow === true || playerPinIsDefault();
}
// extrait de saveMyPin (partie joueuse)
function saveMyPin(newVal) {
  const p = currentPlayer();
  p.pin = newVal;
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshPlayer(pin) {
  return {
    auth: { role: 'player', playerId: 'pl1' },
    players: [{ id: 'pl1', name: 'Alice', num: 4, pin }],
    _guideForceShow: false,
  };
}

console.log('SCÉNARIO 1 — PIN par défaut → guide visible');
state = freshPlayer('0000');
t('pin 0000 → playerPinIsDefault true', () => assert.strictEqual(playerPinIsDefault(), true));
t('pin 0000 → guide affiché', () => assert.strictEqual(shouldShowPlayerGuide(), true));

console.log('SCÉNARIO 2 — PIN personnalisé → guide masqué');
state = freshPlayer('4321');
t('pin 4321 → playerPinIsDefault false', () => assert.strictEqual(playerPinIsDefault(), false));
t('pin 4321 → guide masqué', () => assert.strictEqual(shouldShowPlayerGuide(), false));

console.log('SCÉNARIO 3 — changement de PIN masque le guide immédiatement');
state = freshPlayer('0000');
t('avant : visible', () => assert.strictEqual(shouldShowPlayerGuide(), true));
t('après saveMyPin(7890) : masqué', () => {
  saveMyPin('7890');
  assert.strictEqual(shouldShowPlayerGuide(), false);
});

console.log('SCÉNARIO 4 — rappel manuel « ↻ Revoir le guide » force l\'affichage');
state = freshPlayer('4321'); // PIN déjà changé → normalement masqué
t('masqué par défaut', () => assert.strictEqual(shouldShowPlayerGuide(), false));
t('_guideForceShow=true → réaffiché malgré PIN changé', () => {
  state._guideForceShow = true; // simule reopenPlayerGuide()
  assert.strictEqual(shouldShowPlayerGuide(), true);
});

console.log('SCÉNARIO 5 — migration douce : pin manquant = considéré par défaut (onboarding)');
state = freshPlayer(undefined);
t('pin absent → guide visible (gentil)', () => assert.strictEqual(shouldShowPlayerGuide(), true));

console.log('SCÉNARIO 6 — non-joueuse (coach) → guide jamais concerné');
state = { auth: { role: 'coach' }, players: [], _guideForceShow: false };
t('coach → playerPinIsDefault false', () => assert.strictEqual(playerPinIsDefault(), false));
t('coach → guide masqué', () => assert.strictEqual(shouldShowPlayerGuide(), false));

console.log(`\n✅ ${pass} assertions OK — guide joueuse gaté par le changement de PIN.`);
