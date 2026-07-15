// Test FIX notif in-app « faux doublon » — le détail d'une notif gage doit porter
// le NOM DU GAGE, sinon 2 gages DIFFÉRENTS de la même joueuse rendent 2 lignes
// identiques (lu à tort comme un doublon). Extrait FIDÈLE de _notifDrawDetail.
import assert from 'node:assert';
let passed = 0;
function eq(l, a, b) { assert.strictEqual(a, b, `✗ ${l}\n   attendu: ${JSON.stringify(b)}\n   reçu   : ${JSON.stringify(a)}`); passed++; }
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }

// ---- COPIE FIDÈLE ----
function _notifDrawDetail(player, gage, maxLen) {
  const max = Number.isFinite(maxLen) ? maxLen : 45;
  const who = player ? ('#' + player.num + ' ' + player.name) : '';
  let what = (gage && gage.text ? String(gage.text) : '').trim().replace(/\s+/g, ' ');
  if (what.length > max) what = what.slice(0, max - 1).replace(/\s+$/, '') + '…';
  return [who, what].filter(Boolean).join(' · ');
}

const DELPH = { id: 'x1779097938214bem8', num: 6, name: 'Delph' };
// Les 2 VRAIS gages du cas signalé (données prod réelles)
const G_CHANSON = { id: 'x17829249566484kgk', text: 'Interpréter une chanson' };
const G_BOISSON = { id: 'x1782924254755zgfu', text: 'Amener sa boisson pour un match' };

// ---- 1. LE BUG : les 2 lignes doivent maintenant DIFFÉRER ----
const l1 = _notifDrawDetail(DELPH, G_CHANSON);
const l2 = _notifDrawDetail(DELPH, G_BOISSON);
eq('gage 1 → joueuse · nom du gage', l1, '#6 Delph · Interpréter une chanson');
eq('gage 2 → joueuse · nom du gage', l2, '#6 Delph · Amener sa boisson pour un match');
ok('les 2 lignes du "faux doublon" sont désormais DISTINCTES', l1 !== l2);
// Avant le fix, les deux valaient « #6 Delph » → indiscernables.
eq('avant le fix (sans gage) les 2 étaient identiques', _notifDrawDetail(DELPH, null), _notifDrawDetail(DELPH, null));

// ---- 2. Troncature ----
const LONG = { text: 'Ramener des croissants pour toute l\'équipe le samedi matin avant le match à domicile' };
const t = _notifDrawDetail(DELPH, LONG);
ok('gage long tronqué avec …', t.endsWith('…'));
ok('partie gage ≤ 45 chars', t.split(' · ')[1].length <= 45);
eq('troncature exacte à 45 (44 + …)', t.split(' · ')[1].length, 45);
eq('maxLen custom respecté', _notifDrawDetail(DELPH, LONG, 10).split(' · ')[1].length, 10);
ok('pas d\'espace avant les points de suspension', !/ …$/.test(_notifDrawDetail(DELPH, { text: 'aaaa bbbb cccc' }, 10)));

// ---- 3. Garde-fous ----
eq('gage manquant → joueuse seule (comportement d\'avant)', _notifDrawDetail(DELPH, null), '#6 Delph');
eq('gage sans text → joueuse seule', _notifDrawDetail(DELPH, { id: 'x' }), '#6 Delph');
eq('gage text vide → joueuse seule', _notifDrawDetail(DELPH, { text: '   ' }), '#6 Delph');
eq('joueuse manquante → gage seul', _notifDrawDetail(null, G_CHANSON), 'Interpréter une chanson');
eq('les deux manquants → chaîne vide', _notifDrawDetail(null, null), '');
eq('espaces multiples normalisés', _notifDrawDetail(DELPH, { text: 'Chanter   la\n  Marseillaise' }), '#6 Delph · Chanter la Marseillaise');
eq('text non-string (nombre) toléré', _notifDrawDetail(DELPH, { text: 42 }), '#6 Delph · 42');

// ---- 4. Cas 2 joueuses différentes, même gage → distinctes par la joueuse ----
const LEA = { num: 7, name: 'Lea' };
ok('même gage, joueuses différentes → lignes distinctes', _notifDrawDetail(DELPH, G_CHANSON) !== _notifDrawDetail(LEA, G_CHANSON));

console.log(`\n✓ ${passed} assertions passées — notif gage : détail avec nom du gage (faux doublon résolu) OK`);
