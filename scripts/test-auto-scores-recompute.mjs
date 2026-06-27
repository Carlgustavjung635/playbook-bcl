// Test du RECOMPUTE-ON-READ des compteurs auto (autoChallengeScores / getAutoScoreFor).
// Reproduit fidèlement les helpers de index.html (aucune DB touchée).
// Cas central : Alice voit "2" en saison active alors qu'elle n'a 0 présence
// réelle cette saison (scalaire c.scores contaminé avant le cloisonnement) →
// après recompute-on-read, elle doit voir 0 SANS aucune action utilisateur.
import assert from 'node:assert';

let state;
let _periodOverride = 'season'; // stub de getChallengePeriod (pas de localStorage en node)

// --- helpers copiés conformes à index.html ---
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getCurrentSeason() { return (state.seasons || []).find(s => s.id === state.currentSeasonId) || null; }
function teamTagMatches(tag, want) { if (!want || want === 'all') return true; const t = tag || 'e1'; return t === want || t === 'both'; }
function getSeasonPlayers(seasonId, { team = 'all' } = {}) {
  if (!seasonId) return state.players || [];
  const links = (state.seasonPlayers || []).filter(sp => sp.seasonId === seasonId);
  return links.map(link => {
    const p = (state.players || []).find(p => p.id === link.playerId);
    if (!p) return null;
    if (link.leftAt) return null;
    if (!teamTagMatches(link.teamTag, team)) return null;
    return { ...p, _seasonLink: link };
  }).filter(Boolean);
}
function getSeasonIdForDate(dateStr) {
  if (!dateStr || !_seasonsLoaded()) return null;
  const hit = (state.seasons || []).find(s => s.startDate && dateStr >= s.startDate && (!s.endDate || dateStr <= s.endDate));
  return hit ? hit.id : null;
}
function makeConvocInstance(convoc, dateStr) {
  const override = (convoc.instanceOverrides || {})[dateStr] || {};
  return { ...convoc, date: dateStr, responses: override.responses || convoc.responses || {}, closed: (override.closed || convoc.closed) === true };
}
function getConvocInstances(convoc, fromISO, toISO) {
  const instances = [];
  const from = new Date(fromISO + 'T00:00:00'); const to = new Date(toISO + 'T00:00:00');
  if (!convoc.recurrence) {
    const d = new Date(convoc.date + 'T00:00:00');
    if (d >= from && d <= to) instances.push(makeConvocInstance(convoc, convoc.date));
    return instances;
  }
  return instances; // pas de récurrence dans ces scénarios
}
function computeAutoScoresFromSource(fromISO, toISO) {
  const out = { attendance_training: {}, attendance_match: {}, punctuality: {} };
  const bump = (type, sid, pid, delta) => { if (!sid) return; out[type][sid] = out[type][sid] || {}; out[type][sid][pid] = (out[type][sid][pid] || 0) + delta; };
  (state.convocations || []).forEach(c => {
    const team = c.teamTag === 'both' ? 'all' : (c.teamTag === 'e2' ? 'e2' : 'e1');
    getConvocInstances(c, fromISO, toISO).forEach(inst => {
      const date = inst.date; const sid = getSeasonIdForDate(date);
      const pool = (_seasonsLoaded() && sid) ? getSeasonPlayers(sid, { team }) : (state.players || []);
      if (inst.closed) {
        const responses = inst.responses || {};
        const type = c.type === 'match' ? 'attendance_match' : 'attendance_training';
        pool.forEach(p => { const r = responses[p.id]; if (!r || r.status === 'present') bump(type, sid, p.id, 1); });
      }
      const sheet = (c.recurrence ? ((c.instanceOverrides || {})[date] || {}).callSheet : c.callSheet) || null;
      const arrivals = sheet && sheet.arrivals;
      if (arrivals) Object.keys(arrivals).forEach(pid => { const late = (arrivals[pid] && arrivals[pid].lateMin) || 0; if (late > 0) bump('punctuality', sid, pid, late); });
    });
  });
  return out;
}
function getChallengePeriod() { return _periodOverride; }
function challengePeriodWindow(period) {
  period = period || getChallengePeriod();
  const now = new Date();
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  const season = getCurrentSeason();
  return { from: (season && season.startDate) || '0000-01-01', to: (season && season.endDate) || '9999-12-31' };
}

