// Test ANNIVERSAIRES À VENIR (admin_coach only).
//   • getUpcomingBirthdays : fenêtre J-7, tri par proximité, âge fêté, J/M ;
//     inclut aujourd'hui (0), exclut hors fenêtre (>7 ou passé) ;
//   • carte visible pour admin_coach uniquement (pas coach non-admin, pas joueuse).
// Extraits FIDÈLES d'index.html.
import assert from 'node:assert';

// ---- SUJET : getUpcomingBirthdays (copie fidèle) ----
function getUpcomingBirthdays(people, daysAhead = 7, ref) {
  const today = ref ? new Date(ref) : new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  (people || []).forEach(person => {
    const dob = person && person.dateNaissance;
    if (!dob) return;
    const b = new Date(String(dob).slice(0, 10) + 'T00:00:00');
    if (isNaN(b.getTime())) return;
    const bm = b.getMonth(), bd = b.getDate();
    let next = new Date(today.getFullYear(), bm, bd); next.setHours(0, 0, 0, 0);
    if (next < today) next = new Date(today.getFullYear() + 1, bm, bd);
    const daysUntil = Math.round((next - today) / 86400000);
    if (daysUntil < 0 || daysUntil > daysAhead) return;
    out.push({
      id: person.id, name: person.name, kind: person.kind || 'player',
      dateNaissance: dob,
      monthDay: String(bd).padStart(2, '0') + '/' + String(bm + 1).padStart(2, '0'),
      daysUntil, turningAge: next.getFullYear() - b.getFullYear(),
      nextBirthdayYear: next.getFullYear()
    });
  });
  out.sort((a, b) => a.daysUntil - b.daysUntil || String(a.name).localeCompare(String(b.name)));
  return out;
}
function _bdayWhen(d) { return d === 0 ? "aujourd'hui !" : d === 1 ? 'demain' : 'dans ' + d + ' jours'; }

// Gating de la carte (fidèle) : admin_coach uniquement + liste non vide.
function birthdayCardVisible(role, coachRole, list) {
  const isAdmin = role === 'coach' && coachRole === 'admin_coach';
  return isAdmin && list.length > 0;
}

let passed = 0;
function ok(l, c) { assert.ok(c, '✗ ' + l); passed++; }

const REF = '2026-07-10'; // jeudi
const people = [
  { id: 'p1', name: 'Alice', kind: 'player', dateNaissance: '2004-07-13' }, // dans 3 jours → 22 ans
  { id: 'p2', name: 'Bea', kind: 'player', dateNaissance: '2006-07-10' },   // aujourd'hui → 20 ans
  { id: 'p3', name: 'Chloe', kind: 'player', dateNaissance: '2005-07-17' }, // dans 7 jours (limite) → 21 ans
  { id: 'p4', name: 'Dora', kind: 'player', dateNaissance: '2005-07-18' },  // dans 8 jours → HORS fenêtre
  { id: 'p5', name: 'Eve', kind: 'player', dateNaissance: '2005-07-09' },   // hier → prochain dans 364j → HORS
  { id: 'c1', name: 'Coach Sophie', kind: 'coach', dateNaissance: '1990-07-11' }, // demain → 36 ans
  { id: 'p6', name: 'Fanny', kind: 'player', dateNaissance: null },          // pas de dob → ignorée
];

const list = getUpcomingBirthdays(people, 7, REF);

// === Inclusion / exclusion ===
ok('4 anniversaires dans la fenêtre J-7', list.length === 4);
const ids = list.map(b => b.id);
ok('inclut aujourd\'hui (p2)', ids.includes('p2'));
ok('inclut la limite J-7 (p3, dans 7 jours)', ids.includes('p3'));
ok('exclut J-8 (p4)', !ids.includes('p4'));
ok('exclut anniversaire d\'hier (p5)', !ids.includes('p5'));
ok('ignore les personnes sans date de naissance (p6)', !ids.includes('p6'));
ok('inclut les coachs (c1)', ids.includes('c1'));

// === Tri par proximité ===
ok('tri : Bea (0) en premier', list[0].id === 'p2' && list[0].daysUntil === 0);
ok('tri : Coach Sophie (1) en second', list[1].id === 'c1' && list[1].daysUntil === 1);
ok('tri : Alice (3) puis Chloe (7)', list[2].id === 'p1' && list[3].id === 'p3');

// === Champs calculés ===
const bea = list.find(b => b.id === 'p2');
ok('Bea : âge fêté = 20 ans', bea.turningAge === 20);
ok('Bea : monthDay = 10/07', bea.monthDay === '10/07');
ok('Bea : "aujourd\'hui !"', _bdayWhen(bea.daysUntil) === "aujourd'hui !");
ok('Coach Sophie : "demain"', _bdayWhen(list.find(b => b.id === 'c1').daysUntil) === 'demain');
ok('Alice : "dans 3 jours" + 22 ans', _bdayWhen(list.find(b => b.id === 'p1').daysUntil) === 'dans 3 jours' && list.find(b => b.id === 'p1').turningAge === 22);
ok('Coach Sophie : kind coach', list.find(b => b.id === 'c1').kind === 'coach');

// === Passage d'année (décembre → janvier) ===
const yearWrap = getUpcomingBirthdays([{ id: 'x', name: 'X', dateNaissance: '2000-01-02' }], 7, '2025-12-30');
ok('anniversaire 02/01 vu depuis le 30/12 (dans 3 jours)', yearWrap.length === 1 && yearWrap[0].daysUntil === 3 && yearWrap[0].turningAge === 26);

// === 0 anniversaire ===
ok('fenêtre vide → liste vide', getUpcomingBirthdays(people, 7, '2026-01-01').length === 0);

// === Gating de la carte par rôle ===
ok('admin_coach voit la carte', birthdayCardVisible('coach', 'admin_coach', list) === true);
ok('coach non-admin NE voit PAS la carte', birthdayCardVisible('coach', 'coach', list) === false);
ok('joueuse NE voit PAS la carte', birthdayCardVisible('player', null, list) === false);
ok('admin_coach mais fenêtre vide → pas de carte', birthdayCardVisible('coach', 'admin_coach', []) === false);

console.log(`\n✓ ${passed} assertions passées — anniversaires à venir (admin only) OK`);
