// Test INDISPONIBILITÉS (cf. migration 20260729_004).
//
// Une période saisie PAR LE COACH pendant laquelle une joueuse est comptée
// absente par défaut et ne reçoit plus les rappels push.
//
// CHOIX STRUCTURANT — l'absence est DÉRIVÉE, jamais matérialisée en lignes
// convocation_responses. La règle tient en une ligne, et c'est elle que ce
// fichier verrouille :
//     RSVP explicite s'il existe → sinon indisponibilité couvrante → sinon présente.
// Corollaire testé : modifier ou supprimer une période met l'affichage à jour
// partout, immédiatement, sans reprise de données.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']module["']/.test(m[1]));
const code = blocks.map(m => m[2]).join('\n;\n')
  + '\n;globalThis.state = state; globalThis.K = K; globalThis.UNAVAIL_REASONS = UNAVAIL_REASONS;';

const store = {};
const fields = {};
const mkEl = () => ({ style: {}, className: '', innerHTML: '', textContent: '', id: '', value: '',
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
  getContext: () => null, setAttribute() {}, focus() {} });
const doc = {
  getElementById: (id) => (id === 'modal-root' ? null : (id in fields ? { value: fields[id] } : mkEl())),
  createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
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
let pushed = [];
ctx.render = () => {}; ctx.showToast = () => {};
ctx.notifyPush = (keys, payload) => { pushed.push({ keys, payload }); };
ctx.openModal = h => { ctx.__lastModal = h; };
ctx.closeModal = () => {};

const CID = 'cvTraining';
const DATE = '2026-08-19';
function seed() {
  pushed = []; for (const k of Object.keys(fields)) delete fields[k];
  S.auth = { role: 'coach', coachId: 'admin' };
  S.coaches = [{ id: 'admin', name: 'Admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }];
  S.seasons = [{ id: '2026-2027', name: 'S', startDate: '2026-07-01', endDate: '2027-06-30', status: 'active' }];
  S.activeSeasonId = '2026-2027'; S.currentSeasonId = '2026-2027';
  S.players = [{ id: 'pA', name: 'Ophelie', num: 1 }, { id: 'pB', name: 'Celia', num: 14 }];
  S.seasonPlayers = ['pA', 'pB'].map(id => ({ seasonId: '2026-2027', playerId: id, teamTag: 'both', joinedAt: '2026-07-01', leftAt: null }));
  S.convocations = [{
    id: CID, type: 'training', title: 'Entraînement Mercredi', date: DATE, time: '20:10',
    location: '', note: '', recurrence: { days: [3], type: 'weekly', until: '' },
    cancelledInstances: [], instanceOverrides: {}, attachments: [], responses: {},
    seasonId: '2026-2027', teamTag: 'both', closed: false,
  }];
  S.playerUnavailabilities = [];
  S.matches = []; S.gages = []; S.gageDraws = []; S.playerLicences = [];
  S.trainingCompletions = []; S.trainingPrograms = [];
}
const conv = () => S.convocations[0];
function addUnavail(playerId, startsAt, endsAt, reason, notes) {
  fields['un-start'] = startsAt; fields['un-end'] = endsAt || '';
  fields['un-reason'] = reason || 'blessure'; fields['un-notes'] = notes || '';
  return ctx.saveUnavailability(playerId);
}

// --- 1) écriture -------------------------------------------------------------
t('le coach enregistre une période', () => {
  seed();
  ok(addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure', 'entorse') === true, 'refusé');
  const u = ctx._unavailsOf('pA')[0];
  ok(u.startsAt === '2026-08-10' && u.endsAt === '2026-08-31', JSON.stringify(u));
  ok(u.reason === 'blessure' && u.notes === 'entorse', JSON.stringify(u));
  ok(u.createdBy === 'admin', 'auteur non tracé : ' + u.createdBy);
});
t('une fin vide = sans date de fin connue (pas une date inventée)', () => {
  seed();
  addUnavail('pA', '2026-08-10', '', 'blessure');
  ok(ctx._unavailsOf('pA')[0].endsAt === null, 'endsAt = ' + ctx._unavailsOf('pA')[0].endsAt);
});
t('une fin avant le début est refusée', () => {
  seed();
  ok(addUnavail('pA', '2026-08-10', '2026-08-01', 'blessure') === false, 'accepté');
  ok(ctx._unavailsOf('pA').length === 0, 'ligne écrite malgré tout');
});
t('une période sans date de début est refusée', () => {
  seed();
  ok(addUnavail('pA', '', '2026-08-31', 'blessure') === false, 'accepté');
});
t('un motif inconnu retombe sur « autre »', () => {
  seed();
  addUnavail('pA', '2026-08-10', '2026-08-31', 'n_importe_quoi');
  ok(ctx._unavailsOf('pA')[0].reason === 'autre', 'motif = ' + ctx._unavailsOf('pA')[0].reason);
});
t('une joueuse ne peut PAS saisir d\'indisponibilité', () => {
  seed(); S.auth = { role: 'player', playerId: 'pA' };
  ok(addUnavail('pA', '2026-08-10', '2026-08-31', 'vacances') === false, 'écriture acceptée');
  ok((S.playerUnavailabilities || []).length === 0, 'ligne écrite');
});

// --- 2) couverture de date ---------------------------------------------------
t('les bornes sont INCLUSIVES', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(ctx._unavailOn('pA', '2026-08-10'), 'borne basse exclue');
  ok(ctx._unavailOn('pA', '2026-08-31'), 'borne haute exclue');
  ok(!ctx._unavailOn('pA', '2026-08-09'), 'veille incluse à tort');
  ok(!ctx._unavailOn('pA', '2026-09-01'), 'lendemain inclus à tort');
});
t('sans date de fin, la période court indéfiniment', () => {
  seed(); addUnavail('pA', '2026-08-10', '', 'blessure');
  ok(ctx._unavailOn('pA', '2030-01-01'), 'période fermée à tort');
  ok(!ctx._unavailOn('pA', '2026-08-09'), 'couvre avant le début');
});
t('la période d\'une joueuse ne déborde pas sur une autre', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(!ctx._unavailOn('pB', '2026-08-19'), 'fuite entre joueuses');
});
t('une période soft-deleted ne couvre plus rien', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ctx.deleteUnavailability(ctx._unavailsOf('pA')[0].id);
  ok(!ctx._unavailOn('pA', '2026-08-19'), 'période supprimée encore active');
  ok((S.playerUnavailabilities || []).length === 1, 'hard delete au lieu de soft');
  ok(typeof S.playerUnavailabilities[0].deletedAt === 'number', 'deletedAt non horodaté');
});

// --- 3) LA RÈGLE : explicite > indispo > présente ---------------------------
t('sans rien, une joueuse est présente', () => {
  seed();
  ok(ctx._convocResp(conv(), DATE, 'pA').status === 'present', 'défaut KO');
});
t('une indisponibilité couvrante la rend absente, avec le motif', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure', 'entorse cheville');
  const r = ctx._convocResp(conv(), DATE, 'pA');
  ok(r.status === 'absent', 'statut = ' + r.status);
  ok(r.auto === true, 'devrait être marquée dérivée');
  ok(r.reason === 'Blessure', 'motif = ' + r.reason);
  ok(r.unavail && r.unavail.notes === 'entorse cheville', 'notes perdues');
});
t('hors période, elle redevient présente', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-15', 'blessure');
  ok(ctx._convocResp(conv(), DATE, 'pA').status === 'present', 'encore absente hors période');
});
t('un RSVP explicite PRIME sur l\'indisponibilité', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  conv().instanceOverrides[DATE] = { responses: { pA: { status: 'present', at: 1 } } };
  const r = ctx._convocResp(conv(), DATE, 'pA');
  ok(r.status === 'present', 'statut = ' + r.status);
  ok(r.auto === false, 'un statut explicite ne doit pas être dit dérivé');
});
t('un désistement explicite reste un désistement, pas une indispo', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'vacances');
  conv().instanceOverrides[DATE] = { responses: { pA: { status: 'absent', reason: 'Boulot', at: 1 } } };
  const r = ctx._convocResp(conv(), DATE, 'pA');
  ok(r.reason === 'Boulot', 'motif écrasé par l\'indispo : ' + r.reason);
  ok(r.auto === false, 'marquée dérivée à tort');
});
t('_effectiveConvocStatus suit la même règle', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(ctx._effectiveConvocStatus(conv(), DATE, 'pA') === 'absent', 'le helper historique ignore les indispos');
});
t('supprimer la période rend la joueuse convocable, sans reprise de données', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(ctx._convocResp(conv(), DATE, 'pA').status === 'absent', 'décor KO');
  ctx.deleteUnavailability(ctx._unavailsOf('pA')[0].id);
  ok(ctx._convocResp(conv(), DATE, 'pA').status === 'present', 'toujours absente après suppression');
  ok(JSON.stringify(conv().instanceOverrides) === '{}', 'des RSVP ont été matérialisés');
});
t('AUCUNE ligne de réponse n\'est écrite par une indisponibilité', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ctx._convocResp(conv(), DATE, 'pA');
  ok(JSON.stringify(conv().responses) === '{}', 'responses matérialisées');
  ok(JSON.stringify(conv().instanceOverrides) === '{}', 'overrides matérialisés');
});

