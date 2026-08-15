// Test de l'heure exacte de dernière connexion (effectif coach).
// Le label du badge porte l'heure PRÉCISE à la seconde, avec un repère de date
// qui se resserre selon l'ancienneté :
//   aujourd'hui  → "16:33:24"
//   hier         → "hier 20:45:11"
//   cette semaine→ "lundi 15:22:03"
//   plus ancien  → "12/08 à 18:44:07"
// `exact` = "DD/MM/YYYY à HH:mm:ss" (année COMPLÈTE) reste le tooltip (title).
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
const badge = new Function(extractFn('_lastSeenBadge') + '\nreturn _lastSeenBadge;')();

// Ancrage sur MINUIT du jour courant : les cas ci-dessous restent vrais quelle
// que soit l'heure à laquelle le test tourne (un « il y a 2h » brut basculerait
// sur « hier » entre 00h et 02h).
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const DAY = 86400000;
const at = (dayOffset, h, m, s) => midnight.getTime() + dayOffset * DAY + h * 3600000 + m * 60000 + s * 1000;
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

console.log('SCÉNARIO 1 — le label dit les secondes');
t("aujourd'hui → heure nue « 16:33:24 »", () => {
  assert.strictEqual(badge(at(0, 16, 33, 24)).label, '16:33:24');
});
t('hier → « hier 20:45:11 »', () => {
  assert.strictEqual(badge(at(-1, 20, 45, 11)).label, 'hier 20:45:11');
});
t('cette semaine (J-3) → « <jour> 15:22:03 »', () => {
  const ms = at(-3, 15, 22, 3);
  assert.strictEqual(badge(ms).label, JOURS[new Date(ms).getDay()] + ' 15:22:03');
});
t('J-6 encore nommé par son jour (borne < 7)', () => {
  const ms = at(-6, 9, 5, 7);
  assert.strictEqual(badge(ms).label, JOURS[new Date(ms).getDay()] + ' 09:05:07');
});
t('J-7 bascule sur la date courte « DD/MM à HH:mm:ss »', () => {
  const ms = at(-7, 18, 44, 7);
  const d = new Date(ms), z = n => String(n).padStart(2, '0');
  assert.strictEqual(badge(ms).label, z(d.getDate()) + '/' + z(d.getMonth() + 1) + ' à 18:44:07');
});
t('zéros de tête partout (00:00:00 à minuit pile)', () => {
  assert.strictEqual(badge(at(0, 0, 0, 0)).label, '00:00:00');
});

console.log("SCÉNARIO 2 — l'écart se compte en jours de CALENDRIER, pas en heures");
t('hier 23:50 relu aujourd\'hui reste « hier » (< 24h écoulées)', () => {
  const r = badge(at(-1, 23, 50, 0));
  assert.ok(r.label.startsWith('hier '), 'label = ' + r.label);
});
t('même connexion : couleur toujours pilotée par les heures écoulées', () => {
  // < 24h écoulées → vert, même si le libellé dit « hier ».
  const ms = Date.now() - 2 * 3600000;
  assert.ok(/green/.test(badge(ms).color));
});

console.log('SCÉNARIO 3 — tooltip `exact` : date complète + secondes');
t('2 juillet 2026 14:32:09 → "02/07/2026 à 14:32:09"', () => {
  const ms = new Date(2026, 6, 2, 14, 32, 9).getTime();
  assert.strictEqual(badge(ms).exact, '02/07/2026 à 14:32:09');
});
t('5 janvier 2026 09:05:00 → zéros de tête OK', () => {
  const ms = new Date(2026, 0, 5, 9, 5, 0).getTime();
  assert.strictEqual(badge(ms).exact, '05/01/2026 à 09:05:00');
});

console.log('SCÉNARIO 4 — edge case : jamais vue');
t('lastSeenAt null → « jamais vue », exact vide (pas de tooltip)', () => {
  assert.strictEqual(badge(null).exact, '');
  assert.strictEqual(badge(null).label, 'jamais vue');
  assert.ok(/red/.test(badge(null).color));
});
t('lastSeenAt 0 (falsy) → exact = ""', () => assert.strictEqual(badge(0).exact, ''));

console.log('SCÉNARIO 5 — câblage : title=exact sur les écrans Effectif');
t('onglet Saison (_effectifSeasonBody) : title "Dernière connexion : ${ls.exact}"', () => {
  const b = extractFn('_effectifSeasonBody');
  assert.ok(/\$\{ls\.exact \? ` title="Dernière connexion : \$\{ls\.exact\}"` : ''\}/.test(b));
});
t('onglet Roster (_effectifRosterBody) : title "Dernière connexion : ${ls.exact}"', () => {
  const b = extractFn('_effectifRosterBody');
  assert.ok(/\$\{ls\.exact \? ` title="Dernière connexion : \$\{ls\.exact\}"` : ''\}/.test(b));
});
t('panneau saison : "Vue " préfixe le label, mais JAMAIS "jamais vue"', () => {
  const b = extractFn('openPlayerSeasonPanel');
  assert.ok(/\$\{ls\.exact \? 'Vue ' : ''\}\$\{ls\.label\}/.test(b), 'préfixe conditionné à ls.exact');
  assert.ok(/ls\.exact \? ` title="Dernière connexion : \$\{ls\.exact\}"` : ''/.test(b), 'tooltip aussi dans le panneau');
});
t('3 tooltips au total (2 listes + panneau saison)', () => {
  assert.strictEqual((html.match(/ls\.exact \? ` title="Dernière connexion/g) || []).length, 3);
});

console.log(`\n✅ ${pass} assertions OK — heure exacte (secondes) de dernière connexion.`);
