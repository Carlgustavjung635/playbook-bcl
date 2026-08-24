// Test des TROIS TYPES DE GAGE (v.157/158/159) — classique / sanction / défi.
// Reproduit fidèlement index.html. Ce que ça verrouille :
//   • le type vit sur l'ASSIGNATION (gage_draws.kind), et les lignes non
//     classiques sont EXCLUES du calcul de dette (sinon poser une sanction
//     rembourserait une dette de tirage) ;
//   • les trois types passent par le TIRAGE AU SORT : le coach n'assigne qu'un
//     type, la ligne naît 'owed' sans item, la joueuse pioche puis
//     garde / retire / annule ;
//   • un défi ne tombe jamais sur une joueuse qu'il cite, ni ne l'implique par
//     la bande via le tirage aléatoire ;
//   • les sanctions d'une joueuse s'agrègent en un programme unique.
// Le tirage est rendu DÉTERMINISTE ici (1er du pool éligible).
import assert from 'node:assert';

let state;
let _uid = 0; function uid() { return 'x' + (++_uid); }
let CLOCK = 1000; function now() { return ++CLOCK; }

// --- SUJET (extraits fidèles) ----------------------------------------------
const GAGE_KINDS = { classique: 1, sanction_physique: 1, defi: 1 };
function _drawKind(d) { return (d && GAGE_KINDS[d.kind]) ? d.kind : 'classique'; }
function _isClassiqueDraw(d) { return _drawKind(d) === 'classique'; }
function _seasonGageDraws(pid) { return (state.gageDraws || []).filter(d => d.playerId === pid); }

function gageDebt(pid) {
  const draws = _seasonGageDraws(pid).filter(_isClassiqueDraw);   // ← le fix
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
function sanctionTemplatesList() { return (state.sanctionTemplates || []).filter(t => !t.deletedAt); }
function gageDefisList() { return (state.gageDefis || []).filter(t => !t.deletedAt); }
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
    ids.push(pool[0].id);                                   // déterministe pour le test
  }
  return ids;
}
function _drawInvolvedIds(d) {
  if (Array.isArray(d && d.resolvedInvolvedPlayerIds) && d.resolvedInvolvedPlayerIds.length) return d.resolvedInvolvedPlayerIds;
  return _defiInvolvedIds(_gageDefiById(d && d.defiTemplateId));
}

