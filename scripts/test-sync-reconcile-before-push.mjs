// Test de non-régression du BUG « les renommages de plays disparaissent au bout
// de quelques heures » (v.104).
//
// CAUSE — `_lastSeen` (le cache qui sert à calculer les deltas à pousser) est un
// cache MÉMOIRE : il repart VIDE à chaque chargement de page. Tant qu'une entité
// n'avait pas été confrontée au serveur, chacune de ses lignes locales paraissait
// modifiée → le flush ré-uploadait la collection ENTIÈRE, telle qu'elle dormait
// dans le localStorage de CET appareil. Sur un appareil dont la copie datait —
// une joueuse qui rouvre la PWA le lendemain — ça réécrivait par-dessus les
// renommages faits par le coach entre-temps. Un appui sur un onglet dans les ~2 s
// du boot suffisait (goSection → persist → flush à +400 ms, avant que fetchAll
// n'ait peuplé le cache). Signature en base : 100 lignes `plays` sur 105
// réécrites en un seul ordre, à la microseconde près (2026-08-03T16:03:27.739623).
//
// FIX — réconcilier avant de pousser : une entité jamais confrontée au serveur
// est fetchée (apply + amorce du cache) AVANT tout upsert ; serveur injoignable
// → on ne pousse rien pour cette entité.
//
// On modélise fidèlement _flushEntity / _flushAll / _fetchApplySeed d'index.html.
import assert from 'node:assert';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// SUJET — extrait fidèle du moteur de sync (bloc <script type="module">)
// ---------------------------------------------------------------------------
const _stableJson = (o) => JSON.stringify(o, Object.keys(o).sort());

// Entité `plays` réduite au champ qui nous intéresse (title), même forme
// dump/apply que la vraie : apply = remote-wins + conservation des locaux 'x…'
// pas encore poussés.
const PLAYS = {
  key: 'plays', table: 'plays',
  dump: (state) => Object.fromEntries((state.plays || []).map(p => [p.id, { id: p.id, title: p.title }])),
  apply: (state, rows) => {
    const remoteIds = new Set(rows.map(r => r.id));
    const fromRemote = rows.map(r => ({ id: r.id, title: r.title }));
    const pendingLocal = (state.plays || []).filter(p => !remoteIds.has(p.id) && String(p.id).startsWith('x'));
    state.plays = [...pendingLocal, ...fromRemote];
  }
};

function makeEngine(server, { gate = true } = {}) {
  const ENTITIES = [PLAYS];
  const _lastSeen = Object.fromEntries(ENTITIES.map(e => [e.key, {}]));
  const _reconciled = new Set();
  const _bootDump = {};
  let _fetchAllInFlight = null;
  const upserts = [];   // journal des ordres d'upsert réellement émis

  // Repère de session : l'état tel qu'il était AU CHARGEMENT DE LA PAGE.
  function _captureBaseline(state) {
    ENTITIES.forEach(entity => {
      if (_bootDump[entity.key]) return;
      const map = entity.dump(state);
      _bootDump[entity.key] = Object.fromEntries(
        Object.entries(map).map(([k, r]) => [k, _stableJson(r)]));
    });
  }

  // Après une réconciliation tardive : ré-affirme ce que l'utilisateur a
  // RÉELLEMENT modifié depuis le chargement (≠ des lignes simplement périmées).
  async function _reassertDirty(entity, before) {
    const base = _bootDump[entity.key] || {};
    const dirty = Object.entries(before)
      .filter(([k, row]) => _stableJson(row) !== base[k])
      .map(([, row]) => row);
    if (!dirty.length) return;
    upserts.push({ table: entity.table, rows: dirty, reassert: true });
    await server.upsert(entity.table, dirty);
  }

  function _seedCacheFromRemote(entity, rows, state) {
    _reconciled.add(entity.key);
    const map = entity.dump(state);
    const remoteKeys = new Set(rows.map(r => r.id));
    const cache = {};
    Object.entries(map).forEach(([k, row]) => { if (remoteKeys.has(k)) cache[k] = _stableJson(row); });
    _lastSeen[entity.key] = cache;
  }

  async function _fetchApplySeed(entity, state) {
    const { data, error } = await server.select(entity.table);
    if (error) return false;
    const rows = data || [];
    if (rows.length > 0) entity.apply(state, rows);
    _seedCacheFromRemote(entity, rows, state);
    return true;
  }

  async function _flushEntity(entity, currentMap) {
    const cache = _lastSeen[entity.key];
    const toUpsert = [];
    const newCache = {};
    Object.entries(currentMap).forEach(([k, row]) => {
      const h = _stableJson(row);
      newCache[k] = h;
      if (cache[k] !== h) toUpsert.push(row);
    });
    if (toUpsert.length) {
      upserts.push({ table: entity.table, rows: toUpsert });
      const { error } = await server.upsert(entity.table, toUpsert);
      if (error) return;
    }
    _lastSeen[entity.key] = newCache;
  }

  async function _flushAll(state) {
    _captureBaseline(state);
    if (_fetchAllInFlight) { try { await _fetchAllInFlight; } catch (e) {} }
    for (const entity of ENTITIES) {
      if (gate && !_reconciled.has(entity.key)) {
        const before = entity.dump(state);
        const ok = await _fetchApplySeed(entity, state);
        if (!ok) continue;                    // serveur injoignable → on ne pousse RIEN
        await _reassertDirty(entity, before);
      }
      await _flushEntity(entity, entity.dump(state));
    }
  }

  function fetchAll(state) {
    _captureBaseline(state);
    if (_fetchAllInFlight) return _fetchAllInFlight;
    const p = (async () => { for (const e of ENTITIES) await _fetchApplySeed(e, state); })();
    _fetchAllInFlight = p;
    return p.finally(() => { if (_fetchAllInFlight === p) _fetchAllInFlight = null; });
  }

  // `boot` = ce que fait la page au premier rendu : figer le repère de session.
  return { flushAll: _flushAll, fetchAll, boot: _captureBaseline, upserts, _reconciled, _lastSeen };
}

