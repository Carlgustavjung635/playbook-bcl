// Test PRÉPA « FULL PACKAGE » — scoring, fenêtre de rattrapage 48 h, dates prévues.
// Extrait FIDÈLE des fonctions pures d'index.html (cf. migration 20260713_004).
// Toute modif du cœur pur dans index.html doit être reportée ici DANS LE MÊME COMMIT.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }
function deq(l, a, b) { assert.deepStrictEqual(a, b, '✗ ' + l); passed++; }

// ============================================================================
// COPIE FIDÈLE — cœur pur prépa (doit rester identique à index.html)
// ============================================================================
const TRAINING_DEFAULT_CONFIG = {
  points: { min: 10, med: 20, ultra: 30 },
  squad_multiplier: 2,
  post_bonus: 10,
  remind_hour: 9
};
const TRAINING_LEVELS = ['min', 'med', 'ultra'];
const TRAINING_LEVEL_LABEL = { min: 'Minimum', med: 'Medium', ultra: 'Ultra' };
const TRAINING_RATTRAPAGE_MS = 48 * 3600000;
const TRAINING_ADVANCE_MS = 24 * 3600000;

function _trainingCleanDays(days) {
  if (!Array.isArray(days)) return [];
  const seen = new Set();
  days.forEach(d => { const n = Number(d); if (Number.isInteger(n) && n >= 1 && n <= 7) seen.add(n); });
  return [...seen].sort((a, b) => a - b);
}
function _trainingConfig(program) {
  const raw = (program && program.scoringConfig && typeof program.scoringConfig === 'object') ? program.scoringConfig : {};
  const pts = (raw.points && typeof raw.points === 'object') ? raw.points : {};
  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  return {
    points: {
      min: num(pts.min, TRAINING_DEFAULT_CONFIG.points.min),
      med: num(pts.med, TRAINING_DEFAULT_CONFIG.points.med),
      ultra: num(pts.ultra, TRAINING_DEFAULT_CONFIG.points.ultra)
    },
    squad_multiplier: num(raw.squad_multiplier, TRAINING_DEFAULT_CONFIG.squad_multiplier),
    post_bonus: num(raw.post_bonus, TRAINING_DEFAULT_CONFIG.post_bonus),
    remind_hour: num(raw.remind_hour, TRAINING_DEFAULT_CONFIG.remind_hour)
  };
}
function _computePoints({ level, hasSquad, hasPost, config } = {}) {
  const cfg = _trainingConfig({ scoringConfig: config || {} });
  const lvl = TRAINING_LEVELS.includes(level) ? level : 'min';
  const base = cfg.points[lvl];
  const total = (base * (hasSquad ? cfg.squad_multiplier : 1)) + (hasPost ? cfg.post_bonus : 0);
  return { base, total: Math.round(total) };
}
function _trainingDayStartMs(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const ms = Date.parse(dateStr + 'T00:00:00Z');
  return Number.isFinite(ms) ? ms : null;
}
function _isRattrapageValid(datePlanned, dateNow) {
  const start = _trainingDayStartMs(datePlanned);
  if (start === null) return false;
  const now = (dateNow instanceof Date) ? dateNow.getTime() : Number(dateNow);
  if (!Number.isFinite(now)) return false;
  const elapsed = now - start;
  return elapsed >= -TRAINING_ADVANCE_MS && elapsed < TRAINING_RATTRAPAGE_MS;
}
function _isTrainingAdvance(datePlanned, dateNow) {
  const start = _trainingDayStartMs(datePlanned);
  if (start === null) return false;
  const now = (dateNow instanceof Date) ? dateNow.getTime() : Number(dateNow);
  if (!Number.isFinite(now)) return false;
  const elapsed = now - start;
  return elapsed < 0 && elapsed >= -TRAINING_ADVANCE_MS;
}
// isoDate : copie fidèle (composantes LOCALES, comme dans l'app).
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _trainingCanValidate(program, datePlanned, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!_isRattrapageValid(datePlanned, now)) return false;
  if (!program || !program.startDate) return false;
  return isoDate(new Date(now)) >= program.startDate;
}
function _isRattrapage(datePlanned, dateNow) {
  const start = _trainingDayStartMs(datePlanned);
  if (start === null) return false;
  const now = (dateNow instanceof Date) ? dateNow.getTime() : Number(dateNow);
  if (!Number.isFinite(now)) return false;
  const elapsed = now - start;
  return elapsed >= 86400000 && elapsed < TRAINING_RATTRAPAGE_MS;
}
function _trainingDayOfWeek(dateStr) {
  const ms = _trainingDayStartMs(dateStr);
  if (ms === null) return null;
  const d = new Date(ms).getUTCDay();
  return d === 0 ? 7 : d;
}
function _dateRangeForProgram(startDate, endDate, daysActive) {
  const start = _trainingDayStartMs(startDate);
  const end = _trainingDayStartMs(endDate);
  const days = _trainingCleanDays(daysActive);
  if (start === null || end === null || end < start || !days.length) return [];
  const MAX_DAYS = 366 * 5;
  const out = [];
  for (let i = 0, ms = start; ms <= end && i < MAX_DAYS; i++, ms = start + i * 86400000) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    const dow = new Date(ms).getUTCDay();
    if (days.includes(dow === 0 ? 7 : dow)) out.push(iso);
  }
  return out;
}
function _completionSummary(c) {
  if (!c) return '';
  const bits = [TRAINING_LEVEL_LABEL[c.contractLevel] || c.contractLevel];
  if (c.squadTeammateId) bits.push('👯 Squad');
  if (c.postPhotoUrl) bits.push('📸 Post');
  if (Number.isFinite(c.runningDistanceKm) && c.runningDistanceKm > 0) bits.push('🏃 ' + c.runningDistanceKm + ' km');
  return bits.join(' · ') + ' — ' + (c.pointsTotal || 0) + ' pts';
}

