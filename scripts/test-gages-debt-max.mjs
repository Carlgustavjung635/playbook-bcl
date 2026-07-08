// Test PLAFOND DE DETTE (=2) + TIRAGE IMMÉDIAT (drip) + MAPPING NOTIF coach.
//   • un skip relance AUSSITÔT un tirage owed (plus « à la prochaine assignation ») ;
//   • à chaque render, une dette > 0 sans owed en cours relance un tirage ;
//   • à GAGE_DEBT_MAX (=2) skips non compensés, passer est INTERDIT (accept
//     obligatoire) — bouton désactivé ET garde côté action ;
//   • un accept rembourse 1 (dette 2→1→0) et relance tant que dette > 0 ;
//   • table status→message du push coach (5 statuts, coach_confirmed = aucun push).
// Extrait FIDÈLE d'index.html.
import assert from 'node:assert';

let state;
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function getSeasonIdForDate() { return getActiveSeasonId(); }
function isoDate() { return '2026-10-01'; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }
function persist() {}
function _gageFlush() {}

// ---------------- SUJET (extraits fidèles d'index.html) ----------------
const GAGE_DEBT_MAX = 2;
function _gageById(id) { return (state.gages || []).find(g => g.id === id); }
function _gageInSeason(g, seasonId) { if (!_seasonsLoaded()) return true; if (g.seasonId) return g.seasonId === seasonId; return seasonId === getActiveSeasonId(); }
function currentSeasonGages() { const a = getActiveSeasonId(); if (!_seasonsLoaded() || !a) return state.gages || []; return (state.gages || []).filter(g => _gageInSeason(g, a)); }
function _gageTirable(g) { return !!g && g.status === 'approved' && !g.deletedAt && !g.completedAt; }
function _drawPoolFor(pid) {
  const approved = currentSeasonGages().filter(_gageTirable);
  const drawn = new Set((state.gageDraws || []).filter(d => d.playerId === pid && d.gageId && d.status !== 'skipped').map(d => d.gageId));
  const fresh = approved.filter(g => !drawn.has(g.id));
  return fresh.length ? fresh : approved;
}
function _seasonGageDraws(pid) { const a = getActiveSeasonId(); return (state.gageDraws || []).filter(d => d.playerId === pid && (!_seasonsLoaded() || !a || (d.seasonId ? d.seasonId === a : true))); }
function pendingDraws(pid) { return _seasonGageDraws(pid).filter(d => d.status === 'owed').sort((a, b) => (a.assignedAt || 0) - (b.assignedAt || 0)); }

// gageDebt — copie fidèle (solde courant chronologique par lot, borné à 0).
function gageDebt(pid) {
  const draws = _seasonGageDraws(pid);
  const events = [];
  const batches = {};
  draws.forEach(d => {
    if (d.status === 'adjust' || !d.assignedAt) return;
    (batches[d.assignedAt] = batches[d.assignedAt] || []).push(d);
  });
  Object.values(batches).forEach(arr => {
    const at = Math.max(0, ...arr.map(d => d.completedAt || 0));
    const skips = arr.filter(d => d.status === 'skipped').length;
    if (skips) { events.push({ at, v: skips }); return; }
    if (arr.some(d => d.status === 'owed')) return;
    const engaged = arr.filter(d => d.status === 'accepted' || d.status === 'player_done' || d.status === 'coach_confirmed').length;
    if (engaged) events.push({ at, v: -engaged });
  });
  draws.filter(d => d.status === 'adjust').forEach(d => {
    events.push({ at: d.completedAt || 0, v: Number.isFinite(d.delta) ? d.delta : 0 });
  });
  events.sort((a, b) => a.at - b.at);
  let bal = 0;
  events.forEach(e => { bal += e.v; if (bal < 0) bal = 0; });
  return bal;
}
// _ensureDebtDraw — copie fidèle.
function _ensureDebtDraw(pid) {
  if (!pid || gageDebt(pid) <= 0) return false;
  if (pendingDraws(pid).length) return false;
  if (!_drawPoolFor(pid).length) return false;
  const now_ = now();
  const sid = (getSeasonIdForDate(isoDate(new Date(now_))) || getActiveSeasonId()) || null;
  state.gageDraws = state.gageDraws || [];
  state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'owed',
    assignedAt: now_, drawnAt: null, completedAt: null, seasonId: sid, createdAt: now_, updatedAt: now_ });
  persist(); _gageFlush();
  return true;
}