// Serveur factice : `plays` = source de vérité, avec compteur d'écritures.
function makeServer(rows, { failSelect = false } = {}) {
  return {
    rows: rows.map(r => ({ ...r })),
    failSelect,
    writes: 0,
    async select(_t) {
      if (this.failSelect) return { data: null, error: { message: 'boom' } };
      return { data: this.rows.map(r => ({ ...r })), error: null };
    },
    async upsert(_t, list) {
      this.writes += list.length;
      list.forEach(row => {
        const i = this.rows.findIndex(r => r.id === row.id);
        if (i >= 0) this.rows[i] = { ...row }; else this.rows.push({ ...row });
      });
      return { error: null };
    },
    titleOf(id) { const r = this.rows.find(x => x.id === id); return r ? r.title : null; }
  };
}

let pass = 0;
async function t(name, fn) { await fn(); pass++; console.log('  ✓', name); }

// ---------------------------------------------------------------------------
console.log("SCÉNARIO 1 — le bug tel qu'il s'est produit en prod le 2026-08-03");

// Le coach a renommé 'p_a' en « Coté » ; l'appareil de la joueuse a encore
// l'ancien nom en localStorage et n'a pas encore synchronisé.
const STALE_LOCAL = [
  { id: 'p_a', title: 'ancien nom' },
  { id: 'p_b', title: 'Etoile' },
  { id: 'p_c', title: 'U18' },
];
const SERVER_ROWS = [
  { id: 'p_a', title: 'Coté' },          // ← le renommage du coach
  { id: 'p_b', title: 'Etoile' },
  { id: 'p_c', title: 'U18' },
];

await t('SANS le gate : le flush du boot réécrit TOUTE la collection et perd le renommage', async () => {
  const server = makeServer(SERVER_ROWS);
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(server, { gate: false });
  await eng.flushAll(state);               // goSection() dans les 2 s du boot
  assert.strictEqual(server.writes, 3, 'la collection entière est repoussée');
  assert.strictEqual(server.titleOf('p_a'), 'ancien nom', 'le renommage du coach est écrasé (bug)');
});

await t('AVEC le gate : le flush du boot ne pousse RIEN et le local se recale', async () => {
  const server = makeServer(SERVER_ROWS);
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(server);
  eng.boot(state);
  await eng.flushAll(state);
  assert.strictEqual(server.writes, 0, 'aucune ligne poussée : rien n\'avait changé localement');
  assert.strictEqual(eng.upserts.length, 0, 'aucun ordre d\'upsert émis');
  assert.strictEqual(server.titleOf('p_a'), 'Coté', 'le renommage du coach survit');
  assert.strictEqual(state.plays.find(p => p.id === 'p_a').title, 'Coté',
    'la joueuse voit désormais le bon nom (apply de réconciliation)');
});

// ---------------------------------------------------------------------------
console.log('\nSCÉNARIO 2 — une VRAIE édition locale est toujours poussée');

await t('cas normal (app déjà synchronisée) : la seule ligne modifiée part', async () => {
  const server = makeServer(SERVER_ROWS);
  const state = { plays: SERVER_ROWS.map(p => ({ ...p })) };
  const eng = makeEngine(server);
  eng.boot(state);
  await eng.fetchAll(state);
  state.plays.find(p => p.id === 'p_b').title = 'Etoile inversée';
  await eng.flushAll(state);
  assert.strictEqual(server.writes, 1, 'une seule ligne poussée, pas la collection');
  assert.strictEqual(server.titleOf('p_b'), 'Etoile inversée');
  assert.strictEqual(server.titleOf('p_a'), 'Coté', 'les autres lignes sont intactes');
});