// --- 4) écran de convoc ------------------------------------------------------
t('l\'écran de convoc la compte dans les absentes', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ctx.openEventInstance(CID, DATE);
  const m = ctx.__lastModal || '';
  ok(m.includes('Ophelie'), 'joueuse absente de l\'écran');
  ok(/INDISPO/.test(m), 'badge « indispo » absent');
  ok(m.includes('overrideUnavailPresence('), 'action « convoquer quand même » absente');
});
t('un désistement classique garde son rendu habituel', () => {
  seed();
  conv().instanceOverrides[DATE] = { responses: { pA: { status: 'absent', reason: 'Boulot', at: 1 } } };
  ctx.openEventInstance(CID, DATE);
  const m = ctx.__lastModal || '';
  ok(m.includes('Boulot'), 'motif absent');
  ok(!/INDISPO/.test(m), 'badge indispo affiché à tort');
  ok(m.includes('restoreInstancePresent('), 'action de retour habituelle perdue');
});
t('le coach peut la convoquer quand même (override)', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(ctx.overrideUnavailPresence(CID, DATE, 'pA') === true, 'override refusé');
  ok(ctx._convocResp(conv(), DATE, 'pA').status === 'present', 'toujours absente après override');
  // L'indisponibilité N'EST PAS touchée : elle vaut encore pour les autres dates.
  ok(ctx._unavailOn('pA', '2026-08-26'), 'la période a été supprimée par l\'override');
  ok(ctx._convocResp(conv(), '2026-08-26', 'pA').status === 'absent', 'override propagé aux autres dates');
});