// ============================================================================
// 1) _computePoints — formule figée : (base × squad_mult) + post_bonus
// ============================================================================
const D = undefined; // config absente → défauts 10/20/30, ×2, +10

// Base seule, les 3 niveaux.
eq('min seul → 10', _computePoints({ level: 'min', config: D }).total, 10);
eq('med seul → 20', _computePoints({ level: 'med', config: D }).total, 20);
eq('ultra seul → 30', _computePoints({ level: 'ultra', config: D }).total, 30);

// Squad seul : ×2 sur la base.
eq('min + squad → 20', _computePoints({ level: 'min', hasSquad: true, config: D }).total, 20);
eq('med + squad → 40', _computePoints({ level: 'med', hasSquad: true, config: D }).total, 40);
eq('ultra + squad → 60', _computePoints({ level: 'ultra', hasSquad: true, config: D }).total, 60);

// Post seul : additif, JAMAIS multiplié.
eq('min + post → 20', _computePoints({ level: 'min', hasPost: true, config: D }).total, 20);
eq('med + post → 30', _computePoints({ level: 'med', hasPost: true, config: D }).total, 30);
eq('ultra + post → 40', _computePoints({ level: 'ultra', hasPost: true, config: D }).total, 40);

// Combiné — le cas de référence de la spec.
eq('med + squad + post → 50 (20×2+10) — CAS DE RÉFÉRENCE', _computePoints({ level: 'med', hasSquad: true, hasPost: true, config: D }).total, 50);
eq('min + squad + post → 30', _computePoints({ level: 'min', hasSquad: true, hasPost: true, config: D }).total, 30);
eq('ultra + squad + post → 70', _computePoints({ level: 'ultra', hasSquad: true, hasPost: true, config: D }).total, 70);

// Le post n'est PAS multiplié : garde anti-régression sur l'ordre des opérations.
// Si la formule devenait (base + post) × mult, on aurait 60 au lieu de 50.
ok('post non multiplié (≠ (20+10)×2 = 60)', _computePoints({ level: 'med', hasSquad: true, hasPost: true, config: D }).total !== 60);

// base retourné = barème du niveau, indépendant des bonus (c'est lui qui est figé
// dans base_points au moment de la validation).
eq('base med = 20 même avec squad+post', _computePoints({ level: 'med', hasSquad: true, hasPost: true, config: D }).base, 20);

// Barème custom.
const cfgCustom = { points: { min: 5, med: 15, ultra: 50 }, squad_multiplier: 3, post_bonus: 25 };
eq('custom ultra + squad + post → 175 (50×3+25)', _computePoints({ level: 'ultra', hasSquad: true, hasPost: true, config: cfgCustom }).total, 175);
eq('custom min seul → 5', _computePoints({ level: 'min', config: cfgCustom }).total, 5);

// Surcharge PARTIELLE : les clés absentes retombent sur le défaut (un programme
// créé avant l'ajout d'une clé doit rester scorable).
eq('config partielle {post_bonus:100} → med+post = 120', _computePoints({ level: 'med', hasPost: true, config: { post_bonus: 100 } }).total, 120);
eq('config partielle {points:{med:7}} → med = 7', _computePoints({ level: 'med', config: { points: { med: 7 } } }).total, 7);
eq('config partielle {points:{med:7}} → ultra reste 30', _computePoints({ level: 'ultra', config: { points: { med: 7 } } }).total, 30);