await t('édition faite AVANT toute réconciliation : elle est ré-affirmée, pas annulée', async () => {
  // Le piège du correctif : réconcilier tard (boot hors ligne, fetch en erreur)
  // fait un apply remote-wins qui recouvre l'état local. Une saisie faite
  // entre-temps serait perdue — on remplacerait une perte de données par une
  // autre. Le repère de session la distingue d'une ligne simplement périmée.
  const server = makeServer(SERVER_ROWS);
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(server);
  eng.boot(state);                                   // chargement de la page
  state.plays.find(p => p.id === 'p_c').title = 'U18 zone'; // saisie de l'utilisateur
  await eng.flushAll(state);                         // 1re confrontation au serveur
  assert.strictEqual(server.titleOf('p_c'), 'U18 zone', 'la saisie survit à la réconciliation');
  assert.strictEqual(server.titleOf('p_a'), 'Coté', 'la ligne PÉRIMÉE, elle, n\'est pas ré-affirmée');
  assert.strictEqual(server.writes, 1, 'une seule ligne écrite : la vraie saisie');
});

// ---------------------------------------------------------------------------
console.log('\nSCÉNARIO 3 — serveur injoignable : on ne pousse rien à l\'aveugle');

await t('select en erreur → 0 upsert, state local intact, entité non réconciliée', async () => {
  const server = makeServer(SERVER_ROWS, { failSelect: true });
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(server);
  eng.boot(state);
  await eng.flushAll(state);
  assert.strictEqual(server.writes, 0, 'rien n\'est poussé sur un serveur qu\'on n\'a pas pu lire');
  assert.strictEqual(state.plays.length, 3, 'le state local n\'est pas amputé');
  assert.ok(!eng._reconciled.has('plays'), 'l\'entité reste marquée non réconciliée');
});

await t('le flush suivant, une fois le serveur revenu, réconcilie puis pousse', async () => {
  const server = makeServer(SERVER_ROWS, { failSelect: true });
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(server);
  eng.boot(state);
  await eng.flushAll(state);                       // hors ligne
  server.failSelect = false;                       // retour du réseau
  state.plays.push({ id: 'x_new', title: 'Nouveau play' }); // création locale entre-temps
  await eng.flushAll(state);
  assert.strictEqual(server.titleOf('p_a'), 'Coté', 'toujours pas d\'écrasement');
  assert.strictEqual(server.titleOf('x_new'), 'Nouveau play', 'la création locale est bien poussée');
});

// ---------------------------------------------------------------------------
console.log('\nSCÉNARIO 4 — une création locale non encore poussée survit à la réconciliation');

await t('play créé hors sync (id x…) : conservé par apply puis poussé', async () => {
  const server = makeServer(SERVER_ROWS);
  const state = { plays: [...STALE_LOCAL.map(p => ({ ...p })), { id: 'x123', title: 'Spanish' }] };
  const eng = makeEngine(server);
  eng.boot(state);
  await eng.flushAll(state);
  assert.ok(state.plays.some(p => p.id === 'x123'), 'la création locale n\'est pas wipée par apply');
  assert.strictEqual(server.titleOf('x123'), 'Spanish', 'elle est poussée au serveur');
  assert.strictEqual(server.writes, 1, 'ELLE SEULE est poussée, pas la collection');
});

// ---------------------------------------------------------------------------
console.log('\nSCÉNARIO 5 — un flush pendant le fetchAll du boot attend au lieu de pousser');

await t('flush concurrent : aucun double fetch, aucune écriture parasite', async () => {
  const server = makeServer(SERVER_ROWS);
  let selects = 0;
  const slow = { ...server, rows: server.rows, writes: 0,
    async select(t) { selects++; await new Promise(r => setTimeout(r, 10)); return server.select(t); },
    async upsert(t, l) { const r = await server.upsert(t, l); this.writes = server.writes; return r; },
    titleOf: (id) => server.titleOf(id) };
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(slow);
  eng.boot(state);
  const boot = eng.fetchAll(state);          // sync initiale en vol
  await eng.flushAll(state);                 // l'utilisateur tape sur un onglet
  await boot;
  assert.strictEqual(selects, 1, 'le flush a attendu la sync en cours au lieu de refetcher');
  assert.strictEqual(server.writes, 0, 'aucune écriture parasite');
  assert.strictEqual(server.titleOf('p_a'), 'Coté');
});

