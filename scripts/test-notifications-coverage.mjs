// Test des notifications app-wide (Phase 1, approche A+ dérivée). Reproduit
// fidèlement notifFeed/appBadgeCount de index.html : couverture multi-événements
// par rôle, ACTIONNABLE (intrinsèque) vs INFORMATIONNEL (filigrane "vu"),
// déduplication (ids uniques), badge = somme des poids non lus, "tout marquer lu".
import assert from 'node:assert';

let state, SEEN = 0;
// Stubs des sources (en vrai : helpers existants de l'app).
function playerInboxBroadcasts(pid) { return (state.broadcasts || []).filter(b => (b._to || []).includes(pid)); }
function _inboxIsUnread(b, pid) { return !(b._read || []).includes(pid); }
function isPollBroadcast(b) { return !!(b.pollOptions && b.pollOptions.length >= 2); }
function pendingDraws(pid) { return (state.gageDraws || []).filter(d => d.playerId === pid && d.status === 'owed'); }
function gagesPendingCount() { return (state.gages || []).filter(g => g.status === 'pending').length; }
function getOverdueTrainings() { return state._overdue || []; }
function currentSeasonConvocations() { return state.convocations || []; }
function currentSeasonPlays() { return state.plays || []; }
function currentSeasonChallenges() { return state.challenges || []; }
function currentSeasonMatches() { return state.matches || []; }
function formatDate() { return ''; }

// --- SUJET (extrait fidèle, filigrane = SEEN) ---
function notifFeed() {
  const a = state && state.auth; if (!a) return [];
  const seen = SEEN; const items = [];
  const info = (id, ts, icon, title, detail) => { if (ts) items.push({ id, ts, icon, title, detail, count: 1, unread: ts > seen }); };
  if (a.role === 'player' && a.playerId) {
    const pid = a.playerId;
    playerInboxBroadcasts(pid).forEach(b => items.push({ id: 'msg-' + b.id, ts: b.createdAt || 0, icon: isPollBroadcast(b) ? '🗳' : '📨', title: 'Message', detail: '', count: 1, unread: _inboxIsUnread(b, pid) }));
    const nd = pendingDraws(pid).length;
    if (nd > 0) items.push({ id: 'gages', ts: Math.max(0, ...pendingDraws(pid).map(d => d.assignedAt || 0)), icon: '🎁', title: 'Gage à tirer', detail: '', count: nd, unread: true });
    currentSeasonConvocations().forEach(c => info('cv-' + c.id, Math.max(c.createdAt || 0, c.updatedAt || 0), '🗓', 'Convoc', ''));
    currentSeasonPlays().forEach(p => info('play-' + p.id, p.createdAt || 0, '📋', 'Play', ''));
    (state.trainingPlans || []).forEach(tp => { const v = tp.plan && tp.plan.validated; const ts = (tp.plan && tp.plan.validatedAt) || tp.updatedAt || 0; if (v) info('plan-' + tp.id, ts, '✅', 'Plan', ''); });
    currentSeasonChallenges().filter(c => !c.badgesAwarded).forEach(c => info('ch-' + c.id, c.createdAt || c.updatedAt || 0, '🏆', 'Défi', ''));
    const me = (state.players || []).find(p => p.id === pid);
    (me && me.badges || []).forEach((b, i) => info('badge-' + i, b.date ? Date.parse(b.date + 'T12:00:00') : 0, '🏅', 'Trophée', ''));
    currentSeasonMatches().filter(m => m.playerStats && m.playerStats[pid]).forEach(m => info('recap-' + m.id, m.updatedAt || 0, '📊', 'Récap', ''));
  } else if (a.role === 'coach') {
    const np = gagesPendingCount(); if (np > 0) items.push({ id: 'gage-mod', ts: Date.now(), icon: '🎁', title: 'Modérer', detail: '', count: np, unread: true });
    const no = getOverdueTrainings().length; if (no > 0) items.push({ id: 'overdue', ts: Date.now(), icon: '⏱', title: 'Clôturer', detail: '', count: no, unread: true });
    (state.gageDraws || []).forEach(d => { if ((d.status === 'accepted' || d.status === 'skipped') && d.completedAt) info('draw-' + d.id, d.completedAt, '💪', 'Gage tiré', ''); });
    currentSeasonMatches().filter(m => m.playerStats && Object.keys(m.playerStats).length).forEach(m => info('stats-' + m.id, m.updatedAt || 0, '📊', 'Stats', ''));
  }
  return items.sort((x, y) => (y.ts || 0) - (x.ts || 0));
}
function appBadgeCount() { return notifFeed().filter(i => i.unread).reduce((s, i) => s + (i.count || 1), 0); }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
const T0 = 1_700_000_000_000;

