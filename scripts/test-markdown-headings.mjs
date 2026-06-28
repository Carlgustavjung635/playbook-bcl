// Test des nouveaux éléments markdown : titres (# ## ###), hr (--- *** ___),
// blockquote (>). Reproduit la nouvelle logique mdToHtml de index.html.
import assert from 'node:assert';

function mdEscape(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mdInline(t) {
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => /^(https?:\/\/|mailto:)/i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return t;
}
function mdStripArtefacts(s) { return String(s).replace(/\[\/?span(?:_\d+)?\]/gi, '').replace(/\{\/?[a-z]*_?span\}/gi, '').replace(/\{span_\d+\}/gi, ''); }
function mdToHtml(src) {
  if (src == null) return '';
  const lines = mdStripArtefacts(String(src)).replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let list = null, para = [], quote = null;
  const fp = () => { if (para.length) { blocks.push({ p: para.slice() }); para = []; } };
  const fl = () => { if (list) { blocks.push(list); list = null; } };
  const fq = () => { if (quote) { blocks.push({ q: quote.slice() }); quote = null; } };
  const fa = () => { fp(); fl(); fq(); };
  lines.forEach(line => {
    const hr = /^\s*([-*_])\1{2,}\s*$/.test(line);
    const heading = line.match(/^\s*(#{1,6})\s+(.*\S)\s*$/);
    const ul = line.match(/^\s*[*-]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const q = line.match(/^\s*>\s?(.*)$/);
    if (hr) { fa(); blocks.push({ hr: true }); return; }
    if (heading) { fa(); blocks.push({ h: Math.min(heading[1].length, 3), text: heading[2] }); return; }
    if (ul) { fp(); fq(); if (list && list.type !== 'ul') fl(); list = list || { type: 'ul', items: [] }; list.items.push(ul[1]); return; }
    if (ol) { fp(); fq(); if (list && list.type !== 'ol') fl(); list = list || { type: 'ol', items: [] }; list.items.push(ol[1]); return; }
    if (q) { fp(); fl(); quote = quote || []; quote.push(q[1]); return; }
    fl(); fq(); if (line.trim() === '') { fp(); return; } para.push(line);
  });
  fa();
  if (blocks.length === 1 && blocks[0].p) return blocks[0].p.map(l => mdInline(mdEscape(l))).join('<br>');
  return blocks.map(b => {
    if (b.hr) return '<hr>';
    if (b.h) return `<h${b.h + 1}>` + mdInline(mdEscape(b.text)) + `</h${b.h + 1}>`;
    if (b.q) return '<blockquote>' + b.q.map(l => mdInline(mdEscape(l))).join('<br>') + '</blockquote>';
    if (b.p) return '<p>' + b.p.map(l => mdInline(mdEscape(l))).join('<br>') + '</p>';
    return `<${b.type}>` + b.items.map(it => '<li>' + mdInline(mdEscape(it)) + '</li>').join('') + `</${b.type}>`;
  }).join('');
}

let pass = 0; function t(n, f) { f(); pass++; console.log('  ✓', n); }

console.log('SCÉNARIO 1 — titres # ## ### → h2 h3 h4');
t('# → h2', () => assert.strictEqual(mdToHtml('# Titre\n\ntexte'), '<h2>Titre</h2><p>texte</p>'));
t('## → h3', () => assert.strictEqual(mdToHtml('## Sous\n\ntexte'), '<h3>Sous</h3><p>texte</p>'));
t('### → h4 ; #### et + plafonnés à h4', () => {
  assert.ok(mdToHtml('### A\n\nx').startsWith('<h4>A</h4>'));
  assert.ok(mdToHtml('##### B\n\nx').startsWith('<h4>B</h4>'));
});
t('titre avec numéro "## 1. Échauffement" → h3 (pas une liste)', () => {
  assert.strictEqual(mdToHtml('## 1. Échauffement des Bras\n\nx'), '<h3>1. Échauffement des Bras</h3><p>x</p>');
});
t('#hashtag sans espace → PAS un titre (paragraphe)', () => {
  assert.strictEqual(mdToHtml('#pasuntitre'), '#pasuntitre');
});
t('gras dans un titre', () => assert.strictEqual(mdToHtml('# **Gros** titre\n\nx'), '<h2><strong>Gros</strong> titre</h2><p>x</p>'));

console.log('SCÉNARIO 2 — règle horizontale --- *** ___ → hr');
t('--- → hr', () => assert.strictEqual(mdToHtml('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>'));
t('*** et ___ → hr', () => { assert.ok(mdToHtml('***').includes('<hr>')); assert.ok(mdToHtml('___').includes('<hr>')); });
t('** (2 chars) n\'est PAS un hr', () => assert.ok(!mdToHtml('**').includes('<hr>')));
t('liste "- item" (avec espace) reste une liste, pas un hr', () => assert.strictEqual(mdToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>'));

console.log('SCÉNARIO 3 — blockquote >');
t('> quote → blockquote', () => assert.strictEqual(mdToHtml('> citation\n\nx'), '<blockquote>citation</blockquote><p>x</p>'));
t('quote multi-lignes', () => assert.strictEqual(mdToHtml('> l1\n> l2'), '<blockquote>l1<br>l2</blockquote>'));

console.log('SCÉNARIO 4 — sécurité maintenue dans les titres/quotes');
t('XSS échappé dans un titre', () => assert.ok(mdToHtml('# <script>x</script>\n\ny').includes('&lt;script&gt;')));

console.log('SCÉNARIO 5 — exemple réel "Routine d\'Échauffement"');
t('rendu complet titres + hr + listes + gras', () => {
  const src = "# Routine d'Échauffement sans Ballon\n## 1. Échauffement des Bras\n* **Bras tendus devant le corps :** rotations\n---\n## 2. Jambes";
  const out = mdToHtml(src);
  assert.ok(out.includes('<h2>') && out.includes('Routine'));
  assert.ok(out.includes('<h3>1. Échauffement des Bras</h3>'));
  assert.ok(out.includes('<ul><li><strong>Bras tendus devant le corps :</strong> rotations</li></ul>'));
  assert.ok(out.includes('<hr>'));
  assert.ok(!out.includes('#') && !out.includes('---'), 'plus de markdown brut');
});

console.log(`\n✅ ${pass} assertions OK — titres / hr / blockquote markdown.`);
