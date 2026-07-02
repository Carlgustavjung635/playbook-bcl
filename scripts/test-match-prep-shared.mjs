// Test du partage de la préparation match aux joueuses (prepShared).
// Coach toggle → joueuse voit plays liés + notes + vidéos de prépa, JAMAIS le
// coachNote par play (tactique privée). Rétrocompat : prepShared défaut false.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const src = [extractFn('getMatchPlayLinks'), extractFn('renderMatchPrepForPlayer')].join('\n\n');
function renderForPlayer(state, m) {
  return new Function('state', 'esc', 'getCatShort', 'getCatLabel', 'parseVideo', 'viewFocusVideo',
    src + '\nreturn renderMatchPrepForPlayer;'
  )(state, s => String(s), () => 'O', () => 'Offensif', () => ({ thumb: '' }), () => {})(m);
}
function baseState(role = 'player') {
  return {
    auth: { role, playerId: 'pl' },
    plays: [{ id: 'p1', title: 'Horns', cat: 'off', images: [] }, { id: 'p2', title: 'Zone 2-3', cat: 'def', images: [] }],
    matchPlayLinks: [
      { matchId: 'm1', playId: 'p1', position: 0, coachNote: 'SECRET_TACTIQUE_COACH' },
      { matchId: 'm1', playId: 'p2', position: 1, coachNote: 'autre note privée' },
    ],
  };
}

console.log('SCÉNARIO 1 — gating : rien si non partagé ou si coach');
t('coach → "" (le coach a déjà sa vue complète)', () => {
  assert.strictEqual(renderForPlayer(baseState('coach'), { id: 'm1', prepShared: true, prepComment: 'x', prepVideos: [] }), '');
});
t('joueuse + prepShared=false → "" (rétrocompat privé)', () => {
  assert.strictEqual(renderForPlayer(baseState(), { id: 'm1', prepShared: false, prepComment: 'x', prepVideos: [] }), '');
});
t('joueuse + prepShared=true mais prépa vide → "" (pas de section vide)', () => {
  const s = baseState(); s.matchPlayLinks = [];
  assert.strictEqual(renderForPlayer(s, { id: 'm1', prepShared: true, prepComment: '', prepVideos: [] }), '');
});

console.log('SCÉNARIO 2 — prepShared=true : plays + notes + vidéos visibles');
{
  const out = renderForPlayer(baseState(), { id: 'm1', prepShared: true, prepComment: 'Focus sur leur zone', prepVideos: [{ url: 'https://youtu.be/abc', label: 'Scouting' }] });
  t('les plays liés sont affichés (titre)', () => { assert.ok(out.includes('Horns') && out.includes('Zone 2-3')); });
  t('les notes de prépa (prepComment) sont affichées', () => assert.ok(out.includes('Focus sur leur zone')));
  t('la vidéo de prépa (label) est affichée', () => assert.ok(out.includes('Scouting')));
  t('mention « Partagé par ton coach »', () => assert.ok(/Partagé par ton coach/.test(out)));
}

console.log('SCÉNARIO 3 — SÉCURITÉ : coachNote par play JAMAIS exposé');
{
  const out = renderForPlayer(baseState(), { id: 'm1', prepShared: true, prepComment: '', prepVideos: [] });
  t('aucun coachNote tactique dans le rendu joueuse', () => {
    assert.ok(!out.includes('SECRET_TACTIQUE_COACH'));
    assert.ok(!out.includes('autre note privée'));
  });
  t('le code de renderMatchPrepForPlayer ne référence jamais coachNote', () => {
    assert.ok(!/coachNote/.test(extractFn('renderMatchPrepForPlayer')));
  });
}

console.log('SCÉNARIO 4 — toggle coach + persistance');
{
  const src2 = extractFn('toggleMatchPrepShared');
  const state = { auth: { role: 'coach' }, matches: [{ id: 'm1', prepShared: false }] };
  let persisted = 0, toasts = [];
  const fn = new Function('state', 'persist', 'render', 'showToast', src2 + '\nreturn toggleMatchPrepShared;')(state, () => persisted++, () => {}, m => toasts.push(m));
  fn('m1');
  t('toggle ON : prepShared=true + toast + persist', () => {
    assert.strictEqual(state.matches[0].prepShared, true);
    assert.ok(persisted >= 1 && toasts.some(x => /partagée/.test(x)));
  });
  fn('m1');
  t('toggle OFF : prepShared=false (re-privatisation)', () => assert.strictEqual(state.matches[0].prepShared, false));
  // gating : joueuse ne peut pas toggler
  const ps = { auth: { role: 'player' }, matches: [{ id: 'm1', prepShared: false }] };
  new Function('state', 'persist', 'render', 'showToast', src2 + '\nreturn toggleMatchPrepShared;')(ps, () => {}, () => {}, () => {})('m1');
  t('joueuse → toggle no-op', () => assert.strictEqual(ps.matches[0].prepShared, false));
}

console.log('SCÉNARIO 5 — câblage sync + saveMatch + toggle UI + migration');
t('dump matches pousse prep_shared', () => assert.ok(/prep_shared: !!m\.prepShared/.test(html)));
t('apply matches lit prep_shared', () => assert.ok(/prepShared: !!r\.prep_shared/.test(html)));
t('saveMatch préserve prepShared (existing ? !!existing : false)', () => assert.ok(/prepShared: existing \? !!existing\.prepShared : false/.test(html)));
t('toggle UI câblé dans renderMatchPrep (coach)', () => assert.ok(/toggleMatchPrepShared\('\$\{m\.id\}'\)/.test(extractFn('renderMatchPrep'))));
t('renderMatchPrepForPlayer câblé dans renderMatchDetail', () => assert.ok(/renderMatchPrepForPlayer\(m\)/.test(extractFn('renderMatchDetail'))));
t('migration prep_shared présente', () => {
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20260702_001_match_prep_shared.sql'), 'utf8');
  assert.ok(/add column if not exists prep_shared boolean not null default false/.test(mig));
});

console.log(`\n✅ ${pass} assertions OK — partage prépa match (coachNote toujours privé).`);
