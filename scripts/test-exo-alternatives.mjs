// Test « EXOS ALTERNATIFS » (v.153, ZÉRO migration).
//
// LE choix structurant : on ne stocke pas « variante A / variante B + un drapeau
// lu partout ». `ex` porte TOUJOURS l'exo actif, `ex.alt` porte la réserve, et
// basculer ÉCHANGE les deux. Conséquence — c'est ce que ce fichier verrouille —
// aucun écran joueuse n'a une ligne à changer, et l'alternative leur est
// structurellement invisible puisqu'aucun d'eux ne lit `ex.alt`. Un drapeau lu à
// N endroits aurait fini par fuiter à l'endroit oublié : c'est le mode de panne
// de la v.133 (la clôture corrigée, les vues jamais).
//
// Sont aussi verrouillés : UNE seule alternative par exo, la suppression qui
// vise la RÉSERVE et jamais l'exo affiché, et la survie au round-trip jsonb du
// plan — le plan est un blob, pas des colonnes, d'où l'absence de migration.
//
// Le sujet est le VRAI code d'index.html, exécuté dans un vm à DOM stubé.
import { buildCtx, runner } from './_ctx-index.mjs';
const ctx = buildCtx();
const { t, ok, eq, end } = runner();
const S = ctx.state;

S.auth = { role: 'coach', coachId: 'c1' };
S.coaches = [{ id: 'c1', name: 'Marc', coachRole: 'admin_coach' }];
S.exoTemplates = [{ id: 'e1', name: 'Pompes classiques', description: '4x12' }];
const mkEx = () => ({ id: 'x1', source: 'custom', title: 'Pompes diamant', description: '4x8', duration: 10 });

t('poser une alternative depuis la biblio', () => {
  const ex = mkEx();
  const alt = ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12', exoTemplateId: 'e1' });
  ok(alt, 'posée');
  eq(ex.alt.title, 'Pompes classiques');
  eq(ex.alt.exoTemplateId, 'e1');
  eq(ex.title, 'Pompes diamant', "l'exo actif n'a pas bougé");
  eq(ex.activeVariant, 'main');
});

t('poser une alternative custom (hors biblio)', () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Gainage', description: '3x45 s' });
  eq(ex.alt.exoTemplateId, null, 'aucun template');
  eq(ex.alt.description, '3x45 s');
});

t('un titre vide est refusé', () => {
  const ex = mkEx();
  eq(ctx.altSet(ex, { title: '   ', description: 'x' }), null);
  ok(!ex.alt, 'rien posé');
});

t('UNE SEULE alternative : une seconde pose REMPLACE', () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'A', description: 'a' });
  ctx.altSet(ex, { title: 'B', description: 'b' });
  eq(ex.alt.title, 'B');
  ok(!Array.isArray(ex.alt), 'jamais une liste');
});

t('basculer ÉCHANGE les contenus et flippe activeVariant', () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12', exoTemplateId: 'e1' });
  ok(ctx.altSwap(ex), 'bascule acceptée');
  eq(ex.title, 'Pompes classiques', "l'alternative est devenue l'actif");
  eq(ex.description, '4x12');
  eq(ex.exoTemplateId, 'e1');
  eq(ex.alt.title, 'Pompes diamant', "l'ancien actif est passé en réserve");
  eq(ex.activeVariant, 'alt');
});

t('double bascule = identité (aucune donnée perdue en route)', () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12', exoTemplateId: 'e1' });
  ctx.altSwap(ex); ctx.altSwap(ex);
  eq(ex.title, 'Pompes diamant');
  eq(ex.description, '4x8');
  eq(ex.alt.title, 'Pompes classiques');
  eq(ex.activeVariant, 'main');
});

t("sans alternative, il n'y a rien à basculer", () => {
  eq(ctx.altSwap(mkEx()), false);
});

t("✕ supprime la RÉSERVE, jamais l'exo affiché", () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12' });
  ctx.altSwap(ex);                       // l'alternative est maintenant l'actif
  ctx.altClear(ex);
  eq(ex.title, 'Pompes classiques', "l'exo affiché survit");
  ok(!ex.alt, 'la réserve est partie');
  ok(!ex.activeVariant, 'et le libellé dérivé avec');
});

t("INVISIBLE CÔTÉ JOUEUSE : aucun rendu de l'alternative hors rôle coach", () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12' });
  S.auth = { role: 'player', playerId: 'j1' };
  eq(ctx.altRowHtml(ex, 0), '', 'rien pour une joueuse');
  S.auth = { role: 'coach', coachId: 'c1' };
  const h = ctx.altRowHtml(ex, 0);
  ok(h.includes('Pompes classiques'), 'le coach voit la réserve');
  ok(h.includes('privé coach'), 'et son étiquette');
  ok(h.includes('Basculer'), 'avec le bouton de bascule');
});

t("le bouton « ⇄ Alternative » n'est proposé qu'au coach", () => {
  const ex = mkEx();
  S.auth = { role: 'player', playerId: 'j1' };
  eq(ctx.altRowHtml(ex, 0), '');
  S.auth = { role: 'coach', coachId: 'c1' };
  ok(ctx.altRowHtml(ex, 0).includes('openAltExoModal(0)'), 'proposé au coach');
});

t("la session live (écran partagé) ne voit QUE l'exo actif", () => {
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12' });
  const exos = ctx._liveExtractExos({ exercises: [ex] });
  eq(exos.length, 1);
  eq(exos[0].title, 'Pompes diamant', "seul l'actif est extrait");
  ok(!JSON.stringify(exos).includes('Pompes classiques'), 'la réserve ne fuit pas');
});

t("le badge ACTIF n'apparaît QUE s'il y a une alternative", () => {
  const plain = mkEx();
  eq(ctx.altActiveBadge(plain), '', 'exo seul : pas de badge (bruit inutile)');
  ctx.altSet(plain, { title: 'B' });
  ok(ctx.altActiveBadge(plain).includes('ACTIF'), "badge dès qu'il y a un choix");
});

t("ZÉRO migration : l'alternative survit au round-trip jsonb du plan", () => {
  const ent = (ctx.ENTITIES || []).find(e => e.key === 'trainingPlans');
  ok(ent, 'entité trainingPlans');
  const ex = mkEx();
  ctx.altSet(ex, { title: 'Pompes classiques', description: '4x12', exoTemplateId: 'e1' });
  S.trainingPlans = [{ convocationId: 'cv1', instanceDate: '2026-08-22', seasonId: 's1', plan: { exercises: [ex], validated: false, completedExercises: {} }, updatedAt: 1000 }];
  const rows = ent.dump(S);
  const row = rows['cv1::2026-08-22'];
  ok(row, 'ligne dumpée');
  eq(row.plan.exercises[0].alt.title, 'Pompes classiques', "l'alternative part avec le blob");
  S.trainingPlans = [];
  ent.apply(S, [{ ...row, updated_at: '2026-08-22T10:00:00Z' }]);
  eq(S.trainingPlans[0].plan.exercises[0].alt.title, 'Pompes classiques', 'et revient intacte');
  eq(S.trainingPlans[0].plan.exercises[0].title, 'Pompes diamant', "l'actif aussi");
});

end();