await t('fetchAll appelé deux fois en parallèle → une seule sync partagée', async () => {
  const server = makeServer(SERVER_ROWS);
  let selects = 0;
  const counting = {
    async select(t) { selects++; return server.select(t); },
    async upsert(t, l) { return server.upsert(t, l); }
  };
  const state = { plays: STALE_LOCAL.map(p => ({ ...p })) };
  const eng = makeEngine(counting);
  eng.boot(state);
  await Promise.all([eng.fetchAll(state), eng.fetchAll(state)]);
  assert.strictEqual(selects, 1, 'la 2e demande se greffe sur la 1re');
});

// ---------------------------------------------------------------------------
// GARDE STRUCTURELLE — le correctif doit rester GÉNÉRIQUE.
//
// Le bug ne touchait pas « les plays » : il touchait le moteur. Relevé en prod
// le 2026-08-03, un seul flush a réécrit 12 collections en 2,2 s, dans l'ordre
// exact de déclaration de ENTITIES (plays 16:34:00.752, matches .01.238,
// challenges .01.419, challenge_scores .01.589, convocations .01.748,
// convocation_responses .01.902, lineups .02.049, ffbb_config .02.202,
// team_settings .02.408, programs .02.600, offseason_logs .02.749,
// team_reviews .02.930). Le correctif vit donc dans la boucle de `_flushAll`,
// et il doit y rester : ces assertions échouent si quelqu'un le déplace, le
// contourne, ou le réduit à une entité particulière.
console.log('\nGARDE STRUCTURELLE — le gate est dans le moteur, pas sur une entité');

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Extrait le corps d'une fonction par appariement d'accolades.
function bodyOf(signature) {
  const i = HTML.indexOf(signature);
  assert.notStrictEqual(i, -1, `introuvable dans index.html : ${signature}`);
  let d = 0, start = HTML.indexOf('{', i);
  for (let j = start; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(start, j + 1);
  }
  throw new Error('accolades non appariées : ' + signature);
}

const flushAll = bodyOf('async function _flushAll(state)');

await t('le gate est DANS la boucle sur ENTITIES (donc les 38 entités, pas une)', () => {
  assert.ok(/for \(const entity of ENTITIES\)/.test(flushAll), '_flushAll itère bien sur ENTITIES');
  assert.ok(flushAll.includes('_reconciled.has(entity.key)'), 'le gate interroge _reconciled');
  assert.ok(flushAll.indexOf('_reconciled.has(entity.key)') < flushAll.indexOf('_flushEntity('),
    'le gate passe AVANT le push, pas après');
});

await t("aucune entité n'est traitée à part (pas de cas particulier dans le gate)", () => {
  const gate = flushAll.slice(flushAll.indexOf('for (const entity of ENTITIES)'));
  assert.ok(!/entity\.key\s*===/.test(gate), 'pas de branche sur une entité nommée');
  assert.ok(!/entity\.table\s*===/.test(gate), 'pas de branche sur une table nommée');
});

await t('serveur injoignable → on saute l\'entité au lieu de pousser à l\'aveugle', () => {
  assert.ok(/const ok = await _fetchApplySeed\(entity, state\);\s*\n\s*if \(!ok\) continue;/.test(flushAll),
    'un fetch en échec fait `continue`, jamais un push');
});

await t('_flushEntity n\'est appelable que depuis _flushAll (aucun contournement)', () => {
  const appels = (HTML.match(/_flushEntity\(/g) || []).length;
  assert.strictEqual(appels, 2, `attendu : 1 définition + 1 appel dans _flushAll (trouvé ${appels})`);
  assert.ok(flushAll.includes('_flushEntity('), 'et cet appel est bien celui de _flushAll');
});

await t('toute lecture serveur marque l\'entité comme réconciliée', () => {
  assert.ok(bodyOf('function _seedCacheFromRemote(entity, rows, state)').includes('_reconciled.add(entity.key)'),
    'le seed du cache est le seul point qui ouvre le droit de pousser');
});

await t('la sync initiale est partagée, pour que le flush du boot puisse l\'attendre', () => {
  assert.ok(/_fetchAllInFlight = p;/.test(HTML), 'fetchAll publie sa promesse');
  assert.ok(flushAll.includes('await _fetchAllInFlight'), '_flushAll l\'attend avant de pousser');
});

await t('le repère de session est pris avant tout, dans les deux points d\'entrée', () => {
  assert.ok(flushAll.trimStart().startsWith('{\n  _captureBaseline(state);'),
    '_captureBaseline est la 1re instruction de _flushAll (avant même le test online)');
  assert.ok(/fetchAll\(state\) \{\s*\n\s*_captureBaseline\(state\);/.test(HTML),
    'et la 1re de fetchAll');
});

console.log(`\n${pass} assertion(s) OK — le flush ne réécrit plus une collection qu'il n'a pas lue.`);
