// Test : plays liés au match publics vs privés coach. visibility='private' →
// jamais partagé à la joueuse, même prepShared=true (tactique/scouting).
// Migration 20260702_002 (match_play_links.visibility default 'public').
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

const plays = [{ id: 'p1', title: 'Horns', cat: 'off', images: [] }, { id: 'p2', title: 'ScoutAdverse', cat: 'def', images: [] }];
const links = [
  { matchId: 'm1', playId: 'p1', position: 0, coachNote: 'note1', visibility: 'public' },
  { matchId: 'm1', playId: 'p2', position: 1, coachNote: 'note2', visibility: 'private' },
];

console.log('SCÉNARIO 1 — SÉCURITÉ : la joueuse ne voit pas les plays privés');
{
  const src = [extractFn('getMatchPlayLinks'), extractFn('renderMatchPrepForPlayer')].join('\n\n');
  const state = { auth: { role: 'player', playerId: 'pl' }, plays, matchPlayLinks: links };
  const fn = new Function('state', 'esc', 'getCatShort', 'getCatLabel', 'parseVideo', 'viewFocusVideo',
    src + '\nreturn renderMatchPrepForPlayer;'
  )(state, s => String(s), () => 'O', () => 'Off', () => null, () => {});
  const out = fn({ id: 'm1', prepShared: true, prepComment: '', prepVideos: [] });
  t('play public (Horns) visible', () => assert.ok(out.includes('Horns')));
  t('play privé (ScoutAdverse) JAMAIS visible malgré prepShared=true', () => assert.ok(!out.includes('ScoutAdverse')));
  t('le filtre visibility!==private est bien appliqué dans le code', () => {
    assert.ok(/getMatchPlayLinks\(m\.id\)\.filter\(lk => lk\.visibility !== 'private'\)/.test(extractFn('renderMatchPrepForPlayer')));
  });
}

console.log('SCÉNARIO 2 — le compteur « Plays liés · N » côté joueuse exclut les privés');
{
  const src = [extractFn('getMatchPlayLinks'), extractFn('renderMatchPrepForPlayer')].join('\n\n');
  const state = { auth: { role: 'player', playerId: 'pl' }, plays, matchPlayLinks: links };
  const fn = new Function('state', 'esc', 'getCatShort', 'getCatLabel', 'parseVideo', 'viewFocusVideo',
    src + '\nreturn renderMatchPrepForPlayer;'
  )(state, s => String(s), () => 'O', () => 'Off', () => null, () => {});
  const out = fn({ id: 'm1', prepShared: true, prepComment: '', prepVideos: [] });
  t('affiche « · 1 » (1 public), pas « · 2 »', () => {
    assert.ok(/Plays liés <span[^>]*>· 1</.test(out));
  });
}

console.log('SCÉNARIO 3 — toggle visibilité (coach) : public ↔ privé');
{
  const src = extractFn('toggleMatchPlayVisibility');
  function build(role) {
    const state = { auth: { role }, matchPlayLinks: [{ matchId: 'm1', playId: 'p1', visibility: 'public' }] };
    const fn = new Function('state', 'persist', 'render', src + '\nreturn toggleMatchPlayVisibility;')(state, () => {}, () => {});
    return { state, fn };
  }
  const a = build('coach');
  a.fn('m1', 'p1');
  t('coach : public → private', () => assert.strictEqual(a.state.matchPlayLinks[0].visibility, 'private'));
  a.fn('m1', 'p1');
  t('coach : private → public (toggle)', () => assert.strictEqual(a.state.matchPlayLinks[0].visibility, 'public'));
  const b = build('player');
  b.fn('m1', 'p1');
  t('joueuse : toggle no-op (reste public)', () => assert.strictEqual(b.state.matchPlayLinks[0].visibility, 'public'));
}

console.log('SCÉNARIO 4 — addPlayToMatch : défaut public (rétrocompat)');
{
  const src = [extractFn('getMatchPlayLinks'), extractFn('addPlayToMatch')].join('\n\n');
  const state = { matchPlayLinks: [] };
  const fn = new Function('state', 'persist', src + '\nreturn addPlayToMatch;')(state, () => {});
  fn('m1', 'p9', '');
  t('nouveau play lié → visibility "public" par défaut', () => {
    assert.strictEqual(state.matchPlayLinks[0].visibility, 'public');
  });
}

console.log('SCÉNARIO 5 — sync + UI coach + migration');
t('dump match_play_links pousse visibility', () => assert.ok(/visibility: lk\.visibility === 'private' \? 'private' : 'public'/.test(html)));
t('apply match_play_links lit visibility (défaut public)', () => assert.ok(/visibility: r\.visibility === 'private' \? 'private' : 'public'/.test(html)));
t('UI coach : toggle 🔒/📤 par play (renderMatchPrep)', () => {
  const rp = extractFn('renderMatchPrep');
  assert.ok(/toggleMatchPlayVisibility\('\$\{m\.id\}','\$\{p\.id\}'\)/.test(rp));
  assert.ok(/isPrivate \? '🔒' : '📤'/.test(rp));
});
t('migration 20260702_002 présente (visibility default public)', () => {
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20260702_002_match_private_notes_and_plays.sql'), 'utf8');
  assert.ok(/match_play_links add column if not exists visibility text not null default 'public'/.test(mig));
});

console.log(`\n✅ ${pass} assertions OK — plays liés privés (jamais partagés à la joueuse).`);
