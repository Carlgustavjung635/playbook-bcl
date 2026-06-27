// Audit vague 3 — #2 persistance clôture convocations (dump/apply) + #7 prochain
// match public scopé saison. Reproduit fidèlement la logique de index.html.
import assert from 'node:assert';

// --- #2 : dump + apply de l'entité convocations (extrait fidèle) ---
function dumpConvocs(state) {
  return Object.fromEntries((state.convocations || []).map(c => [c.id, {
    id: c.id, type: c.type || 'training', title: c.title || '',
    date: c.date, time: c.time || null, recurrence: c.recurrence || null,
    instance_overrides: c.instanceOverrides || {},
    season_id: c.seasonId || null,
    closed: c.closed === true,
    team_tag: c.teamTag || 'e1',
  }]));
}
function applyConvocs(state, rows) {
  const byId = Object.fromEntries((state.convocations || []).map(c => [c.id, c]));
  state.convocations = rows.map(r => ({
    ...(byId[r.id] || {}),
    id: r.id, type: r.type, title: r.title, date: r.date,
    instanceOverrides: r.instance_overrides || {},
    seasonId: r.season_id || (byId[r.id] || {}).seasonId || null,
    closed: (r.closed !== undefined) ? (r.closed === true) : ((byId[r.id] || {}).closed === true),
    teamTag: r.team_tag || 'e1',
  }));
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO #2 — la clôture d\'une convoc NON récurrente persiste via le dump');
t('dump inclut closed:true', () => {
  const state = { convocations: [{ id: 'cv1', type: 'training', date: '2026-10-05', closed: true }] };
  assert.strictEqual(dumpConvocs(state).cv1.closed, true);
});
t('dump closed:false si non clôturé (jamais undefined)', () => {
  const state = { convocations: [{ id: 'cv1', type: 'training', date: '2026-10-05' }] };
  assert.strictEqual(dumpConvocs(state).cv1.closed, false);
});
t('round-trip device 1 (clôture) → cache vidé → reload cloud : TOUJOURS fermé', () => {
  const dev1 = { convocations: [{ id: 'cv1', type: 'training', title: 'Entr', date: '2026-10-05', closed: true }] };
  const rows = Object.values(dumpConvocs(dev1));        // push cloud
  const fresh = { convocations: [] };                    // cache vidé / autre device
  applyConvocs(fresh, rows);                             // pull cloud
  assert.strictEqual(fresh.convocations[0].closed, true, 'clôture survit au reload depuis le cloud');
});
t('rétrocompat pré-migration : row sans colonne closed → conserve le flag local', () => {
  const local = { convocations: [{ id: 'cv1', type: 'training', date: '2026-10-05', closed: true }] };
  const legacyRow = { id: 'cv1', type: 'training', title: '', date: '2026-10-05' }; // pas de champ closed
  applyConvocs(local, [legacyRow]);
  assert.strictEqual(local.convocations[0].closed, true, 'pas d\'écrasement par undefined');
});

console.log('SCÉNARIO #7 — « prochain match » public scopé à la saison résolue');
function nextPublicMatch(state, pubSeasonId, todayStr) {
  return [...state.convocations]
    .filter(c => c.date >= todayStr && c.type === 'match'
      && (!pubSeasonId || !c.seasonId || c.seasonId === pubSeasonId))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}
const baseConvocs = {
  convocations: [
    { id: 'm-cur', type: 'match', date: '2026-11-10', seasonId: '2026-2027' },
    { id: 'm-future-season', type: 'match', date: '2027-10-10', seasonId: '2027-2028' },
    { id: 'm-legacy', type: 'match', date: '2026-12-01', seasonId: null },
  ],
};
t('saison résolue 2026-2027 → ignore le match de 2027-2028', () => {
  const n = nextPublicMatch(baseConvocs, '2026-2027', '2026-09-15');
  assert.strictEqual(n.id, 'm-cur');
});
t('legacy sans seasonId reste inclus (lenient)', () => {
  const onlyLegacy = { convocations: [{ id: 'm-legacy', type: 'match', date: '2026-12-01', seasonId: null }] };
  assert.strictEqual(nextPublicMatch(onlyLegacy, '2026-2027', '2026-09-15').id, 'm-legacy');
});
t('worst case pubSeasonId null → pas de filtre saison (ne vide pas)', () => {
  const n = nextPublicMatch(baseConvocs, null, '2026-09-15');
  assert.strictEqual(n.id, 'm-cur'); // le plus proche par date
});

console.log(`\n✅ ${pass} assertions OK — persistance clôture (#2) + prochain match public scopé saison (#7).`);