// Multiplicateur décimal → entier (colonne integer).
eq('squad_mult 1.5 sur med → 30', _computePoints({ level: 'med', hasSquad: true, config: { squad_multiplier: 1.5 } }).total, 30);
eq('squad_mult 1.5 sur 25 → 38 (arrondi)', _computePoints({ level: 'med', hasSquad: true, config: { points: { med: 25 }, squad_multiplier: 1.5 } }).total, 38);

// Garde-fous entrées.
eq('niveau inconnu → min', _computePoints({ level: 'zzz', config: D }).total, 10);
eq('niveau absent → min', _computePoints({ config: D }).total, 10);
eq('appel sans argument → min', _computePoints().total, 10);
eq('squad_mult à 0 → base annulée', _computePoints({ level: 'med', hasSquad: true, config: { squad_multiplier: 0 } }).total, 0);
eq('config null → défauts', _computePoints({ level: 'med', config: null }).total, 20);

// ============================================================================
// 2) _isRattrapageValid — fenêtre H-24 → J+48 h autour de MINUIT du jour prévu
// ============================================================================
// 2026-07-13 est un LUNDI. minuit UTC = référence.
const LUNDI = '2026-07-13';
const T0 = Date.parse('2026-07-13T00:00:00Z');

eq('sanity : 2026-07-13 est bien un lundi (ISO 1)', _trainingDayOfWeek(LUNDI), 1);

// Bornes exactes demandées par la spec.
ok('47h59 → valide', _isRattrapageValid(LUNDI, T0 + 47 * 3600000 + 59 * 60000));
ok('48h00 pile → INVALIDE (borne haute exclue)', !_isRattrapageValid(LUNDI, T0 + 48 * 3600000));
ok('48h01 → invalide', !_isRattrapageValid(LUNDI, T0 + 48 * 3600000 + 60000));

// Minuit du mercredi = 48 h pile = périmé (formulation de la spec).
ok('mercredi 00:00 UTC → périmé', !_isRattrapageValid(LUNDI, Date.parse('2026-07-15T00:00:00Z')));
ok('mardi 23:59 UTC → encore valide', _isRattrapageValid(LUNDI, Date.parse('2026-07-14T23:59:00Z')));

// Borne basse : H-24 (anticipation). La séance de demain est validable.
ok('minuit du jour prévu pile → valide', _isRattrapageValid(LUNDI, T0));
ok('1 ms avant minuit → valide (anticipation)', _isRattrapageValid(LUNDI, T0 - 1));
ok('la veille 18:00 → valide (anticipation, H-6)', _isRattrapageValid(LUNDI, Date.parse('2026-07-12T18:00:00Z')));
ok('24 h pile avant → valide (borne basse incluse)', _isRattrapageValid(LUNDI, T0 - TRAINING_ADVANCE_MS));
ok('24 h + 1 ms avant → INVALIDE (l\'anticipation s\'arrête à 24 h)', !_isRattrapageValid(LUNDI, T0 - TRAINING_ADVANCE_MS - 1));
ok('l\'avant-veille → invalide', !_isRattrapageValid(LUNDI, Date.parse('2026-07-11T18:00:00Z')));
ok('12 jours avant → invalide (toute la semaine n\'est pas ouverte)', !_isRattrapageValid(LUNDI, Date.parse('2026-07-01T12:00:00Z')));

// CAS RÉEL (prépa estivale) : programme lun/mer/ven à partir du mardi 28/07/2026.
// On est le 28 (mardi, jour creux) → la séance du mercredi 29 doit être validable.
const MER29 = '2026-07-29';
const PREP_ESTIVALE = { startDate: '2026-07-28', endDate: '2026-08-17' };
eq('sanity : 2026-07-28 est un mardi (ISO 2)', _trainingDayOfWeek('2026-07-28'), 2);
eq('sanity : 2026-07-29 est un mercredi (ISO 3)', _trainingDayOfWeek(MER29), 3);
ok('mardi 28 23:00 → séance du 29 validable', _isRattrapageValid(MER29, Date.parse('2026-07-28T23:00:00Z')));
ok('mardi 28 00:00 → validable (borne basse exacte, H-24 pile)', _isRattrapageValid(MER29, Date.parse('2026-07-28T00:00:00Z')));
ok('lundi 27 23:00 → PAS validable (J-2, hors fenêtre)', !_isRattrapageValid(MER29, Date.parse('2026-07-27T23:00:00Z')));
ok('mardi 28 → séance du 29 validable pour le programme démarré le 28',
  _trainingCanValidate(PREP_ESTIVALE, MER29, Date.parse('2026-07-28T12:00:00Z')));
