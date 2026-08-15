// Test DÉFIS — éditer un score APRÈS le chrono (timed / countdown_score / series).
// Extrait FIDÈLE de _challengeSeriesOf / _recomputeChallengeAggregate /
// _seriesValueField / _editChallengeSeries / _cdCount (index.html).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');

let passed = 0;
function ok(l, cnd) { assert.ok(cnd, '✗ ' + l); passed++; }

// ---------- copies fidèles ----------
function _challengeSeriesOf(c, pid) {
  return ((((c || {}).series || {})[pid]) || []).filter(s => !s.deletedAt)
    .slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function _recomputeChallengeAggregate(c, pid) {
  if (!c) return 0;
  const arr = _challengeSeriesOf(c, pid);
  if (!arr.length) return 0;
  const agg = ['average', 'best', 'sum', 'last'].includes(c.aggregate) ? c.aggregate : 'average';
  if (c.mode === 'timed') {
    const durs = arr.map(s => Number(s.durationMs) || 0).filter(v => v > 0);
    if (!durs.length) return 0;
    if (agg === 'average') return Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
    if (agg === 'sum') return durs.reduce((a, b) => a + b, 0);
    if (agg === 'last') return durs[durs.length - 1];
    return Math.min(...durs);
  }
  const size = Number.isFinite(c.seriesSize) && c.seriesSize > 0 ? c.seriesSize : null;
  const vals = arr.map(s => {
    const made = Number(s.made) || 0;
    const att = Number.isFinite(s.attempts) && s.attempts > 0 ? s.attempts : size;
    if (size && att && att !== size) return (made / att) * size;
    return made;
  });
  if (agg === 'best') return Math.max(...vals);
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'last') return vals[vals.length - 1];
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}
function _seriesValueField(c) { return (c && c.mode === 'timed') ? 'durationMs' : 'made'; }
function _seriesValueOf(c, s) { const v = (s || {})[_seriesValueField(c)]; return Number.isFinite(v) ? v : 0; }
// _editChallengeSeries sans les effets de bord (persist/flush/render/notif).
function _editChallengeSeries(c, pid, sid, nextValue, actorId) {
  if (!c || c.autoCount) return false;
  const s = _challengeSeriesOf(c, pid).find(x => x.id === sid); if (!s) return false;
  const field = _seriesValueField(c);
  let val = Math.round(Number(nextValue));
  if (!Number.isFinite(val) || val < 0) return false;
  if (field === 'made' && Number.isFinite(c.seriesSize) && c.seriesSize > 0 && c.mode === 'series') val = Math.min(val, c.seriesSize);
  const before = _seriesValueOf(c, s);
  if (val === before) return true;
  s[field] = val;
  s.previousScore = before;
  s.editedBy = actorId;
  s.editedAt = 1770000000000;
  c.scores = c.scores || {}; c.scores[pid] = _recomputeChallengeAggregate(c, pid);
  return true;
}

// ---------- 1. COUNTDOWN : le panier parti avant le buzzer compte ----------
{
  const c = {
    mode: 'countdown_score', aggregate: 'best', metric: 'paniers', countdownMs: 60000,
    series: { p1: [{ id: 'x1', made: 11, durationMs: 60000, createdAt: 10 }] }, scores: { p1: 11 }
  };
  ok('countdown : agrégat initial = 11', _recomputeChallengeAggregate(c, 'p1') === 11);
  _editChallengeSeries(c, 'p1', 'x1', 12, 'p1'); // le dernier tir était en l'air
  ok('countdown : le score monte à 12', c.series.p1[0].made === 12);
  ok('countdown : agrégat recalculé à 12', c.scores.p1 === 12);
  ok('countdown : previousScore = 11', c.series.p1[0].previousScore === 11);
  ok('countdown : editedBy tracé', c.series.p1[0].editedBy === 'p1');
  ok('countdown : editedAt tracé', !!c.series.p1[0].editedAt);
}

// ---------- 2. COUNTDOWN : total saisi après coup (chrono = minuteur) ----------
{
  const c = {
    mode: 'countdown_score', aggregate: 'sum', metric: 'paniers',
    series: { p1: [{ id: 'x1', made: 0, durationMs: 120000, createdAt: 10 }] }, scores: { p1: 0 }
  };
  _editChallengeSeries(c, 'p1', 'x1', 37, 'coach');
  ok('countdown : total 0 → 37 après coup', c.series.p1[0].made === 37);
  ok('countdown : agrégat sum suit', c.scores.p1 === 37);
  ok('countdown : édition coach tracée', c.series.p1[0].editedBy === 'coach');
}

