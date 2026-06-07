// Test isolé de la logique "défis auto par saison" (aucune DB touchée).
// Reproduit fidèlement les helpers de index.html et joue les scénarios smoke.
import assert from 'node:assert';

const DEFAULT_CHALLENGES = [
  { id: 'c1', title: 'Présences entraînements', type: 'attendance_training', metric: 'présences', endDate: '2026-06-30', scope: 'season', scores: {}, autoCount: true },
  { id: 'c2', title: 'Présences matchs', type: 'attendance_match', metric: 'matchs', endDate: '2026-06-30', scope: 'season', scores: {}, autoCount: true },
  { id: 'c4', title: 'Ponctualité', type: 'punctuality', metric: 'min retard', endDate: '2026-06-30', scope: 'season', scores: {}, autoCount: true, lowerIsBetter: true },
  { id: 'c3', title: 'Free Throw Streak', type: 'skill', metric: 'LF', endDate: '2026-05-31', scope: 'individual', scores: {} },
];

let state;
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }

// --- copie conforme des helpers de index.html ---
function getAutoChallenge(type, seasonId) {
  seasonId = seasonId || getActiveSeasonId();
  state.challenges = state.challenges || [];
  if (!seasonId) return state.challenges.find(c => c.autoCount && c.type === type) || null;
  let ch = state.challenges.find(c => c.autoCount && c.type === type && c.seasonId === seasonId);
  if (ch) return ch;
  const legacy = state.challenges.find(c => c.autoCount && c.type === type && !c.seasonId);
  if (legacy) { legacy.seasonId = seasonId; return legacy; }
  const tpl = DEFAULT_CHALLENGES.find(c => c.autoCount && c.type === type);
  if (!tpl) return null;
  ch = { ...tpl, id: `${type}-${seasonId}`, seasonId, scores: {} };
  state.challenges.push(ch);
  return ch;
}
function _cloneAutoChallengesForSeason(newSeasonId, sourceSeasonId) {
  if (!newSeasonId) return;
  state.challenges = state.challenges || [];
  let templates = sourceSeasonId ? state.challenges.filter(c => c.autoCount && c.seasonId === sourceSeasonId) : [];
  if (templates.length === 0) templates = DEFAULT_CHALLENGES.filter(c => c.autoCount);
  templates.forEach(tpl => {
    if (state.challenges.find(c => c.autoCount && c.type === tpl.type && c.seasonId === newSeasonId)) return;
    state.challenges.push({ ...tpl, id: `${tpl.type}-${newSeasonId}`, seasonId: newSeasonId, scores: {} });
  });
}
function _ensureAutoChallenges() {
  const seasonId = getActiveSeasonId();
  if (!seasonId) return false;
  state.challenges = state.challenges || [];
  let changed = false;
  state.challenges.forEach(c => { if (c.autoCount && !c.seasonId) { c.seasonId = seasonId; changed = true; } });
  DEFAULT_CHALLENGES.filter(c => c.autoCount).forEach(tpl => {
    const exists = state.challenges.find(c => c.autoCount && c.type === tpl.type && c.seasonId === seasonId);
    if (!exists) { state.challenges.push({ ...tpl, id: `${tpl.type}-${seasonId}`, seasonId, scores: {} }); changed = true; }
  });
  return changed;
}
const autoCount = c => state.challenges.filter(x => x.autoCount).length;
const find = (type, sid) => state.challenges.find(c => c.autoCount && c.type === type && c.seasonId === sid);

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — prod actuelle : défis existants seasonId set, compteurs préservés');
state = { seasons: [{ id: '2025-2026', status: 'active' }], challenges: [
  { id: 'c1', type: 'attendance_training', autoCount: true, scope: 'season', seasonId: '2025-2026', scores: { p1: 12, p2: 8 } },
  { id: 'c2', type: 'attendance_match', autoCount: true, scope: 'season', seasonId: '2025-2026', scores: { p1: 5 } },
  { id: 'c4', type: 'punctuality', autoCount: true, scope: 'season', seasonId: '2025-2026', scores: { p1: 3 } },
]};
t('backfill/init = no-op, aucun doublon', () => { const ch = _ensureAutoChallenges(); assert.equal(ch, false); assert.equal(autoCount(), 3); });
t('compteurs intacts', () => { assert.equal(find('attendance_training','2025-2026').scores.p1, 12); assert.equal(find('punctuality','2025-2026').scores.p1, 3); });

