// Test de l'inbox messages joueuse (audit #4). Reproduit fidèlement la logique
// de index.html : ciblage, statut lu/non-lu via broadcastReceipts (PAS de set
// localStorage parallèle), tri récent, et marquage à l'ouverture (annonce =
// 'seen' immédiat ; sondage = non marqué pour préserver le vote).
import assert from 'node:assert';

let state;

// --- helpers copiés conformes à index.html ---
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function teamTagMatches(tag, want) { if (!want || want === 'all') return true; const t = tag || 'e1'; return t === want || t === 'both'; }
function getSeasonPlayers(seasonId, { team = 'all' } = {}) {
  if (!seasonId) return state.players || [];
  return (state.seasonPlayers || []).filter(sp => sp.seasonId === seasonId).map(link => {
    const p = (state.players || []).find(p => p.id === link.playerId);
    if (!p || link.leftAt) return null;
    if (!teamTagMatches(link.teamTag, team)) return null;
    return { ...p };
  }).filter(Boolean);
}
function _broadcastDeleted(b) { return !!(b && b.deletedAt); }
function _broadcastInSeason(b, seasonId) {
  if (!b) return false;
  const bs = b.seasonId || null;
  if (!bs) return true; // legacy sans seasonId → visible (rétrocompat)
  return bs === seasonId;
}
function broadcastTargetPlayerIds(b) {
  const seasonId = b.seasonId || getActiveSeasonId();
  if (b.targetType === 'players') {
    const valid = new Set(getSeasonPlayers(seasonId, { team: 'all' }).map(p => p.id));
    return (b.targetPlayerIds || []).filter(id => valid.has(id));
  }
  const team = (b.targetType === 'e1' || b.targetType === 'e2') ? b.targetType : 'all';
  return getSeasonPlayers(seasonId, { team }).map(p => p.id);
}
function getBroadcastReceipt(broadcastId, playerId) {
  return (state.broadcastReceipts || []).find(r => r.broadcastId === broadcastId && r.playerId === playerId) || null;
}
function isPollBroadcast(b) { return !!(b && Array.isArray(b.pollOptions) && b.pollOptions.length >= 2); }
function markReceiptStatus(broadcastId, playerId, status, pollChoice) {
  if (!state.broadcastReceipts) state.broadcastReceipts = [];
  let r = getBroadcastReceipt(broadcastId, playerId);
  if (!r) { r = { broadcastId, playerId, status: 'pending', seenAt: null, actedAt: null, pollChoice: null }; state.broadcastReceipts.push(r); }
  if (!r.seenAt) r.seenAt = 1;
  r.status = status;
  if (pollChoice !== undefined) r.pollChoice = pollChoice;
}

