// Test du mini-renderer markdown (mdToHtml) — reproduit fidèlement index.html.
// Couvre : gras, italique, code, listes (* - 1.), liens, échappement XSS,
// multiligne, cas mono-paragraphe (inline sans <p>), et l'exemple réel rapporté.
import assert from 'node:assert';

// --- SUJET (extrait fidèle de index.html) ---
function mdEscape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function mdInline(t) {
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) =>
    /^(https?:\/\/|mailto:)/i.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return t;
}
// mdToHtml mis à jour (PR #95+ : headings/hr/quote/strip artefacts). Les
// assertions ci-dessous (patterns historiques) doivent rester VRAIES sous la
// nouvelle logique → prouve la non-régression des anciens patterns.
function mdStripArtefacts(s) {
  return String(s).replace(/\[\/?span(?:_\d+)?\]/gi, '').replace(/\{\/?[a-z]*_?span\}/gi, '').replace(/\{span_\d+\}/gi, '');
}
function mdToHtml(src) {
  if (src == null) return '';
  const lines = mdStripArtefacts(String(src)).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let list = null, para = [], quote = null;
  const flushPara = () => { if (para.length) { blocks.push({ p: para.slice() }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flushQuote = () => { if (quote) { blocks.push({ q: quote.slice() }); quote = null; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  lines.forEach(line => {
    const hr = /^\s*([-*_])\1{2,}\s*$/.test(line);
    const heading = line.match(/^\s*(#{1,6})\s+(.*\S)\s*$/);
    const ul = line.match(/^\s*[*-]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const q = line.match(/^\s*>\s?(.*)$/);
    if (hr) { flushAll(); blocks.push({ hr: true }); return; }
    if (heading) { flushAll(); blocks.push({ h: Math.min(heading[1].length, 3), text: heading[2] }); return; }
    if (ul) { flushPara(); flushQuote(); if (list && list.type !== 'ul') flushList(); list = list || { type: 'ul', items: [] }; list.items.push(ul[1]); return; }
    if (ol) { flushPara(); flushQuote(); if (list && list.type !== 'ol') flushList(); list = list || { type: 'ol', items: [] }; list.items.push(ol[1]); return; }
    if (q) { flushPara(); flushList(); quote = quote || []; quote.push(q[1]); return; }
    flushList(); flushQuote();
    if (line.trim() === '') { flushPara(); return; }
    para.push(line);
  });
  flushAll();
  if (blocks.length === 1 && blocks[0].p) {
    return blocks[0].p.map(l => mdInline(mdEscape(l))).join('<br>');
  }
  return blocks.map(b => {
    if (b.hr) return '<hr>';
    if (b.h) return `<h${b.h + 1}>` + mdInline(mdEscape(b.text)) + `</h${b.h + 1}>`;
    if (b.q) return '<blockquote>' + b.q.map(l => mdInline(mdEscape(l))).join('<br>') + '</blockquote>';
    if (b.p) return '<p>' + b.p.map(l => mdInline(mdEscape(l))).join('<br>') + '</p>';
    return `<${b.type}>` + b.items.map(it => '<li>' + mdInline(mdEscape(it)) + '</li>').join('') + `</${b.type}>`;
  }).join('');
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — inline : gras / italique / code');
t('**gras** → <strong>', () => assert.strictEqual(mdToHtml('Voici du **gras** ici'), 'Voici du <strong>gras</strong> ici'));
t('*italique* → <em>', () => assert.strictEqual(mdToHtml('un mot *clé* important'), 'un mot <em>clé</em> important'));
t('`code` → <code>', () => assert.strictEqual(mdToHtml('la var `x` vaut 2'), 'la var <code>x</code> vaut 2'));
t('gras + italique combinés', () => assert.strictEqual(mdToHtml('**L\'objectif :** près du panier (*low post*)'),
  '<strong>L\'objectif :</strong> près du panier (<em>low post</em>)'));
t('mono-paragraphe → PAS de <p> (compact, réutilisable inline)', () => {
  assert.ok(!mdToHtml('texte simple').includes('<p>'));
});

console.log('SCÉNARIO 2 — listes');
t('liste à puces (*) → <ul><li>', () => assert.strictEqual(mdToHtml('* un\n* deux'),
  '<ul><li>un</li><li>deux</li></ul>'));
t('liste à puces (-) → <ul><li>', () => assert.strictEqual(mdToHtml('- a\n- b'),
  '<ul><li>a</li><li>b</li></ul>'));
t('liste numérotée (1.) → <ol><li>', () => assert.strictEqual(mdToHtml('1. premier\n2. second'),
  '<ol><li>premier</li><li>second</li></ol>'));
t('liste avec gras dans les items', () => assert.strictEqual(mdToHtml('* **Titre :** détail'),
  '<ul><li><strong>Titre :</strong> détail</li></ul>'));

console.log('SCÉNARIO 3 — liens (http/mailto autorisés, reste littéral)');
t('lien http → <a target=_blank rel=noopener>', () => assert.strictEqual(mdToHtml('voir [doc](https://x.com/a)'),
  'voir <a href="https://x.com/a" target="_blank" rel="noopener noreferrer">doc</a>'));
t('mailto autorisé', () => assert.ok(mdToHtml('[mail](mailto:a@b.fr)').includes('href="mailto:a@b.fr"')));
t('javascript: REJETÉ (texte littéral inerte, aucun href dangereux)', () => {
  const out = mdToHtml('[x](javascript:alert(1))');
  assert.ok(!out.includes('<a '), 'aucun lien <a> généré');
  assert.ok(!/href\s*=/i.test(out), 'aucun attribut href émis');
});

console.log('SCÉNARIO 4 — sécurité XSS : échappement AVANT transformation');
t('<script> échappé', () => {
  const out = mdToHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), 'balise script neutralisée');
  assert.ok(out.includes('&lt;script&gt;'), 'échappé en entités');
});
t('guillemets et < > dans le texte échappés', () => {
  assert.strictEqual(mdToHtml('a < b & "c"'), 'a &lt; b &amp; &quot;c&quot;');
});
t('HTML brut injecté dans un item de liste reste échappé', () => {
  assert.strictEqual(mdToHtml('* <img src=x onerror=alert(1)>'),
    '<ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>');
});

console.log('SCÉNARIO 5 — multiligne / paragraphes / sauts de ligne');
t('deux lignes dans un paragraphe → <br>', () => assert.strictEqual(mdToHtml('ligne1\nligne2'), 'ligne1<br>ligne2'));
t('paragraphes séparés par ligne vide → <p>…</p><p>…</p>', () => assert.strictEqual(mdToHtml('para A\n\npara B'),
  '<p>para A</p><p>para B</p>'));
t('paragraphe puis liste', () => assert.strictEqual(mdToHtml('Intro\n* a\n* b'),
  '<p>Intro</p><ul><li>a</li><li>b</li></ul>'));
t('vide / null → chaîne vide', () => { assert.strictEqual(mdToHtml(''), ''); assert.strictEqual(mdToHtml(null), ''); });

console.log('SCÉNARIO 6 — exemple réel rapporté (CROSS SCREEN)');
t('liste md du play rendue en <ul> avec gras + italique', () => {
  const src = "* **L'objectif :** libérer un pivot près du panier (*low post*).\n* **La variante (Screen-the-Screener) :** très souvent utilisée.";
  const out = mdToHtml(src);
  assert.ok(out.startsWith('<ul>') && out.endsWith('</ul>'));
  assert.ok(out.includes('<strong>L\'objectif :</strong>'));
  assert.ok(out.includes('<em>low post</em>'));
  assert.ok(out.includes('<strong>La variante (Screen-the-Screener) :</strong>'));
  assert.ok(!out.includes('* '), 'plus de syntaxe markdown brute visible');
});

console.log(`\n✅ ${pass} assertions OK — mini-renderer markdown (gras/italique/listes/liens/XSS/multiligne).`);