ok('lundi 27 (veille du lancement) → rien n\'est validable',
  !_trainingCanValidate(PREP_ESTIVALE, '2026-07-28', Date.parse('2026-07-27T12:00:00Z')));

// _isTrainingAdvance : marque la validation EN AVANCE (et rien d'autre).
ok('la veille → marquée « en avance »', _isTrainingAdvance(LUNDI, T0 - 6 * 3600000));
ok('24 h pile avant → en avance (borne incluse)', _isTrainingAdvance(LUNDI, T0 - TRAINING_ADVANCE_MS));
ok('minuit pile → PAS en avance (c\'est le jour même)', !_isTrainingAdvance(LUNDI, T0));
ok('jour même 10:00 → pas en avance', !_isTrainingAdvance(LUNDI, T0 + 10 * 3600000));
ok('J+1 → pas en avance (c\'est un rattrapage)', !_isTrainingAdvance(LUNDI, T0 + 30 * 3600000));
ok('avant-veille → pas en avance (hors fenêtre)', !_isTrainingAdvance(LUNDI, T0 - 30 * 3600000));
ok('date malformée → false', !_isTrainingAdvance('13/07/2026', T0));

// _trainingCanValidate : l'anticipation ne perce PAS l'aperçu 21 j — la veille
// du lancement, la 1re séance reste en lecture seule.
const PROG_LUNDI = { startDate: LUNDI, endDate: '2026-08-23' };
ok('veille du lancement → séance du 1er jour NON validable (aperçu préservé)',
  !_trainingCanValidate(PROG_LUNDI, LUNDI, T0 - 6 * 3600000));
ok('programme démarré → séance du lendemain validable',
  _trainingCanValidate({ startDate: LUNDI, endDate: '2026-08-23' }, '2026-07-15', Date.parse('2026-07-14T12:00:00Z')));
ok('programme absent → jamais validable', !_trainingCanValidate(null, LUNDI, T0 + 3600000));
ok('jour même du lancement → validable', _trainingCanValidate(PROG_LUNDI, LUNDI, T0 + 10 * 3600000));

// Le jour même et J+1 sont dans la fenêtre.
ok('jour même 10:00 → valide', _isRattrapageValid(LUNDI, T0 + 10 * 3600000));
ok('J+1 (mardi) 10:00 → valide', _isRattrapageValid(LUNDI, T0 + 34 * 3600000));
ok('J+2 (mercredi) 10:00 → invalide', !_isRattrapageValid(LUNDI, T0 + 58 * 3600000));

// Accepte un Date autant qu'un ms epoch.
ok('accepte un objet Date', _isRattrapageValid(LUNDI, new Date(T0 + 3600000)));

// Garde-fous : une date absente/malformée ne doit JAMAIS ouvrir la fenêtre.
ok('date null → false', !_isRattrapageValid(null, T0));
ok('date vide → false', !_isRattrapageValid('', T0));
ok('date malformée → false', !_isRattrapageValid('13/07/2026', T0));
ok('date non-string → false', !_isRattrapageValid(T0, T0));
ok('now NaN → false', !_isRattrapageValid(LUNDI, NaN));
ok('now undefined → false', !_isRattrapageValid(LUNDI, undefined));

// ============================================================================
// 3) _isRattrapage — en retard MAIS encore rattrapable (badge home)
// ============================================================================
ok('jour même → PAS un rattrapage (c\'est la séance du jour)', !_isRattrapage(LUNDI, T0 + 10 * 3600000));
ok('J+1 → rattrapage', _isRattrapage(LUNDI, T0 + 30 * 3600000));
ok('24h pile → rattrapage (borne basse incluse)', _isRattrapage(LUNDI, T0 + 24 * 3600000));
ok('23h59 → pas encore un rattrapage', !_isRattrapage(LUNDI, T0 + 24 * 3600000 - 60000));
ok('48h pile → plus rattrapable', !_isRattrapage(LUNDI, T0 + 48 * 3600000));
ok('rattrapage ⊂ fenêtre valide (J+1)', _isRattrapage(LUNDI, T0 + 30 * 3600000) && _isRattrapageValid(LUNDI, T0 + 30 * 3600000));

