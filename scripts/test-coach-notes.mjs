// Test « NOTES COACHS » (v.153, migration 20260822_001).
//
// Le fil est privé entre coachs et accroché à UNE SÉANCE. Ce qui casse en
// silence, et qui est donc verrouillé ici :
//   • le fil est scopé au couple (convocation, date d'instance) et PAS à la
//     convocation seule : un entraînement récurrent a un fil par séance. C'est
//     exactement le défaut payé en v.140 sur les réponses de convoc — stockage
//     clé sur la date, lecture qui ne l'était pas ;
//   • la garde coach se lit sur state.auth.role === 'coach', JAMAIS sur
//     !isPlayer : un rôle inconnu doit se taire (leçon v.114) ;
//   • le rendu ÉCHAPPE D'ABORD et injecte les chips ENSUITE — une note qui
//     contient du HTML ne doit jamais s'exécuter ;
//   • createdAt ne bouge pas à l'édition (c'est l'heure du propos) ; editedAt
//     EST le badge « modifié », et il naît NULL ;
//   • la suppression est un SOFT-delete : un hard delete sur un id local serait
//     repoussé par n'importe quel autre appareil au flush suivant ;
//   • le corps du push est le texte NU tronqué à 100 — ni la ferraille de
//     mention, ni la photo.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import { buildCtx, runner } from './_ctx-index.mjs';
const ctx = buildCtx();
const { t, ok, eq, end } = runner();
const S = ctx.state;

S.auth = { role: 'coach', coachId: 'c1' };
S.coaches = [{ id: 'c1', name: 'Marc', coachRole: 'admin_coach' }, { id: 'c2', name: 'Lea', coachRole: 'coach' }];
S.plays = [{ id: 'p1', name: 'Horns 45' }, { id: 'p2', name: 'Zipper' }];
S.trainingCoachNotes = [];

t("le fil est scopé à SA date d'instance (pas à la convoc)", () => {
  S.trainingCoachNotes = [
    { id: 'n1', trainingKey: 'cv1::2026-08-19', convocationId: 'cv1', instanceDate: '2026-08-19', coachId: 'c2', coachName: 'Lea', textMd: 'du 19', createdAt: 100, updatedAt: 100 },
    { id: 'n2', trainingKey: 'cv1::2026-08-26', convocationId: 'cv1', instanceDate: '2026-08-26', coachId: 'c2', coachName: 'Lea', textMd: 'du 26', createdAt: 200, updatedAt: 200 },
  ];
  eq(ctx.tcnNotes('cv1', '2026-08-19').length, 1, 'fil du 19');
  eq(ctx.tcnNotes('cv1', '2026-08-19')[0].textMd, 'du 19');
  eq(ctx.tcnNotes('cv1', '2026-08-26')[0].textMd, 'du 26');
});

t('soft-delete filtré + tri chronologique DESCENDANT', () => {
  S.trainingCoachNotes.push({ id: 'n3', trainingKey: 'cv1::2026-08-19', convocationId: 'cv1', instanceDate: '2026-08-19', coachId: 'c1', textMd: 'plus recente', createdAt: 500, updatedAt: 500 });
  S.trainingCoachNotes.push({ id: 'n4', trainingKey: 'cv1::2026-08-19', convocationId: 'cv1', instanceDate: '2026-08-19', coachId: 'c1', textMd: 'morte', createdAt: 900, updatedAt: 900, deletedAt: 950 });
  const l = ctx.tcnNotes('cv1', '2026-08-19');
  eq(l.length, 2, 'la supprimée ne compte pas');
  eq(l[0].textMd, 'plus recente', 'la plus récente en tête');
});

t('non-lus : mes propres notes ne le sont jamais ; tcnMarkRead éteint le badge', () => {
  eq(ctx.tcnUnreadCount('cv1', '2026-08-19'), 1, 'seule celle de Lea est non lue');
  ctx.tcnMarkRead('cv1', '2026-08-19');
  eq(ctx.tcnUnreadCount('cv1', '2026-08-19'), 0, 'badge éteint après lecture');
});

t('@mentions : extraction, texte nu, chip cliquable', () => {
  const txt = 'On rejoue @[Horns 45](play:p1) puis @[Zipper](play:p2)';
  const refs = ctx.tcnExtractPlayRefs(txt);
  eq(refs.length, 2); eq(refs[0], 'p1'); eq(refs[1], 'p2');
  eq(ctx.tcnPlainText(txt), 'On rejoue Horns 45 puis Zipper', 'texte nu');
  const html = ctx.tcnRenderText(txt);
  ok(html.includes('tcn-chip'), 'chip rendu');
  ok(html.includes("_tcnOpenPlay('p1')"), 'chip cliquable pour un play connu');
});

t('un play supprimé dégrade le chip au lieu de casser la note', () => {
  const html = ctx.tcnRenderText('cf @[Fantome](play:pX)');
  ok(html.includes('tcn-chip'), 'chip présent');
  ok(!html.includes('_tcnOpenPlay'), 'mais pas cliquable');
});