console.log('SCÉNARIO 2 — défis legacy SANS seasonId (device offline) → backfill saison active');
state = { seasons: [{ id: '2025-2026', status: 'active' }], challenges: [
  { id: 'c1', type: 'attendance_training', autoCount: true, scores: { p1: 7 } },
  { id: 'c4', type: 'punctuality', autoCount: true, scores: { p1: 2 } },
]};
t('backfill assigne la saison active', () => { const ch = _ensureAutoChallenges(); assert.equal(ch, true); assert.equal(find('attendance_training','2025-2026').scores.p1, 7); });
t('init crée le défi match manquant (vide)', () => { const m = find('attendance_match','2025-2026'); assert.ok(m); assert.deepEqual(m.scores, {}); });
t('pas de doublon training', () => { assert.equal(state.challenges.filter(c=>c.type==='attendance_training').length, 1); });

console.log('SCÉNARIO 3 — création saison N+1 : clone défis auto, compteurs vides');
state = { seasons: [{ id: '2025-2026', status: 'active' }, { id: '2026-2027', status: 'draft' }], challenges: [
  { id: 'c1', type: 'attendance_training', autoCount: true, seasonId: '2025-2026', scores: { p1: 20 } },
  { id: 'c2', type: 'attendance_match', autoCount: true, seasonId: '2025-2026', scores: { p1: 10 } },
  { id: 'c4', type: 'punctuality', autoCount: true, seasonId: '2025-2026', scores: { p1: 4 } },
]};
_cloneAutoChallengesForSeason('2026-2027', '2025-2026');
t('3 nouveaux défis pour N+1', () => { assert.equal(state.challenges.filter(c=>c.seasonId==='2026-2027').length, 3); });
t('compteurs N+1 vides', () => { ['attendance_training','attendance_match','punctuality'].forEach(ty => assert.deepEqual(find(ty,'2026-2027').scores, {})); });
t('compteurs N intacts', () => { assert.equal(find('attendance_training','2025-2026').scores.p1, 20); });
t('clone idempotent', () => { _cloneAutoChallengesForSeason('2026-2027','2025-2026'); assert.equal(state.challenges.filter(c=>c.seasonId==='2026-2027').length, 3); });

console.log('SCÉNARIO 4 — incrément sur N+1 va dans N+1, pas dans N');
// N+1 est maintenant active
state.seasons = [{ id: '2025-2026', status: 'archived' }, { id: '2026-2027', status: 'active' }];
const beforeN = find('attendance_training','2025-2026').scores.p1;
const chNplus1 = getAutoChallenge('attendance_training', '2026-2027');
chNplus1.scores.p1 = (chNplus1.scores.p1 || 0) + 1;
t('défi N+1 incrémenté', () => assert.equal(find('attendance_training','2026-2027').scores.p1, 1));
t('défi N inchangé', () => assert.equal(find('attendance_training','2025-2026').scores.p1, beforeN));

console.log('SCÉNARIO 5 — saison N+1 SANS défis clonés : incrément crée à la volée');
state = { seasons: [{ id: '2026-2027', status: 'active' }], challenges: [
  { id: 'c1', type: 'attendance_training', autoCount: true, seasonId: '2025-2026', scores: { p1: 99 } },
]};
const ch = getAutoChallenge('attendance_training', '2026-2027');
t('crée le défi N+1 à la volée (id déterministe)', () => { assert.equal(ch.id, 'attendance_training-2026-2027'); assert.deepEqual(ch.scores, {}); });
t('ancien défi N intact (cumul stoppé)', () => assert.equal(state.challenges.find(c=>c.seasonId==='2025-2026').scores.p1, 99));

console.log('SCÉNARIO 6 — saisons non chargées : fallback legacy, pas de création');
state = { seasons: [], challenges: [{ id: 'c1', type: 'attendance_training', autoCount: true, scores: {} }] };
t('getAutoChallenge retourne le legacy sans rien créer', () => { const c = getAutoChallenge('attendance_training', null); assert.equal(c.id, 'c1'); assert.equal(state.challenges.length, 1); });
t('_ensureAutoChallenges no-op si pas de saison active', () => assert.equal(_ensureAutoChallenges(), false));

console.log(`\n✅ ${pass} assertions OK — défis auto correctement scopés par saison.`);