// ============================================================================
// 4) _dateRangeForProgram
// ============================================================================
// Lun/Mer/Ven sur 2 semaines pleines (13 → 26 juillet 2026).
deq('lun/mer/ven sur 2 semaines', _dateRangeForProgram('2026-07-13', '2026-07-26', [1, 3, 5]), [
  '2026-07-13', '2026-07-15', '2026-07-17',
  '2026-07-20', '2026-07-22', '2026-07-24'
]);
// Bornes INCLUSES des deux côtés.
deq('borne start incluse (lundi = start)', _dateRangeForProgram('2026-07-13', '2026-07-13', [1]), ['2026-07-13']);
deq('borne end incluse (dimanche = end)', _dateRangeForProgram('2026-07-13', '2026-07-19', [7]), ['2026-07-19']);
// Tous les jours.
eq('7j/7 sur 14 jours → 14 dates', _dateRangeForProgram('2026-07-13', '2026-07-26', [1, 2, 3, 4, 5, 6, 7]).length, 14);
// Traversée de mois et d'année (pièges classiques d'arithmétique de dates).
deq('traversée de mois (31 juillet → 3 août)', _dateRangeForProgram('2026-07-31', '2026-08-03', [1, 5]), ['2026-07-31', '2026-08-03']);
deq('traversée d\'année (31 déc 2026 = jeudi)', _dateRangeForProgram('2026-12-28', '2027-01-03', [4, 7]), ['2026-12-31', '2027-01-03']);
// Année bissextile : 29 février 2028 est un mardi.
deq('29 février 2028 (bissextile) présent', _dateRangeForProgram('2028-02-28', '2028-03-01', [2]), ['2028-02-29']);
// Cas vides / invalides.
deq('aucun jour actif → []', _dateRangeForProgram('2026-07-13', '2026-07-26', []), []);
deq('daysActive null → []', _dateRangeForProgram('2026-07-13', '2026-07-26', null), []);
deq('end < start → [] (jamais de boucle infinie)', _dateRangeForProgram('2026-07-26', '2026-07-13', [1]), []);
deq('start invalide → []', _dateRangeForProgram('nope', '2026-07-26', [1]), []);
deq('end null → []', _dateRangeForProgram('2026-07-13', null, [1]), []);
deq('aucune occurrence dans la plage → []', _dateRangeForProgram('2026-07-13', '2026-07-14', [6, 7]), []);
// Garde-fou 5 ans : ne fige pas l'onglet sur une faute de frappe d'année.
ok('plage absurde (2026→2260) bornée à 5 ans', _dateRangeForProgram('2026-07-13', '2260-07-13', [1, 2, 3, 4, 5, 6, 7]).length <= 366 * 5);
// Les jours actifs sont bien filtrés (aucun jour hors daysActive ne sort).
ok('aucune date hors daysActive', _dateRangeForProgram('2026-07-13', '2026-08-31', [2, 4])
  .every(d => [2, 4].includes(_trainingDayOfWeek(d))));

// ============================================================================
// 5) _trainingCleanDays — normalisation ISO
// ============================================================================
deq('tri + dédup', _trainingCleanDays([5, 1, 3, 1]), [1, 3, 5]);
deq('strings (<input> renvoie du texte)', _trainingCleanDays(['1', '3']), [1, 3]);
deq('hors bornes rejetés (0 et 8)', _trainingCleanDays([0, 8, 3]), [3]);
deq('décimaux rejetés', _trainingCleanDays([1.5, 2]), [2]);
deq('non-array → []', _trainingCleanDays('lundi'), []);
deq('null → []', _trainingCleanDays(null), []);
deq('dimanche = 7 accepté', _trainingCleanDays([7]), [7]);

// ============================================================================
// 6) _trainingDayOfWeek — ISO 1=lundi … 7=dimanche
// ============================================================================
eq('lundi → 1', _trainingDayOfWeek('2026-07-13'), 1);
eq('samedi → 6', _trainingDayOfWeek('2026-07-18'), 6);
eq('dimanche → 7 (pas 0)', _trainingDayOfWeek('2026-07-19'), 7);
eq('invalide → null', _trainingDayOfWeek('nope'), null);

// ============================================================================
// 7) _completionSummary
// ============================================================================
eq('validation nue', _completionSummary({ contractLevel: 'min', pointsTotal: 10 }), 'Minimum — 10 pts');
eq('squad + post + course', _completionSummary({
  contractLevel: 'med', squadTeammateId: 'p2', postPhotoUrl: 'u', runningDistanceKm: 5.2, pointsTotal: 50
}), 'Medium · 👯 Squad · 📸 Post · 🏃 5.2 km — 50 pts');
eq('distance 0 masquée', _completionSummary({ contractLevel: 'ultra', runningDistanceKm: 0, pointsTotal: 30 }), 'Ultra — 30 pts');
eq('distance null masquée', _completionSummary({ contractLevel: 'ultra', runningDistanceKm: null, pointsTotal: 30 }), 'Ultra — 30 pts');
eq('null → chaîne vide', _completionSummary(null), '');