t("XSS : on échappe D'ABORD, on injecte les chips ENSUITE", () => {
  const html = ctx.tcnRenderText('<img src=x onerror=alert(1)> @[<b>Play</b>](play:p1)');
  ok(!html.includes('<img'), 'la balise est neutralisée');
  ok(html.includes('&lt;img'), 'elle est échappée');
  ok(!html.includes('<b>Play</b>'), 'le nom de la mention est échappé lui aussi');
});

t('corps du push : texte NU, 100 chars max, photo seule => 📎', () => {
  eq(ctx.tcnPushBody('On rejoue @[Horns 45](play:p1) ce soir'), 'On rejoue Horns 45 ce soir');
  eq(ctx.tcnPushBody('a'.repeat(250)).length, 101, '100 + ellipse');
  eq(ctx.tcnPushBody(''), '📎 Photo', 'une note sans texte annonce la photo');
  ok(ctx.tcnPushTitle('Lea', 'Entrainement E1').startsWith('💬 Lea a commenté'), 'titre du push');
});

t('ajout : playRefs dérivés du texte, editedAt NULL à la création', () => {
  S.trainingCoachNotes = [];
  const n = ctx.tcnAddNote('cv9', '2026-08-22', 'Voir @[Zipper](play:p2)', null);
  ok(n, 'note créée');
  eq(n.coachId, 'c1');
  eq(n.playRefs.length, 1); eq(n.playRefs[0], 'p2');
  eq(n.editedAt, null, 'editedAt NULL sur une création');
  eq(n.trainingKey, 'cv9::2026-08-22');
});

t('édition : createdAt figé, editedAt né, playRefs recalculés', () => {
  const n = ctx.tcnNotes('cv9', '2026-08-22')[0];
  const born = n.createdAt;
  const e = ctx.tcnEditNote(n.id, 'Finalement @[Horns 45](play:p1)');
  ok(e, 'édition acceptée');
  eq(e.createdAt, born, 'createdAt ne bouge pas');
  ok(e.editedAt, 'editedAt né');
  eq(e.playRefs[0], 'p1', 'refs recalculés');
  eq(e.updatedAt, e.editedAt, 'LWW bumpé');
});

t("on n'édite ni ne supprime la note d'un autre coach", () => {
  const n = ctx.tcnNotes('cv9', '2026-08-22')[0];
  n.coachId = 'c2';
  eq(ctx.tcnEditNote(n.id, 'pirate'), null, 'édition refusée');
  eq(ctx.tcnDeleteNote(n.id), false, 'suppression refusée');
  n.coachId = 'c1';
});

t('suppression = SOFT-delete (la ligne survit, marquée)', () => {
  const n = ctx.tcnNotes('cv9', '2026-08-22')[0];
  ok(ctx.tcnDeleteNote(n.id), 'accepté');
  eq(ctx.tcnNotes('cv9', '2026-08-22').length, 0, 'plus rendue');
  ok(S.trainingCoachNotes.some(x => x.id === n.id && x.deletedAt), 'mais toujours là, deleted_at posé');
});

t('COACH ONLY : une joueuse ne voit rien et ne peut rien écrire', () => {
  S.auth = { role: 'player', playerId: 'j1' };
  eq(ctx.tcnBlockHtml('cv1', '2026-08-19'), '', 'aucun HTML rendu');
  eq(ctx.tcnAddNote('cv1', '2026-08-19', 'coucou'), null, 'écriture refusée');
  eq(ctx.tcnUnreadCount('cv1', '2026-08-19'), 0, 'aucun badge');
  S.auth = { role: 'coach', coachId: 'c1' };
  const h = ctx.tcnBlockHtml('cv1', '2026-08-19');
  ok(h.includes('Notes coachs'), 'le coach, lui, voit le bloc');
  ok(h.includes('coach uniquement'), "et la mention 👁️ d'exclusivité");
});

t("PbSync : l'entité est branchée et fait l'aller-retour", () => {
  const ent = (ctx.ENTITIES || []).find(e => e.key === 'trainingCoachNotes');
  ok(ent, 'entité présente dans ENTITIES');
  eq(ent.table, 'training_coach_notes');
  S.trainingCoachNotes = [{ id: 'nZ', trainingKey: 'cv1::2026-08-19', convocationId: 'cv1', instanceDate: '2026-08-19', coachId: 'c1', coachName: 'Marc', textMd: 'aller', photoDataUrl: null, playRefs: ['p1'], createdAt: 1000, updatedAt: 1000, editedAt: null, deletedAt: null }];
  const rows = ent.dump(S);
  ok(rows.nZ, 'ligne dumpée');
  eq(rows.nZ.training_key, 'cv1::2026-08-19');
  eq(rows.nZ.text_md, 'aller');
  S.trainingCoachNotes = [];
  ent.apply(S, [rows.nZ]);
  eq(S.trainingCoachNotes.length, 1);
  eq(S.trainingCoachNotes[0].textMd, 'aller', 'retour fidèle');
  eq(S.trainingCoachNotes[0].playRefs[0], 'p1');
});

end();
