// Test de la protection du « hard reset » (chantier sécurité).
// Vérifie :
//  1) la joueuse ne voit JAMAIS le bouton (gating strict role === 'coach') ;
//  2) le bouton vit dans une « Zone dangereuse » dédiée (bordure rouge) ;
//  3) la modale exige le mot SUPPRIMER tapé à l'identique (case-sensitive) ;
//  4) no-op si le mot ne correspond pas, et garde-fou défensif si non-coach ;
//  5) une trace d'audit datée est écrite hors espace pb8_ (survit au reset).
//
// Les comportements (no-op, log, garde-fou) sont testés en EXÉCUTANT les vraies
// fonctions extraites du source dans un sandbox (localStorage/document stubés).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 1 — gating strict : la joueuse ne voit pas le bouton');

// Le corps de openSettings (jusqu'à la fonction suivante).
const setBlock = html.slice(html.indexOf('function openSettings()'), html.indexOf('function confirmLogout()'));

t('confirmHardReset() apparaît une seule fois dans openSettings', () => {
  assert.strictEqual((setBlock.match(/confirmHardReset\(\)/g) || []).length, 1);
});
t('le bouton reset est DANS une ternaire role === \'coach\'', () => {
  // La zone dangereuse (avec l'appel) est enveloppée par ${role === 'coach' ? ` ... ` : ''}
  assert.ok(/\$\{role === 'coach' \? `[\s\S]*?Zone dangereuse[\s\S]*?confirmHardReset\(\)[\s\S]*?` : ''\}/.test(setBlock));
});
t('le bloc role === \'player\' ne contient PAS le reset', () => {
  const playerBlock = (setBlock.match(/\$\{role === 'player' \? `([\s\S]*?)` : ''\}/) || [])[1] || '';
  assert.ok(!/confirmHardReset|Réinitialiser/.test(playerBlock));
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 2 — « Zone dangereuse » dédiée (bordure rouge)');
t('libellé « Zone dangereuse » présent', () => assert.ok(/⚠ Zone dangereuse/.test(setBlock)));
t('bordure rouge sur le conteneur', () => assert.ok(/border:1\.5px solid var\(--red\)/.test(setBlock)));

// ---------------------------------------------------------------------------
// Extraction du code réel (consts + 3 fonctions) et exécution en sandbox.
const src = html.slice(
  html.indexOf("const HARD_RESET_WORD = 'SUPPRIMER';"),
  html.indexOf('function openPublicShare()')
);

function makeLS() {
  const ls = {};
  Object.defineProperties(ls, {
    getItem: { value: k => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null) },
    setItem: { value: (k, v) => { ls[k] = String(v); } },
    removeItem: { value: k => { delete ls[k]; } },
  });
  return ls; // Object.keys(ls) ne renvoie que les clés de données (méthodes non-énumérables)
}

function makeSandbox() {
  const alerts = [];
  const modal = { html: null, closed: false };
  const els = {
    'reset-confirm': { value: '', focus() {} },
    'reset-go': { disabled: true, style: { opacity: '0.45', pointerEvents: 'none' } },
  };
  const document = { getElementById: id => els[id] || null };
  const localStorage = makeLS();
  const window = { location: { reload() { modal.reloaded = true; } } };
  const state = { auth: { role: 'coach' } };
  const K = { auth: 'pb8_auth', plays: 'pb8_plays', matches: 'pb8_matches' };
  const factory = new Function(
    'state', 'openModal', 'closeModal', 'alert', 'document', 'localStorage', 'window', 'setTimeout', 'K',
    src + '\nreturn { confirmHardReset, syncHardResetBtn, doHardReset, HARD_RESET_WORD, HARD_RESET_AUDIT_KEY };'
  );
  const api = factory(
    state,
    h => { modal.html = h; },
    () => { modal.closed = true; },
    msg => alerts.push(msg),
    document,
    localStorage,
    window,
    () => {}, // setTimeout no-op (pas de reload/focus async pendant le test)
    K
  );
  return { api, alerts, modal, els, localStorage, state };
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 3 — la modale exige SUPPRIMER (exact, case-sensitive)');
{
  const s = makeSandbox();
  t('HARD_RESET_WORD === \'SUPPRIMER\'', () => assert.strictEqual(s.api.HARD_RESET_WORD, 'SUPPRIMER'));
  t('clé d\'audit hors espace pb8_', () => assert.ok(!s.api.HARD_RESET_AUDIT_KEY.startsWith('pb8_')));

  s.api.confirmHardReset();
  t('confirmHardReset (coach) ouvre la modale avec le mot et l\'input', () => {
    assert.ok(/SUPPRIMER/.test(s.modal.html));
    assert.ok(/id="reset-confirm"/.test(s.modal.html));
  });
  t('le bouton final est désactivé par défaut', () => {
    assert.ok(/id="reset-go"[^>]*\sdisabled/.test(s.modal.html));
  });

  // syncHardResetBtn : (dé)verrouille selon la saisie
  s.els['reset-confirm'].value = 'supprimer'; // mauvaise casse
  s.api.syncHardResetBtn();
  t('mauvaise casse → bouton reste désactivé', () => assert.strictEqual(s.els['reset-go'].disabled, true));

  s.els['reset-confirm'].value = 'SUPPRIMER ';
  s.api.syncHardResetBtn();
  t('espace en trop → bouton reste désactivé', () => assert.strictEqual(s.els['reset-go'].disabled, true));

  s.els['reset-confirm'].value = 'SUPPRIMER';
  s.api.syncHardResetBtn();
  t('match exact → bouton activé', () => assert.strictEqual(s.els['reset-go'].disabled, false));
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 4 — no-op si le mot ne match pas / si non-coach');
{
  const s = makeSandbox();
  s.localStorage.setItem('pb8_auth', '{}');
  s.localStorage.setItem('pb8_matches', '[1]');
  s.els['reset-confirm'].value = 'supprimer'; // pas exact
  s.api.doHardReset();
  t('mot incorrect → alerte + AUCUNE donnée effacée', () => {
    assert.ok(s.alerts.some(a => /SUPPRIMER/.test(a)));
    assert.strictEqual(s.localStorage.getItem('pb8_matches'), '[1]');
    assert.strictEqual(s.localStorage.getItem(s.api.HARD_RESET_AUDIT_KEY), null);
  });
}
{
  const s = makeSandbox();
  s.state.auth.role = 'player'; // garde-fou défensif
  s.localStorage.setItem('pb8_matches', '[1]');
  s.els['reset-confirm'].value = 'SUPPRIMER'; // mot correct mais rôle interdit
  s.api.doHardReset();
  t('non-coach → alerte « réservée au coach » + no-op', () => {
    assert.ok(s.alerts.some(a => /coach/i.test(a)));
    assert.strictEqual(s.localStorage.getItem('pb8_matches'), '[1]');
  });
  // confirmHardReset doit aussi refuser au non-coach (modale jamais ouverte)
  s.api.confirmHardReset();
  t('confirmHardReset (non-coach) n\'ouvre pas la modale', () => assert.strictEqual(s.modal.html, null));
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 5 — reset effectif + trace d\'audit datée');
{
  const s = makeSandbox();
  s.localStorage.setItem('pb8_auth', '{}');
  s.localStorage.setItem('pb8_matches', '[1,2]');
  s.localStorage.setItem('pb8_live', 'x');       // clé pb8_ hors K
  s.localStorage.setItem('bcl_keepme', 'garde');  // clé hors pb8_ : doit survivre
  s.els['reset-confirm'].value = 'SUPPRIMER';
  s.api.doHardReset();
  t('toutes les clés pb8_ sont effacées', () => {
    assert.strictEqual(s.localStorage.getItem('pb8_auth'), null);
    assert.strictEqual(s.localStorage.getItem('pb8_matches'), null);
    assert.strictEqual(s.localStorage.getItem('pb8_live'), null);
  });
  t('les clés hors pb8_ survivent', () => assert.strictEqual(s.localStorage.getItem('bcl_keepme'), 'garde'));
  t('trace d\'audit écrite (date ISO + by:coach)', () => {
    const raw = s.localStorage.getItem(s.api.HARD_RESET_AUDIT_KEY);
    assert.ok(raw, 'audit manquant');
    const log = JSON.parse(raw);
    assert.strictEqual(log.by, 'coach');
    assert.ok(!Number.isNaN(Date.parse(log.at)), 'date invalide');
  });
}

console.log(`\n✅ ${pass} assertions OK — protection du hard reset (coach-only + confirmation forte + audit).`);