// ============================================================================
// 8) ROUND-TRIP PbSync — état front → row DB → état front, sur les 3 entités.
// COPIE FIDÈLE des sérialiseurs d'index.html.
// ============================================================================
function _dumpTrainingProgramRow(p) {
  return {
    id: p.id, name: p.name || '', description: p.description || null,
    start_date: p.startDate || null, end_date: p.endDate || null,
    days_active: _trainingCleanDays(p.daysActive),
    scoring_config: (p.scoringConfig && typeof p.scoringConfig === 'object' && !Array.isArray(p.scoringConfig)) ? p.scoringConfig : {},
    created_by: p.createdBy || null,
    team_tag: p.teamTag || null,
    is_active: p.isActive !== false,
    deleted_at: p.deletedAt ? new Date(p.deletedAt).toISOString() : null,
    updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : (p.createdAt ? new Date(p.createdAt).toISOString() : null)
  };
}
function _trainingProgramFromRow(r) {
  return {
    id: r.id, name: r.name || '', description: r.description || '',
    startDate: r.start_date || null, endDate: r.end_date || null,
    daysActive: _trainingCleanDays(r.days_active),
    scoringConfig: (r.scoring_config && typeof r.scoring_config === 'object' && !Array.isArray(r.scoring_config)) ? r.scoring_config : {},
    createdBy: r.created_by || null,
    teamTag: r.team_tag || null,
    isActive: r.is_active !== false,
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : (r.created_at ? Date.parse(r.created_at) : null),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null
  };
}
function _dumpTrainingSessionRow(s) {
  return {
    id: s.id, program_id: s.programId || null,
    day_of_week: (Number.isFinite(s.dayOfWeek) && s.dayOfWeek >= 1 && s.dayOfWeek <= 7) ? s.dayOfWeek : null,
    name: s.name || '', format_label: s.formatLabel || null,
    intro_text: s.introText || null, notes_recovery: s.notesRecovery || null,
    blocks: Array.isArray(s.blocks) ? s.blocks : [],
    is_template: !!s.isTemplate,
    position: Number.isFinite(s.position) ? s.position : 0,
    deleted_at: s.deletedAt ? new Date(s.deletedAt).toISOString() : null,
    updated_at: s.updatedAt ? new Date(s.updatedAt).toISOString() : (s.createdAt ? new Date(s.createdAt).toISOString() : null)
  };
}
function _trainingSessionFromRow(r) {
  return {
    id: r.id, programId: r.program_id || null,
    dayOfWeek: (Number.isFinite(r.day_of_week) && r.day_of_week >= 1 && r.day_of_week <= 7) ? r.day_of_week : null,
    name: r.name || '', formatLabel: r.format_label || '',
    introText: r.intro_text || '', notesRecovery: r.notes_recovery || '',
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    isTemplate: !!r.is_template,
    position: Number.isFinite(r.position) ? r.position : 0,
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : (r.created_at ? Date.parse(r.created_at) : null),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null
  };
}
function _dumpTrainingCompletionRow(c) {
  return {
    id: c.id, program_id: c.programId || null, session_id: c.sessionId || null,
    player_id: c.playerId || null,
    date_planned: c.datePlanned || null,
    date_completed: c.dateCompleted ? new Date(c.dateCompleted).toISOString() : null,
    contract_level: ['min', 'med', 'ultra'].includes(c.contractLevel) ? c.contractLevel : 'min',
    base_points: Number.isFinite(c.basePoints) ? c.basePoints : 0,
    squad_teammate_id: c.squadTeammateId || null,
    squad_photo_url: c.squadPhotoUrl || null,
    post_photo_url: c.postPhotoUrl || null,
    post_message: c.postMessage || null,
    running_distance_km: Number.isFinite(c.runningDistanceKm) ? c.runningDistanceKm : null,
    points_total: Number.isFinite(c.pointsTotal) ? c.pointsTotal : 0,
    notes: c.notes || null,
    deleted_at: c.deletedAt ? new Date(c.deletedAt).toISOString() : null,
    updated_at: c.updatedAt ? new Date(c.updatedAt).toISOString() : (c.createdAt ? new Date(c.createdAt).toISOString() : null)
  };
}
function _trainingCompletionFromRow(r) {
  const km = (r.running_distance_km === null || r.running_distance_km === undefined || r.running_distance_km === '')
    ? null : Number(r.running_distance_km);
  return {
    id: r.id, programId: r.program_id || null, sessionId: r.session_id || null,
    playerId: r.player_id || null,
    datePlanned: r.date_planned || null,
    dateCompleted: r.date_completed ? Date.parse(r.date_completed) : null,
    contractLevel: ['min', 'med', 'ultra'].includes(r.contract_level) ? r.contract_level : 'min',
    basePoints: Number.isFinite(r.base_points) ? r.base_points : 0,
    squadTeammateId: r.squad_teammate_id || null,
    squadPhotoUrl: r.squad_photo_url || null,
    postPhotoUrl: r.post_photo_url || null,
    postMessage: r.post_message || '',
    runningDistanceKm: Number.isFinite(km) ? km : null,
    pointsTotal: Number.isFinite(r.points_total) ? r.points_total : 0,
    notes: r.notes || '',
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : (r.created_at ? Date.parse(r.created_at) : null),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null
  };
}

