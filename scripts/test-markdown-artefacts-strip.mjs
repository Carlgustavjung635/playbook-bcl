// Test du strip des artefacts de collage (export Docs/Notion/IA) + mdToPlain.
// Reproduit mdStripArtefacts / mdToPlain / mdToHtml de index.html.
import assert from 'node:assert';

function mdStripArtefacts(s) {
  return String(s)
    .replace(/\[\/?span(?:_\d+)?\]/gi, '')
    .replace(/\{\/?[a-z]*_?span\}/gi, '')
    .replace(/\{span_\d+\}/gi, '');
}
function mdToPlain(s) {
  return mdStripArtefacts(String(s || ''))
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\n{2,}/g, ' · ').replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}
// mdToHtml minimal (réutilise stripArtefacts) pour vérifier que l'artefact ne
// survit pas au rendu HTML non plus.
function mdEscape(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mdToHtml(src) {
  if (src == null) return '';
  const lines = mdStripArtefacts(String(src)).replace(/\r\n?/g, '\n').split('\n');
  return lines.map(l => mdEscape(l)).join('<br>'); // suffisant pour l'assertion "plus d'artefact"
}

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — strip des patterns d\'artefact');
t('[span_0] retiré', () => assert.strictEqual(mdStripArtefacts('Bras [span_0]tendus'), 'Bras tendus'));
t('[span_12] (multi-digits) retiré', () => assert.strictEqual(mdStripArtefacts('a[span_12]b'), 'ab'));
t('{start_span} et {end_span} retirés', () => assert.strictEqual(mdStripArtefacts('x{start_span}y{end_span}z'), 'xyz'));
t('{span_3} retiré', () => assert.strictEqual(mdStripArtefacts('p{span_3}q'), 'pq'));
t('[span] / [/span] / {span} génériques retirés', () => {
  assert.strictEqual(mdStripArtefacts('a[span]b[/span]c{span}d{/span}e'), 'abcde');
});
t('le cas réel "[span_0]{start_span}…{end_span}"', () => {
  assert.strictEqual(mdStripArtefacts('Texte [span_0]{start_span}important{end_span} ici'), 'Texte important ici');
});
t('texte normal inchangé (pas de faux positif)', () => {
  assert.strictEqual(mdStripArtefacts('Course [voir lien](https://x.com) et [1] note'), 'Course [voir lien](https://x.com) et [1] note');
});

console.log('SCÉNARIO 2 — strip appliqué avant le rendu HTML');
t('aucun artefact ne survit dans le HTML', () => {
  const out = mdToHtml('# Titre [span_0]\n{start_span}corps{end_span}');
  assert.ok(!out.includes('span_0') && !out.includes('start_span') && !out.includes('end_span'));
});

console.log('SCÉNARIO 3 — mdToPlain (aperçu tronqué : ni markdown ni artefact)');
t('titres et puces nettoyés en texte', () => {
  assert.strictEqual(mdToPlain('# Titre\n* point un\n* point deux'), 'Titre • point un • point deux');
});
t('gras/italique/code/liens réduits au texte', () => {
  assert.strictEqual(mdToPlain('**Gros** et *fin* et `code` et [lien](https://x)'), 'Gros et fin et code et lien');
});
t('artefacts retirés dans l\'aperçu', () => {
  assert.strictEqual(mdToPlain('Bras [span_0]tendus{end_span} devant'), 'Bras tendus devant');
});
t('--- supprimé en aperçu', () => assert.ok(!mdToPlain('a\n---\nb').includes('---')));

console.log(`\n✅ ${pass} assertions OK — strip artefacts + mdToPlain.`);
