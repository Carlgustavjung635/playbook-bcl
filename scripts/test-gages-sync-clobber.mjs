// Test de non-régression du BUG « acceptation perdue » (race condition sync).
// Cause : apply() remplaçait toute ligne locale par la version distante dès que
// l'id existait en remote → un refetch realtime concurrent, arrivé pendant le
// flush, ramenait un tirage 'accepted' local à 'owed' avant qu'il ne soit poussé.
// Fix : last-writer-wins par updatedAt (garder le local plus récent) + réassert.
// On modélise fidèlement la partie merge de l'apply gageDraws d'index.html.
import assert from 'node:assert';

// --- SUJET (extrait fidèle de la logique apply gageDraws, partie merge) ---
function applyMerge(localArr, remoteRows) {
  const local = localArr || [];
  const localById = Object.fromEntries(local.map(d => [d.id, d]));
  const remoteIds = new Set(remoteRows.map(r => r.id));
  const ahead = [];
  const fromRemote = remoteRows.map(r => {
    const mapped = { id: r.id, status: r.status, updatedAt: r.updated_at };
    const loc = localById[r.id];
    if (loc && (loc.updatedAt || 0) > (mapped.updatedAt || 0)) { ahead.push(loc); return loc; }
    return mapped;
  });
  const pendingLocal = local.filter(d => !remoteIds.has(d.id) && typeof d.id === 'string' && d.id.startsWith('x'));
  return { merged: [...pendingLocal, ...fromRemote], ahead };
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — le refetch NE clobber PLUS une acceptation locale récente');
t('local accepted (récent) vs remote owed (ancien) → garde accepted + réassert', () => {
  const local = [{ id: 'd1', status: 'accepted', updatedAt: 200 }];
  const remote = [{ id: 'd1', status: 'owed', updated_at: 100 }];
  const { merged, ahead } = applyMerge(local, remote);
  const row = merged.find(x => x.id === 'd1');
  assert.strictEqual(row.status, 'accepted', 'l\'acceptation locale est préservée');
  assert.strictEqual(ahead.length, 1, 'la ligne locale en avance est marquée pour ré-upsert');
  assert.strictEqual(ahead[0].id, 'd1');
});

console.log('SCÉNARIO 2 — un update distant LÉGITIME (plus récent) gagne bien');
t('local owed (ancien) vs remote accepted (récent) → prend remote, pas de réassert', () => {
  const local = [{ id: 'd1', status: 'owed', updatedAt: 100 }];
  const remote = [{ id: 'd1', status: 'accepted', updated_at: 200 }];
  const { merged, ahead } = applyMerge(local, remote);
  assert.strictEqual(merged.find(x => x.id === 'd1').status, 'accepted');
  assert.strictEqual(ahead.length, 0);
});

console.log('SCÉNARIO 3 — égalité de timestamp : le remote fait foi (pas de réassert)');
t('updatedAt égaux → prend remote', () => {
  const local = [{ id: 'd1', status: 'accepted', updatedAt: 150 }];
  const remote = [{ id: 'd1', status: 'owed', updated_at: 150 }];
  const { merged, ahead } = applyMerge(local, remote);
  assert.strictEqual(merged.find(x => x.id === 'd1').status, 'owed');
  assert.strictEqual(ahead.length, 0);
});

console.log('SCÉNARIO 4 — lignes locales neuves (x…) absentes du remote préservées');
t('anti-wipe conservé pour une création locale non encore synchronisée', () => {
  const local = [{ id: 'x999', status: 'accepted', updatedAt: 300 }];
  const remote = [{ id: 'd1', status: 'owed', updated_at: 100 }];
  const { merged } = applyMerge(local, remote);
  assert.ok(merged.some(x => x.id === 'x999'), 'la ligne locale neuve survit');
  assert.ok(merged.some(x => x.id === 'd1'), 'la ligne remote est ajoutée');
});

console.log('SCÉNARIO 5 — multi-lignes mixtes');
t('garde les locales en avance, prend les distantes plus récentes', () => {
  const local = [
    { id: 'a', status: 'accepted', updatedAt: 200 },   // en avance → garder
    { id: 'b', status: 'owed', updatedAt: 100 },        // remote plus récent → remote
    { id: 'c', status: 'player_done', updatedAt: 500 }, // en avance → garder
  ];
  const remote = [
    { id: 'a', status: 'owed', updated_at: 100 },
    { id: 'b', status: 'coach_confirmed', updated_at: 300 },
    { id: 'c', status: 'accepted', updated_at: 400 },
  ];
  const { merged, ahead } = applyMerge(local, remote);
  const by = Object.fromEntries(merged.map(x => [x.id, x.status]));
  assert.strictEqual(by.a, 'accepted');
  assert.strictEqual(by.b, 'coach_confirmed');
  assert.strictEqual(by.c, 'player_done');
  assert.deepStrictEqual(ahead.map(x => x.id).sort(), ['a', 'c']);
});

console.log(`\n✅ ${pass} assertions OK — anti-clobber last-writer-wins + réassert des lignes locales en avance.`);
