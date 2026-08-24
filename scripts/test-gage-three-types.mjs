// Test des TROIS TYPES DE GAGE (v.157) — classique / sanction physique / défi.
// Reproduit fidèlement index.html : le type vit sur l'ASSIGNATION
// (gage_draws.kind), les lignes non-classiques sont exclues du calcul de dette,
// les sanctions d'une même joueuse s'agrègent, et un défi ne peut jamais tomber
// sur une joueuse qu'il cite (ni l'impliquer par la bande via le tirage random).
import assert from 'node:assert';

let state;
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extraits fidèles) ----------------------------------------------
const GAGE_KINDS = { classique: 1, sanction_physique: 1, defi: 1 };
function _drawKind(d) { return (d && GAGE_KINDS[d.kind]) ? d.kind : 'classique'; }
function _isClassiqueDraw(d) { return _drawKind(d) === 'classique'; }
function _seasonGageDraws(pid) { return (state.gageDraws || []).filter(d => d.playerId === pid); }

// Dette : identique à index.html, MAIS filtrée sur le classique (c'est le fix).
function gageDebt(pid) {
  const draws = _seasonGageDraws(pid).filter(_isClassiqueDraw);
  const events = []; const batches = {};
  draws.forEach(d => { if (d.status === 'adjust' || !d.assignedAt) return; (batches[d.assignedAt] = batches[d.assignedAt] || []).push(d); });
  Object.values(batches).forEach(arr => {
    const at = Math.max(0, ...arr.map(d => d.completedAt || 0));
    const skips = arr.filter(d => d.status === 'skipped').length;
    if (skips) { events.push({ at, v: skips }); return; }
    if (arr.some(d => d.status === 'owed')) return;
    const engaged = arr.filter(d => d.status === 'accepted' || d.status === 'player_done' || d.status === 'coach_confirmed').length;
    if (engaged) events.push({ at, v: -engaged });
  });
  draws.filter(d => d.status === 'adjust').forEach(d => events.push({ at: d.completedAt || 0, v: Number.isFinite(d.delta) ? d.delta : 0 }));
  events.sort((a, b) => a.at - b.at);
  let bal = 0; events.forEach(e => { bal += e.v; if (bal < 0) bal = 0; });
  return bal;
}
function pendingDraws(pid) { return _seasonGageDraws(pid).filter(d => d.status === 'owed' && _isClassiqueDraw(d)); }
function playerActiveDraws(pid) { return _seasonGageDraws(pid).filter(d => _isClassiqueDraw(d) && (d.status === 'accepted' || d.status === 'player_done')); }

function _sanctionTplById(id) { return (state.sanctionTemplates || []).find(t => t.id === id) || null; }
function _gageDefiById(id) { return (state.gageDefis || []).find(t => t.id === id) || null; }
function _sanctionDose(t, mult) {
  if (!t) return '';
  mult = Number.isFinite(mult) && mult > 0 ? mult : 1;
  const bits = [];
  const sets = Number.isFinite(t.sets) && t.sets > 0 ? t.sets * mult : 0;
  const reps = Number.isFinite(t.reps) && t.reps > 0 ? t.reps : 0;
  if (sets && reps) bits.push(sets + ' × ' + reps);
  else if (reps) bits.push((reps * mult) + ' reps');
  else if (sets) bits.push(sets + ' séries');
  const dur = Number.isFinite(t.durationSeconds) && t.durationSeconds > 0 ? t.durationSeconds * mult : 0;
  if (dur) bits.push(dur + ' s');
  return bits.join(' · ');
}
function playerPendingSanctions(pid) {
  return _seasonGageDraws(pid).filter(d => _drawKind(d) === 'sanction_physique' && (d.status === 'accepted' || d.status === 'player_done'));
}
function playerPendingDefis(pid) {
  return _seasonGageDraws(pid).filter(d => _drawKind(d) === 'defi' && (d.status === 'accepted' || d.status === 'player_done'));
}
function sanctionProgramFor(pid) {
  const draws = playerPendingSanctions(pid);
  const byTpl = new Map();
  draws.forEach(d => {
    const key = d.sanctionTemplateId || ('_orphan:' + d.id);
    const t = _sanctionTplById(d.sanctionTemplateId);
    const cur = byTpl.get(key) || { tpl: t, name: t ? t.name : '(exo retiré de la base)', times: 0, draws: [] };
    cur.times++; cur.draws.push(d); byTpl.set(key, cur);
  });
  const items = [...byTpl.values()].map(it => Object.assign(it, {
    dose: _sanctionDose(it.tpl, it.times),
    label: it.name + (it.times > 1 ? ' ×' + it.times : '')
  }));
  return { items, count: draws.length, draws };
}

