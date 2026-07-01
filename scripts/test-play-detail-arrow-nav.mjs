// Test de la navigation ◀▶ entre plays dans la vue détail (renderPlayDetail).
// Exécute _playNavList (liste ordonnée filtrée) + _playNavAdjacent (saut, bords
// sans wrapping) et vérifie le câblage UI (barre flèches + compteur + clavier).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const src = [extractFn(html, '_playNavList'), extractFn(html, '_playNavAdjacent')].join('\n\n');
function make(state, getSeasonPlays, seasonsLoaded) {
  const opened = [];
  const api = new Function('state', 'getSeasonPlays', '_seasonsLoaded', 'openPlay',
    src + '\nreturn { _playNavList, _playNavAdjacent };'
  )(state, getSeasonPlays || (() => []), () => !!seasonsLoaded, id => opened.push(id));
  return { api, opened };
}

console.log('SCÉNARIO 1 — mode legacy (pas de liens) : liste = plays de la catégorie');
{
  const state = { auth: { role: 'coach' }, currentSeasonId: null, playsCat: 'off', playsTag: null,
    plays: [{ id: 'a', cat: 'off', tags: [] }, { id: 'b', cat: 'off', tags: ['horns'] }, { id: 'c', cat: 'def', tags: [] }, { id: 'd', cat: 'off', tags: [] }] };
  const { api } = make(state);
  t('navList(off) ordonnée = [a,b,d] (def exclu)', () => {
    assert.deepStrictEqual(api._playNavList(state.plays[0]).map(x => x.id), ['a', 'b', 'd']);
  });
}

console.log('SCÉNARIO 2 — saut + bords sans wrapping');
{
  const state = { auth: { role: 'player' }, currentSeasonId: null, playsCat: 'off', playsTag: null,
    plays: [{ id: 'a', cat: 'off', tags: [] }, { id: 'b', cat: 'off', tags: [] }, { id: 'd', cat: 'off', tags: [] }] };
  let { api, opened } = make(state);
  state.view = { type: 'play', id: 'a' }; api._playNavAdjacent(1);
  t('a → suivant = b', () => assert.deepStrictEqual(opened, ['b']));
  ({ api, opened } = make(state));
  state.view = { type: 'play', id: 'a' }; api._playNavAdjacent(-1);
  t('a → précédent = no-op (première position)', () => assert.strictEqual(opened.length, 0));
  ({ api, opened } = make(state));
  state.view = { type: 'play', id: 'd' }; api._playNavAdjacent(1);
  t('d → suivant = no-op (dernière position)', () => assert.strictEqual(opened.length, 0));
  ({ api, opened } = make(state));
  state.view = { type: 'play', id: 'd' }; api._playNavAdjacent(-1);
  t('d → précédent = b', () => assert.deepStrictEqual(opened, ['b']));
}

console.log('SCÉNARIO 3 — filtre de tag respecté seulement s\'il n\'exclut pas le play courant');
{
  const state = { auth: { role: 'coach' }, currentSeasonId: null, playsCat: 'off', playsTag: 'horns',
    plays: [{ id: 'a', cat: 'off', tags: [] }, { id: 'b', cat: 'off', tags: ['horns'] }, { id: 'd', cat: 'off', tags: [] }] };
  const { api } = make(state);
  t('depuis b (a le tag) → liste filtrée [b]', () => assert.deepStrictEqual(api._playNavList(state.plays[1]).map(x => x.id), ['b']));
  t('depuis a (pas le tag) → tag ignoré, liste [a,b,d]', () => assert.deepStrictEqual(api._playNavList(state.plays[0]).map(x => x.id), ['a', 'b', 'd']));
}

console.log('SCÉNARIO 4 — coach : orphelins inclus dans la navigation');
{
  const state = { auth: { role: 'coach' }, currentSeasonId: 's1', playsCat: 'off', playsTag: null, _showInactivePlays: false,
    seasonPlays: [{ seasonId: 's1', playId: 'a', active: true }],
    plays: [{ id: 'a', cat: 'off', tags: [] }, { id: 'orph', cat: 'off', tags: [] }] };
  // getSeasonPlays renvoie les liés (a) ; orph est orphelin (pas de lien)
  const { api } = make(state, (sid, o) => state.plays.filter(p => (state.seasonPlays || []).some(sp => sp.seasonId === sid && sp.playId === p.id)), true);
  t('liste inclut le play lié ET l\'orphelin', () => {
    const ids = api._playNavList(state.plays[0]).map(x => x.id);
    assert.ok(ids.includes('a') && ids.includes('orph'));
  });
}

console.log('SCÉNARIO 5 — garde-fou : play courant absent du pool → présent quand même');
{
  const state = { auth: { role: 'player' }, currentSeasonId: 's1', playsCat: 'off', playsTag: null,
    seasonPlays: [{ seasonId: 's1', playId: 'other', active: true }],
    plays: [{ id: 'zz', cat: 'off', tags: [] }, { id: 'other', cat: 'off', tags: [] }] };
  const { api } = make(state, (sid, o) => [{ id: 'other', cat: 'off', tags: [] }], true);
  t('play courant zz (hors pool) → inclus en tête', () => {
    const ids = api._playNavList(state.plays[0]).map(x => x.id);
    assert.ok(ids.includes('zz'));
  });
}

console.log('SCÉNARIO 6 — câblage UI dans renderPlayDetail');
{
  const rpd = extractFn(html, 'renderPlayDetail');
  t('barre affichée seulement si >1 play (showNav)', () => assert.ok(/const showNav = navList\.length > 1;/.test(rpd)));
  t('flèche ◀ → _playNavAdjacent(-1), grisée si !hasPrev', () => {
    assert.ok(/_playNavAdjacent\(-1\)[\s\S]*?◀/.test(rpd));
    assert.ok(/\$\{hasPrev \? '' : 'disabled'\}/.test(rpd));
  });
  t('flèche ▶ → _playNavAdjacent(1), grisée si !hasNext', () => {
    assert.ok(/_playNavAdjacent\(1\)[\s\S]*?▶/.test(rpd));
    assert.ok(/\$\{hasNext \? '' : 'disabled'\}/.test(rpd));
  });
  t('compteur "idx / total" affiché', () => assert.ok(/\$\{navIdx \+ 1\} \/ \$\{navList\.length\}/.test(rpd)));
  t('clavier ← / → câblé (_ensurePlayNavKeys + ArrowLeft/Right)', () => {
    assert.ok(/_ensurePlayNavKeys\(\)/.test(rpd));
    const k = extractFn(html, '_ensurePlayNavKeys');
    assert.ok(/ArrowLeft/.test(k) && /ArrowRight/.test(k));
    assert.ok(/INPUT\|TEXTAREA\|SELECT/.test(k), 'ne doit pas voler les flèches dans un champ');
  });
}

console.log(`\n✅ ${pass} assertions OK — navigation ◀▶ entre plays (détail).`);