// --- 5) pushs ----------------------------------------------------------------
t('les destinataires indisponibles sont retirés d\'un rappel daté', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  const keys = ctx._pushPlayerKeysOn(['pA', 'pB'], DATE);
  ok(!keys.includes('player:pA'), 'joueuse indisponible notifiée');
  ok(keys.includes('player:pB'), 'joueuse disponible retirée à tort');
});
t('hors période, elle reçoit de nouveau les rappels', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-15', 'blessure');
  ok(ctx._pushPlayerKeysOn(['pA'], DATE).includes('player:pA'), 'filtrée hors période');
});
t('sans date, aucun filtrage (on ne devine pas)', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure');
  ok(ctx._pushPlayerKeysOn(['pA'], null).includes('player:pA'), 'filtrage sans date');
});
t('la nouvelle convocation ne notifie pas les indisponibles', () => {
  const src = html.slice(html.indexOf('PUSH : nouvelle convoc'), html.indexOf('PUSH : nouvelle convoc') + 700);
  ok(/_pushPlayerKeysOn\(pool\.map\(p => p\.id\), obj\.date\)/.test(src), 'push convoc non filtré');
});
t('le rappel quotidien de prépa non plus', () => {
  const i = html.indexOf("title: '\u{1F4AA} Ta prépa'");
  ok(i > 0, 'rappel prépa introuvable');
  ok(/_pushPlayerKeysOn\(late\.map\(pl => pl\.id\), todayISO\)/.test(html.slice(i - 300, i)), 'rappel prépa non filtré');
});