// Table notif — copie fidèle.
const GAGE_COACH_MSG = {
  accepted:    { title: '💪 Gage accepté',    tail: ' a accepté le gage' },
  skipped:     { title: '🙈 Gage passé',       tail: ' a passé le gage' },
  player_done: { title: '✅ Gage à confirmer',  tail: ' a marqué son gage comme fait' },
  invalidated: { title: '❌ Gage invalidé',     lead: 'Le gage de ', tail: ' a été invalidé' },
};
function _gageCoachMsg(pid, status) {
  const cfg = GAGE_COACH_MSG[status];
  if (!cfg) return null;
  const p = (state.players || []).find(x => x.id === pid);
  const who = p ? ('#' + p.num + ' ' + p.name) : 'Une joueuse';
  return { title: cfg.title, body: (cfg.lead || '') + who + cfg.tail, url: '/', tag: 'gage-evt-' + status, type: 'gage_event', status };
}
// Flag UI overlay (Patch 2) — même expression que _gageRevealResult.
function skipBlockedFor(pid) { return gageDebt(pid) >= GAGE_DEBT_MAX; }

// ---- Actions joueuse (cœur d'acceptGage/skipGage, sans DOM ni push) ----
function assignDraw(pid) { const t = now(); state.gageDraws.push({ id: uid(), playerId: pid, gageId: null, status: 'owed', assignedAt: t, drawnAt: null, completedAt: null, seasonId: getActiveSeasonId(), createdAt: t, updatedAt: t }); return state.gageDraws[state.gageDraws.length - 1]; }
function _drawCurrent(pid) { const d = pendingDraws(pid)[0]; const pool = _drawPoolFor(pid); if (d && !d.gageId && pool.length) { d.gageId = pool[0].id; d.drawnAt = now(); } return d; }
function skipGage(pid) {                       // renvoie { ok, blocked }
  const d = _drawCurrent(pid); if (!d) return { ok: false };
  if (gageDebt(pid) >= GAGE_DEBT_MAX) return { ok: false, blocked: true }; // garde
  d.status = 'skipped'; d.completedAt = now();
  _ensureDebtDraw(pid);                         // tirage immédiat
  return { ok: true };
}
function acceptGage(pid) {
  const d = _drawCurrent(pid); if (!d) return { ok: false };
  d.status = 'accepted'; d.completedAt = now();
  _ensureDebtDraw(pid);                         // relance si dette encore due
  return { ok: true };
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  state = { seasons: [{ id: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active' }],
    players: [{ id: 'p1', num: 4, name: 'Alice' }], gages: [], gageDraws: [] };
  _uid = 0; CLOCK = 1000;
  for (let i = 0; i < 4; i++) state.gages.push({ id: uid(), text: 'gage ' + i, authorId: 'coach', status: 'approved', completedAt: null, deletedAt: null, seasonId: getActiveSeasonId(), createdAt: now(), updatedAt: now() });
}

console.log('SCÉNARIO 1 — skip dette 0→1 : skip disponible + tirage immédiat');
fresh();
assignDraw('p1');
t('skip (dette 0) → dette 1', () => {
  const r = skipGage('p1');
  assert.strictEqual(r.ok, true, 'skip autorisé à dette 0');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('un tirage owed a été relancé IMMÉDIATEMENT (drip)', () => {
  assert.strictEqual(pendingDraws('p1').length, 1, 'nouvel owed créé sur-le-champ');
});
t('skip encore disponible (dette 1 < 2)', () => {
  assert.strictEqual(skipBlockedFor('p1'), false);
});

console.log('SCÉNARIO 2 — skip dette 1→2 : skip DÉSACTIVÉ (accept obligatoire)');
t('skip (dette 1) → dette 2 + tirage immédiat', () => {
  const r = skipGage('p1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(gageDebt('p1'), 2);
  assert.strictEqual(pendingDraws('p1').length, 1, 'encore un owed relancé');
});
t('bouton « passer » désactivé à dette 2 (skipBlocked = true)', () => {
  assert.strictEqual(skipBlockedFor('p1'), true);
});
t('la garde skipGage REFUSE l\'action à dette 2 (double sécurité)', () => {
  const before = gageDebt('p1'); const owedBefore = pendingDraws('p1').length;
  const r = skipGage('p1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(gageDebt('p1'), before, 'dette inchangée : rien n\'a été passé');
  assert.strictEqual(pendingDraws('p1').length, owedBefore, 'aucun nouveau tirage parasite');
});

console.log('SCÉNARIO 3 — accept dette 2→1 : remboursement partiel + tirage immédiat');
t('accept (dette 2) → dette 1', () => {
  const r = acceptGage('p1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(gageDebt('p1'), 1, 'un accept rembourse exactement 1 (pas de reset total)');
});
t('re-tirage immédiat car dette encore > 0', () => {
  assert.strictEqual(pendingDraws('p1').length, 1);
  assert.strictEqual(skipBlockedFor('p1'), false, 'à dette 1, skip redevient possible');
});

console.log('SCÉNARIO 4 — accept dette 1→0 : plus aucun tirage forcé');
t('accept (dette 1) → dette 0', () => {
  const r = acceptGage('p1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(gageDebt('p1'), 0);
});
t('aucun tirage forcé : la joueuse retrouve une app normale', () => {
  assert.strictEqual(pendingDraws('p1').length, 0);
  assert.strictEqual(_ensureDebtDraw('p1'), false, '_ensureDebtDraw ne crée rien à dette 0');
});

console.log('SCÉNARIO 5 — le filet render (_ensureDebtDraw) relance après « fait »/dette coach');
fresh();
t('dette posée sans owed → un render relance un tirage', () => {
  // dette 1 via un skip d'un draw assigné, puis on vide les owed (simulate « fait »).
  assignDraw('p1'); skipGage('p1');
  assert.strictEqual(gageDebt('p1'), 1);
  // vide artificiellement les owed pour simuler « aucun tirage en cours »
  state.gageDraws = state.gageDraws.filter(d => d.status !== 'owed');
  assert.strictEqual(pendingDraws('p1').length, 0);
  assert.strictEqual(_ensureDebtDraw('p1'), true, 'le filet recrée un owed');
  assert.strictEqual(pendingDraws('p1').length, 1);
});
t('idempotent : un owed déjà en cours → pas de doublon', () => {
  assert.strictEqual(_ensureDebtDraw('p1'), false);
  assert.strictEqual(pendingDraws('p1').length, 1);
});

console.log('SCÉNARIO 6 — mapping notif coach : chaque statut → le BON message');
fresh();
t('accepted → « a accepté le gage »', () => {
  const m = _gageCoachMsg('p1', 'accepted');
  assert.strictEqual(m.title, '💪 Gage accepté');
  assert.strictEqual(m.body, '#4 Alice a accepté le gage');
});
t('skipped → « a passé le gage » (JAMAIS accepté)', () => {
  const m = _gageCoachMsg('p1', 'skipped');
  assert.strictEqual(m.title, '🙈 Gage passé');
  assert.strictEqual(m.body, '#4 Alice a passé le gage');
  assert.ok(!/accept/i.test(m.body), 'un skip ne doit jamais dire « accepté »');
});
t('player_done → « a marqué son gage comme fait »', () => {
  const m = _gageCoachMsg('p1', 'player_done');
  assert.strictEqual(m.body, '#4 Alice a marqué son gage comme fait');
});
t('invalidated → « Le gage de … a été invalidé »', () => {
  const m = _gageCoachMsg('p1', 'invalidated');
  assert.strictEqual(m.body, 'Le gage de #4 Alice a été invalidé');
});
t('coach_confirmed → AUCUN push (le coach en est l\'auteur)', () => {
  assert.strictEqual(_gageCoachMsg('p1', 'coach_confirmed'), null);
});
t('statut inconnu → AUCUN push (pas de faux « accepté » par défaut)', () => {
  assert.strictEqual(_gageCoachMsg('p1', 'owed'), null);
  assert.strictEqual(_gageCoachMsg('p1', undefined), null);
  assert.strictEqual(_gageCoachMsg('p1', 'wtf'), null);
});

console.log(`\n✅ ${pass} assertions OK — plafond dette=2, tirage immédiat/forcé, mapping notif fiable.`);
