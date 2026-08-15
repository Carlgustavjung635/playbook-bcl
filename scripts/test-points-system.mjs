// Test SYSTÈME DE POINTS GÉNÉRAL (v.126) — barème, tarif d'un défi, fusion
// dérivé/stocké, série journalière.
//
// Extrait FIDÈLE des fonctions pures d'index.html. Toute modif du cœur pur
// (pointsRules / challengePointsReward / _pointsKey / _pointsMergeEntries /
// _pointsDailySeries) doit être reportée ICI DANS LE MÊME COMMIT.
//
// CE QUE CE TEST VERROUILLE, ET POURQUOI :
//
//   1. LE 0 QUI VEUT DIRE ZÉRO. Trois endroits distincts pouvaient transformer
//      un 0 légitime en défaut par un `||` de trop : le tarif d'un défi (« ce
//      défi ne rapporte rien »), une clé de barème réglée à 0, et une surcharge
//      coach à 0 (« cette présence-là ne compte pas »). Les trois sont testés
//      séparément, parce que les trois se réécrivent séparément.
//
//   2. LA SURCHARGE REMPLACE, ELLE NE S'AJOUTE PAS. C'est LA règle qui rend le
//      ledger sûr : sans elle, corriger un gain le compterait deux fois. Le
//      test le vérifie sur une valeur DIFFÉRENTE de l'originale, pour qu'un
//      « ça marche » accidentel (les deux à la même valeur) soit impossible.
//
//   3. UNE SURCHARGE NE VAUT QUE POUR SA CLÉ. Deux présences du même
//      entraînement à des dates différentes ont deux clés : corriger l'une ne
//      doit pas effacer l'autre. Le jeu de données en contient exprès deux.
//
//   4. LE SOCLE DE LA COURBE. Les gains antérieurs à la fenêtre de 7 jours
//      doivent être dans la valeur de DÉPART, sinon la courbe repart de zéro
//      chaque semaine et affiche une chute là où il n'y a qu'un bord. Un gain
//      SANS horodatage doit y être aussi : il pèse dans le total, il ne
//      prétend pas à un jour.
import assert from 'node:assert';
let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l} (attendu ${b}, reçu ${a})`); passed++; }

// ============================================================================
// COPIE FIDÈLE — cœur pur (doit rester identique à index.html)
// ============================================================================
const POINTS_SOURCES = [
  { id: 'training_completion', label: 'Prépa physique',       short: 'Prépa',    emoji: '💪', color: '#22c55e' },
  { id: 'training_attendance', label: 'Présence entraînement', short: 'Présence', emoji: '📋', color: '#3b82f6' },
  { id: 'challenge_score',     label: 'Défi',                  short: 'Défi',     emoji: '🏆', color: '#f59e0b' },
  { id: 'ardoise_done',        label: 'Ardoise',               short: 'Ardoise',  emoji: '🍽️', color: '#ef4444' },
  { id: 'gage_done',           label: 'Gage',                  short: 'Gage',     emoji: '🎁', color: '#a855f7' },
  { id: 'manual_adjustment',   label: 'Ajustement coach',      short: 'Coach',    emoji: '✍️', color: '#94a3b8' },
];
function pointsSourceMeta(id) {
  return POINTS_SOURCES.find(s => s.id === id)
    || { id: id || '?', label: 'Autre', short: 'Autre', emoji: '•', color: 'var(--ink-3)' };
}

const POINTS_DEFAULT_RULES = {
  attendancePoints: 10,
  challengeDefaultPoints: 5,
  gageDonePoints: 15,
};
// `state` injecté (dans index.html c'est le global).
function pointsRules(state) {
  const raw = (state.pointsRules && typeof state.pointsRules === 'object') ? state.pointsRules : {};
  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  return {
    attendancePoints: num(raw.attendancePoints, POINTS_DEFAULT_RULES.attendancePoints),
    challengeDefaultPoints: num(raw.challengeDefaultPoints, POINTS_DEFAULT_RULES.challengeDefaultPoints),
    gageDonePoints: num(raw.gageDonePoints, POINTS_DEFAULT_RULES.gageDonePoints),
  };
}
function challengePointsReward(c, state) {
  if (!c) return 0;
  if (c.pointsReward == null || !Number.isFinite(Number(c.pointsReward))) return pointsRules(state).challengeDefaultPoints;
  return Math.min(1000, Math.max(0, Math.round(Number(c.pointsReward))));
}

function _pointsKey(sourceType, sourceId) { return sourceType + '|' + (sourceId || ''); }

function _pointsMergeEntries(derived, storedRows, metaOf) {
  const stored = (storedRows || []).filter(Boolean);
  const overridden = new Set(stored.filter(e => e.sourceId).map(e => _pointsKey(e.sourceType, e.sourceId)));
  const out = (derived || []).filter(d => !overridden.has(d.key));
  stored.forEach(e => {
    const meta = (metaOf || pointsSourceMeta)(e.sourceType);
    out.push({
      key: _pointsKey(e.sourceType, e.sourceId || e.id),
      sourceType: e.sourceType, sourceId: e.sourceId,
      delta: Number(e.pointsDelta) || 0,
      at: e.createdAt || e.updatedAt || null,
      label: e.reason || meta.label,
      detail: e.sourceId ? 'Corrigé par le coach' : '',
      stored: true, ledgerId: e.id, reason: e.reason || ''
    });
  });
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

function _pointsDailySeries(entries, days, todayMidnightMs) {
  days = Math.max(2, Math.min(90, days || 7));
  const startMs = todayMidnightMs - (days - 1) * 86400000;
  const endMs = startMs + days * 86400000;
  let running = (entries || []).filter(e => e.at == null || e.at < startMs || e.at >= endMs)
    .reduce((s, e) => s + (Number(e.delta) || 0), 0);
  const out = [];
  for (let i = 0; i < days; i++) {
    const dayStart = startMs + i * 86400000;
    const gained = (entries || [])
      .filter(e => e.at != null && e.at >= dayStart && e.at < dayStart + 86400000)
      .reduce((s, e) => s + (Number(e.delta) || 0), 0);
    running += gained;
    out.push({ dayStart, gained, total: running });
  }
  return out;
}

const total = list => list.reduce((s, e) => s + (Number(e.delta) || 0), 0);

// ============================================================================
// 1) LE BARÈME — défauts clé par clé, et le 0 qui veut dire zéro
// ============================================================================
{
  const r = pointsRules({});
  eq('barème vide → présence 10', r.attendancePoints, 10);
  eq('barème vide → défi 5', r.challengeDefaultPoints, 5);
  eq('barème vide → gage 15', r.gageDonePoints, 15);
}
{
  // Une SEULE clé réglée : les autres gardent leur défaut. C'est ce qui permet
  // d'ajouter une clé de barème sans migration — une colonne encore absente
  // rend la clé indéfinie, elle ne doit pas invalider tout le barème.
  const r = pointsRules({ pointsRules: { attendancePoints: 25 } });
  eq('clé réglée', r.attendancePoints, 25);
  eq('clé absente → défaut préservé', r.gageDonePoints, 15);
}
{
  // « Les présences ne rapportent plus rien » est un réglage LÉGITIME.
  const r = pointsRules({ pointsRules: { attendancePoints: 0 } });
  eq('présence à 0 reste 0 (pas le défaut)', r.attendancePoints, 0);
}
{
  // Valeur illisible (champ vidé, colonne texte) → défaut, jamais NaN : un NaN
  // se propagerait dans TOUS les totaux de l'app.
  const r = pointsRules({ pointsRules: { attendancePoints: 'abc' } });
  eq('valeur illisible → défaut', r.attendancePoints, 10);
}

// ============================================================================
// 2) LE TARIF D'UN DÉFI
// ============================================================================
{
  eq('défi sans tarif → défaut du barème', challengePointsReward({ id: 'c1' }, {}), 5);
  eq('défi sans tarif → défaut RÉGLÉ', challengePointsReward({ id: 'c1' }, { pointsRules: { challengeDefaultPoints: 8 } }), 8);
  eq('tarif explicite', challengePointsReward({ id: 'c1', pointsReward: 30 }, {}), 30);
  // LE piège : `|| 5` aurait rendu 5 ici, et un défi « qui ne rapporte rien »
  // se serait mis à rapporter dès le premier rendu.
  eq('tarif 0 reste 0', challengePointsReward({ id: 'c1', pointsReward: 0 }, {}), 0);
  eq('tarif borné haut', challengePointsReward({ id: 'c1', pointsReward: 99999 }, {}), 1000);
  eq('tarif négatif borné à 0', challengePointsReward({ id: 'c1', pointsReward: -10 }, {}), 0);
  eq('null → défaut', challengePointsReward({ id: 'c1', pointsReward: null }, {}), 5);
}

// ============================================================================
// 3) LA FUSION dérivé ↔ stocké
// ============================================================================
// Jeu de données : deux présences au MÊME entraînement récurrent (deux dates,
// donc deux clés), une séance de prépa, un défi.
const DERIVED = [
  { key: _pointsKey('training_attendance', 'cv1|2026-08-03'), sourceType: 'training_attendance', sourceId: 'cv1|2026-08-03', delta: 10, at: 1000, label: 'Entraînement', stored: false },
  { key: _pointsKey('training_attendance', 'cv1|2026-08-10'), sourceType: 'training_attendance', sourceId: 'cv1|2026-08-10', delta: 10, at: 2000, label: 'Entraînement', stored: false },
  { key: _pointsKey('training_completion', 'tc1'),            sourceType: 'training_completion', sourceId: 'tc1',            delta: 40, at: 3000, label: 'Séance validée', stored: false },
  { key: _pointsKey('challenge_score', 'ch1'),                sourceType: 'challenge_score',     sourceId: 'ch1',            delta: 5,  at: 4000, label: 'Free throws', stored: false },
];

{
  const merged = _pointsMergeEntries(DERIVED, []);
  eq('sans ledger : rien n\'est perdu', merged.length, 4);
  eq('sans ledger : total dérivé', total(merged), 65);
}
{
  // Ajustement manuel : PAS de sourceId → il s'AJOUTE, il ne remplace rien.
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x1', sourceType: 'manual_adjustment', sourceId: null, pointsDelta: 20, reason: 'Coup de main au rangement', createdAt: 5000 }
  ]);
  eq('ajustement : une entrée de plus', merged.length, 5);
  eq('ajustement : additionné', total(merged), 85);
  eq('ajustement : le motif fait le libellé', merged[0].label, 'Coup de main au rangement');
}
{
  // Ajustement NÉGATIF : un malus doit se soustraire, pas être ignoré.
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x2', sourceType: 'manual_adjustment', sourceId: null, pointsDelta: -15, reason: 'Retard répété', createdAt: 5000 }
  ]);
  eq('malus soustrait', total(merged), 50);
}
{
  // SURCHARGE : même (sourceType, sourceId) qu'un dérivé → REMPLACE.
  // 25 ≠ 10 exprès : si la surcharge s'ajoutait au lieu de remplacer, on
  // lirait 90 et pas 80.
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x3', sourceType: 'training_attendance', sourceId: 'cv1|2026-08-03', pointsDelta: 25, reason: 'Séance double', createdAt: 6000 }
  ]);
  eq('surcharge : pas d\'entrée en plus', merged.length, 4);
  eq('surcharge : remplace (65 - 10 + 25)', total(merged), 80);
  ok('surcharge : marquée comme stockée', merged.some(e => e.stored && e.sourceId === 'cv1|2026-08-03'));
  // L'AUTRE présence du même entraînement n'a pas bougé.
  const other = merged.find(e => e.sourceId === 'cv1|2026-08-10');
  ok('surcharge : l\'autre date intacte', other && other.delta === 10 && !other.stored);
}
{
  // SURCHARGE À ZÉRO : « cette présence-là ne compte pas ». Le piège serait de
  // filtrer les lignes à 0 en amont — le gain dérivé reviendrait alors.
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x4', sourceType: 'training_attendance', sourceId: 'cv1|2026-08-03', pointsDelta: 0, reason: 'Arrivée après la fin', createdAt: 6000 }
  ]);
  eq('surcharge à 0 : annule bien le gain', total(merged), 55);
}
{
  // La clé porte AUSSI le type : même id, autre source → aucune interférence.
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x5', sourceType: 'ardoise_done', sourceId: 'tc1', pointsDelta: 20, reason: '', createdAt: 6000 }
  ]);
  eq('type différent : rien n\'est remplacé', merged.length, 5);
  eq('type différent : tout s\'additionne', total(merged), 85);
}
{
  // Les points d'un module qui n'a AUCUNE dérivation ici (ardoise) entrent par
  // le ledger et comptent comme les autres. C'est le contrat de reprise avec le
  // chantier Ardoise : il insère, tout le reste marche.
  const merged = _pointsMergeEntries([], [
    { id: 'x6', sourceType: 'ardoise_done', sourceId: 'as1', pointsDelta: 20, reason: 'Ardoise du 12/08', createdAt: 7000 }
  ]);
  eq('ardoise seule : comptée', total(merged), 20);
  eq('ardoise : libellé', merged[0].label, 'Ardoise du 12/08');
}
{
  // Tri : le plus récent en tête (c'est une timeline).
  const merged = _pointsMergeEntries(DERIVED, [
    { id: 'x7', sourceType: 'manual_adjustment', sourceId: null, pointsDelta: 1, reason: 'Récent', createdAt: 99999 }
  ]);
  eq('tri antéchronologique', merged[0].label, 'Récent');
  eq('… et le plus ancien en queue', merged[merged.length - 1].at, 1000);
}

// ============================================================================
// 4) LA SÉRIE JOURNALIÈRE
// ============================================================================
const DAY = 86400000;
const TODAY = Date.UTC(2026, 7, 15); // jour de référence figé (pas de Date.now())
{
  const entries = [
    { delta: 100, at: TODAY - 30 * DAY },  // bien avant la fenêtre → socle
    { delta: 10,  at: TODAY - 6 * DAY },   // premier jour de la fenêtre
    { delta: 40,  at: TODAY - 1 * DAY },   // hier
    { delta: 5,   at: TODAY + 3600000 },   // aujourd'hui
  ];
  const s = _pointsDailySeries(entries, 7, TODAY);
  eq('7 points de série', s.length, 7);
  eq('socle : l\'antérieur est dans le départ', s[0].total, 110);
  eq('jour 1 : gain isolé', s[0].gained, 10);
  eq('jours creux : gain nul', s[1].gained, 0);
  eq('jours creux : total STABLE (pas de chute)', s[1].total, 110);
  eq('hier', s[5].total, 150);
  eq('aujourd\'hui', s[6].total, 155);
  eq('fin de série == total général', s[6].total, entries.reduce((a, e) => a + e.delta, 0));
}
{
  // Un gain SANS horodatage (défi sans date de fin) : compté dans le socle,
  // jamais perdu. Le total final doit rester juste.
  const s = _pointsDailySeries([{ delta: 5, at: null }, { delta: 10, at: TODAY }], 7, TODAY);
  eq('sans horodatage : dans le socle', s[0].total, 5);
  eq('sans horodatage : total final juste', s[6].total, 15);
}
{
  // UN GAIN DANS LE FUTUR. Pas un cas théorique : un défi encore ouvert est daté
  // de sa date de FIN, donc à venir. Il doit rejoindre le socle comme les autres
  // hors-fenêtre — sinon la courbe termine SOUS le total affiché juste au-dessus
  // d'elle, ce qui est pire que pas de courbe. Trouvé par le test d'intégration
  // sur le code réel, pas à la lecture.
  const s = _pointsDailySeries([
    { delta: 5,  at: TODAY + 20 * DAY },  // défi qui se termine dans 3 semaines
    { delta: 10, at: TODAY },
    { delta: 7,  at: TODAY - 40 * DAY },
  ], 7, TODAY);
  eq('futur : dans le socle', s[0].total, 12);
  eq('INVARIANT : le dernier point == le total général', s[6].total, 22);
}
{
  // Fenêtre bornée : une demande absurde ne doit pas produire 100 000 itérations,
  // et une courbe d'un seul point n'est pas une courbe.
  eq('bornage bas', _pointsDailySeries([], 1, TODAY).length, 2);
  eq('bornage haut', _pointsDailySeries([], 9999, TODAY).length, 90);
  // 0 et undefined tombent tous deux sur le défaut 7 — ici le `||` est VOULU :
  // « zéro jour » n'a pas de sens, contrairement à « zéro point ».
  eq('0 jour → défaut 7', _pointsDailySeries([], 0, TODAY).length, 7);
  eq('undefined → défaut 7', _pointsDailySeries([], undefined, TODAY).length, 7);
}

console.log(`✅ test-points-system : ${passed} assertions OK`);