// --- SUJET DU TEST : recompute-on-read (extrait fidèle de index.html) ---
let _autoScoreMemo = { key: null, data: null };
let _computeCalls = 0; // instrumentation : compte les calculs réels (pour la mémoïsation)
function invalidateAutoScoreCache() { _autoScoreMemo = { key: null, data: null }; }
function _autoScoresForWindow(fromISO, toISO) {
  const key = (fromISO || '') + '|' + (toISO || '');
  if (_autoScoreMemo.key === key && _autoScoreMemo.data) return _autoScoreMemo.data;
  _computeCalls++;
  const data = computeAutoScoresFromSource(fromISO, toISO);
  _autoScoreMemo = { key, data };
  return data;
}
function autoChallengeScores(c, period) {
  if (!c || !c.autoCount) return (c && c.scores) || {};
  period = period || getChallengePeriod();
  const sid = c.seasonId || state.currentSeasonId;
  let w;
  if (period === 'season') {
    const season = (state.seasons || []).find(s => s.id === sid);
    w = (season && season.startDate)
      ? { from: season.startDate, to: season.endDate || '9999-12-31' }
      : challengePeriodWindow('season');
  } else {
    w = challengePeriodWindow(period);
  }
  const comp = _autoScoresForWindow(w.from, w.to);
  return (comp[c.type] && comp[c.type][sid]) || {};
}
function getAutoScoreFor(c, playerId, period) { return autoChallengeScores(c, period)[playerId] || 0; }