// ---------- 3. TIMED : correction du temps + recalcul du record ----------
{
  const c = {
    mode: 'timed', aggregate: 'best', lowerIsBetter: true,
    series: { p1: [
      { id: 'x1', durationMs: 42000, createdAt: 10 },
      { id: 'x2', durationMs: 39500, createdAt: 20 }
    ] }, scores: { p1: 39500 }
  };
  ok('timed : record initial = 39500ms', _recomputeChallengeAggregate(c, 'p1') === 39500);
  _editChallengeSeries(c, 'p1', 'x2', 41200, 'p1'); // chrono coupé trop tôt
  ok('timed : le run édité vaut 41200ms', c.series.p1[1].durationMs === 41200);
  ok('timed : le record redevient 41200 (toujours le meilleur)', c.scores.p1 === 41200);
  ok('timed : previousScore garde les ms d\'avant', c.series.p1[1].previousScore === 39500);
  _editChallengeSeries(c, 'p1', 'x1', 38000, 'p1');
  ok('timed : le record bascule sur le run corrigé', c.scores.p1 === 38000);
}

// ---------- 4. SERIES : clamp à seriesSize, et pas d'audit sans changement ----------
{
  const c = {
    mode: 'series', seriesSize: 25, aggregate: 'average',
    series: { p1: [{ id: 'x1', made: 18, attempts: 25, createdAt: 10 }] }, scores: { p1: 18 }
  };
  _editChallengeSeries(c, 'p1', 'x1', 99, 'p1');
  ok('series : valeur clampée à seriesSize (25)', c.series.p1[0].made === 25);
  const stamp = c.series.p1[0].editedAt;
  c.series.p1[0].editedBy = 'sentinelle';
  _editChallengeSeries(c, 'p1', 'x1', 25, 'p1'); // même valeur → aucune écriture
  ok('series : une non-modification n\'écrit aucun audit', c.series.p1[0].editedBy === 'sentinelle' && c.series.p1[0].editedAt === stamp);
}

// ---------- 5. Une tentative supprimée n'est plus éditable ----------
{
  const c = {
    mode: 'countdown_score', aggregate: 'best',
    series: { p1: [{ id: 'x1', made: 5, createdAt: 10, deletedAt: 99 }] }, scores: { p1: 0 }
  };
  ok('supprimée : édition refusée', _editChallengeSeries(c, 'p1', 'x1', 12, 'p1') === false);
  ok('supprimée : valeur intacte', c.series.p1[0].made === 5);
}

// ---------- 6. Un défi auto-compté reste non éditable ----------
{
  const c = { mode: 'countdown_score', autoCount: true, series: { p1: [{ id: 'x1', made: 5, createdAt: 10 }] }, scores: { p1: 5 } };
  ok('autoCount : édition refusée', _editChallengeSeries(c, 'p1', 'x1', 9, 'p1') === false);
}

// ---------- 7. Gardes statiques sur index.html ----------
{
  ok('le compteur du rebours n\'est plus verrouillé par t.finished',
    /function _cdCount\(d\) \{\s*\n\s*const t = window\._cdChrono; if \(!t\) return;/.test(html));
  ok('saisie directe du total après le buzzer (_cdSetTotal)', html.includes('function _cdSetTotal()') && html.includes('id="cd-total"'));
  ok('le récap du rebours se met à jour au clic (+/−)', html.includes('id="cd-recap-made"'));
  ok('bouton ✏ présent sur les 3 historiques',
    (html.match(/onclick="openChallengeEntryEdit\('/g) || []).length >= 3);
  ok('modale d\'édition avec pas rapides et saisie manuelle',
    html.includes('function openChallengeEntryEdit(') && html.includes('function _ceStep(') && html.includes('function _ceSave('));
  ok('les 3 colonnes d\'audit sont sérialisées vers la base',
    html.includes('edited_by: s.editedBy || null') && html.includes('edited_at: s.editedAt ?') && html.includes('previous_score: Number.isFinite(s.previousScore)'));
  ok('les 3 colonnes d\'audit sont relues depuis la base',
    html.includes('editedBy: r.edited_by || null') && html.includes('editedAt: r.edited_at ?') && html.includes('previousScore: Number.isFinite(r.previous_score)'));
  ok('la trace d\'édition est affichée dans l\'historique',
    html.includes('function _seriesEditedHtml(') && (html.match(/_seriesEditedHtml\(c, s\)/g) || []).length >= 3);
  ok('l\'édition est réservée aux rôles joueuse/coach',
    /function _editChallengeSeries[\s\S]{0,400}state\.auth\.role !== 'player' && state\.auth\.role !== 'coach'/.test(html));
  ok('la migration d\'audit existe',
    readFileSync(join(repoRoot, 'supabase/migrations/20260813_001_challenge_series_edit_audit.sql'), 'utf8').includes('previous_score'));
}

console.log(`✓ ${passed} assertions OK — édition rétroactive des scores de défi`);
