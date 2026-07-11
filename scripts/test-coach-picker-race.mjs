// Test FIX SYNC COACH — anti-course du sélecteur de coach au login.
// Bug prod : sur un nouveau device, `pickRole('coach')` décidait « sélecteur vs
// admin direct » à partir de state.coaches peuplé de façon ASYNCHRONE → un clic
// avant la fin du fetch masquait les coachs existants en base (golden path admin).
// Fix : si aucun coach non-admin en local ET en ligne → fetch frais AVANT de trancher.
// Extrait FIDÈLE de la logique pickRole (branche coach).
import assert from 'node:assert';

// Reproduction fidèle de la branche « coach » de pickRole (index.html).
async function pickRoleCoachBranch(state, { online, PbSync }) {
  const _nonAdminCoaches = () => (state.coaches || []).filter(c => c.coachRole === 'coach');
  state.authFlow = state.authFlow || {};
  state.authFlow.role = 'coach';
  state.authFlow.coachId = null;
  if (_nonAdminCoaches().length === 0 && online && PbSync && PbSync.fetchOne) {
    state.authFlow.stage = 'coachLoading';
    await PbSync.fetchOne(state, 'coaches');
    if (!state.authFlow || state.authFlow.role !== 'coach' || state.authFlow.stage !== 'coachLoading') return;
  }
  state.authFlow.stage = _nonAdminCoaches().length > 0 ? 'pickCoach' : 'pin';
  if (state.authFlow.stage === 'pin') state.authFlow.pinInput = '';
}

// fetchOne mock : peuple state.coaches depuis un « remote » fourni.
function mkPbSync(remoteRows) {
  return { async fetchOne(state) { state.coaches = remoteRows.slice(); return true; } };
}

let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }

const REMOTE = [
  { id: 'admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] },
  { id: 'x1', name: 'Manu', coachRole: 'coach', teams: ['e2'] }
];

// 1. Nouveau device, local vide, EN LIGNE, coach existe en base → fetch → pickCoach
{
  const state = { coaches: [], authFlow: {} };
  await pickRoleCoachBranch(state, { online: true, PbSync: mkPbSync(REMOTE) });
  ok('local vide + online + coach en base → stage pickCoach', state.authFlow.stage === 'pickCoach');
  ok('le coach Manu est chargé après le fetch', (state.coaches || []).some(c => c.coachRole === 'coach'));
}

// 2. Local vide, EN LIGNE, AUCUN coach non-admin en base → golden path admin (pin)
{
  const state = { coaches: [], authFlow: {} };
  await pickRoleCoachBranch(state, { online: true, PbSync: mkPbSync([{ id: 'admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }]) });
  ok('local vide + online + aucun coach → stage pin (golden path)', state.authFlow.stage === 'pin');
}

// 3. Local vide, HORS LIGNE → pas de fetch → golden path (on ne peut pas savoir)
{
  const state = { coaches: [], authFlow: {} };
  let fetched = false;
  await pickRoleCoachBranch(state, { online: false, PbSync: { async fetchOne() { fetched = true; } } });
  ok('offline → pas de fetch', fetched === false);
  ok('offline + local vide → stage pin', state.authFlow.stage === 'pin');
}

// 4. Coach déjà présent en local → pas de fetch nécessaire → pickCoach direct
{
  const state = { coaches: REMOTE.slice(), authFlow: {} };
  let fetched = false;
  await pickRoleCoachBranch(state, { online: true, PbSync: { async fetchOne() { fetched = true; } } });
  ok('local non vide → aucun fetch superflu', fetched === false);
  ok('local non vide → stage pickCoach direct', state.authFlow.stage === 'pickCoach');
}

// 5. L'utilisateur quitte l'écran pendant le fetch (back) → on n'écrase pas son état
{
  const state = { coaches: [], authFlow: {} };
  const PbSync = { async fetchOne(st) { st.authFlow = { stage: 'role', role: null }; st.coaches = REMOTE.slice(); } };
  await pickRoleCoachBranch(state, { online: true, PbSync });
  ok('navigation pendant le fetch → état non forcé (reste sur role)', state.authFlow.stage === 'role');
}

console.log(`\n✓ ${passed} assertions passées — anti-course sélecteur de coach OK`);
