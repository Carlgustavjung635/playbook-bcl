// Test MOTS D'ANNIVERSAIRE (cf. migration 20260730_001_birthday_messages).
//
// Les joueuses voient les anniversaires À VENIR de leurs coéquipières et
// écrivent un mot À L'AVANCE. Le mot n'est lu que LE JOUR J, par la fêtée, dans
// une modale de célébration.
//
// CHOIX STRUCTURANTS verrouillés ici :
//   • la fêtée ne voit JAMAIS son propre anniversaire dans la liste (surprise) ;
//   • « 1 mot par autrice » est tenu CÔTÉ FRONT (réutilisation de la ligne à
//     l'écriture + survivante déterministe à la lecture), parce qu'une
//     contrainte UNIQUE empoisonnerait le lot d'upsert PbSync ;
//   • modifiable jusqu'à la VEILLE, figé le jour J (il est peut-être déjà lu) ;
//   • mais une joueuse qui n'a RIEN écrit peut encore le faire le jour J ;
//   • suppression = soft-delete (un hard delete d'un id 'x…' serait repoussé) ;
//   • l'animation du jour J est one-shot par journée (filigrane localStorage) et
//     ne passe jamais par-dessus une popup ouverte.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.BIRTHDAY_MSG_MAX = BIRTHDAY_MSG_MAX;'
  + '\n;globalThis.BIRTHDAY_LOOKAHEAD_DAYS = BIRTHDAY_LOOKAHEAD_DAYS; globalThis.BIRTHDAY_NOTIF_DAYS = BIRTHDAY_NOTIF_DAYS;';

const store = {};
const fields = {};                     // valeurs des <input>/<textarea> simulés
let openPopup = false;                 // une popup (modale / tirage de gage) est-elle ouverte ?
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = {
  getElementById: (id) => (id === 'modal-root' ? null : (id in fields ? { value: fields[id], textContent: '' } : mkEl())),
  createElement: mkEl,
  // C'est ce sélecteur que maybeShowBirthdayCelebration interroge pour savoir
  // si une popup occupe déjà l'écran.
  querySelector: (sel) => (openPopup && /modal|gage/.test(sel) ? mkEl() : null),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: mkEl(), documentElement: mkEl(), head: mkEl(), visibilityState: 'visible' };
const ctx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, document: doc,
  navigator: { userAgent: 'probe', onLine: true, serviceWorker: { getRegistrations: () => Promise.resolve([]), register: () => Promise.resolve({}), ready: Promise.resolve({ showNotification() {} }), addEventListener() {} } },
  location: { hash: '', href: 'http://localhost/', replace() {}, reload() {} },
  history: { pushState() {}, back() {}, replaceState() {} },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  alert: () => {}, confirm: () => true, prompt: () => '',
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  scrollTo() {}, scrollX: 0, scrollY: 0, innerWidth: 390, innerHeight: 844,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  AudioContext: undefined, speechSynthesis: undefined, Notification: undefined,
  screen: { orientation: null }, indexedDB: undefined,
  caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try { vm.runInContext(code, ctx, { filename: 'index.inline.js' }); }
catch (e) { console.log('✗ ÉVALUATION: ' + e.message); process.exit(1); }