const NOW = Date.parse('2026-07-15T08:30:00Z');

// --- Programme ---
const prog = {
  id: 'x1', name: 'Prépa été', description: 'Bloc 1',
  startDate: '2026-07-13', endDate: '2026-08-23', daysActive: [1, 3, 5],
  scoringConfig: { points: { min: 10, med: 20, ultra: 30 }, squad_multiplier: 2, post_bonus: 10, remind_hour: 9 },
  createdBy: 'admin', teamTag: 'e1', isActive: true,
  createdAt: NOW, updatedAt: NOW, deletedAt: null
};
const progRT = _trainingProgramFromRow({ ..._dumpTrainingProgramRow(prog), created_at: new Date(NOW).toISOString() });
deq('round-trip programme', progRT, prog);
// Les dates restent des STRINGS 'YYYY-MM-DD' : un ms epoch décalerait le jour.
eq('round-trip : startDate reste une string', progRT.startDate, '2026-07-13');
eq('round-trip : daysActive préservés', progRT.daysActive.join(','), '1,3,5');
deq('round-trip : scoringConfig jsonb passthrough', progRT.scoringConfig, prog.scoringConfig);
// days_active part bien en int[] (et non en strings) vers la colonne integer[].
ok('dump : days_active = int[]', _dumpTrainingProgramRow({ ...prog, daysActive: ['1', '3'] }).days_active.every(Number.isInteger));

// --- Session (avec blocs 3 niveaux + drill lié + track_distance) ---
const sess = {
  id: 'x2', programId: 'x1', dayOfWeek: 1, name: 'Lundi — Bas du corps',
  formatLabel: '45 min', introText: 'On y va', notesRecovery: 'Étirements 10 min',
  blocks: [
    { id: 'b1', type: 'warmup', name: 'Échauffement', instructions: 'Mobilité', track_distance: false,
      levels: { min: { text: '5 min', drill_id: null }, med: { text: '8 min', drill_id: 'xd1' }, ultra: { text: '12 min', drill_id: null } } },
    { id: 'b2', type: 'course', name: 'Course', instructions: 'Allure libre', track_distance: true,
      levels: { min: { text: '2 km', drill_id: null }, med: { text: '4 km', drill_id: null }, ultra: { text: '6 km', drill_id: null } } }
  ],
  isTemplate: false, position: 0, createdAt: NOW, updatedAt: NOW, deletedAt: null
};
const sessRT = _trainingSessionFromRow({ ..._dumpTrainingSessionRow(sess), created_at: new Date(NOW).toISOString() });
deq('round-trip session', sessRT, sess);
deq('round-trip : blocs jsonb passthrough (3 niveaux + drill_id + track_distance)', sessRT.blocks, sess.blocks);
eq('round-trip : drill_id lié préservé', sessRT.blocks[0].levels.med.drill_id, 'xd1');
eq('round-trip : track_distance préservé', sessRT.blocks[1].track_distance, true);
// Modèle réutilisable : ni programme ni jour.
const tpl = { ...sess, id: 'x3', programId: null, dayOfWeek: null, isTemplate: true };
const tplRT = _trainingSessionFromRow({ ..._dumpTrainingSessionRow(tpl), created_at: new Date(NOW).toISOString() });
deq('round-trip modèle (is_template, sans programme ni jour)', tplRT, tpl);
eq('modèle : day_of_week = null en base', _dumpTrainingSessionRow(tpl).day_of_week, null);