// --- 6) UI -------------------------------------------------------------------
t('le panneau joueuse porte la section indisponibilités', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'blessure', 'entorse');
  ctx.openPlayerSeasonPanel('pA');
  const m = ctx.__lastModal || '';
  ok(/Indisponibilit/.test(m), 'section absente');
  ok(m.includes('entorse'), 'notes absentes');
  ok(m.includes('openUnavailForm('), 'bouton d\'ajout absent');
  ok(m.includes('deleteUnavailability('), 'suppression absente');
});
t('le formulaire pré-remplit une période existante', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'vacances', 'Corse');
  ctx.openUnavailForm('pA', ctx._unavailsOf('pA')[0].id);
  const m = ctx.__lastModal || '';
  ok(m.includes('2026-08-10') && m.includes('2026-08-31'), 'dates non pré-remplies');
  ok(/value="vacances" selected/.test(m), 'motif non pré-sélectionné');
  ok(m.includes('Corse'), 'notes non pré-remplies');
});
t('la joueuse voit un bandeau quand elle est indisponible AUJOURD\'HUI', () => {
  seed();
  const today = ctx.isoDate(new Date());
  addUnavail('pA', today, today, 'blessure');
  S.auth = { role: 'player', playerId: 'pA' };
  const b = ctx.renderUnavailPlayerBanner();
  ok(b && /Indisponible/.test(b), 'bandeau absent');
  ok(/Blessure/.test(b), 'motif absent');
});
t('pas de bandeau hors période', () => {
  seed(); addUnavail('pA', '2020-01-01', '2020-01-02', 'blessure');
  S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.renderUnavailPlayerBanner() === '', 'bandeau affiché hors période');
});
t('pas de bandeau pour une autre joueuse', () => {
  seed();
  const today = ctx.isoDate(new Date());
  addUnavail('pA', today, today, 'blessure');
  S.auth = { role: 'player', playerId: 'pB' };
  ok(ctx.renderUnavailPlayerBanner() === '', 'bandeau d\'une autre joueuse affiché');
});
t('la section coach est vide côté joueuse', () => {
  seed(); S.auth = { role: 'player', playerId: 'pA' };
  ok(ctx.renderUnavailSection('pA') === '', 'section coach exposée');
});

// --- 7) sérialisation (bloc module) -----------------------------------------
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
const ser = new Function(extractFn('_dumpUnavailRow') + '\n' + extractFn('_unavailFromRow')
  + '\nreturn { _dumpUnavailRow, _unavailFromRow };')();

t('les sérialiseurs du bloc module sont autonomes', () => {
  ser._dumpUnavailRow({ id: 'x', playerId: 'pA', startsAt: '2026-08-10', reason: 'blessure' });
});
t('round-trip dump → row → client', () => {
  seed(); addUnavail('pA', '2026-08-10', '2026-08-31', 'exams', 'partiels');
  const u = ctx._unavailsOf('pA')[0];
  const row = ser._dumpUnavailRow(u);
  ok(row.player_id === 'pA' && row.starts_at === '2026-08-10' && row.ends_at === '2026-08-31', JSON.stringify(row));
  ok(row.reason === 'exams' && row.notes === 'partiels', JSON.stringify(row));
  const back = ser._unavailFromRow(Object.assign({ created_at: new Date().toISOString() }, row));
  ok(back.startsAt === u.startsAt && back.reason === u.reason && back.notes === u.notes, JSON.stringify(back));
});
t('une fin vide part à NULL (une chaîne vide violerait le type date)', () => {
  const row = ser._dumpUnavailRow({ id: 'x', playerId: 'pA', startsAt: '2026-08-10', endsAt: '', reason: 'blessure' });
  ok(row.ends_at === null, 'ends_at = ' + JSON.stringify(row.ends_at));
});
t('un motif hors contrainte SQL est neutralisé au dump', () => {
  ok(ser._dumpUnavailRow({ id: 'x', playerId: 'pA', startsAt: '2026-08-10', reason: 'bidon' }).reason === 'autre');
});

// ============================================================================
// 8) v.97 — LE STATUT MÉDICAL EST LA SECONDE SOURCE D'INDISPONIBILITÉ
// ----------------------------------------------------------------------------
// Sur le terrain la coach déclare une blessure depuis la FICHE JOUEUSE
// (`p.injury`), pas via une période. Ce gisement était ignoré : la joueuse
// portait un badge « ✕ Indispo » sur la vue match ET restait comptée présente,
// donc le compteur du haut ne bougeait pas (19/1 au lieu de 16/4).
// ============================================================================
const TODAY = ctx.isoDate(new Date());
const AFTER = (n) => ctx.isoDate(new Date(Date.now() + n * 86400000));
function setInjury(pid, injury) {
  S.players.find(p => p.id === pid).injury = injury;
}

