// Test du badge d'icône d'app (App Badging API, Phase 1). Reproduit fidèlement
// appBadgeCount + updateAppBadge de index.html : total par rôle, réactivité aux
// mutations, no-op si l'API est absente.
import assert from 'node:assert';

let state;
// Compteurs sources (stubés ici ; en vrai = playerInboxUnreadCount / pendingDraws
// / gagesPendingCount / getOverdueTrainings).
function playerInboxUnreadCount(pid) { return (state._unread || {})[pid] || 0; }
function pendingDraws(pid) { return (state.gageDraws || []).filter(d => d.playerId === pid && d.status === 'owed'); }
function gagesPendingCount() { return (state.gages || []).filter(g => g.status === 'pending').length; }
function getOverdueTrainings() { return state._overdue || []; }

// --- SUJET (extrait fidèle) ---
function appBadgeCount() {
  const a = state && state.auth;
  if (!a) return 0;
  let n = 0;
  try {
    if (a.role === 'player' && a.playerId) {
      if (typeof playerInboxUnreadCount === 'function') n += playerInboxUnreadCount(a.playerId) || 0;
      if (typeof pendingDraws === 'function') n += pendingDraws(a.playerId).length;
    } else if (a.role === 'coach') {
      if (typeof gagesPendingCount === 'function') n += gagesPendingCount() || 0;
      if (typeof getOverdueTrainings === 'function') n += getOverdueTrainings().length;
    }
  } catch (e) {}
  return n;
}
// updateAppBadge avec navigator injecté (pour tester le no-op).
function updateAppBadge(nav) {
  try {
    if (!nav || typeof nav.setAppBadge !== 'function') return 'noop';
    const n = appBadgeCount();
    if (n > 0) { nav.setAppBadge(n); return 'set:' + n; }
    if (typeof nav.clearAppBadge === 'function') { nav.clearAppBadge(); return 'clear'; }
    return 'noop';
  } catch (e) { return 'err'; }
}
function fakeNav() { const c = { last: undefined, cleared: 0 }; return { setAppBadge: n => { c.last = n; }, clearAppBadge: () => { c.cleared++; }, _c: c }; }

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — total côté JOUEUSE (messages non lus + tirages dûs)');
state = { auth: { role: 'player', playerId: 'p1' }, _unread: { p1: 2 },
  gageDraws: [{ playerId: 'p1', status: 'owed' }, { playerId: 'p1', status: 'owed' }, { playerId: 'p1', status: 'accepted' }, { playerId: 'p2', status: 'owed' }] };
t('2 non lus + 2 tirages owed (p1) = 4', () => assert.strictEqual(appBadgeCount(), 4));
t('les tirages d\'une autre joueuse ne comptent pas', () => { state.gageDraws.push({ playerId: 'p2', status: 'owed' }); assert.strictEqual(appBadgeCount(), 4); });

console.log('SCÉNARIO 2 — total côté COACH (propositions à modérer + entraînements à clôturer)');
state = { auth: { role: 'coach' }, gages: [{ status: 'pending' }, { status: 'pending' }, { status: 'approved' }], _overdue: [{}, {}, {}] };
t('2 pending + 3 overdue = 5', () => assert.strictEqual(appBadgeCount(), 5));

console.log('SCÉNARIO 3 — réactivité aux mutations');
state = { auth: { role: 'player', playerId: 'p1' }, _unread: { p1: 1 }, gageDraws: [] };
t('1 au départ', () => assert.strictEqual(appBadgeCount(), 1));
t('lecture du message → 0', () => { state._unread.p1 = 0; assert.strictEqual(appBadgeCount(), 0); });
t('coach assigne un tirage → +1', () => { state.gageDraws.push({ playerId: 'p1', status: 'owed' }); assert.strictEqual(appBadgeCount(), 1); });
t('la joueuse accepte → 0', () => { state.gageDraws[0].status = 'accepted'; assert.strictEqual(appBadgeCount(), 0); });

console.log('SCÉNARIO 4 — pas d\'auth / public → 0');
state = { auth: null };
t('aucune identité → 0', () => assert.strictEqual(appBadgeCount(), 0));

console.log('SCÉNARIO 5 — appels API : set / clear / no-op');
state = { auth: { role: 'coach' }, gages: [{ status: 'pending' }], _overdue: [] };
t('total > 0 → setAppBadge(n)', () => { const nav = fakeNav(); assert.strictEqual(updateAppBadge(nav), 'set:1'); assert.strictEqual(nav._c.last, 1); });
t('total 0 → clearAppBadge', () => { state.gages = []; const nav = fakeNav(); assert.strictEqual(updateAppBadge(nav), 'clear'); assert.strictEqual(nav._c.cleared, 1); });
t('API absente (Safari onglet / vieil OS) → no-op silencieux', () => { assert.strictEqual(updateAppBadge({}), 'noop'); assert.strictEqual(updateAppBadge(null), 'noop'); });

console.log(`\n✅ ${pass} assertions OK — app badge global (totaux par rôle, réactivité, no-op).`);
