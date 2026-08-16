// Test de non-régression : « les disponibilités ne sont pas enregistrées, je
// change de device et je ne les retrouve pas toutes » (v.105).
//
// CAUSE — l'app a DEUX gisements d'indisponibilité, et un seul était synchronisé :
//   • 🏖️ player_unavailabilities (migration 20260729_004) → entité PbSync, sync OK
//   • ⚠ p.injury.status === 'indispo' (statut médical de la fiche joueuse)
//     → AUCUNE colonne en base, absent de PbStore.upsertPlayer ET de
//       fetchPlayers. Écrit par saveInjury() qui n'appelait que persist().
// resolveEffectivePresence() interroge les deux pour décider qui est absente par
// défaut : tant que le second restait dans le localStorage, la feuille de
// présence différait d'un appareil à l'autre. D'où « certaines oui, pas toutes ».
//
// FIX v.105 — colonnes players.injury / injury_history (migration 20260806_001),
// lues par fetchPlayers, écrites par PbStore.updateInjury (UPDATE CIBLÉ de ces
// deux colonnes SEULEMENT — surtout pas via upsertPlayer qui pousse la ligne
// entière, cf. le mode de panne v.104).
import assert from 'node:assert';
import fs from 'node:fs';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

function bodyOf(signature) {
  const i = HTML.indexOf(signature);
  assert.notStrictEqual(i, -1, `introuvable dans index.html : ${signature}`);
  let d = 0; const start = HTML.indexOf('{', i);
  for (let j = start; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(start, j + 1);
  }
  throw new Error('accolades non appariées : ' + signature);
}

// ---------------------------------------------------------------------------
console.log('LE STATUT MÉDICAL QUITTE L\'APPAREIL');

t('la saisie pousse au serveur, pas seulement en localStorage', () => {
  const save = bodyOf('function saveInjury(pid)');
  assert.ok(save.includes('persist()'), 'toujours persisté en local');
  assert.ok(save.includes('_pushInjury(p)'), 'ET poussé au serveur (c\'était ÇA qui manquait)');
});

t('la guérison aussi (elle efface le statut : une suppression doit voyager)', () => {
  const healed = bodyOf('function markAsHealed(pid)');
  assert.ok(healed.includes('delete p.injury'), 'le statut courant est effacé');
  assert.ok(healed.includes('_pushInjury(p)'), 'et l\'effacement est propagé');
});

t('fetchPlayers rapatrie les colonnes (sinon on pousse dans le vide)', () => {
  const f = bodyOf('async fetchPlayers()');
  assert.ok(/select\('[^']*\binjury\b[^']*'\)/.test(f), 'injury est dans le select');
  assert.ok(/select\('[^']*injury_history[^']*'\)/.test(f), 'injury_history aussi');
});

t('la fusion au boot préfère le serveur, sans écraser si la colonne manque', () => {
  assert.ok(/injury: \(rp\.injury !== undefined\) \? \(rp\.injury \|\| null\) : \(lp\.injury \|\| null\)/.test(HTML),
    'colonne absente (migration non passée) → rp.injury undefined → on garde le local');
  assert.ok(/injuryHistory: Array\.isArray\(rp\.injury_history\)/.test(HTML),
    'historique repris du serveur quand il est là');
});

// ---------------------------------------------------------------------------
console.log('\nL\'ÉCRITURE EST CIBLÉE — pas de récidive du mode de panne v.104');

t('updateInjury n\'écrit QUE les deux colonnes du statut médical', () => {
  const u = bodyOf('async updateInjury(p)');
  assert.ok(u.includes(".update({"), 'un UPDATE, pas un upsert de ligne entière');
  assert.ok(u.includes('.eq(\'id\', p.id)'), 'ciblé sur une joueuse');
  ['name', 'num', 'photo', 'feedback', 'postes', 'taille_cm'].forEach(col => {
    assert.ok(!u.includes(col + ':'), `updateInjury ne doit pas toucher \`${col}\``);
  });
});

t('upsertPlayer NE porte PAS le statut médical', () => {
  const up = bodyOf('async upsertPlayer(p)');
  assert.ok(!/injury/.test(up),
    'sinon une correction de nom depuis un appareil périmé écraserait un statut saisi ailleurs');
});

// ---------------------------------------------------------------------------
console.log('\nCLOISONNEMENT — la donnée médicale ne doit pas fuiter vers la joueuse');

t('la carte « Mes retours » ne lit toujours que l\'allow-list', () => {
  // Avant v.105, `p.injury` était vide sur un appareil joueuse PAR ACCIDENT : il
  // n'était jamais synchronisé. Il y sera désormais peuplé — l'allow-list
  // devient donc la SEULE barrière, et elle doit le rester.
  const card = bodyOf('function renderPlayerFeedbackCard()');
  assert.ok(!/injury/.test(card), 'la carte ne touche jamais au médical');
  assert.ok(card.includes('getFeedback(p)'), 'elle passe par l\'allow-list getFeedback()');
});

t('getFeedback() ne rend QUE positives / negatives / technicals', () => {
  const g = bodyOf('function getFeedback(');
  assert.ok(!/injury/.test(g), 'aucun accès au médical dans l\'allow-list elle-même');
  ['positives', 'negatives', 'technicals'].forEach(k =>
    assert.ok(g.includes(k), `${k} est bien rendu`));
});

t('les écrans qui AFFICHENT p.injury restent côté coach', () => {
  // Un rendu de `p.injury` hors session coach exposerait du médical à la joueuse.
  // On vérifie que chaque site de rendu vit dans une fonction coach.
  const COACH_ONLY = ['function openRosterManager(', 'function openInjuryModal(', 'function injuryBadge('];
  COACH_ONLY.forEach(sig => assert.notStrictEqual(HTML.indexOf(sig), -1, `${sig} existe toujours`));
  // renderPlayerHome / les écrans joueuse ne doivent contenir aucun p.injury.
  ['function renderPlayerHome(', 'function renderPlayerMatches('].forEach(sig => {
    if (HTML.indexOf(sig) === -1) return;               // écran renommé : rien à vérifier
    assert.ok(!/p\.injury|player\.injury/.test(bodyOf(sig)), `${sig} n'affiche pas de médical`);
  });
});

console.log(`\n${pass} assertion(s) OK — une indispo déclarée sur un téléphone se retrouve sur l'autre.`);