function _assignGagePlayers() { return (state.players || []).slice(); }
function _defiInvolvedIds(t) { return Array.isArray(t && t.involvedPlayerIds) ? t.involvedPlayerIds.filter(Boolean) : []; }
function _playerNameOf(pid) { const p = (state.players || []).find(x => x.id === pid); return p ? p.name : '?'; }
function _defiCites(t, pid) { return !!pid && _defiInvolvedIds(t).includes(pid); }
function _defiRandomPool(t, targetPid) {
  const cited = new Set(_defiInvolvedIds(t));
  return _assignGagePlayers().filter(p => p.id !== targetPid && !cited.has(p.id));
}
function _defiAssignBlocker(t, targetPid) {
  if (!t) return 'Défi introuvable.';
  if (_defiCites(t, targetPid)) return 'Ce défi cite ' + _playerNameOf(targetPid) + ' — elle ne peut pas se défier elle-même.';
  if (t.involvesRandom && !_defiRandomPool(t, targetPid).length) return 'Impossible d\'assigner ce défi : pool de tirage vide.';
  return null;
}
function _resolveDefiInvolved(t, targetPid) {
  const ids = _defiInvolvedIds(t).slice();
  if (t && t.involvesRandom) {
    const pool = _defiRandomPool(t, targetPid);
    if (!pool.length) return null;
    ids.push(pool[Math.floor(Math.random() * pool.length)].id);
  }
  return ids;
}
function _drawInvolvedIds(d) {
  if (Array.isArray(d && d.resolvedInvolvedPlayerIds) && d.resolvedInvolvedPlayerIds.length) return d.resolvedInvolvedPlayerIds;
  return _defiInvolvedIds(_gageDefiById(d && d.defiTemplateId));
}

function _createKindDraw(pid, kind, tplId, resolvedInvolved) {
  const t = now();
  const row = {
    id: uid(), playerId: pid, gageId: null, kind, status: 'accepted', delta: 0,
    sanctionTemplateId: kind === 'sanction_physique' ? tplId : null,
    defiTemplateId: kind === 'defi' ? tplId : null,
    resolvedInvolvedPlayerIds: Array.isArray(resolvedInvolved) ? resolvedInvolved.filter(Boolean) : [],
    deadlineAt: kind === 'defi' ? t + 7 * 86400000 : null,
    assignedAt: t, drawnAt: t, completedAt: t, validatedAt: null, validatedBy: null,
    createdAt: t, updatedAt: t
  };
  state.gageDraws.push(row);
  return row;
}
// La garde défensive de assignKindDrawTo : retourne la ligne, ou l'erreur.
function assignKindDrawTo(pid, kind, tplId) {
  let resolved = [];
  if (kind === 'defi') {
    const t = _gageDefiById(tplId);
    const blocker = _defiAssignBlocker(t, pid);
    if (blocker) return { error: blocker };
    resolved = _resolveDefiInvolved(t, pid) || [];
  }
  return { row: _createKindDraw(pid, kind, tplId, resolved) };
}
function validateGageDraw(drawId) {
  const d = state.gageDraws.find(x => x.id === drawId);
  if (!d || d.status === 'coach_confirmed') return false;
  const t = now();
  d.status = 'coach_confirmed'; d.confirmedAt = t; d.validatedAt = t; d.validatedBy = 'admin';
  return true;
}
function completeSanctionProgram(pid) { playerPendingSanctions(pid).forEach(d => validateGageDraw(d.id)); }