// --- Le tirage des types non-classiques -------------------------------------
function pendingKindDraws(pid) { return _seasonGageDraws(pid).filter(d => d.status === 'owed' && !_isClassiqueDraw(d)); }
function _kindPoolFor(pid, kind, excludeId) {
  const all = (kind === 'sanction_physique'
    ? sanctionTemplatesList()
    : gageDefisList().filter(t => !_defiAssignBlocker(t, pid))
  ).filter(t => t.id !== excludeId);
  const busy = new Set((kind === 'sanction_physique'
    ? playerPendingSanctions(pid).map(d => d.sanctionTemplateId)
    : playerPendingDefis(pid).map(d => d.defiTemplateId)).filter(Boolean));
  const fresh = all.filter(t => !busy.has(t.id));
  return fresh.length ? fresh : all;
}
function _pickKindItem(pid, kind, excludeId) {
  const pool = _kindPoolFor(pid, kind, excludeId);
  return pool.length ? pool[0] : null;                      // déterministe pour le test
}
function _kindDrawItemId(d) { return _drawKind(d) === 'sanction_physique' ? d.sanctionTemplateId : d.defiTemplateId; }
function _setKindDrawItem(draw, tpl) {
  const t = now();
  if (_drawKind(draw) === 'sanction_physique') {
    draw.sanctionTemplateId = tpl.id; draw.resolvedInvolvedPlayerIds = []; draw.deadlineAt = null;
  } else {
    draw.defiTemplateId = tpl.id;
    draw.resolvedInvolvedPlayerIds = _resolveDefiInvolved(tpl, draw.playerId) || [];
    draw.deadlineAt = t + (Number.isFinite(tpl.windowDays) ? tpl.windowDays : 7) * 86400000;
  }
  draw.drawnAt = t; draw.updatedAt = t;
}
function _createKindDraw(pid, kind) {
  const t = now();
  const row = {
    id: uid(), playerId: pid, gageId: null, kind, status: 'owed', delta: 0,
    sanctionTemplateId: null, defiTemplateId: null, resolvedInvolvedPlayerIds: [],
    deadlineAt: null, assignedAt: t, drawnAt: null, completedAt: null,
    validatedAt: null, validatedBy: null, createdAt: t, updatedAt: t
  };
  state.gageDraws.push(row);
  return row;
}
// La garde défensive de assignKindDrawTo : la ligne, ou l'erreur.
function assignKindDrawTo(pid, kind) {
  if (!_kindPoolFor(pid, kind).length) {
    return { error: kind === 'sanction_physique'
      ? 'Base de sanctions vide'
      : 'Aucun défi disponible pour ' + _playerNameOf(pid) + ' (tous la citent)' };
  }
  return { row: _createKindDraw(pid, kind) };
}
// Ouverture de l'écran de tirage : fige l'item (et la random pour un défi).
function openKindDraw(draw) {
  if (!_kindDrawItemId(draw)) {
    const picked = _pickKindItem(draw.playerId, _drawKind(draw), null);
    if (!picked) return null;
    _setKindDrawItem(draw, picked);
  }
  return _kindDrawItemId(draw);
}
function keepKindDraw(draw) {
  if (draw.status !== 'owed' || _isClassiqueDraw(draw)) return false;
  const t = now();
  draw.status = 'accepted'; draw.drawnAt = draw.drawnAt || t; draw.completedAt = t; draw.updatedAt = t;
  return true;
}
function redrawKindDraw(draw) {
  const picked = _pickKindItem(draw.playerId, _drawKind(draw), _kindDrawItemId(draw));
  if (!picked) return false;
  _setKindDrawItem(draw, picked);
  return true;
}
function deferKindDraw(draw) { return draw.status === 'owed'; }   // non destructif

function validateGageDraw(drawId) {
  const d = state.gageDraws.find(x => x.id === drawId);
  if (!d || d.status === 'coach_confirmed') return false;
  const t = now();
  d.status = 'coach_confirmed'; d.confirmedAt = t; d.validatedAt = t; d.validatedBy = 'admin';
  return true;
}
function completeSanctionProgram(pid) { playerPendingSanctions(pid).forEach(d => validateGageDraw(d.id)); }

// Raccourci de test : assigner → tirer → garder.
function assignDrawKeep(pid, kind) {
  const r = assignKindDrawTo(pid, kind);
  if (r.error) return r;
  openKindDraw(r.row);
  keepKindDraw(r.row);
  return r;
}

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

console.log('\nSCÉNARIO 1 — le coach n\'assigne QU\'UN TYPE, le système tire');
fresh();
t('assigner une sanction crée un tirage DÛ, sans item', () => {
  const r = assignKindDrawTo('p1', 'sanction_physique');
  assert.ok(r.row);
  assert.strictEqual(r.row.status, 'owed');
  assert.strictEqual(r.row.sanctionTemplateId, null, 'le coach ne choisit pas l\'exo');
  assert.strictEqual(pendingKindDraws('p1').length, 1);
});
t('l\'ouverture de l\'écran de tirage FIGE l\'item pioché', () => {
  const d = pendingKindDraws('p1')[0];
  const id = openKindDraw(d);
  assert.ok(id);
  assert.strictEqual(openKindDraw(d), id, 're-ouvrir ne repioche pas (anti force-close)');
});
t('« Retirer au sort » repioche autre chose, sans dette', () => {
  const d = pendingKindDraws('p1')[0];
  const before = _kindDrawItemId(d);
  assert.ok(redrawKindDraw(d));
  assert.notStrictEqual(_kindDrawItemId(d), before);
  assert.strictEqual(gageDebt('p1'), 0, 'retirer ne coûte aucune dette');
});
t('« Annuler » laisse le tirage DÛ (non destructif)', () => {
  const d = pendingKindDraws('p1')[0];
  assert.ok(deferKindDraw(d));
  assert.strictEqual(d.status, 'owed');
  assert.strictEqual(pendingKindDraws('p1').length, 1, 'il reviendra à la prochaine ouverture');
});
t('« Je garde » transforme le tirage en obligation', () => {
  const d = pendingKindDraws('p1')[0];
  assert.ok(keepKindDraw(d));
  assert.strictEqual(d.status, 'accepted');
  assert.strictEqual(pendingKindDraws('p1').length, 0);
  assert.strictEqual(playerPendingSanctions('p1').length, 1);
});
t('base vide → refus, aucune ligne écrite', () => {
  fresh();
  state.sanctionTemplates = [];
  const r = assignKindDrawTo('p1', 'sanction_physique');
  assert.ok(r.error);
  assert.strictEqual(state.gageDraws.length, 0);
});

