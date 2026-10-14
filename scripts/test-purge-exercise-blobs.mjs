// Test de la transformation pure de scripts/purge-exercise-blobs.mjs.
// Ce que ces assertions protègent : une purge est IRRÉVERSIBLE, donc ce qui
// compte n'est pas « ça supprime » mais « ça ne supprime QUE ça ».
import assert from 'node:assert';
import { stripPlan } from './purge-exercise-blobs.mjs';

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

const B64 = 'data:image/jpeg;base64,' + 'A'.repeat(500);
const PDF = 'data:application/pdf;base64,' + 'B'.repeat(900);
const URL1 = 'https://orertxlsvkdqayybgwaq.supabase.co/storage/v1/object/public/training-photos/exos/a.jpg';

const plan = () => ({
  validated: true,
  validatedAt: 1760000000000,
  completedExercises: { 0: true },
  exercises: [
    {
      title: 'TDT', duration: 15, desc: 'montée de balle',
      images: [B64, URL1, B64],
      attachments: [
        { name: 'schema.pdf', type: 'application/pdf', size: 900, data: PDF },
        { name: 'deja-migre.pdf', type: 'application/pdf', size: 12, data: URL1 },
      ],
      animations: [{ id: 'anim1', frames: 3 }],
      groups: [{ name: 'Groupe 1', players: ['p1', 'p2'] }],
    },
    { title: 'Shoot', duration: 10 },                       // ni images ni pièces jointes
    { title: 'Défense', duration: 8, images: [], attachments: [] },
  ],
});

console.log('Ce qui part');
{
  const r = stripPlan(plan());
  t('3 base64 retirés (2 photos + 1 PDF)', () => {
    assert.strictEqual(r.removedImages, 2);
    assert.strictEqual(r.removedFiles, 1);
  });
  t('octets libérés = la taille réelle des blobs', () => {
    assert.strictEqual(r.freedBytes, B64.length * 2 + PDF.length);
  });
}

console.log('Ce qui RESTE — la partie qui compte');
{
  const r = stripPlan(plan());
  const ex = r.plan.exercises[0];
  t('les images déjà en URL sont conservées', () => {
    assert.deepStrictEqual(ex.images, [URL1]);
  });
  t('les pièces jointes déjà en URL sont conservées', () => {
    assert.strictEqual(ex.attachments.length, 1);
    assert.strictEqual(ex.attachments[0].name, 'deja-migre.pdf');
  });
  t('titre, durée, description intacts', () => {
    assert.strictEqual(ex.title, 'TDT');
    assert.strictEqual(ex.duration, 15);
    assert.strictEqual(ex.desc, 'montée de balle');
  });
  t('animations et groupes intacts', () => {
    assert.deepStrictEqual(ex.animations, [{ id: 'anim1', frames: 3 }]);
    assert.deepStrictEqual(ex.groups, [{ name: 'Groupe 1', players: ['p1', 'p2'] }]);
  });
  t('validation et exercices terminés intacts', () => {
    assert.strictEqual(r.plan.validated, true);
    assert.strictEqual(r.plan.validatedAt, 1760000000000);
    assert.deepStrictEqual(r.plan.completedExercises, { 0: true });
  });
  t('les exercices sans média ne sont pas déformés', () => {
    assert.deepStrictEqual(r.plan.exercises[1], { title: 'Shoot', duration: 10 });
    assert.strictEqual(r.plan.exercises.length, 3);
  });
}

console.log("L'entrée n'est jamais mutée (la sauvegarde doit rester fidèle)");
{
  const src = plan();
  const copie = JSON.parse(JSON.stringify(src));
  stripPlan(src);
  t('le plan source est identique après appel', () => {
    assert.deepStrictEqual(src, copie);
  });
}

console.log('Entrées dégénérées : on ne casse rien');
{
  t('plan vide / null / sans exercices', () => {
    assert.deepStrictEqual(stripPlan(null).plan, {});
    assert.strictEqual(stripPlan({}).removedImages, 0);
    assert.strictEqual(stripPlan({ exercises: [] }).removedFiles, 0);
  });
  t('exercises pas un tableau → aucune casse', () => {
    const r = stripPlan({ exercises: { oops: true } });
    assert.deepStrictEqual(r.plan.exercises, { oops: true });
    assert.strictEqual(r.removedImages, 0);
  });
  t('pièce jointe nulle ou sans data → conservée telle quelle', () => {
    const r = stripPlan({ exercises: [{ attachments: [null, { name: 'x' }] }] });
    assert.strictEqual(r.removedFiles, 0);
    assert.strictEqual(r.plan.exercises[0].attachments.length, 2);
  });
  t('rien à purger → compteurs à zéro', () => {
    const r = stripPlan({ exercises: [{ images: [URL1] }] });
    assert.strictEqual(r.removedImages, 0);
    assert.strictEqual(r.freedBytes, 0);
  });
}

console.log('\n✅ ' + pass + ' assertions vertes');