// --- HARNAIS ----------------------------------------------------------------
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }
function fresh() {
  _uid = 0; CLOCK = 1000;
  state = {
    players: [
      { id: 'p1', num: 4, name: 'Emma' },
      { id: 'p2', num: 7, name: 'Cécile' },
      { id: 'p3', num: 9, name: 'Lina' },
    ],
    gages: [], gageDraws: [],
    sanctionTemplates: [
      { id: 's1', name: 'Gainage planche', category: 'abdos', sets: 3, reps: null, durationSeconds: 30 },
      { id: 's2', name: 'Pompes', category: 'bras', sets: 2, reps: 10, durationSeconds: null },
    ],
    gageDefis: [
      { id: 'd1', name: '100 lancers francs', windowDays: 7, involvedPlayerIds: [], involvesRandom: false },
      { id: 'd2', name: 'Battre le temps d\'Emma aux BLS', windowDays: 5, involvedPlayerIds: ['p1'], involvesRandom: false },
      { id: 'd3', name: 'Bats le temps d\'Emma au 3pts avec X', windowDays: 5, involvedPlayerIds: ['p1'], involvesRandom: true },
    ],
  };
}

console.log('\nSCÉNARIO 1 — la dette reste une affaire de TIRAGE');
fresh();
t('un lot classique skippé met la dette à 1', () => {
  const at = now();
  state.gageDraws.push({ id: uid(), playerId: 'p1', kind: 'classique', status: 'skipped', assignedAt: at, completedAt: now() });
  assert.strictEqual(gageDebt('p1'), 1);
});
t('poser une sanction ne rembourse RIEN (le bug évité)', () => {
  _createKindDraw('p1', 'sanction_physique', 's1');
  assert.strictEqual(gageDebt('p1'), 1, 'une sanction acceptée ne doit pas éteindre une dette de tirage');
});
t('valider la sanction ne rembourse rien non plus', () => {
  completeSanctionProgram('p1');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('un défi non plus', () => {
  assignKindDrawTo('p1', 'defi', 'd1');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('pendingDraws ignore les lignes non-classiques', () => {
  assert.strictEqual(pendingDraws('p1').length, 0);
});
t('playerActiveDraws (bandeau gage classique) ignore sanctions et défis', () => {
  assert.strictEqual(playerActiveDraws('p1').length, 0);
});

console.log('\nSCÉNARIO 2 — les sanctions s\'agrègent en UN programme');
fresh();
t('deux fois le même exo → une seule ligne, dose cumulée', () => {
  _createKindDraw('p1', 'sanction_physique', 's1');
  _createKindDraw('p1', 'sanction_physique', 's1');
  const prog = sanctionProgramFor('p1');
  assert.strictEqual(prog.count, 2);
  assert.strictEqual(prog.items.length, 1, 'pas de doublon dans le programme');
  assert.strictEqual(prog.items[0].label, 'Gainage planche ×2');
  assert.strictEqual(prog.items[0].dose, '6 séries · 60 s', 'séries et durée multipliées');
});
t('deux exos différents → deux lignes', () => {
  _createKindDraw('p1', 'sanction_physique', 's2');
  const prog = sanctionProgramFor('p1');
  assert.strictEqual(prog.count, 3);
  assert.strictEqual(prog.items.length, 2);
});
t('« marquer comme fait » clôt TOUTE la pile d\'un geste', () => {
  completeSanctionProgram('p1');
  assert.strictEqual(sanctionProgramFor('p1').count, 0);
  assert.strictEqual(state.gageDraws.filter(d => d.status === 'coach_confirmed').length, 3);
  assert.ok(state.gageDraws.every(d => !d.validatedAt || d.validatedBy === 'admin'), 'validated_by renseigné');
});
t('un exo retiré de la base reste lisible dans le programme', () => {
  fresh();
  _createKindDraw('p1', 'sanction_physique', 'inconnu');
  assert.strictEqual(sanctionProgramFor('p1').items[0].name, '(exo retiré de la base)');
});

console.log('\nSCÉNARIO 3 — on ne se défie pas soi-même');
fresh();
t('Emma ne peut pas recevoir le défi qui la cite', () => {
  const r = assignKindDrawTo('p1', 'defi', 'd2');
  assert.ok(r.error, 'refus attendu');
  assert.match(r.error, /Emma/);
  assert.strictEqual(state.gageDraws.length, 0, 'aucune ligne écrite');
});
t('Cécile, elle, peut recevoir ce même défi', () => {
  const r = assignKindDrawTo('p2', 'defi', 'd2');
  assert.ok(r.row);
  assert.deepStrictEqual(_drawInvolvedIds(r.row), ['p1']);
});
t('la garde tient même si le picker est contourné (appel direct)', () => {
  const before = state.gageDraws.length;
  const r = assignKindDrawTo('p1', 'defi', 'd2');
  assert.ok(r.error);
  assert.strictEqual(state.gageDraws.length, before);
});
t('un défi qui ne cite personne passe pour tout le monde', () => {
  assert.strictEqual(_defiAssignBlocker(_gageDefiById('d1'), 'p1'), null);
  assert.strictEqual(_defiAssignBlocker(_gageDefiById('d1'), 'p3'), null);
});

console.log('\nSCÉNARIO 4 — la joueuse tirée au sort');
fresh();
t('le random exclut la cible ET les citées', () => {
  const pool = _defiRandomPool(_gageDefiById('d3'), 'p2').map(p => p.id);
  assert.deepStrictEqual(pool, ['p3'], 'roster moins Cécile (cible) moins Emma (citée)');
});
t('l\'assignation fige citées + random résolue', () => {
  const r = assignKindDrawTo('p2', 'defi', 'd3');
  assert.ok(r.row);
  assert.deepStrictEqual(r.row.resolvedInvolvedPlayerIds, ['p1', 'p3']);
  assert.ok(!r.row.resolvedInvolvedPlayerIds.includes('p2'), 'la cible ne s\'implique jamais elle-même');
});
t('la liste figée ne bouge plus si le modèle change ensuite', () => {
  const row = state.gageDraws[state.gageDraws.length - 1];
  _gageDefiById('d3').involvedPlayerIds = ['p3'];
  assert.deepStrictEqual(_drawInvolvedIds(row), ['p1', 'p3'], 'le défi ne change pas de sens entre deux ouvertures');
});
t('roster trop petite → refus explicite, aucune ligne écrite', () => {
  fresh();
  state.players = [{ id: 'p1', num: 4, name: 'Emma' }, { id: 'p2', num: 7, name: 'Cécile' }];
  _gageDefiById('d3').involvedPlayerIds = ['p1'];       // cite Emma, cible Cécile → pool vide
  const before = state.gageDraws.length;
  const r = assignKindDrawTo('p2', 'defi', 'd3');
  assert.ok(r.error);
  assert.match(r.error, /pool de tirage vide/);
  assert.strictEqual(state.gageDraws.length, before);
});
t('un défi random sans citation pioche parmi les autres', () => {
  fresh();
  _gageDefiById('d3').involvedPlayerIds = [];
  const r = assignKindDrawTo('p1', 'defi', 'd3');
  assert.strictEqual(r.row.resolvedInvolvedPlayerIds.length, 1);
  assert.ok(['p2', 'p3'].includes(r.row.resolvedInvolvedPlayerIds[0]));
});

console.log('\nSCÉNARIO 5 — les défis en attente, côté joueuse');
fresh();
t('un défi assigné est « en cours » jusqu\'à validation coach', () => {
  const r = assignKindDrawTo('p2', 'defi', 'd1');
  assert.strictEqual(playerPendingDefis('p2').length, 1);
  validateGageDraw(r.row.id);
  assert.strictEqual(playerPendingDefis('p2').length, 0);
});

console.log('\n✅ ' + pass + ' assertions OK — 3 types, dette cloisonnée, agrégation des sanctions, anti-auto-défi et tirage random figé.\n');
