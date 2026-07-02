// Test : notes de match privée (coach seul) vs publique (joueuses si prep_shared).
// prepComment = PUBLIQUE (existant, partagé si prepShared) ; prepCommentPrivate =
// PRIVÉE (nouveau, jamais partagé). Migration 20260702_002.
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

console.log('SCÉNARIO 1 — savePrepComment écrit les 2 notes distinctes');
{
  const src = extractFn('savePrepComment');
  const state = { matches: [{ id: 'm1', prepComment: '', prepCommentPrivate: '' }] };
  const vals = { 'pc-public': '  Focus énergie  ', 'pc-private': '  Zone adverse faible côté gauche  ' };
  const fn = new Function('state', 'document', 'persist', 'closeModal', 'render',
    src + '\nreturn savePrepComment;'
  )(state, { getElementById: id => ({ value: vals[id] }) }, () => {}, () => {}, () => {});
  fn('m1');
  t('prepComment (publique) + prepCommentPrivate (privée) trimés', () => {
    assert.strictEqual(state.matches[0].prepComment, 'Focus énergie');
    assert.strictEqual(state.matches[0].prepCommentPrivate, 'Zone adverse faible côté gauche');
  });
}

console.log('SCÉNARIO 2 — joueuse : voit la publique, JAMAIS la privée');
{
  const src = [extractFn('getMatchPlayLinks'), extractFn('renderMatchPrepForPlayer')].join('\n\n');
  const state = { auth: { role: 'player', playerId: 'pl' }, plays: [], matchPlayLinks: [] };
  const fn = new Function('state', 'esc', 'getCatShort', 'getCatLabel', 'parseVideo', 'viewFocusVideo',
    src + '\nreturn renderMatchPrepForPlayer;'
  )(state, s => String(s), () => 'O', () => 'Off', () => null, () => {});
  const out = fn({ id: 'm1', prepShared: true, prepComment: 'NOTE_PUBLIQUE', prepCommentPrivate: 'NOTE_PRIVEE_SECRETE', prepVideos: [] });
  t('note publique affichée', () => assert.ok(out.includes('NOTE_PUBLIQUE')));
  t('note privée JAMAIS affichée', () => assert.ok(!out.includes('NOTE_PRIVEE_SECRETE')));
  t('renderMatchPrepForPlayer ne référence jamais prepCommentPrivate (code, hors commentaires)', () => {
    const code = extractFn('renderMatchPrepForPlayer').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/prepCommentPrivate/.test(code), 'fuite : prepCommentPrivate référencé dans le code');
  });
}

console.log('SCÉNARIO 3 — prepShared=false : joueuse ne voit AUCUNE note');
{
  const src = [extractFn('getMatchPlayLinks'), extractFn('renderMatchPrepForPlayer')].join('\n\n');
  const state = { auth: { role: 'player', playerId: 'pl' }, plays: [], matchPlayLinks: [] };
  const fn = new Function('state', 'esc', 'getCatShort', 'getCatLabel', 'parseVideo', 'viewFocusVideo',
    src + '\nreturn renderMatchPrepForPlayer;'
  )(state, s => String(s), () => 'O', () => 'Off', () => null, () => {});
  t('prepShared=false → "" (rien, même la publique)', () => {
    assert.strictEqual(fn({ id: 'm1', prepShared: false, prepComment: 'NOTE_PUBLIQUE', prepCommentPrivate: 'x', prepVideos: [] }), '');
  });
}

console.log('SCÉNARIO 4 — éditeur coach : 2 textarea + labels + rendu 2 notes');
{
  const ed = extractFn('editPrepComment');
  t('2 textarea distincts (pc-public / pc-private)', () => {
    assert.ok(/id="pc-public"/.test(ed) && /id="pc-private"/.test(ed));
    assert.ok(/📤 Note publique/.test(ed) && /🔒 Note privée/.test(ed));
  });
  t('la note privée est annoncée « jamais partagée »', () => assert.ok(/Jamais<\/strong> partagée/.test(ed)));
  const rp = extractFn('renderMatchPrep');
  t('renderMatchPrep (coach) affiche les 2 notes séparées', () => {
    assert.ok(/📤 Publique/.test(rp) && /🔒 Privée · coach seul/.test(rp));
    assert.ok(/prepCommentPrivate/.test(rp));
  });
}

console.log('SCÉNARIO 5 — sync + saveMatch + migration');
t('dump matches pousse prep_comment_private', () => assert.ok(/prep_comment_private: m\.prepCommentPrivate \|\| null/.test(html)));
t('apply matches lit prep_comment_private', () => assert.ok(/prepCommentPrivate: r\.prep_comment_private \|\| ''/.test(html)));
t('saveMatch préserve prepCommentPrivate', () => assert.ok(/prepCommentPrivate: existing \? \(existing\.prepCommentPrivate \|\| ''\) : ''/.test(html)));
t('prep_comment reste la note PUBLIQUE (rétrocompat : pas de renommage)', () => {
  assert.ok(/prep_comment: m\.prepComment \|\| null/.test(html));
});
t('migration 20260702_002 présente (prep_comment_private)', () => {
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20260702_002_match_private_notes_and_plays.sql'), 'utf8');
  assert.ok(/add column if not exists prep_comment_private text/.test(mig));
});

console.log(`\n✅ ${pass} assertions OK — notes privée/publique (privée jamais partagée).`);
