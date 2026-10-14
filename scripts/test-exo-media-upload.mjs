// Test : les photos et PDF d'un exercice partent dans le bucket, et le plan ne
// garde qu'une URL. Avant, ils étaient embarqués en base64 DANS le plan, donc
// dans localStorage (~5 Mo sur Safari iOS) → bandeau « Enregistrement local
// incomplet ».
//
// L'assertion qui compte : en cas d'échec d'upload, on ne retombe JAMAIS sur le
// base64. Un repli « au cas où » recréerait exactement le bug corrigé.
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
  let p = 0, sigEnd = -1;
  for (let j = html.indexOf('(', start); j < html.length; j++) {
    if (html[j] === '(') p++;
    else if (html[j] === ')') { p--; if (p === 0) { sigEnd = j; break; } }
  }
  let depth = 0, began = false;
  for (let j = html.indexOf('{', sigEnd); j < html.length; j++) {
    const ch = html[j];
    if (ch === '{') { depth++; began = true; }
    else if (ch === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('déséquilibré : ' + name);
}

const FNS = ['_uploadExoMedia', '_exoMediaError', 'addCustomExoImages', 'addCustomExoFiles',
  'addExerciseImagesInDetail', 'addExerciseFilesInDetail'];
// `async function x(` n'est pas capté par le `function x(` d'extractFn : on
// recolle le mot-clé perdu, sinon les `await` du corps sont des SyntaxError.
const src = FNS.map(n => (html.includes('async function ' + n + '(') ? 'async ' : '') + extractFn(n)).join('\n\n');

function build({ failUpload = false, offline = false } = {}) {
  const log = { uploads: [], alerts: [], persisted: 0 };
  const sb = { storage: { from: (bucket) => ({
    upload: async (fname, body, opts) => {
      log.uploads.push({ bucket, fname, type: opts && opts.contentType });
      return failUpload ? { error: new Error('mime type not allowed') } : { error: null };
    },
    getPublicUrl: (fname) => ({ data: { publicUrl: 'https://cdn.test/' + bucket + '/' + fname } }),
  }) } };
  const state = {
    _customExoBuffer: { images: [], files: [] },
    _editingTraining: { convocId: 'c1' },
    _editingExerciseIdx: 0,
    convocations: [{ id: 'c1', trainingPlan: { exercises: [{ title: 'TDT' }] } }],
  };
  const env = {
    state, sb,
    window: offline ? {} : { sb },
    compressImageBlob: async () => ({ size: 120000, __blob: true }),
    // Si un chemin l'appelait encore, le test le verrait passer : c'est lui qui
    // produisait le base64.
    compressImage: async () => { throw new Error('compressImage ne doit plus servir pour un exo'); },
    alert: (m) => log.alerts.push(String(m)),
    persist: () => log.persisted++,
    renderCustomExerciseModal: () => {},
    renderExerciseDetail: () => {},
    console,
  };
  const names = Object.keys(env);
  const api = new Function(...names, src + '\nreturn {' + FNS.join(',') + '};')(...names.map(n => env[n]));
  return { api, log, state };
}

const evt = (names) => ({ target: { files: names.map(n => ({ name: n, size: 1000, type: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' })), value: 'x' } });
const isB64 = v => typeof v === 'string' && v.startsWith('data:');

console.log('CHEMIN NOMINAL — le plan ne contient que des URL');
{
  const { api, log, state } = build();
  await api.addExerciseImagesInDetail(evt(['terrain.jpg', 'terrain2.jpg']));
  const ex = state.convocations[0].trainingPlan.exercises[0];
  t('2 photos téléversées dans training-photos', () => {
    assert.strictEqual(log.uploads.length, 2);
    assert.ok(log.uploads.every(u => u.bucket === 'training-photos'));
    assert.ok(log.uploads.every(u => u.fname.startsWith('exo-') && u.fname.endsWith('.jpg')));
    assert.ok(log.uploads.every(u => u.type === 'image/jpeg'));
  });
  t('le plan ne garde que des URL, aucun base64', () => {
    assert.strictEqual(ex.images.length, 2);
    assert.ok(!ex.images.some(isB64));
    assert.ok(ex.images.every(u => u.startsWith('https://')));
  });
  t('persist() appelé, aucune alerte', () => {
    assert.strictEqual(log.persisted, 1);
    assert.deepStrictEqual(log.alerts, []);
  });
}
{
  const { api, log, state } = build();
  await api.addExerciseFilesInDetail(evt(['schema tactique.pdf']));
  const ex = state.convocations[0].trainingPlan.exercises[0];
  t('PDF téléversé, nom de fichier assaini', () => {
    assert.strictEqual(log.uploads.length, 1);
    assert.ok(log.uploads[0].fname.startsWith('exodoc-'));
    assert.doesNotMatch(log.uploads[0].fname, / /);
    assert.strictEqual(log.uploads[0].type, 'application/pdf');
  });
  t('`data` porte une URL — les lecteurs <a href> marchent sans changement', () => {
    assert.ok(!isB64(ex.attachments[0].data));
    assert.ok(ex.attachments[0].data.startsWith('https://'));
    assert.strictEqual(ex.attachments[0].name, 'schema tactique.pdf');
  });
}

console.log("ÉCHEC D'UPLOAD — aucun repli en base64 (c'est tout l'enjeu)");
{
  const { api, log, state } = build({ failUpload: true });
  await api.addExerciseImagesInDetail(evt(['terrain.jpg']));
  const ex = state.convocations[0].trainingPlan.exercises[0];
  t('rien n\'est ajouté au plan', () => {
    assert.deepStrictEqual(ex.images, []);
  });
  t('le coach est prévenu explicitement', () => {
    assert.strictEqual(log.alerts.length, 1);
    assert.match(log.alerts[0], /terrain\.jpg/);
    assert.match(log.alerts[0], /Rien n'a ete ajoute/);
  });
}
{
  const { api, state } = build({ failUpload: true });
  await api.addExerciseFilesInDetail(evt(['doc.pdf']));
  t('idem pour un PDF : pas de pièce jointe fantôme', () => {
    assert.deepStrictEqual(state.convocations[0].trainingPlan.exercises[0].attachments, []);
  });
}

console.log('HORS LIGNE — echec franc, pas de base64 de secours');
{
  // window.sb absent : _uploadExoMedia doit jeter AVANT tout upload.
  const { api, log, state } = build({ offline: true });
  await api.addExerciseImagesInDetail(evt(['terrain.jpg']));
  t('hors ligne : plan vide, aucun upload tenté, coach prévenu', () => {
    assert.deepStrictEqual(state.convocations[0].trainingPlan.exercises[0].images, []);
    assert.strictEqual(log.uploads.length, 0);
    assert.strictEqual(log.alerts.length, 1);
  });
}

console.log('BUFFER EXO CUSTOM — même règle');
{
  const { api, state, log } = build();
  await api.addCustomExoImages(evt(['a.jpg']));
  await api.addCustomExoFiles(evt(['b.pdf']));
  t('images et fichiers du buffer sont des URL', () => {
    assert.ok(!state._customExoBuffer.images.some(isB64));
    assert.ok(!state._customExoBuffer.files.some(f => isB64(f.data)));
    assert.strictEqual(log.uploads.length, 2);
  });
}

console.log('GARDE STATIQUE — plus aucun base64 sur le chemin des exos');
{
  t('les 4 handlers n\'appellent plus compressImage()', () => {
    for (const n of ['addCustomExoImages', 'addExerciseImagesInDetail']) {
      assert.doesNotMatch(extractFn(n), /compressImage\(/);
    }
  });
  t('les 2 handlers de fichiers n\'appellent plus readAsDataURL()', () => {
    for (const n of ['addCustomExoFiles', 'addExerciseFilesInDetail']) {
      assert.doesNotMatch(extractFn(n), /readAsDataURL/);
    }
  });
}

console.log('VERSION — bumpée des DEUX côtés (procédure PWA)');
{
  const v = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).v;
  t('version.json === APP_VERSION', () => {
    assert.strictEqual(html.match(/const APP_VERSION = '([^']+)'/)[1], v);
  });
}

console.log('\n✅ ' + pass + ' assertions vertes');
