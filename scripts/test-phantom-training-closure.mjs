// Test du « fantôme du 24 mai » : entraînement d'une saison passée qui remontait
// en boucle dans la modale « à clôturer » de la saison active.
// Reproduit fidèlement getOverdueTrainings (+ helpers) de index.html, avec un
// « aujourd'hui » injectable pour rester déterministe (pas de Date.now()).
import assert from 'node:assert';

let state;

// --- helpers copiés conformes à index.html ---
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function getSeasonIdForDate(dateStr) {
  if (!dateStr || !_seasonsLoaded()) return null;
  const hit = (state.seasons || []).find(s => s.startDate && dateStr >= s.startDate && (!s.endDate || dateStr <= s.endDate));
  return hit ? hit.id : null;
}
function _convocsSeasonId(seasonId) {
  if (!_seasonsLoaded()) return state.convocations || [];
  const activeId = getActiveSeasonId();
  return (state.convocations || []).filter(c => c.seasonId ? c.seasonId === seasonId : seasonId === activeId);
}
function currentSeasonConvocations() { return _convocsSeasonId(state.currentSeasonId); } // (filtre équipe non pertinent ici)
function makeConvocInstance(convoc, dateStr) {
  const override = (convoc.instanceOverrides || {})[dateStr] || {};
  return { ...convoc, date: dateStr, responses: override.responses || convoc.responses || {},
    time: override.time || convoc.time, closed: (override.closed || convoc.closed) === true };
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
const TRAINING_AUTOCLOSE_GRACE_MS = 2 * 60 * 60 * 1000;
const TRAINING_AUTOCLOSE_LOOKBACK_DAYS = 60;
function _autoCloseEnabled() { return _seasonsLoaded() && state.currentSeasonId && state.currentSeasonId === getActiveSeasonId(); }
function _instanceStartMs(dateStr, time) { const t = (time || '00:00').padStart(5, '0'); return new Date(dateStr + 'T' + t + ':00').getTime(); }
function _isTrainingOverdue(dateStr, time, now) { const startMs = _instanceStartMs(dateStr, time); if (isNaN(startMs)) return false; return now > startMs + TRAINING_AUTOCLOSE_GRACE_MS; }

// SUJET DU TEST : getOverdueTrainings AVEC le garde-fou saison (today injectable).
function getOverdueTrainings(todayDate) {
  if (!_autoCloseEnabled()) return [];
  const now = todayDate.getTime() + 23 * 3600000; // « maintenant » = fin de journée pour que les instances du jour soient échues
  const today = new Date(todayDate); today.setHours(0, 0, 0, 0);
  const fromISO = isoDate(new Date(today.getTime() - TRAINING_AUTOCLOSE_LOOKBACK_DAYS * 86400000));
  const todayISO = isoDate(today);
  const activeId = getActiveSeasonId();
  const out = [];
  currentSeasonConvocations().filter(c => c.type === 'training').forEach(c => {
    getConvocInstances(c, fromISO, todayISO).forEach(inst => {
      if (inst.closed) return;
      if (getSeasonIdForDate(inst.date) !== activeId) return; // garde-fou par DATE
      if (!_isTrainingOverdue(inst.date, inst.time, now)) return;
      out.push({ convocId: c.id, instanceDate: inst.date, instance: inst, startMs: _instanceStartMs(inst.date, inst.time) });
    });
  });
  return out.sort((a, b) => a.startMs - b.startMs);
}
// clôture conforme : récurrent → instanceOverrides[date].closed ; sinon c.closed.
function autoCloseTraining(convocId, instanceDate) {
  const c = state.convocations.find(x => x.id === convocId);
  if (!c) return;
  if (c.recurrence && instanceDate) {
    c.instanceOverrides = c.instanceOverrides || {};
    c.instanceOverrides[instanceDate] = c.instanceOverrides[instanceDate] || {};
    c.instanceOverrides[instanceDate].closed = true;
  } else { c.closed = true; }
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshState() {
  return {
    currentSeasonId: '2026-2027', // coach a PRÉ-ACTIVÉ la saison N+1 (avant son démarrage calendaire)
    seasons: [
      { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' },
      { id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' },
    ],
    players: [ { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bea' } ],
    convocations: [],
  };
}

console.log('SCÉNARIO 1 — fantôme du 24 mai (∈ 2025-2026) NON listé sous la saison active 2026-2027');
state = freshState();
// entraînement non récurrent du 24/05/2026, seasonId CONTAMINÉ à la saison active
state.convocations.push({ id: 'cv-phantom', type: 'training', date: '2026-05-24', time: '20:20', seasonId: '2026-2027', teamTag: 'e1', responses: {} });
t('aujourd\'hui 2026-06-27 → fantôme exclu (date ∈ 2025-2026 ≠ active)', () => {
  const overdue = getOverdueTrainings(new Date('2026-06-27T12:00:00'));
  assert.strictEqual(overdue.length, 0, 'aucun entraînement à clôturer sous la saison active');
});
t('preuve : sans garde-fou la date est bien dans la fenêtre lookback + échue', () => {
  // date du 24 mai à 60j de 2026-06-27 ? oui (33j) ; échue ? oui. Seul le garde-fou l'exclut.
  assert.strictEqual(getSeasonIdForDate('2026-05-24'), '2025-2026');
  assert.notStrictEqual('2025-2026', getActiveSeasonId());
});

console.log('SCÉNARIO 2 — entraînement légitime de la saison active listé, fantôme cross-saison exclu');
state = freshState();
state.convocations.push({ id: 'cv-legit', type: 'training', date: '2026-11-02', time: '20:00', seasonId: '2026-2027', teamTag: 'e1', responses: {} });
state.convocations.push({ id: 'cv-phantom', type: 'training', date: '2026-05-24', time: '20:20', seasonId: '2026-2027', teamTag: 'e1', responses: {} });
t('aujourd\'hui 2026-11-15 → seul l\'entraînement de novembre (∈ 2026-2027) est listé', () => {
  const overdue = getOverdueTrainings(new Date('2026-11-15T12:00:00'));
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].convocId, 'cv-legit');
});

console.log('SCÉNARIO 3 — la clôture persiste : une fois clôturé, ne revient plus (simulé reload)');
state = freshState();
state.convocations.push({ id: 'cv-legit', type: 'training', date: '2026-11-02', time: '20:00', seasonId: '2026-2027', teamTag: 'e1', responses: {} });
t('avant clôture : listé', () => assert.strictEqual(getOverdueTrainings(new Date('2026-11-15T12:00:00')).length, 1));
t('après autoCloseTraining + « reload » (recalcul depuis state) : plus listé', () => {
  autoCloseTraining('cv-legit', '2026-11-02');
  // reload simulé : on relit l'état (le flag closed est lu par makeConvocInstance)
  assert.strictEqual(getOverdueTrainings(new Date('2026-11-15T12:00:00')).length, 0);
});

console.log('SCÉNARIO 4 — pas de doublon : un créneau = une entrée (récurrent inclus)');
state = freshState();
// récurrent hebdo le dimanche (jour 0) à partir du 2026-09-06, dans la saison active
state.convocations.push({ id: 'cv-rec', type: 'training', date: '2026-09-06', time: '10:00', seasonId: '2026-2027', teamTag: 'e1', responses: {}, recurrence: { type: 'weekly', days: [0] } });
t('aujourd\'hui 2026-09-27 → 4 dimanches distincts (06,13,20,27), aucun doublon', () => {
  const overdue = getOverdueTrainings(new Date('2026-09-27T12:00:00'));
  const dates = overdue.map(o => o.instanceDate);
  assert.deepStrictEqual(dates, ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  assert.strictEqual(new Set(dates).size, dates.length, 'aucune date dupliquée');
});
t('clôture d\'une occurrence n\'affecte que celle-ci', () => {
  autoCloseTraining('cv-rec', '2026-09-13');
  const dates = getOverdueTrainings(new Date('2026-09-27T12:00:00')).map(o => o.instanceDate);
  assert.deepStrictEqual(dates, ['2026-09-06', '2026-09-20', '2026-09-27']);
});

console.log(`\n✅ ${pass} assertions OK — fantôme cross-saison neutralisé, clôture stable, pas de doublon.`);
