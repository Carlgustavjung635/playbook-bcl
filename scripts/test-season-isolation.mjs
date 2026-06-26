// Test isolé du cloisonnement saison-par-date + recompute + présence par défaut.
// Reproduit fidèlement les helpers de index.html (aucune DB touchée).
import assert from 'node:assert';

const DEFAULT_CHALLENGES = [
  { id: 'c1', title: 'Présences entraînements', type: 'attendance_training', metric: 'présences', scope: 'season', scores: {}, autoCount: true },
  { id: 'c2', title: 'Présences matchs', type: 'attendance_match', metric: 'matchs', scope: 'season', scores: {}, autoCount: true },
  { id: 'c4', title: 'Ponctualité', type: 'punctuality', metric: 'min retard', scope: 'season', scores: {}, autoCount: true, lowerIsBetter: true },
];

let state;

// --- helpers copiés conformes ---
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
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
function getSeasonIdForDate(dateStr) {
  if (!dateStr || !_seasonsLoaded()) return null;
  const hit = (state.seasons || []).find(s => s.startDate && dateStr >= s.startDate && (!s.endDate || dateStr <= s.endDate));
  return hit ? hit.id : null;
}
function seasonIdForConvocInstance(c, instanceDate) {
  const d = instanceDate || (c && c.date) || null;
  return getSeasonIdForDate(d) || (c && c.seasonId) || state.currentSeasonId || null;
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
  const r = convoc.recurrence;
  if (r.type === 'weekly' && r.days && r.days.length > 0) {
    const start = new Date(convoc.date + 'T00:00:00');
    const until = r.until ? new Date(r.until + 'T00:00:00') : new Date(to.getTime());
    const stopAt = until < to ? until : to;
    let cursor = new Date(Math.max(start.getTime(), from.getTime())); cursor.setHours(0,0,0,0);
    while (cursor <= stopAt) {
      if (cursor >= start && r.days.includes(cursor.getDay())) {
        const dateStr = isoDate(cursor);
        if (!(convoc.cancelledInstances || []).includes(dateStr)) instances.push(makeConvocInstance(convoc, dateStr));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return instances;
}
// cœur de clôture (extrait fidèle, sans persist/render)
function _applyConvocClosure(c, instanceDate) {
  if (!c) return false;
  const _instDate = instanceDate || c.date || null;
  const _seasonId = seasonIdForConvocInstance(c, _instDate);
  const _convTeam = c.teamTag === 'both' ? 'all' : (c.teamTag === 'e2' ? 'e2' : 'e1');
  const _seasonPool = _seasonsLoaded() && _seasonId ? getSeasonPlayers(_seasonId, { team: _convTeam }) : (state.players || []);
  const targetType = c.type === 'match' ? 'attendance_match' : 'attendance_training';
  const ch = getAutoChallenge(targetType, _seasonId);
  const credit = (responses) => {
    if (!ch) return;
    const presentPlayers = _seasonPool.filter(p => !responses[p.id] || responses[p.id].status === 'present');
    ch.scores = ch.scores || {};
    presentPlayers.forEach(p => { ch.scores[p.id] = (ch.scores[p.id] || 0) + 1; });
  };
  if (c.recurrence && instanceDate) {
    c.instanceOverrides = c.instanceOverrides || {};
    c.instanceOverrides[instanceDate] = c.instanceOverrides[instanceDate] || {};
    const ov = c.instanceOverrides[instanceDate];
    if (ov.closed) return false;
    credit(ov.responses || c.responses || {});
    ov.closed = true;
  } else {
    if (c.closed) return false;
    credit(c.responses || {});
    c.closed = true;
  }
  return true;
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
function recomputeAutoChallengeScores(opts) {
  opts = opts || {}; const dryRun = !!opts.dryRun;
  const todayISO = isoDate(new Date());
  const starts = (state.seasons || []).map(s => s.startDate).filter(Boolean).sort();
  const fromISO = starts[0] || '2000-01-01';
  const computed = computeAutoScoresFromSource(fromISO, todayISO);
  const report = [];
  ['attendance_training', 'attendance_match', 'punctuality'].forEach(type => {
    const bySeason = computed[type] || {};
    const seasonIds = new Set([...Object.keys(bySeason), ...(state.challenges || []).filter(c => c.autoCount && c.type === type && c.seasonId).map(c => c.seasonId)]);
    seasonIds.forEach(sid => {
      const ch = getAutoChallenge(type, sid); if (!ch) return;
      const before = ch.scores || {}; const after = bySeason[sid] || {};
      const pids = new Set([...Object.keys(before), ...Object.keys(after)]);
      let changedPlayers = 0, beforeTotal = 0, afterTotal = 0;
      pids.forEach(pid => { const b = before[pid] || 0, a = after[pid] || 0; beforeTotal += b; afterTotal += a; if (b !== a) changedPlayers++; });
      if (changedPlayers > 0 || beforeTotal !== afterTotal) report.push({ type, seasonId: sid, beforeTotal, afterTotal, changedPlayers });
      if (!dryRun) ch.scores = { ...after };
    });
  });
  return report;
}

// --- scénarios ---
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshState() {
  return {
    currentSeasonId: '2025-2026',
    seasons: [
      { id: '2024-2025', startDate: '2024-09-01', endDate: '2025-06-30', status: 'archived' },
      { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'active' },
    ],
    players: [ { id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' } ],
    seasonPlayers: [
      { seasonId: '2024-2025', playerId: 'p1', teamTag: 'e1' }, { seasonId: '2024-2025', playerId: 'p2', teamTag: 'e1' },
      { seasonId: '2025-2026', playerId: 'p1', teamTag: 'e1' }, { seasonId: '2025-2026', playerId: 'p2', teamTag: 'e1' },
    ],
    convocations: [], challenges: [],
  };
}

console.log('SCÉNARIO 1 — clôture rétroactive : créditée à la saison de la DATE (pas la courante)');
state = freshState();
// convoc d'entraînement du 10 mai 2025 (saison 2024-2025) MAIS seasonId contaminé à 2025-2026
state.convocations.push({ id: 'cv1', type: 'training', date: '2025-05-10', seasonId: '2025-2026', teamTag: 'e1', responses: {} });
t('clôture crédite attendance_training de 2024-2025', () => {
  const c = state.convocations[0];
  assert.strictEqual(_applyConvocClosure(c, null), true);
  const chOld = getAutoChallenge('attendance_training', '2024-2025');
  const chNew = state.challenges.find(x => x.autoCount && x.type === 'attendance_training' && x.seasonId === '2025-2026');
  assert.deepStrictEqual(chOld.scores, { p1: 1, p2: 1 }, 'saison de la date doit recevoir +1/+1');
  assert.ok(!chNew || Object.keys(chNew.scores || {}).length === 0, 'saison courante NE doit PAS être créditée');
});

console.log('SCÉNARIO 2 — présence par défaut si pas d\'appel (présomption favorable)');
state = freshState();
state.convocations.push({ id: 'cv2', type: 'training', date: '2026-01-15', seasonId: '2025-2026', teamTag: 'e1', responses: {} });
t('aucune réponse → toutes présentes', () => {
  _applyConvocClosure(state.convocations[0], null);
  const ch = getAutoChallenge('attendance_training', '2025-2026');
  assert.deepStrictEqual(ch.scores, { p1: 1, p2: 1 });
});
t('une absente explicite → non créditée, l\'autre présente', () => {
  state = freshState();
  state.convocations.push({ id: 'cv3', type: 'training', date: '2026-01-22', seasonId: '2025-2026', teamTag: 'e1', responses: { p2: { status: 'absent', reason: 'blessée' } } });
  _applyConvocClosure(state.convocations[0], null);
  const ch = getAutoChallenge('attendance_training', '2025-2026');
  assert.deepStrictEqual(ch.scores, { p1: 1 });
});

console.log('SCÉNARIO 3 — match attribué par date');
state = freshState();
state.convocations.push({ id: 'cv4', type: 'match', date: '2025-03-01', seasonId: '2025-2026', teamTag: 'e1', responses: {} });
t('match du 01/03/2025 → attendance_match 2024-2025', () => {
  _applyConvocClosure(state.convocations[0], null);
  const ch = getAutoChallenge('attendance_match', '2024-2025');
  assert.deepStrictEqual(ch.scores, { p1: 1, p2: 1 });
});

console.log('SCÉNARIO 4 — recompute idempotent + corrige une contamination existante');
state = freshState();
// 2 entraînements clôturés : un en 2024-2025 (juin), un en 2025-2026 (oct)
state.convocations.push({ id: 'a', type: 'training', date: '2025-06-02', seasonId: '2025-2026', teamTag: 'e1', responses: {}, closed: true });
state.convocations.push({ id: 'b', type: 'training', date: '2025-10-06', seasonId: '2025-2026', teamTag: 'e1', responses: {}, closed: true });
// état contaminé : tout a été compté dans 2025-2026
state.challenges.push({ id: 'attendance_training-2025-2026', type: 'attendance_training', autoCount: true, scope: 'season', seasonId: '2025-2026', scores: { p1: 2, p2: 2 } });
t('dry-run détecte l\'écart', () => {
  const rep = recomputeAutoChallengeScores({ dryRun: true });
  assert.ok(rep.length >= 1, 'au moins un écart attendu');
  // après dry-run, les scores ne changent pas
  const ch = state.challenges.find(x => x.seasonId === '2025-2026' && x.type === 'attendance_training');
  assert.deepStrictEqual(ch.scores, { p1: 2, p2: 2 });
});
t('apply re-clé : 1 en 2024-2025, 1 en 2025-2026', () => {
  recomputeAutoChallengeScores({ dryRun: false });
  const chOld = getAutoChallenge('attendance_training', '2024-2025');
  const chNew = getAutoChallenge('attendance_training', '2025-2026');
  assert.deepStrictEqual(chOld.scores, { p1: 1, p2: 1 }, '2024-2025 = la séance de juin');
  assert.deepStrictEqual(chNew.scores, { p1: 1, p2: 1 }, '2025-2026 = la séance d\'octobre');
});
t('recompute idempotent (2e passage = stable)', () => {
  const snap = JSON.stringify(state.challenges.map(c => [c.seasonId, c.type, c.scores]));
  recomputeAutoChallengeScores({ dryRun: false });
  const snap2 = JSON.stringify(state.challenges.map(c => [c.seasonId, c.type, c.scores]));
  assert.strictEqual(snap, snap2);
});

console.log('SCÉNARIO 5 — getSeasonIdForDate frontières');
state = freshState();
t('bornes incluses + trous', () => {
  assert.strictEqual(getSeasonIdForDate('2025-09-01'), '2025-2026');
  assert.strictEqual(getSeasonIdForDate('2026-06-30'), '2025-2026');
  assert.strictEqual(getSeasonIdForDate('2025-06-30'), '2024-2025');
  assert.strictEqual(getSeasonIdForDate('2025-07-15'), null, 'intersaison (trou) → null');
});

console.log(`\n✅ ${pass} assertions OK`);