t('un statut médical « indispo » rend absente, comme une période', () => {
  seed(); setInjury('pA', { status: 'indispo', description: 'entorse' });
  const r = ctx._convocResp(conv(), AFTER(3), 'pA');
  ok(r.status === 'absent', 'statut = ' + r.status);
  ok(r.auto === true, 'non marquée dérivée');
  ok(r.unavail && r.unavail.medical === true, 'source médicale non tracée');
});
t('« aménagée » et « en soin » restent PRÉSENTES (elles s\'entraînent)', () => {
  seed(); setInjury('pA', { status: 'amenage' });
  ok(ctx._convocResp(conv(), AFTER(3), 'pA').status === 'present', 'aménagée comptée absente');
  setInjury('pA', { status: 'soin' });
  ok(ctx._convocResp(conv(), AFTER(3), 'pA').status === 'present', 'en soin comptée absente');
});
t('le retour prévu borne le statut médical', () => {
  seed(); setInjury('pA', { status: 'indispo', returnDate: AFTER(5) });
  ok(ctx._convocResp(conv(), AFTER(3), 'pA').status === 'absent', 'avant le retour, devrait être absente');
  ok(ctx._convocResp(conv(), AFTER(9), 'pA').status === 'present', 'encore absente après le retour prévu');
});
t('un statut médical NE RÉÉCRIT PAS le passé', () => {
  // Sinon la clôture d'un entraînement déjà joué recompterait les présences, et
  // les compteurs de défis (dérivés de là) partiraient en vrille.
  seed(); setInjury('pA', { status: 'indispo', startDate: '2020-01-01' });
  ok(ctx._convocResp(conv(), '2026-07-01', 'pA').status === 'present', 'le passé a été réécrit');
  ok(ctx._convocResp(conv(), TODAY, 'pA').status === 'absent', 'aujourd\'hui non couvert');
});
t('un RSVP explicite prime AUSSI sur le statut médical', () => {
  seed(); setInjury('pA', { status: 'indispo' });
  conv().instanceOverrides[AFTER(3)] = { responses: { pA: { status: 'present', at: 1 } } };
  ok(ctx._convocResp(conv(), AFTER(3), 'pA').status === 'present', 'la coach ne peut plus la convoquer');
});
t('une période saisie prime sur le statut médical (motif le plus précis)', () => {
  seed(); addUnavail('pA', TODAY, AFTER(30), 'exams');
  setInjury('pA', { status: 'indispo' });
  const r = ctx._convocResp(conv(), AFTER(3), 'pA');
  ok(r.reason === 'Examens', 'motif = ' + r.reason);
  ok(!r.unavail.medical, 'la source médicale a doublé la période saisie');
});
// v.98 — UN SEUL MOT, LE MÊME POUR TOUTES.
// « INDISPO (Blessure) » / « Indispo · médical » disaient DEUX choses fausses :
// que l'app ne gère que le médical, et — plus grave — ça étalait la raison de
// l'absence d'une joueuse sur un écran d'équipe. Vacances, examens, perso,
// blessure : le badge est le même. Le détail reste accessible à la coach.
t('le motif affiché est « INDISPO » nu — jamais la raison', () => {
  seed(); addUnavail('pA', TODAY, AFTER(30), 'vacances');
  const r = ctx._convocResp(conv(), AFTER(3), 'pA');
  ok(r.motif === 'INDISPO', 'motif = ' + r.motif);
  ok(r.reason === 'Vacances', 'la raison précise doit rester disponible : ' + r.reason);
  ok(r.source === 'unavailability', 'source = ' + r.source);
});
t('TOUS les motifs donnent le même badge (pas seulement le médical)', () => {
  ['blessure', 'vacances', 'exams', 'perso', 'autre'].forEach(reason => {
    seed(); addUnavail('pA', TODAY, AFTER(30), reason);
    const r = ctx._convocResp(conv(), AFTER(3), 'pA');
    ok(r.status === 'absent', reason + ' : non comptée absente');
    ok(r.motif === 'INDISPO', reason + ' : motif = ' + r.motif);
  });
});
t('le statut médical donne EXACTEMENT le même badge qu\'une période', () => {
  seed(); addUnavail('pA', TODAY, AFTER(30), 'vacances');
  const viaPeriode = ctx._convocResp(conv(), AFTER(3), 'pA').motif;
  seed(); setInjury('pA', { status: 'indispo' });
  const viaMedical = ctx._convocResp(conv(), AFTER(3), 'pA').motif;
  ok(viaPeriode === 'INDISPO' && viaMedical === 'INDISPO',
    'badges divergents : « ' + viaPeriode + ' » vs « ' + viaMedical + ' »');
});
t('aucun écran ne laisse fuir « médical » ni la raison dans le badge', () => {
  seed(); addUnavail('pA', TODAY, AFTER(30), 'perso', 'rendez-vous');
  S.auth = { role: 'coach', coachId: 'admin' };
  ctx.openEventInstance(CID, AFTER(3));
  const m = ctx.__lastModal || '';
  ok(/INDISPO/.test(m), 'badge absent');
  ok(!/Indispo · médical/.test(m) && !/INDISPO \(/.test(m), 'la raison fuite dans le badge');
});
t('un désistement explicite ne porte pas le préfixe INDISPO', () => {
  seed();
  conv().instanceOverrides[DATE] = { responses: { pA: { status: 'absent', reason: 'Boulot', at: 1 } } };
  const r = ctx._convocResp(conv(), DATE, 'pA');
  ok(r.motif === 'Boulot' && r.source === 'manual', JSON.stringify(r));
});
t('la joueuse voit son statut médical dans « mon statut » (vue entraînement)', () => {
  // Elle lisait « ✓ Présente · par défaut tu es comptée présente » pendant que
  // la coach la comptait absente : deux vérités pour le même événement.
  seed(); setInjury('pA', { status: 'indispo' });
  S.auth = { role: 'player', playerId: 'pA' };
  ctx.openEventInstance(CID, AFTER(3));
  const m = ctx.__lastModal || '';
  ok(/Absente/.test(m), 'la joueuse se croit encore présente');
  ok(/INDISPO/.test(m) && !/Blessure/.test(m), 'motif nu attendu');
});
t('la feuille d\'appel s\'ouvre malgré une absence DÉRIVÉE', () => {
  // Elle lisait `responses[p.id].reason` en direct → TypeError sur une absence
  // sans ligne de réponse, et l'écran d'appel ne s'ouvrait plus du tout.
  seed(); addUnavail('pA', TODAY, AFTER(30), 'blessure');
  ctx.openCallSheet(CID, AFTER(3));
  const m = ctx.__lastModal || '';
  ok(/Appel/.test(m), 'la feuille d\'appel ne s\'est pas ouverte');
  ok(/INDISPO/.test(m), 'motif absent de la liste des absentes');
});
t('l\'effectif du match n\'affiche plus « présente » sous un badge indispo', () => {
  seed();
  const MD = AFTER(3);
  S.matches = [{ id: 'm1', date: MD, opponent: 'X', teamTag: 'e1', seasonId: '2026-2027', roster: { included: ['pA', 'pB'] } }];
  S.convocations.push({ id: 'cvM', type: 'match', title: 'vs X', date: MD, recurrence: null,
    cancelledInstances: [], instanceOverrides: {}, attachments: [], responses: {},
    seasonId: '2026-2027', teamTag: 'e1', closed: false });
  setInjury('pA', { status: 'indispo' });
  ctx.openRosterManager('m1');
  const m = ctx.__lastModal || '';
  const row = m.slice(m.indexOf('Ophelie'), m.indexOf('Ophelie') + 500);
  ok(!/présente/.test(row), 'toujours annoncée présente : ' + row.slice(0, 260));
  ok(/INDISPO/.test(row), 'badge INDISPO absent de la vue match');
  ok(!/INDISPO \(/.test(m) && !/Indispo · médical/.test(m), 'la raison précise fuite dans le badge');
});
t('convocCard ne lève plus de ReferenceError (dateStr fantôme)', () => {
  seed(); addUnavail('pA', TODAY, AFTER(30), 'blessure');
  const out = ctx.convocCard(conv(), false, true);
  ok(typeof out === 'string' && out.length > 0, 'rendu vide');
  ok(/INDISPO/.test(out), 'motif hérité absent');
});

console.log(R.join('\n'));
const fails = R.filter(l => l.startsWith('✗'));
console.log(`\n${R.length - fails.length}/${R.length} OK`);
process.exit(fails.length ? 1 : 0);
