// Test des 2 nouveaux types de notifs coach (push) — logique pure mockée.
// Type A : changement de réponse à une convoc (présent↔absent ; pas de "maybe"
// dans le modèle). Type B : enregistrement de données de défi par une joueuse.
import assert from 'node:assert';

let state, sent;
function currentPlayer() { return (state.players || []).find(p => p.id === state.auth.playerId) || null; }
function formatDate(d) { return d || ''; }
function _pushCoachKey() { return 'coach:-'; }
// notifyPush mock : enregistre l'appel (ou rien si auto-notif/vide).
function notifyPush(ownerKeys, payload) {
  const me = state.auth ? state.auth.role + ':' + (state.auth.playerId || '-') : '_';
  ownerKeys = (ownerKeys || []).filter(k => k && k !== me);
  if (!ownerKeys.length || !payload || !payload.title) return;
  sent.push({ ownerKeys, payload });
}

// --- SUJET (extrait fidèle) ---
function _effectiveConvocStatus(c, instanceDate, pid) {
  let resp = null;
  if (c && c.recurrence && instanceDate && c.instanceOverrides && c.instanceOverrides[instanceDate] && c.instanceOverrides[instanceDate].responses) {
    resp = c.instanceOverrides[instanceDate].responses[pid];
  } else { resp = (c && c.responses || {})[pid]; }
  return (resp && resp.status) || 'present';
}
function _notifyCoachConvocResponse(c, instanceDate, prevStatus, newStatus) {
  if (!c || !state.auth || state.auth.role !== 'player') return;
  if (prevStatus === newStatus) return;
  const p = currentPlayer(); const who = p ? ('#' + p.num + ' ' + p.name) : 'Une joueuse';
  const label = c.title || (c.type === 'match' ? 'le match' : "l'entraînement");
  const payload = (newStatus === 'absent')
    ? { title: '❌ Désistement', body: who + ' ne sera pas là pour ' + label }
    : { title: '✅ Inscription', body: who + ' sera finalement là pour ' + label };
  payload.url = '/'; payload.tag = 'convoc-resp-' + c.id; payload.type = 'convoc_response';
  notifyPush([_pushCoachKey()], payload);
}
function _notifyCoachChallengeData(c, pid, delta) {
  if (!c || !state.auth || state.auth.role !== 'player') return;
  if (pid !== state.auth.playerId) return;
  const d = Number(delta) || 0; if (!d) return;
  const p = currentPlayer(); const who = p ? ('#' + p.num + ' ' + p.name) : 'Une joueuse';
  notifyPush([_pushCoachKey()], { title: '📊 Données de défi', body: who + ' a enregistré ' + (d > 0 ? '+' + d : String(d)) + ' sur « ' + (c.title || 'un défi') + ' »', url: '/', tag: 'challenge-' + c.id, type: 'challenge_data' });
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function asPlayer() { state = { auth: { role: 'player', playerId: 'p1' }, players: [{ id: 'p1', num: 7, name: 'Bea' }] }; sent = []; }
function asCoach() { state = { auth: { role: 'coach', playerId: null }, players: [{ id: 'p1', num: 7, name: 'Bea' }] }; sent = []; }

console.log('SCÉNARIO 1 — Type A : désistement présent → absent');
asPlayer();
t('présent → absent → push ❌ Désistement au coach', () => {
  const c = { id: 'cv1', type: 'match', title: 'vs Lavaur', responses: {} };
  const prev = _effectiveConvocStatus(c, null, 'p1'); // 'present'
  c.responses['p1'] = { status: 'absent' };
  _notifyCoachConvocResponse(c, null, prev, 'absent');
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].ownerKeys, ['coach:-']);
  assert.ok(sent[0].payload.title.includes('Désistement'));
  assert.ok(sent[0].payload.body.includes('Bea'));
});

console.log('SCÉNARIO 2 — Type A : inscription absent → présent');
asPlayer();
t('absent → présent → push ✅ Inscription', () => {
  const c = { id: 'cv1', type: 'training', title: 'Entraînement', responses: { p1: { status: 'absent' } } };
  const prev = _effectiveConvocStatus(c, null, 'p1'); // 'absent'
  delete c.responses['p1'];
  _notifyCoachConvocResponse(c, null, prev, 'present');
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].payload.title.includes('Inscription'));
});

console.log('SCÉNARIO 3 — Type A : pas de changement → pas de push ; récurrent instance');
asPlayer();
t('même statut (absent→absent) → aucun push', () => {
  const c = { id: 'cv1', responses: { p1: { status: 'absent' } } };
  _notifyCoachConvocResponse(c, null, 'absent', 'absent');
  assert.strictEqual(sent.length, 0);
});
t('récurrent : statut lu depuis instanceOverrides', () => {
  const c = { id: 'cv2', recurrence: { type: 'weekly' }, responses: {}, instanceOverrides: { '2026-11-10': { responses: { p1: { status: 'absent' } } } } };
  assert.strictEqual(_effectiveConvocStatus(c, '2026-11-10', 'p1'), 'absent');
  assert.strictEqual(_effectiveConvocStatus(c, '2026-11-17', 'p1'), 'present'); // autre instance → défaut
});

console.log('SCÉNARIO 4 — Type A : un COACH qui modifie ne se notifie pas lui-même');
asCoach();
t('actor coach → aucun push (gate role player)', () => {
  const c = { id: 'cv1', type: 'match', title: 'x', responses: {} };
  _notifyCoachConvocResponse(c, null, 'present', 'absent');
  assert.strictEqual(sent.length, 0);
});

console.log('SCÉNARIO 5 — Type B : enregistrement de données de défi (3 sous-cas)');
asPlayer();
t('défi manuel +1 → push 📊 +1', () => {
  _notifyCoachChallengeData({ id: 'ch1', title: 'Pompes' }, 'p1', 1);
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].payload.body.includes('+1') && sent[0].payload.body.includes('Pompes'));
});
t('contribution collective +10 → push +10', () => {
  sent = [];
  _notifyCoachChallengeData({ id: 'ch2', title: 'Mur de tirs' }, 'p1', 10);
  assert.ok(sent[0].payload.body.includes('+10'));
});
t('saisie métrique (delta absolu) → push', () => {
  sent = [];
  _notifyCoachChallengeData({ id: 'ch3', title: '3pts' }, 'p1', 7); // 7 = newVal - before
  assert.ok(sent[0].payload.body.includes('+7'));
});
t('delta 0 → aucun push', () => { sent = []; _notifyCoachChallengeData({ id: 'ch3', title: 'x' }, 'p1', 0); assert.strictEqual(sent.length, 0); });
t('données d\'une AUTRE joueuse (pid ≠ moi) → aucun push', () => {
  sent = [];
  _notifyCoachChallengeData({ id: 'ch1', title: 'x' }, 'p2', 5);
  assert.strictEqual(sent.length, 0);
});

console.log('SCÉNARIO 6 — Type B : coach qui édite → pas d\'auto-notif');
asCoach();
t('actor coach → aucun push', () => { _notifyCoachChallengeData({ id: 'ch1', title: 'x' }, 'p1', 5); assert.strictEqual(sent.length, 0); });

console.log(`\n✅ ${pass} assertions OK — notifs coach étendues (désistement/inscription + données de défi).`);
