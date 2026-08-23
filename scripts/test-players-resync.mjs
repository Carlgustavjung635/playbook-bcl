// Re-pull du canal `players` hors PbSync (v.155).
//
// Le bug : `players` a son propre canal (PbStore.fetchPlayers + subscribePlayers)
// et vit HORS du moteur PbSync. Le re-pull de fond de v.139 ne connaît que
// `PbSync.fetchAll` — il ne rafraîchissait donc jamais cette table. Passé le
// boot, un appareil resté ouvert ne voyait plus bouger `last_seen_at` (ni la
// photo, ni le statut médical, ni l'état des notifs) autrement que par le
// websocket Realtime, qu'iOS tue en arrière-plan sans rien rejouer au réveil.
//
// Ce test vérifie (a) le CÂBLAGE statique — les deux points de re-pull appellent
// `_refetchPlayers` —, et (b) la sémantique de `pushLocalOnly`, qui doit rester
// FAUX sur un re-pull sous peine de ressusciter une joueuse supprimée ailleurs.
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

console.log('SCÉNARIO 1 — câblage (statique)');

// Corps de resyncData / refreshFromCloud, isolés par leur signature.
const bodyOf = (sig) => {
  const i = html.indexOf(sig);
  assert.ok(i > 0, sig + ' introuvable');
  return html.slice(i, html.indexOf('\n}', i));
};

t('resyncData re-pull players (pas seulement PbSync.fetchAll)', () => {
  assert.match(bodyOf('async function resyncData('), /_refetchPlayers\(\)/);
});

t('refreshFromCloud (pull-to-refresh) re-pull players', () => {
  assert.match(bodyOf('async function refreshFromCloud('), /_refetchPlayers\(\)/);
});

t('_refetchPlayers passe par PbStore.fetchPlayers et ne jette pas', () => {
  const body = bodyOf('async function _refetchPlayers(');
  assert.match(body, /PbStore\.fetchPlayers\(\)/);
  assert.match(body, /catch/);
});

console.log('SCÉNARIO 2 — pushLocalOnly : boot oui, re-pull non');

const merge = html.slice(
  html.indexOf('function _mergeRemotePlayers('),
  html.indexOf('async function _refetchPlayers(')
);

t('le boot demande pushLocalOnly:true', () => {
  const boot = html.slice(html.indexOf('function _initPlayersSync'));
  assert.match(boot.slice(0, 900), /_mergeRemotePlayers\(remote,\s*\{\s*pushLocalOnly:\s*true\s*\}\)/);
});

t('le re-pull demande pushLocalOnly:false', () => {
  assert.match(bodyOf('async function _refetchPlayers('), /pushLocalOnly:\s*false/);
});

t('upsertPlayer des locales-seules est GARDÉ par pushLocalOnly', () => {
  // Sans la garde, chaque battement de fond repousserait une joueuse supprimée
  // sur un autre appareil — elle réapparaîtrait indéfiniment.
  assert.match(merge, /opts\s*&&\s*opts\.pushLocalOnly.*upsertPlayer/s);
});

console.log('SCÉNARIO 3 — la fusion n\'a rien perdu au passage');

for (const champ of ['lastSeenAt', 'notifPermission', 'injury', 'injuryHistory', 'postes', 'tailleCm', 'dateNaissance', 'feedback', 'photo']) {
  t(`${champ} toujours fusionné`, () => assert.ok(merge.includes(champ + ':')));
}

t('lastSeenAt retombe sur le local si la colonne manque', () => {
  assert.match(merge, /lastSeenAt:\s*rp\.last_seen_at\s*\?[^\n]*lp\.lastSeenAt/);
});

t('pin jamais écrasé par le serveur (colonne absente en base)', () => {
  assert.match(merge, /pin:\s*lp\.pin\s*\|\|\s*'0000'/);
});

console.log(`\n✅ ${n} assertions OK — re-pull du canal players (hors PbSync).`);