// --- scénarios ---
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshState() {
  return {
    currentSeasonId: '2026-2027',
    seasons: [
      { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived', name: 'Saison 2025-2026' },
      { id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active', name: 'Saison 2026-2027' },
    ],
    players: [ { id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' } ],
    seasonPlayers: [
      { seasonId: '2025-2026', playerId: 'p1', teamTag: 'e1' }, { seasonId: '2025-2026', playerId: 'p2', teamTag: 'e1' },
      { seasonId: '2026-2027', playerId: 'p1', teamTag: 'e1' }, { seasonId: '2026-2027', playerId: 'p2', teamTag: 'e1' },
    ],
    convocations: [], challenges: [],
  };
}

console.log("SCÉNARIO 1 — Alice : '2' contaminé en saison active → recompute affiche 0");
state = freshState();
_periodOverride = 'season';
invalidateAutoScoreCache();
// 2 entraînements RÉELS clôturés en 2025-2026 (saison archivée) où Alice était présente
state.convocations.push({ id: 'a', type: 'training', date: '2025-10-06', teamTag: 'e1', responses: {}, closed: true });
state.convocations.push({ id: 'b', type: 'training', date: '2025-11-03', teamTag: 'e1', responses: {}, closed: true });
// AUCUN entraînement clôturé en 2026-2027 (Alice n'a aucune présence réelle cette saison)
// MAIS le défi auto de la saison active porte un scalaire CONTAMINÉ (écrit avant #69)
const chActive = { id: 'attendance_training-2026-2027', type: 'attendance_training', autoCount: true, scope: 'season', seasonId: '2026-2027', scores: { p1: 2, p2: 2 } };
const chArchived = { id: 'attendance_training-2025-2026', type: 'attendance_training', autoCount: true, scope: 'season', seasonId: '2025-2026', scores: { p1: 2, p2: 2 } };
state.challenges.push(chActive, chArchived);
t('AVANT recompute : le scalaire contaminé vaut bien 2 (reproduit le bug)', () => {
  assert.strictEqual((chActive.scores || {}).p1, 2);
});
t('APRÈS recompute-on-read : Alice = 0 en 2026-2027 (aucune présence réelle)', () => {
  assert.strictEqual(getAutoScoreFor(chActive, 'p1', 'season'), 0);
  assert.strictEqual(getAutoScoreFor(chActive, 'p2', 'season'), 0);
});
t('le scalaire persisté n\'est PAS modifié (rétrocompat / badges conservés)', () => {
  assert.deepStrictEqual(chActive.scores, { p1: 2, p2: 2 }, 'cache c.scores intact');
});
t('la saison archivée 2025-2026 reflète les 2 présences réelles', () => {
  assert.strictEqual(getAutoScoreFor(chArchived, 'p1', 'season'), 2);
  assert.strictEqual(getAutoScoreFor(chArchived, 'p2', 'season'), 2);
});

console.log('SCÉNARIO 2 — défi MANUEL : lecture inchangée (c.scores)');
state = freshState(); invalidateAutoScoreCache();
const chManual = { id: 'm1', type: 'custom', autoCount: false, scope: 'individual', seasonId: '2026-2027', scores: { p1: 9 } };
t('manuel → renvoie c.scores tel quel', () => {
  assert.strictEqual(getAutoScoreFor(chManual, 'p1'), 9);
  assert.deepStrictEqual(autoChallengeScores(chManual), { p1: 9 });
});

console.log('SCÉNARIO 3 — invalidation du cache après nouvelle clôture');
state = freshState(); _periodOverride = 'season'; invalidateAutoScoreCache();
state.challenges.push(chActive); // réutilise un défi auto 2026-2027
t('départ : 0 présence en 2026-2027', () => {
  assert.strictEqual(getAutoScoreFor(chActive, 'p1', 'season'), 0);
});
t('clôture réelle en 2026-2027 + invalidation → recompute voit 1', () => {
  state.convocations.push({ id: 'c2627', type: 'training', date: '2026-10-05', teamTag: 'e1', responses: {}, closed: true });
  invalidateAutoScoreCache(); // simulé par persist()
  assert.strictEqual(getAutoScoreFor(chActive, 'p1', 'season'), 1);
});

console.log('SCÉNARIO 4 — mémoïsation : 1 seul calcul partagé tant que la fenêtre ne change pas');
state = freshState(); _periodOverride = 'season'; invalidateAutoScoreCache();
state.convocations.push({ id: 'd', type: 'training', date: '2026-10-05', teamTag: 'e1', responses: {}, closed: true });
state.challenges.push(chActive);
t('3 lectures même fenêtre → 1 seul computeAutoScoresFromSource', () => {
  _computeCalls = 0; invalidateAutoScoreCache();
  getAutoScoreFor(chActive, 'p1', 'season');
  getAutoScoreFor(chActive, 'p2', 'season');
  autoChallengeScores(chActive, 'season');
  assert.strictEqual(_computeCalls, 1, 'mémoïsé par fenêtre de dates');
});
t('invalidation force un recalcul', () => {
  _computeCalls = 0;
  getAutoScoreFor(chActive, 'p1', 'season'); // sert le cache existant
  assert.strictEqual(_computeCalls, 0);
  invalidateAutoScoreCache();
  getAutoScoreFor(chActive, 'p1', 'season');
  assert.strictEqual(_computeCalls, 1);
});

console.log('SCÉNARIO 5 — filtre période Mois s\'applique par-dessus le recompute');
state = freshState(); invalidateAutoScoreCache();
state.challenges.push(chActive);
t('période season ≠ période month renvoient des fenêtres distinctes', () => {
  const wSeason = challengePeriodWindow('season');
  const wMonth = challengePeriodWindow('month');
  assert.notStrictEqual(wSeason.from, wMonth.from, 'fenêtres distinctes (mois glissant vs saison)');
  // le recompute reste fonctionnel quelle que soit la période demandée
  assert.strictEqual(getAutoScoreFor(chActive, 'p1', 'month'), 0);
});

console.log(`\n✅ ${pass} assertions OK`);