// --- Validation ---
const comp = {
  id: 'x4', programId: 'x1', sessionId: 'x2', playerId: 'p7',
  datePlanned: '2026-07-13', dateCompleted: NOW, contractLevel: 'med',
  basePoints: 20, squadTeammateId: 'p3', squadPhotoUrl: 'https://s/squad.jpg',
  postPhotoUrl: 'https://s/post.jpg', postMessage: 'Séance faite 💪',
  runningDistanceKm: 5.2, pointsTotal: 50, notes: '',
  createdAt: NOW, updatedAt: NOW, deletedAt: null
};
const compRT = _trainingCompletionFromRow({ ..._dumpTrainingCompletionRow(comp), created_at: new Date(NOW).toISOString() });
deq('round-trip validation', compRT, comp);
eq('round-trip : points_total figé à 50', compRT.pointsTotal, 50);
eq('round-trip : base_points figé (barème au moment de la validation)', compRT.basePoints, 20);
eq('round-trip : datePlanned reste une string', compRT.datePlanned, '2026-07-13');

// numeric : mesuré en NUMBER sur ce stack (smoke PR #148), mais sérialisable en
// STRING par d'autres versions du driver / à forte précision. Les deux cas doivent
// donner 5.2 — sans le Number(), la variante string serait perdue en silence.
eq('numeric renvoyé en number (5.2) → 5.2', _trainingCompletionFromRow({ ..._dumpTrainingCompletionRow(comp), running_distance_km: 5.2 }).runningDistanceKm, 5.2);
eq('numeric renvoyé en string (\'5.20\') → number 5.2', _trainingCompletionFromRow({ ..._dumpTrainingCompletionRow(comp), running_distance_km: '5.20' }).runningDistanceKm, 5.2);
eq('numeric null → null', _trainingCompletionFromRow({ ..._dumpTrainingCompletionRow(comp), running_distance_km: null }).runningDistanceKm, null);
eq('numeric \'\' → null', _trainingCompletionFromRow({ ..._dumpTrainingCompletionRow(comp), running_distance_km: '' }).runningDistanceKm, null);

// Cohérence bout-en-bout : le total stocké = celui recalculé par la fonction pure.
eq('cohérence _computePoints ↔ row stockée (med+squad+post = 50)',
  _computePoints({ level: comp.contractLevel, hasSquad: !!comp.squadTeammateId, hasPost: !!comp.postPhotoUrl, config: prog.scoringConfig }).total,
  compRT.pointsTotal);

// Soft-delete : deleted_at fait l'aller-retour (sinon la ligne ressusciterait).
eq('round-trip deletedAt', _trainingCompletionFromRow(_dumpTrainingCompletionRow({ ...comp, deletedAt: NOW })).deletedAt, NOW);
eq('dump deleted_at null quand vivant', _dumpTrainingCompletionRow(comp).deleted_at, null);

// LWW : updated_at est toujours peuplé, même si seul createdAt existe (sinon la
// ligne serait toujours perdante face au remote et jamais poussée).
eq('dump : updated_at retombe sur createdAt', _dumpTrainingProgramRow({ id: 'x9', createdAt: NOW, updatedAt: null }).updated_at, new Date(NOW).toISOString());
eq('dump session : updated_at retombe sur createdAt', _dumpTrainingSessionRow({ id: 'x9', createdAt: NOW, updatedAt: null }).updated_at, new Date(NOW).toISOString());
eq('dump validation : updated_at retombe sur createdAt', _dumpTrainingCompletionRow({ id: 'x9', createdAt: NOW, updatedAt: null }).updated_at, new Date(NOW).toISOString());

// Anti-wipe : heuristique des ids locaux non flushés (pendingLocal des apply()).
const _pending = (arr, remoteIds) => arr.filter(x => !remoteIds.has(x.id) && typeof x.id === 'string' && x.id.startsWith('x'));
deq('anti-wipe : id local \'x…\' absent du remote est conservé',
  _pending([{ id: 'x1' }, { id: 'abc' }], new Set([])).map(x => x.id), ['x1']);
deq('anti-wipe : id local déjà présent en remote n\'est pas dupliqué',
  _pending([{ id: 'x1' }], new Set(['x1'])).map(x => x.id), []);

console.log(`\n✓ ${passed} assertions passées — prépa full package (scoring figé (base×mult)+bonus, fenêtre H-24 → J+48h depuis minuit UTC, dates prévues, round-trip PbSync ×3) OK`);
