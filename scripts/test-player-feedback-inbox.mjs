// Test de l'affichage côté JOUEUSE du feedback du coach (Option A + technicals).
// Vérifie : carte masquée si aucun feedback ; carte + pastille NEW si non lu ;
// modale liste qualités/axes/OBJECTIFS TECHNIQUES (via mdToHtml) ; marquage lu
// (filigrane) ; entrée cloche notifFeed ; saisie coach des technicals ; et
// SÉCURITÉ : aucun champ privé (player.injury…) n'est jamais exposé. Les
// fonctions sont exécutées pour de vrai (sandbox).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

// Extracteur par comptage d'accolades (chaque ${...} est équilibré).
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'fonction introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('accolades non équilibrées : ' + name);
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 1 — câblage & sécurité (statique)');
t('la carte est appelée dans renderHomePlayer (sous l\'inbox)', () => {
  const home = html.slice(html.indexOf('function renderHomePlayer'), html.indexOf('function renderHomePlayerFFBB'));
  assert.ok(/renderPlayerInbox\(\)[\s\S]{0,200}renderPlayerFeedbackCard\(\)/.test(home));
});
t('commentaire SECURITY présent sur la carte joueuse (inclut technicals)', () => {
  assert.ok(/SECURITY:[\s\S]{0,500}feedback\.positives \/ player\.feedback\.negatives \/ player\.feedback\.technicals/.test(html));
});
t('renderPlayerFeedbackCard ne référence JAMAIS .injury (code, hors commentaires)', () => {
  // Strippe les commentaires // ... (qui mentionnent légitimement .injury dans
  // la note SECURITY) avant de chercher une vraie référence dans le code.
  const strip = s => s.replace(/\/\/[^\n]*/g, '');
  const src = strip(extractFn(html, 'renderPlayerFeedbackCard') + extractFn(html, 'openMyFeedback'));
  assert.ok(!/\.injury/.test(src), 'fuite potentielle : .injury référencé dans le code');
  assert.ok(!/\.prepComment|\.coachNote|injuryHistory/.test(src));
});
t('entrée feedback dans notifFeed (branche player) : icône 📝 + action + objectifs techniques', () => {
  const feed = html.slice(html.indexOf('function notifFeed'), html.indexOf('function appBadgeCount'));
  assert.ok(/id: 'feedback-' \+ pid/.test(feed));
  assert.ok(/icon: '📝', title: 'Retour du coach'/.test(feed));
  assert.ok(/action: 'openMyFeedback\(\)'/.test(feed));
  assert.ok(/unread: fts > seen/.test(feed));
  assert.ok(/technicals/.test(feed) && /objectif/.test(feed), 'le compte des objectifs techniques manque dans la cloche');
  // notifFeed n'expose QUE positives/negatives/technicals/updatedAt
  assert.ok(!/meFb\.injury|meFb\.feedback\.(?!positives|negatives|technicals|updatedAt)/.test(feed));
});
t('éditeur coach : section technique + FB_SUGGEST_TECH + suggestions basket', () => {
  assert.ok(/const FB_SUGGEST_TECH = \[/.test(html));
  for (const s of ['Footwork', 'Eurostep', 'Flotteur', 'Lancer franc', 'Jeu dos au panier', 'Saut de recul']) {
    assert.ok(html.includes("'" + s + "'"), 'suggestion technique manquante : ' + s);
  }
  const ed = extractFn(html, 'renderFeedbackEditor');
  assert.ok(/Points techniques à travailler/.test(ed));
  assert.ok(/addFeedbackItem\('technicals'\)/.test(ed));
  assert.ok(/suggest-tech/.test(ed));
});

// ---------------------------------------------------------------------------
// Sandbox : exécution réelle de getFeedback + renderPlayerFeedbackCard + openMyFeedback.
const concatSrc = ['getFeedback', 'renderPlayerFeedbackCard', 'openMyFeedback'].map(n => extractFn(html, n)).join('\n\n');

function makeSandbox(player, { seenAt = 0 } = {}) {
  const log = { modalHtml: null, mdCalls: [], seenSet: [], badgeUpdated: 0 };
  let _seen = seenAt;
  const factory = new Function(
    'currentPlayer', 'getNotifSeenAt', 'setNotifSeenAt', '_notifAgo', 'esc', 'mdToHtml',
    'openModal', 'updateAppBadge', 'render',
    concatSrc + '\nreturn { getFeedback, renderPlayerFeedbackCard, openMyFeedback };'
  );
  const api = factory(
    () => player,                                    // currentPlayer
    () => _seen,                                     // getNotifSeenAt
    ts => { _seen = ts; log.seenSet.push(ts); },     // setNotifSeenAt
    () => 'il y a 3 j',                              // _notifAgo
    s => String(s),                                  // esc (identité)
    s => { log.mdCalls.push(s); return 'MD<' + s + '>'; }, // mdToHtml spy
    h => { log.modalHtml = h; },                     // openModal
    () => { log.badgeUpdated++; },                   // updateAppBadge
    () => {}                                         // render
  );
  return { api, log };
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 2 — carte masquée si aucun feedback');
{
  const { api } = makeSandbox({ id: 'p1', name: 'Lea', num: 7 }); // pas de .feedback
  t('renderPlayerFeedbackCard → "" (pas de carte vide)', () => {
    assert.strictEqual(api.renderPlayerFeedbackCard(), '');
  });
  const { api: api2 } = makeSandbox({ id: 'p1', feedback: { positives: [], negatives: [] } });
  t('feedback vide {} → "" aussi', () => assert.strictEqual(api2.renderPlayerFeedbackCard(), ''));
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 3 — carte affichée + pastille NEW selon filigrane');
{
  const player = { id: 'p1', name: 'Lea', num: 7,
    feedback: { positives: ['Énergie défensive'], negatives: ['Choix de tirs', 'Communication'],
      technicals: ['Eurostep', 'Flotteur', 'Lancer franc'], updatedAt: 5000 } };
  const { api } = makeSandbox(player, { seenAt: 0 }); // jamais vu
  const cardNew = api.renderPlayerFeedbackCard();
  t('carte rendue avec résumé "1 qualité · 2 axes · 3 objectifs techniques"', () => {
    assert.ok(cardNew.includes('1 qualité'));
    assert.ok(cardNew.includes('2 axes de progression'));
    assert.ok(cardNew.includes('3 objectifs techniques'));
    assert.ok(cardNew.includes('openMyFeedback()'));
  });
  t('pastille NEW visible quand updatedAt > filigrane', () => assert.ok(/NEW</.test(cardNew)));

  const { api: apiSeen } = makeSandbox(player, { seenAt: 9999 }); // déjà vu (filigrane > updatedAt)
  t('pastille NEW absente quand déjà vu', () => assert.ok(!/NEW</.test(apiSeen.renderPlayerFeedbackCard())));
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 4 — modale détail : qualités/axes via mdToHtml + marquage lu');
{
  const player = { id: 'p1', name: 'Lea',
    feedback: { positives: ['**Énergie** défensive'], negatives: ['Choix de tirs'],
      technicals: ['Eurostep', 'Saut de recul'], updatedAt: 5000 },
    injury: { status: 'indispo', description: 'SECRET_MEDICAL_PRIVE' } }; // champ privé piège
  const { api, log } = makeSandbox(player, { seenAt: 0 });
  api.openMyFeedback();
  t('openModal appelé avec les trois sections (qualités / axes / objectifs techniques)', () => {
    assert.ok(log.modalHtml.includes('Tes qualités'));
    assert.ok(log.modalHtml.includes('Axes de progression'));
    assert.ok(log.modalHtml.includes('Objectifs techniques de saison'));
    assert.ok(/compétences techniques sur lesquelles ta coach/.test(log.modalHtml));
  });
  t('chaque item (dont technicals) passé par mdToHtml (rendu markdown XSS-safe)', () => {
    assert.ok(log.mdCalls.includes('**Énergie** défensive'));
    assert.ok(log.mdCalls.includes('Choix de tirs'));
    assert.ok(log.mdCalls.includes('Eurostep'));
    assert.ok(log.mdCalls.includes('Saut de recul'));
    assert.ok(log.modalHtml.includes('MD<Eurostep>'));
  });
  t('texte d\'aide présent', () => assert.ok(/retours de ta coach pour t'aider à progresser/.test(log.modalHtml)));
  t('marquage lu : setNotifSeenAt appelé + badge mis à jour', () => {
    assert.ok(log.seenSet.length === 1 && log.seenSet[0] > 0);
    assert.strictEqual(log.badgeUpdated, 1);
  });
  t('SÉCURITÉ : le champ médical privé n\'apparaît JAMAIS dans la modale', () => {
    assert.ok(!log.modalHtml.includes('SECRET_MEDICAL_PRIVE'));
    assert.ok(!log.modalHtml.includes('indispo'));
  });
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 5 — SÉCURITÉ carte : aucun champ privé exposé');
{
  const player = { id: 'p1', name: 'Lea', num: 7,
    feedback: { positives: ['Adresse à 3pts'], negatives: [], updatedAt: 5000 },
    injury: { status: 'en soin', description: 'SECRET_MEDICAL_PRIVE', restrictions: 'NE_PAS_FUITER' } };
  const { api } = makeSandbox(player, { seenAt: 0 });
  const card = api.renderPlayerFeedbackCard();
  t('la carte n\'expose ni description ni restrictions médicales', () => {
    assert.ok(!card.includes('SECRET_MEDICAL_PRIVE'));
    assert.ok(!card.includes('NE_PAS_FUITER'));
    assert.ok(!card.includes('en soin'));
  });
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 6 — saisie coach : saveFeedback persiste les technicals');
{
  const saveSrc = ['getFeedback', 'saveFeedback'].map(n => extractFn(html, n)).join('\n\n');
  const state = { players: [{ id: 'p1', name: 'Lea' }], _editingFeedback: {
    pid: 'p1',
    positives: ['Adresse à 3pts', '  '], // espaces → filtrés
    negatives: [],
    technicals: ['Eurostep', 'Flotteur', '  '], // 1 vide filtré
  } };
  let persisted = 0;
  const factory = new Function('state', 'persist', 'window', 'closeModal', 'editPlayer', 'setTimeout',
    saveSrc + '\nreturn { saveFeedback };');
  const api = factory(state, () => { persisted++; }, { PbStore: null }, () => {}, () => {}, () => {});
  api.saveFeedback();
  t('p.feedback.technicals sauvegardés (vides filtrés)', () => {
    assert.deepStrictEqual(state.players[0].feedback.technicals, ['Eurostep', 'Flotteur']);
    assert.deepStrictEqual(state.players[0].feedback.positives, ['Adresse à 3pts']);
    assert.ok(persisted >= 1);
  });
}
{
  // Tout vide (y compris technicals) → feedback supprimé.
  const saveSrc = ['getFeedback', 'saveFeedback'].map(n => extractFn(html, n)).join('\n\n');
  const state = { players: [{ id: 'p1', feedback: { positives: ['x'] } }],
    _editingFeedback: { pid: 'p1', positives: [''], negatives: [], technicals: ['  '] } };
  const factory = new Function('state', 'persist', 'window', 'closeModal', 'editPlayer', 'setTimeout',
    saveSrc + '\nreturn { saveFeedback };');
  factory(state, () => {}, { PbStore: null }, () => {}, () => {}, () => {}).saveFeedback();
  t('feedback entièrement vide → p.feedback supprimé', () => {
    assert.strictEqual(state.players[0].feedback, undefined);
  });
}

console.log(`\n✅ ${pass} assertions OK — retours du coach côté joueuse (qualités/axes/technicals).`);