console.log('SCÉNARIO 1 — COUVERTURE joueuse : messages, gages, convoc, play, plan, défi, badge, récap');
SEEN = T0; // filigrane : tout ce qui est <= T0 est "vu"
state = {
  auth: { role: 'player', playerId: 'p1' },
  players: [{ id: 'p1', num: 4, name: 'A', badges: [{ date: '2030-01-02', challengeTitle: 'x' }] }],
  broadcasts: [{ id: 'b1', _to: ['p1'], _read: [], createdAt: T0 + 10 }],          // non lu
  gageDraws: [{ playerId: 'p1', status: 'owed', assignedAt: T0 + 5 }],              // à tirer
  convocations: [{ id: 'c1', createdAt: T0 + 20 }],                                 // nouvelle
  plays: [{ id: 'pl1', createdAt: T0 + 30 }],                                       // nouveau
  trainingPlans: [{ id: 'tp1', plan: { validated: true, validatedAt: T0 + 40 } }],  // validé
  challenges: [{ id: 'ch1', createdAt: T0 + 50 }],                                  // nouveau
  matches: [{ id: 'm1', opponent: 'X', updatedAt: T0 + 60, playerStats: { p1: { pts: 5 } } }], // récap
};
t('le flux couvre les 8 catégories joueuse', () => {
  const ids = notifFeed().map(i => i.id.split('-')[0]);
  ['msg', 'gages', 'cv', 'play', 'plan', 'ch', 'badge', 'recap'].forEach(k => assert.ok(ids.includes(k), 'manque ' + k));
});
t('badge = 8 (1 msg + 1 gage + 6 infos > filigrane ; badge 2030 > T0)', () => {
  assert.strictEqual(appBadgeCount(), 8);
});

console.log('SCÉNARIO 2 — INFORMATIONNEL : marquer vu (filigrane) éteint, ACTIONNABLE reste');
t('filigrane très haut → infos lues, mais message non lu + gage restent', () => {
  SEEN = 9_999_999_999_999; // au-delà de TOUS les ts informationnels (dont le trophée 2030)
  // le message reste non lu (intrinsèque) + le gage reste (intrinsèque)
  assert.strictEqual(appBadgeCount(), 2);
});
t('lire le message → reste le gage', () => {
  state.broadcasts[0]._read = ['p1'];
  assert.strictEqual(appBadgeCount(), 1);
});
t('faire le tirage → 0', () => {
  state.gageDraws[0].status = 'accepted';
  assert.strictEqual(appBadgeCount(), 0);
});

console.log('SCÉNARIO 3 — agrégat : N gages comptent pour N dans le badge');
SEEN = Date.now();
state = { auth: { role: 'player', playerId: 'p1' }, players: [{ id: 'p1' }], gageDraws: [
  { playerId: 'p1', status: 'owed', assignedAt: 1 }, { playerId: 'p1', status: 'owed', assignedAt: 1 }, { playerId: 'p1', status: 'owed', assignedAt: 1 } ] };
t('3 tirages owed = 1 item count 3 → badge 3', () => {
  const f = notifFeed(); const g = f.find(i => i.id === 'gages');
  assert.strictEqual(g.count, 3); assert.strictEqual(appBadgeCount(), 3);
});

console.log('SCÉNARIO 4 — COUVERTURE coach : modération, clôtures, gages tirés, stats');
SEEN = T0;
state = {
  auth: { role: 'coach' }, players: [{ id: 'p1', num: 4, name: 'A' }],
  gages: [{ status: 'pending' }, { status: 'pending' }, { status: 'approved' }],
  _overdue: [{}, {}],
  gageDraws: [{ id: 'd1', playerId: 'p1', status: 'skipped', completedAt: T0 + 5 }],
  matches: [{ id: 'm1', updatedAt: T0 + 6, playerStats: { p1: {} } }],
};
t('flux coach couvre modération + clôtures + gage tiré + stats', () => {
  const ids = notifFeed().map(i => i.id.split('-')[0]);
  ['gage', 'overdue', 'draw', 'stats'].forEach(k => assert.ok(ids.includes(k), 'manque ' + k));
});
t('badge coach = 2 (modérer) + 2 (clôturer) + 1 draw + 1 stats = 6', () => {
  assert.strictEqual(appBadgeCount(), 6);
});

console.log('SCÉNARIO 5 — déduplication : ids uniques, pas de double comptage');
t('tous les ids du flux sont uniques', () => {
  const ids = notifFeed().map(i => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

console.log('SCÉNARIO 6 — pas d\'identité → flux vide, badge 0');
state = { auth: null };
t('public/déconnecté → 0', () => { assert.strictEqual(notifFeed().length, 0); assert.strictEqual(appBadgeCount(), 0); });

console.log(`\n✅ ${pass} assertions OK — notifications app-wide (couverture rôles, actionnable vs info, agrégats, dédup).`);