// --- SUJET DU TEST ---
function playerInboxBroadcasts(pid) {
  if (!pid) return [];
  return (state.broadcasts || [])
    .filter(b => !b.archived && !_broadcastDeleted(b) && _broadcastInSeason(b, state.currentSeasonId) && broadcastTargetPlayerIds(b).includes(pid))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function _inboxIsUnread(b, pid) { const r = getBroadcastReceipt(b.id, pid); return !r || r.status === 'pending'; }
function playerInboxUnreadCount(pid) { return playerInboxBroadcasts(pid).filter(b => _inboxIsUnread(b, pid)).length; }
function openInboxBroadcast(id, pid) {
  const b = (state.broadcasts || []).find(x => x.id === id);
  if (!b) return;
  if (pid && !isPollBroadcast(b)) {
    const r = getBroadcastReceipt(id, pid);
    if (!r || r.status === 'pending') markReceiptStatus(id, pid, 'seen');
  }
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function freshState() {
  return {
    currentSeasonId: '2026-2027',
    seasons: [
      { id: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'archived' },
      { id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' },
    ],
    players: [{ id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 7, name: 'Bea' }],
    seasonPlayers: [
      { seasonId: '2026-2027', playerId: 'p1', teamTag: 'e1' },
      { seasonId: '2026-2027', playerId: 'p2', teamTag: 'e2' },
    ],
    broadcasts: [], broadcastReceipts: [],
  };
}

console.log('SCÉNARIO 1 — ciblage : la joueuse ne voit que SES diffusions de la saison courante');
state = freshState();
state.broadcasts = [
  { id: 'b1', message: 'Pour toute l\'équipe', targetType: 'team', seasonId: '2026-2027', createdAt: 100 },
  { id: 'b2', message: 'E2 only', targetType: 'e2', seasonId: '2026-2027', createdAt: 200 },
  { id: 'b3', message: 'Saison passée', targetType: 'team', seasonId: '2025-2026', createdAt: 300 },
  { id: 'b4', message: 'Ciblé p2', targetType: 'players', targetPlayerIds: ['p2'], seasonId: '2026-2027', createdAt: 400 },
  { id: 'b5', message: 'Supprimé', targetType: 'team', seasonId: '2026-2027', createdAt: 500, deletedAt: 999 },
  { id: 'b6', message: 'Archivé', targetType: 'team', seasonId: '2026-2027', createdAt: 600, archived: true },
];
t('p1 (e1) voit b1 (team) seulement — pas e2/passée/ciblée-p2/supprimée/archivée', () => {
  assert.deepStrictEqual(playerInboxBroadcasts('p1').map(b => b.id), ['b1']);
});
t('p2 (e2) voit b4 (ciblé), b2 (e2), b1 (team), triés récent→ancien', () => {
  assert.deepStrictEqual(playerInboxBroadcasts('p2').map(b => b.id), ['b4', 'b2', 'b1']);
});

console.log('SCÉNARIO 2 — statut lu/non-lu via receipts (pas de set parallèle)');
state = freshState();
state.broadcasts = [
  { id: 'b1', message: 'A', targetType: 'team', seasonId: '2026-2027', createdAt: 100 },
  { id: 'b2', message: 'B', targetType: 'team', seasonId: '2026-2027', createdAt: 200 },
];
state.broadcastReceipts = [{ broadcastId: 'b1', playerId: 'p1', status: 'seen' }];
t('b1 seen → lu ; b2 sans receipt → non lu', () => {
  assert.strictEqual(_inboxIsUnread(state.broadcasts.find(b => b.id === 'b1'), 'p1'), false);
  assert.strictEqual(_inboxIsUnread(state.broadcasts.find(b => b.id === 'b2'), 'p1'), true);
  assert.strictEqual(playerInboxUnreadCount('p1'), 1);
});
t('receipt pending compte comme non lu', () => {
  markReceiptStatus('b2', 'p1', 'pending');
  assert.strictEqual(playerInboxUnreadCount('p1'), 1);
});

console.log('SCÉNARIO 3 — ouverture : annonce marquée lue, sondage préservé pour le vote');
state = freshState();
state.broadcasts = [
  { id: 'ann', message: 'Annonce', targetType: 'team', seasonId: '2026-2027', createdAt: 100 },
  { id: 'poll', message: 'Sondage ?', pollOptions: ['Oui', 'Non'], targetType: 'team', seasonId: '2026-2027', createdAt: 200 },
];
t('ouvrir une annonce → seen (lue) sans action', () => {
  assert.strictEqual(playerInboxUnreadCount('p1'), 2);
  openInboxBroadcast('ann', 'p1');
  assert.strictEqual(getBroadcastReceipt('ann', 'p1').status, 'seen');
});
t('ouvrir un sondage → reste pending (la popup gère le vote)', () => {
  openInboxBroadcast('poll', 'p1');
  const r = getBroadcastReceipt('poll', 'p1');
  assert.ok(!r || r.status === 'pending', 'sondage non marqué seen à la simple ouverture');
  // après ouverture : 1 non lu restant (le sondage)
  assert.strictEqual(playerInboxUnreadCount('p1'), 1);
});

console.log(`\n✅ ${pass} assertions OK — inbox joueuse : ciblage, lu/non-lu via receipts, ouverture annonce vs sondage.`);
