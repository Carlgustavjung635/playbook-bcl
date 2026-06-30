// Test du nettoyage des aperçus (snippets) d'exo/play : les tiles du carrousel
// Playbook (playTile) affichaient le MARKDOWN BRUT et les artefacts [span_N] dans
// le snippet (bug : PR #96 n'avait corrigé que l'éditeur de plan). Vérifie que
// mdToPlain strip bien artefacts + syntaxe markdown, et que playTile l'utilise.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

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

// mdToPlain dépend de mdStripArtefacts — on les exécute pour de vrai.
const src = extractFn(html, 'mdStripArtefacts') + '\n' + extractFn(html, 'mdToPlain');
const mdToPlain = new Function(src + '\nreturn mdToPlain;')();

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 1 — strip des artefacts [span_N] / {…_span}');
t('le cas exact de la capture : [span_0]L\'échauffeme... → sans artefact', () => {
  const out = mdToPlain("[span_0]L'échauffeme préventif a pour rôle de préparer le corps");
  assert.ok(!out.includes('[span_0]'));
  assert.ok(!out.includes('[span'));
  assert.ok(out.startsWith("L'échauffeme préventif"));
});
t('[span], [/span], {start_span}, {end_span}, {span_12} tous strippés', () => {
  const out = mdToPlain('[span]a[/span] {start_span}b{end_span} {span_12}c');
  assert.ok(!/\[\/?span|\{[a-z_]*span|\{span_\d+\}/i.test(out), 'artefact résiduel : ' + out);
  assert.ok(out.includes('a') && out.includes('b') && out.includes('c'));
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 2 — strip de la syntaxe markdown (texte nu lisible)');
t('gras/italique/code retirés', () => {
  assert.strictEqual(mdToPlain('**gras** et *ital* et `code`'), 'gras et ital et code');
});
t('titres # et listes → puces (simples sauts = espaces)', () => {
  assert.strictEqual(mdToPlain('# Titre\n- un\n- deux'), 'Titre • un • deux');
});
t('liens markdown → texte seul', () => {
  assert.strictEqual(mdToPlain('voir [la vidéo](https://x.io/v)'), 'voir la vidéo');
});
t('citations et hr retirés', () => {
  assert.strictEqual(mdToPlain('> note\n---\ntexte'), 'note · texte');
});
t('texte simple inchangé', () => {
  assert.strictEqual(mdToPlain('Juste du texte normal.'), 'Juste du texte normal.');
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 3 — playTile consomme mdToPlain (plus de desc brute)');
{
  const tile = extractFn(html, 'playTile');
  t('playTile calcule descPlain via mdToPlain(p.desc)', () => {
    assert.ok(/const descPlain = mdToPlain\(p\.desc \|\| ''\);/.test(tile));
  });
  t('le snippet meta (.v-tile-meta) utilise descPlain, pas esc(p.desc) brut', () => {
    assert.ok(/v-tile-meta">\$\{esc\(descPlain/.test(tile));
    assert.ok(!/v-tile-meta">\$\{esc\(p\.desc/.test(tile), 'snippet meta encore en desc brute');
  });
  t('le placeholder tronqué utilise descPlain.slice, pas p.desc.slice', () => {
    assert.ok(/esc\(descPlain\.slice\(0, 40\)\)/.test(tile));
    assert.ok(!/\(p\.desc \|\| ''\)\.slice\(0, 40\)/.test(tile), 'placeholder encore en desc brute');
  });
}

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 4 — non-régression : rendu réaliste d\'un exo échauffement');
t('un déroulé markdown complet → snippet propre clampable', () => {
  const raw = "[span_0]**Routine échauffement**\n\n- mobilité\n- *gainage*\n> rester concentrée";
  const out = mdToPlain(raw);
  assert.ok(!out.includes('[span_0]') && !out.includes('**') && !out.includes('>'));
  assert.ok(out.includes('Routine échauffement') && out.includes('• mobilité') && out.includes('gainage'));
});

console.log(`\n✅ ${pass} assertions OK — snippets d'exo/play nettoyés (mdToPlain dans playTile).`);