const R = [];
const t = (label, fn) => { try { fn(); R.push('✓ ' + label); } catch (e) { R.push('✗ ' + label + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };

const S = ctx.state;
ctx.render = () => {}; ctx.showToast = () => {};
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => { ctx.__lastModal = null; };

// --- horloge maîtrisée -------------------------------------------------------
// Les fonctions d'écriture recalculent « aujourd'hui » elles-mêmes (une modale
// laissée ouverte jusqu'à minuit ne doit pas contourner le verrou du jour J) :
// il faut donc pouvoir déplacer la date système du vm.
const RealDate = Date;
function setToday(iso) {
  const base = new RealDate(iso + 'T12:00:00').getTime();   // midi local : jamais de bascule de jour
  class D extends RealDate {
    constructor(...a) { if (a.length === 0) super(base); else super(...a); }
    static now() { return base; }
  }
  ctx.Date = D;
}

const DOB = { pA: '2005-08-12', pB: '2004-08-01', pC: '2003-09-05' };
function seed(todayISO, authPlayerId) {
  for (const k of Object.keys(fields)) delete fields[k];
  for (const k of Object.keys(store)) delete store[k];
  openPopup = false; ctx.__lastModal = null;
  setToday(todayISO || '2026-08-01');
  S.auth = { role: 'player', playerId: authPlayerId || 'pC' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.currentSeasonId = '2026-2027';
  S.players = [
    { id: 'pA', name: 'Ophelie Martin', num: 1, dateNaissance: DOB.pA },   // 12/08 → J+11
    { id: 'pB', name: 'Celia Roux', num: 14, dateNaissance: DOB.pB },      // 01/08 → aujourd'hui
    { id: 'pC', name: 'Lea Dubois', num: 7, dateNaissance: DOB.pC },       // 05/09 → hors fenêtre
    { id: 'pD', name: 'Nina Sans Date', num: 9, dateNaissance: null },     // ignorée
  ];
  S.seasonPlayers = ['pA', 'pB', 'pC', 'pD'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.birthdayMessages = [];
  S.convocations = []; S.matches = []; S.gages = []; S.gageDraws = [];
  S.playerLicences = []; S.playerUnavailabilities = [];
  S.trainingCompletions = []; S.trainingPrograms = []; S.trainingPlans = [];
  S.plays = []; S.challenges = []; S.broadcasts = [];
}
const write = (targetId, text, year) => { fields['bm-text'] = text; return ctx.saveBirthdayMessage(targetId, year || 2026); };
const rows = (targetId) => (S.birthdayMessages || []).filter(m => m.birthdayPlayerId === targetId);

// --- 1) qui voit quoi --------------------------------------------------------
t('la section liste les anniversaires des 14 prochains jours', () => {
  seed();
  const ids = ctx.upcomingBirthdays().map(b => b.id);
  ok(ids.includes('pB'), "aujourd'hui (pB) absent");
  ok(ids.includes('pA'), 'J+11 (pA) absent');
  ok(!ids.includes('pC'), 'hors fenêtre (pC) présent');
  ok(!ids.includes('pD'), 'joueuse sans date de naissance présente');
});
t('la fêtée ne voit JAMAIS son propre anniversaire (surprise)', () => {
  seed('2026-08-01', 'pB');
  ok(!ctx.upcomingBirthdays().some(b => b.id === 'pB'), 'elle se voit elle-même');
  ok(ctx.upcomingBirthdays().some(b => b.id === 'pA'), 'les autres ont disparu aussi');
});
t('le jour J, la fêtée reste affichée aux autres', () => {
  seed();
  const b = ctx.upcomingBirthdays().find(x => x.id === 'pB');
  ok(b && b.daysUntil === 0, JSON.stringify(b));
  ok(/aujourd/i.test(ctx.renderBirthdaysSection()), "pas de « c'est aujourd'hui »");
});
t('la section porte le numéro, la date et l\'âge fêté', () => {
  seed();
  const h = ctx.renderBirthdaysSection();
  ok(h.includes('#1') && h.includes('Ophelie'), 'nom/numéro absents');
  ok(h.includes('12/08') && h.includes('21 ans'), 'date ou âge absents : ' + h.slice(0, 400));
  ok(h.includes('Écrire un mot'), 'pas de bouton d\'écriture');
});
t('aucune section pour le coach (il a sa propre carte)', () => {
  seed(); S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.renderBirthdaysSection() === '', 'section joueuse exposée au coach');
});

// --- 2) écriture -------------------------------------------------------------
t('une joueuse poste un mot', () => {
  seed();
  ok(write('pA', 'Joyeux anniv Ophelie !') === true, 'refusé');
  const m = rows('pA')[0];
  ok(m && m.message === 'Joyeux anniv Ophelie !', JSON.stringify(m));
  ok(m.authorPlayerId === 'pC' && m.birthdayYear === 2026, JSON.stringify(m));
  ok(m.readAt === null, 'marqué lu à la création');
  ok(String(m.id).startsWith('x'), 'id sans préfixe x → wipé par les apply PbSync : ' + m.id);
});
t('un mot vide est refusé', () => {
  seed();
  ok(write('pA', '   ') === false, 'accepté');
  ok(rows('pA').length === 0, 'ligne écrite');
});
t('le texte est tronqué à 500 caractères (contrainte SQL)', () => {
  seed();
  write('pA', 'x'.repeat(700));
  ok(rows('pA')[0].message.length === 500, 'longueur = ' + rows('pA')[0].message.length);
});
t('impossible d\'écrire à soi-même', () => {
  seed('2026-08-01', 'pA');
  ok(write('pA', 'coucou moi') === false, 'accepté');
  ok(rows('pA').length === 0, 'ligne écrite');
});
t('un coach ne poste pas de mot (canal joueuses)', () => {
  seed(); S.auth = { role: 'coach', coachId: 'admin' };
  ok(write('pA', 'du coach') === false, 'accepté');
  ok(rows('pA').length === 0, 'ligne écrite');
});

// --- 3) anti-doublon : 1 mot par autrice ------------------------------------
t('réécrire ne crée pas un second mot (la ligne est réutilisée)', () => {
  seed();
  write('pA', 'v1');
  const id1 = rows('pA')[0].id;
  ok(write('pA', 'v2') === true, 'modification refusée');
  ok(rows('pA').length === 1, rows('pA').length + ' lignes');
  ok(rows('pA')[0].id === id1 && rows('pA')[0].message === 'v2', JSON.stringify(rows('pA')));
});
t('deux lignes concurrentes du même triplet → un seul mot affiché (id le plus petit)', () => {
  seed();
  const base = { birthdayPlayerId: 'pA', authorPlayerId: 'pC', birthdayYear: 2026, readAt: null, createdAt: 1, updatedAt: 1, deletedAt: null };
  S.birthdayMessages.push(Object.assign({}, base, { id: 'x2', message: 'perdant' }));
  S.birthdayMessages.push(Object.assign({}, base, { id: 'x1', message: 'gagnant' }));
  const list = ctx.birthdayMessagesFor('pA', 2026);
  ok(list.length === 1, list.length + ' mots affichés');
  ok(list[0].message === 'gagnant', 'survivante non déterministe : ' + list[0].id);
});
t('les mots supprimés ne sont plus lus', () => {
  seed();
  write('pA', 'à supprimer');
  ok(ctx.deleteMyBirthdayMessage('pA', 2026) === true, 'suppression refusée');
  ok(ctx.birthdayMessagesFor('pA', 2026).length === 0, 'mot toujours lu');
  ok(rows('pA').length === 1 && rows('pA')[0].deletedAt, 'hard delete au lieu de soft-delete');
});
t('réécrire après suppression ressuscite la même ligne', () => {
  seed();
  write('pA', 'v1');
  const id1 = rows('pA')[0].id;
  ctx.deleteMyBirthdayMessage('pA', 2026);
  ok(write('pA', 'v2') === true, 'refusé');
  ok(rows('pA').length === 1 && rows('pA')[0].id === id1, JSON.stringify(rows('pA')));
  ok(rows('pA')[0].deletedAt === null && rows('pA')[0].message === 'v2', JSON.stringify(rows('pA')[0]));
});
t('chaque autrice a son propre mot', () => {
  seed();
  write('pA', 'de Lea');
  S.auth = { role: 'player', playerId: 'pB' };
  write('pA', 'de Celia');
  ok(ctx.birthdayMessagesFor('pA', 2026).length === 2, 'mots fusionnés');
});
t('un mot de 2026 n\'appartient pas à l\'anniversaire 2027', () => {
  seed();
  write('pA', 'édition 2026');
  ok(ctx.birthdayMessagesFor('pA', 2027).length === 0, 'mot rejoué l\'année suivante');
});

// --- 4) verrou du jour J -----------------------------------------------------
t('modifiable jusqu\'à la veille', () => {
  seed('2026-08-01'); write('pA', 'v1');
  setToday('2026-08-11');                                  // J-1
  ok(write('pA', 'v2') === true, 'refusé la veille');
  ok(rows('pA')[0].message === 'v2', 'texte non modifié');
});
t('verrouillé le jour J (le mot est peut-être déjà lu)', () => {
  seed('2026-08-01'); write('pA', 'v1');
  setToday('2026-08-12');                                  // jour J
  ok(write('pA', 'v2') === false, 'modification acceptée le jour J');
  ok(rows('pA')[0].message === 'v1', 'texte modifié malgré le verrou');
  ok(ctx.deleteMyBirthdayMessage('pA', 2026) === false, 'suppression acceptée le jour J');
});
t('le jour J, celle qui n\'a rien écrit a une dernière chance', () => {
  seed('2026-08-12');                                      // jour J de pA
  ok(write('pA', 'in extremis') === true, 'refusé');
  ok(ctx.birthdayMessagesFor('pA', 2026).length === 1, 'mot non enregistré');
});
t('la modale affiche le verrou au lieu du formulaire le jour J', () => {
  seed('2026-08-01'); write('pA', 'v1');
  setToday('2026-08-12');
  ctx.openBirthdayMessageModal('pA', 2026);
  const h = ctx.__lastModal || '';
  ok(!h.includes('id="bm-text"'), 'formulaire encore éditable');
  ok(/plus être modifié/.test(h), 'pas de mention du verrou');
});

// --- 5) jour J : animation + célébration ------------------------------------
t('la fêtée déclenche la célébration à son premier boot du jour', () => {
  seed('2026-08-01', 'pC'); write('pB', 'bon anniv Celia');   // pB fête aujourd'hui
  S.auth = { role: 'player', playerId: 'pB' };
  ok(ctx.maybeShowBirthdayCelebration() === true, 'pas déclenchée');
  const h = ctx.__lastModal || '';
  ok(/Joyeux anniversaire Celia/.test(h), 'prénom absent : ' + h.slice(0, 200));
  ok(h.includes('bon anniv Celia'), 'mot reçu absent');
  ok(h.includes('22 ans'), 'âge fêté absent');
  ok(h.includes('bday-cake'), 'animation absente');
});
t('elle ne se redéclenche pas dans la journée', () => {
  seed('2026-08-01', 'pB');
  ok(ctx.maybeShowBirthdayCelebration() === true, '1er appel');
  ctx.__lastModal = null;
  ok(ctx.maybeShowBirthdayCelebration() === false, '2e appel déclenché');
  ok(!ctx.__lastModal, 'modale rouverte');
});
t('le filigrane est daté : il ne bloque pas l\'anniversaire suivant', () => {
  seed('2026-08-01', 'pB');
  ctx.maybeShowBirthdayCelebration();
  const map = JSON.parse(store[ctx.K.birthdayCelebrated] || '{}');
  ok(Object.keys(map)[0] === 'pB:2026-08-01', 'clé = ' + Object.keys(map)[0]);
  setToday('2027-08-01');
  ok(ctx.maybeShowBirthdayCelebration() === true, 'année suivante bloquée');
});
t('aucune célébration si ce n\'est pas son anniversaire', () => {
  seed('2026-08-01', 'pA');
  ok(ctx.maybeShowBirthdayCelebration() === false, 'déclenchée à tort');
});
t('la célébration ne passe pas par-dessus une popup ouverte', () => {
  seed('2026-08-01', 'pB');
  openPopup = true;
  ok(ctx.maybeShowBirthdayCelebration() === false, 'a écrasé la popup');
  const map = JSON.parse(store[ctx.K.birthdayCelebrated] || '{}');
  ok(Object.keys(map).length === 0, 'filigrane posé sans avoir fêté → fête perdue');
  openPopup = false;
  ok(ctx.maybeShowBirthdayCelebration() === true, 'jamais rejouée après la popup');
});
t('sans aucun mot, la fête a quand même lieu', () => {
  seed('2026-08-01', 'pB');
  ok(ctx.maybeShowBirthdayCelebration() === true, 'pas de fête sans mots');
  ok(/Joyeux anniversaire/.test(ctx.__lastModal || ''), 'modale vide');
});
t('« Merci 💕 » marque les mots lus — et seule la fêtée le peut', () => {
  seed('2026-08-01', 'pC'); write('pB', 'bisous');
  ctx.thankBirthdayMessages('pB', 2026);                     // pC n'est pas la fêtée
  ok(ctx.birthdayMessagesFor('pB', 2026)[0].readAt === null, 'lecture posée par une autre joueuse');
  S.auth = { role: 'player', playerId: 'pB' };
  ctx.thankBirthdayMessages('pB', 2026);
  ok(ctx.birthdayMessagesFor('pB', 2026)[0].readAt, 'lecture non posée par la fêtée');
});
t('l\'autrice voit que son mot a été lu', () => {
  seed('2026-08-01', 'pC'); write('pB', 'bisous');
  S.auth = { role: 'player', playerId: 'pB' }; ctx.thankBirthdayMessages('pB', 2026);
  S.auth = { role: 'player', playerId: 'pC' };
  ctx.openBirthdayMessageModal('pB', 2026);
  ok(/lu/.test(ctx.__lastModal || ''), 'aucune mention de lecture');
});

// --- 6) modération (coach) ---------------------------------------------------
t('le coach supprime un mot déplacé (soft-delete)', () => {
  seed(); write('pA', 'contenu limite');
  const id = rows('pA')[0].id;
  S.auth = { role: 'coach', coachId: 'admin' };
  ok(ctx.moderateBirthdayMessage(id) === true, 'refusé');
  ok(ctx.birthdayMessagesFor('pA', 2026).length === 0, 'mot toujours affiché');
  ok(rows('pA').length === 1 && rows('pA')[0].deletedAt, 'hard delete');
});
t('une joueuse ne modère pas les mots des autres', () => {
  seed(); write('pA', 'le mien');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(ctx.moderateBirthdayMessage(rows('pA')[0].id) === false, 'accepté');
  ok(ctx.birthdayMessagesFor('pA', 2026).length === 1, 'mot supprimé');
});
t('la carte coach compte les mots sans les dévoiler', () => {
  // pB fête aujourd'hui : elle est dans la fenêtre J-7 de la carte coach (pA,
  // à J+11, n'y figure pas — la carte admin garde sa fenêtre historique).
  seed(); write('pB', 'secret jusqu\'au jour J');
  S.auth = { role: 'coach', coachId: 'admin' };
  const h = ctx.renderBirthdayCoachCard();
  ok(h.includes('1 mot'), 'compteur absent');
  ok(!h.includes('secret jusqu\'au jour J'), 'contenu exposé sur la home coach');
  ok(h.includes('openBirthdayModeration'), 'pas d\'accès à la modération');
});
t('la modération affiche les mots au coach uniquement', () => {
  seed(); write('pA', 'texte à modérer');
  S.auth = { role: 'player', playerId: 'pB' };
  ctx.__lastModal = null; ctx.openBirthdayModeration('pA', 2026);
  ok(!ctx.__lastModal, 'modération ouverte à une joueuse');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openBirthdayModeration('pA', 2026);
  ok((ctx.__lastModal || '').includes('texte à modérer'), 'mots absents de la modération');
});

// --- 7) cloche (notifFeed) ---------------------------------------------------
const bdayNotifs = () => (ctx.notifFeed() || []).filter(i => String(i.id).startsWith('bday-'));
t('un anniversaire sans mot écrit devient une notif actionnable', () => {
  // pB fête aujourd'hui → dans la fenêtre 7 jours de la cloche.
  seed();
  const n = bdayNotifs().find(i => i.id === 'bday-pB-2026');
  ok(n, 'notif absente : ' + JSON.stringify(bdayNotifs()));
  ok(n.unread === true, 'notif déjà lue');
  ok(/openBirthdayMessageModal/.test(n.action || ''), 'action absente');
});
t('la notif disparaît quand le mot est écrit', () => {
  seed(); write('pB', 'fait');
  ok(!bdayNotifs().some(i => i.id === 'bday-pB-2026'), 'notif persistante');
});
t('la fenêtre de la cloche est plus courte que celle de la section', () => {
  ok(ctx.BIRTHDAY_NOTIF_DAYS < ctx.BIRTHDAY_LOOKAHEAD_DAYS, 'cloche aussi bavarde que la section');
  seed('2026-08-01');
  // pA est à J+11 : dans la section (14 j), hors cloche (7 j).
  ok(ctx.upcomingBirthdays().some(b => b.id === 'pA'), 'absente de la section');
  ok(!ctx.upcomingBirthdays(ctx.BIRTHDAY_NOTIF_DAYS).some(b => b.id === 'pA'), 'présente dans la cloche');
});
t('la fêtée peut rejouer sa célébration depuis la cloche', () => {
  seed('2026-08-01', 'pB');
  const n = bdayNotifs().find(i => i.id === 'bday-me-2026');
  ok(n, 'entrée absente : ' + JSON.stringify(bdayNotifs()));
  ok(n.ts > 0, 'ts nul → entrée ignorée par le flux');
  ok(/showBirthdayCelebration/.test(n.action || ''), 'action absente');
});

// --- 8) sérialisation (bloc module) -----------------------------------------
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('introuvable : ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') { depth++; began = true; }
    else if (html[j] === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}
const ser = new Function(extractFn('_dumpBirthdayMsgRow') + '\n' + extractFn('_birthdayMsgFromRow')
  + '\nreturn { _dumpBirthdayMsgRow, _birthdayMsgFromRow };')();

t('les sérialiseurs du bloc module sont autonomes', () => {
  ser._dumpBirthdayMsgRow({ id: 'x1', birthdayPlayerId: 'pA', authorPlayerId: 'pC', birthdayYear: 2026, message: 'hop' });
});
t('round-trip dump → row → client', () => {
  seed(); write('pA', 'joyeux anniv');
  const row = ser._dumpBirthdayMsgRow(rows('pA')[0]);
  ok(row.birthday_player_id === 'pA' && row.author_player_id === 'pC', JSON.stringify(row));
  ok(row.birthday_year === 2026 && row.message === 'joyeux anniv', JSON.stringify(row));
  ok(row.read_at === null && row.deleted_at === null, JSON.stringify(row));
  const back = ser._birthdayMsgFromRow(Object.assign({ created_at: new RealDate().toISOString() }, row));
  ok(back.birthdayPlayerId === 'pA' && back.birthdayYear === 2026 && back.message === 'joyeux anniv', JSON.stringify(back));
});
t('un message trop long est tronqué AU DUMP (sinon tout le lot échoue)', () => {
  const row = ser._dumpBirthdayMsgRow({ id: 'x1', birthdayPlayerId: 'pA', authorPlayerId: 'pC', birthdayYear: 2026, message: 'y'.repeat(900) });
  ok(row.message.length === 500, 'longueur = ' + row.message.length);
});
t('une année non numérique ne part pas en base', () => {
  const row = ser._dumpBirthdayMsgRow({ id: 'x1', birthdayPlayerId: 'pA', authorPlayerId: 'pC', birthdayYear: 'bidon', message: 'a' });
  ok(row.birthday_year === null, 'birthday_year = ' + JSON.stringify(row.birthday_year));
});

// --- 9) non-régression -------------------------------------------------------
t('la carte anniversaires du coach reste réservée à l\'admin', () => {
  seed(); S.auth = { role: 'coach', coachId: 'c2' };
  S.coaches.push({ id: 'c2', name: 'Coach 2', coachRole: 'coach', teams: ['e1'] });
  ok(ctx.renderBirthdayCoachCard() === '', 'carte exposée à un coach non-admin');
});
t('l\'accueil joueuse se rend toujours avec la nouvelle section', () => {
  seed();
  const h = ctx.renderHomePlayer();
  ok(h.includes('Prochains anniversaires'), 'section absente de la home');
  ok(h.includes('Playbook'), 'reste de la home cassé');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