console.log('\nSCÉNARIO 2 — la dette reste une affaire de TIRAGE CLASSIQUE');
fresh();
t('un lot classique skippé met la dette à 1', () => {
  const at = now();
  state.gageDraws.push({ id: uid(), playerId: 'p1', kind: 'classique', status: 'skipped', assignedAt: at, completedAt: now() });
  assert.strictEqual(gageDebt('p1'), 1);
});
t('tirer et garder une sanction ne rembourse RIEN (le bug évité)', () => {
  assignDrawKeep('p1', 'sanction_physique');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('valider la sanction ne rembourse rien non plus', () => {
  completeSanctionProgram('p1');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('un défi non plus', () => {
  assignDrawKeep('p1', 'defi');
  assert.strictEqual(gageDebt('p1'), 1);
});
t('pendingDraws et playerActiveDraws ignorent les lignes non-classiques', () => {
  assert.strictEqual(pendingDraws('p1').length, 0);
  assert.strictEqual(playerActiveDraws('p1').length, 0);
});

console.log('\nSCÉNARIO 3 — les sanctions s\'agrègent en UN programme');
fresh();
t('deux tirages tombés sur le même exo → une ligne, dose cumulée', () => {
  const a = assignKindDrawTo('p1', 'sanction_physique').row;
  openKindDraw(a); keepKindDraw(a);
  const b = assignKindDrawTo('p1', 'sanction_physique').row;
  _setKindDrawItem(b, _sanctionTplById(a.sanctionTemplateId));   // force le doublon
  keepKindDraw(b);
  const prog = sanctionProgramFor('p1');
  assert.strictEqual(prog.count, 2);
  assert.strictEqual(prog.items.length, 1, 'pas de doublon dans le programme');
  assert.strictEqual(prog.items[0].label, 'Gainage planche ×2');
  assert.strictEqual(prog.items[0].dose, '6 séries · 60 s', 'séries et durée multipliées');
});
t('le pool écarte d\'abord ce qu\'elle a déjà en cours', () => {
  const pool = _kindPoolFor('p1', 'sanction_physique').map(t => t.id);
  assert.deepStrictEqual(pool, ['s2'], 's1 est déjà dans son programme');
});
t('pool épuisé → repli sur le pool complet (pas de blocage)', () => {
  const c = assignKindDrawTo('p1', 'sanction_physique').row;
  openKindDraw(c); keepKindDraw(c);
  assert.deepStrictEqual(_kindPoolFor('p1', 'sanction_physique').map(t => t.id), ['s1', 's2']);
});
t('« marquer comme fait » clôt TOUTE la pile d\'un geste', () => {
  completeSanctionProgram('p1');
  assert.strictEqual(sanctionProgramFor('p1').count, 0);
  assert.strictEqual(state.gageDraws.filter(d => d.status === 'coach_confirmed').length, 3);
});
t('un exo retiré de la base reste lisible dans le programme', () => {
  fresh();
  const d = assignKindDrawTo('p1', 'sanction_physique').row;
  openKindDraw(d); keepKindDraw(d);
  state.sanctionTemplates = [];
  assert.strictEqual(sanctionProgramFor('p1').items[0].name, '(exo retiré de la base)');
});

console.log('\nSCÉNARIO 4 — on ne se défie pas soi-même');
fresh();
t('le pool de défis d\'Emma écarte ceux qui la citent', () => {
  assert.deepStrictEqual(_kindPoolFor('p1', 'defi').map(t => t.id), ['d1'], 'd2 et d3 citent Emma');
});
t('Cécile, elle, peut tirer les trois', () => {
  assert.deepStrictEqual(_kindPoolFor('p2', 'defi').map(t => t.id), ['d1', 'd2', 'd3']);
});
t('tous les défis la citent → refus explicite, aucune ligne écrite', () => {
  state.gageDefis = state.gageDefis.filter(t => t.id !== 'd1');
  const before = state.gageDraws.length;
  const r = assignKindDrawTo('p1', 'defi');
  assert.ok(r.error);
  assert.match(r.error, /tous la citent/);
  assert.strictEqual(state.gageDraws.length, before);
});
t('le tirage lui-même ne peut jamais sortir un défi qui la cite', () => {
  fresh();
  const r = assignKindDrawTo('p1', 'defi');
  openKindDraw(r.row);
  assert.strictEqual(r.row.defiTemplateId, 'd1');
  assert.ok(!_defiCites(_gageDefiById(r.row.defiTemplateId), 'p1'));
});

console.log('\nSCÉNARIO 5 — la joueuse tirée au sort, résolue AU TIRAGE');
fresh();
t('le pool random exclut la cible ET les citées', () => {
  assert.deepStrictEqual(_defiRandomPool(_gageDefiById('d3'), 'p2').map(p => p.id), ['p3']);
});
t('tirer un défi random fige citées + random résolue', () => {
  const r = assignKindDrawTo('p2', 'defi');
  const d = r.row;
  _setKindDrawItem(d, _gageDefiById('d3'));                 // force le défi random
  assert.deepStrictEqual(d.resolvedInvolvedPlayerIds, ['p1', 'p3']);
  assert.ok(!d.resolvedInvolvedPlayerIds.includes('p2'), 'la cible ne s\'implique jamais elle-même');
  assert.ok(d.deadlineAt, 'la deadline est posée au tirage, pas à l\'assignation');
});
t('la liste figée ne bouge plus si le modèle change ensuite', () => {
  const d = state.gageDraws[state.gageDraws.length - 1];
  _gageDefiById('d3').involvedPlayerIds = ['p3'];
  assert.deepStrictEqual(_drawInvolvedIds(d), ['p1', 'p3'], 'le défi ne change pas de sens entre deux ouvertures');
});
t('roster trop petite → le défi random sort du pool tirable', () => {
  fresh();
  state.players = [{ id: 'p1', num: 4, name: 'Emma' }, { id: 'p2', num: 7, name: 'Cécile' }];
  state.gageDefis = [{ id: 'd3', name: 'avec X', windowDays: 5, involvedPlayerIds: ['p1'], involvesRandom: true }];
  assert.strictEqual(_kindPoolFor('p2', 'defi').length, 0, 'pool random vide → défi non tirable');
  const r = assignKindDrawTo('p2', 'defi');
  assert.ok(r.error);
  assert.strictEqual(state.gageDraws.length, 0);
});

console.log('\nSCÉNARIO 6 — le défi reste « en cours » jusqu\'à la validation coach');
fresh();
t('assigné → tiré → gardé → validé', () => {
  const r = assignDrawKeep('p2', 'defi');
  assert.strictEqual(playerPendingDefis('p2').length, 1);
  validateGageDraw(r.row.id);
  assert.strictEqual(playerPendingDefis('p2').length, 0);
  assert.strictEqual(r.row.validatedBy, 'admin');
});

console.log('\n✅ ' + pass + ' assertions OK — tirage au sort des 3 types, garder/retirer/annuler, dette cloisonnée, agrégation, anti-auto-défi, random figé.\n');
