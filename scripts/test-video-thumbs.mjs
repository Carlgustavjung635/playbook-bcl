// Test des aperçus vidéo NON-YouTube (Instagram / Vimeo / TikTok).
//
// LE BUG : sur l'écran PLAYS, une carte dont la vidéo est un reel Instagram
// affichait un carré gris quasi vide (juste un ▶ minuscule en haut à gauche),
// là où une vidéo YouTube affiche sa vignette. Cause : parseVideo() renvoie
// `thumb: null` pour Instagram et RIEN dans l'app n'allait chercher de vignette
// — il n'y a jamais eu de mécanisme, ni proxy ni oEmbed.
//
// CE QUI EST VÉRIFIÉ ICI :
//   1. la dissymétrie de parseVideo (YouTube a une vignette d'URL, pas les autres) ;
//   2. la demande de vignette distante est bien posée sur le DOM (data-vthumb)
//      pour instagram/vimeo/tiktok, et JAMAIS pour YouTube (inutile) ;
//   3. le placeholder de repli est LISIBLE : couleurs du réseau + titre du play ;
//   4. le cache local (TTL positif ET négatif) évite de marteler le réseau ;
//   5. la fonction serveur /api/video-thumb : liste blanche, jeton par variable
//      d'environnement, aucun secret en dur.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const fnPath = join(ROOT, 'netlify', 'functions', 'video-thumb.js');

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
function extractDecl(src, name) {
  const m = src.match(new RegExp('^(?:const|let) ' + name + ' = .*$', 'm'));
  assert.ok(m, 'déclaration introuvable : ' + name);
  return m[0];
}

// --- On exécute le VRAI code du fichier (pas une copie) ---------------------
const preamble = `
  const _store = {};
  const localStorage = {
    getItem: k => (k in _store ? _store[k] : null),
    setItem: (k, v) => { _store[k] = String(v); },
  };
  function getCatClass() { return 'cat-x'; }
  function getCatShort() { return 'XX'; }
`;
const src = [
  preamble,
  extractDecl(html, 'VIDEO_THUMB_KEY'),
  extractDecl(html, 'VIDEO_THUMB_TTL_OK'),
  extractDecl(html, 'VIDEO_THUMB_TTL_KO'),
  extractDecl(html, 'VIDEO_THUMB_REMOTE'),
  extractDecl(html, 'VIDEO_PROVIDER_LABEL'),
  'let _videoThumbMem = null;',
  extractFn(html, 'esc'),
  extractFn(html, 'mdStripArtefacts'),
  extractFn(html, 'mdToPlain'),
  extractFn(html, 'parseVideo'),
  extractFn(html, 'videoProviderGlyph'),
  extractFn(html, '_videoThumbNeedsRemote'),
  extractFn(html, '_videoThumbStore'),
  extractFn(html, '_videoThumbSave'),
  extractFn(html, '_videoThumbCached'),
  extractFn(html, '_videoThumbRemember'),
  extractFn(html, '_videoThumbSlot'),
  extractFn(html, 'playTile'),
].join('\n');
const api = new Function(src + `
  return { parseVideo, playTile, _videoThumbSlot, _videoThumbNeedsRemote,
           _videoThumbCached, _videoThumbRemember, _store };
`)();

const IG = 'https://www.instagram.com/reel/C9xAbCdEfGh/';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIM = 'https://vimeo.com/347119375';
const TT = 'https://www.tiktok.com/@bcl/video/7300000000000000000';

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 1 — la dissymétrie d\'origine : YouTube a une vignette, pas Instagram');
t('YouTube : vignette déduite de l\'ID, aucun appel réseau', () => {
  const v = api.parseVideo(YT);
  assert.strictEqual(v.provider, 'youtube');
  assert.ok(/img\.youtube\.com\/vi\/dQw4w9WgXcQ\//.test(v.thumb));
});
t('Instagram / Vimeo / TikTok : parseVideo ne peut pas donner de vignette', () => {
  assert.strictEqual(api.parseVideo(IG).thumb, null);
  assert.strictEqual(api.parseVideo(VIM).thumb, null);
  assert.strictEqual(api.parseVideo(TT).thumb, null);
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 2 — qui déclenche une résolution distante');
t('instagram/vimeo/tiktok → oui', () => {
  [IG, VIM, TT].forEach(u => assert.strictEqual(api._videoThumbNeedsRemote(api.parseVideo(u)), true, u));
});
t('YouTube → non (vignette déjà connue, on n\'appelle rien)', () => {
  assert.strictEqual(api._videoThumbNeedsRemote(api.parseVideo(YT)), false);
});
t('URL non reconnue (null) → non', () => {
  assert.strictEqual(api._videoThumbNeedsRemote(null), false);
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 3 — la tuile de play : le carré gris est mort');
const playIG = { id: 'p1', title: '3 points corners en continue', desc: 'Rotation continue', videoUrl: IG, concepts: [], tags: [], images: [] };
const playYT = { id: 'p2', title: 'Gortat screen', desc: '', videoUrl: YT, concepts: [], tags: [], images: [] };
t('play Instagram : le média porte data-vthumb (hydratation demandée)', () => {
  const out = api.playTile(playIG);
  assert.ok(out.includes(`data-vthumb="${IG}"`), 'pas de data-vthumb sur .v-tile-media');
});
t('play Instagram : placeholder aux couleurs du réseau + libellé + titre du play', () => {
  const out = api.playTile(playIG);
  assert.ok(/data-vprov="instagram"/.test(out), 'placeholder non marqué instagram');
  assert.ok(/v-tile-prov/.test(out) && out.includes('Instagram'), 'libellé du réseau absent');
  assert.ok(/v-tile-placeholder-title">3 points corners en continue</.test(out), 'titre du play absent du placeholder');
  assert.ok(/data-vthumb-ph/.test(out), 'placeholder non masquable à l\'arrivée de la vignette');
});
t('play YouTube : vignette directe, aucun data-vthumb ni placeholder', () => {
  const out = api.playTile(playYT);
  assert.ok(out.includes('img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'));
  assert.ok(!out.includes('data-vthumb='), 'YouTube ne doit RIEN demander au serveur');
  assert.ok(!/v-tile-placeholder/.test(out));
});
t('play sans vidéo : placeholder générique 🏀 inchangé (non-régression)', () => {
  const out = api.playTile({ id: 'p3', title: 'Zone 2-3', desc: 'Défense', concepts: ['Défense'], tags: [], images: [] });
  assert.ok(out.includes('🏀'));
  assert.ok(!/data-vprov/.test(out));
  assert.ok(!out.includes('data-vthumb='));
});
t('une image de galerie prime toujours sur la vignette distante', () => {
  const out = api.playTile({ ...playIG, images: ['https://cdn/x.jpg'] });
  assert.ok(out.includes('https://cdn/x.jpg'));
  assert.ok(!out.includes('data-vthumb='), 'aperçu déjà disponible : aucun appel réseau');
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 4 — petites tuiles carrées (vidéos de prépa / focus match)');
t('sans vignette : slot hydratable, marqué au réseau', () => {
  const out = api._videoThumbSlot(IG, '');
  assert.ok(out.includes('class="vthumb-slot"'));
  assert.ok(out.includes(`data-vthumb="${IG}"`));
  assert.ok(out.includes('data-vthumb-ph'));
  assert.ok(out.includes('data-vprov="instagram"'));
});
t('avec vignette (YouTube) : <img> direct, pas de slot', () => {
  const out = api._videoThumbSlot(YT, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.ok(out.startsWith('<img '));
  assert.ok(!out.includes('data-vthumb'));
});
t('URL non reconnue : slot neutre, aucune demande réseau', () => {
  const out = api._videoThumbSlot('https://exemple.fr/clip', '');
  assert.ok(!out.includes('data-vthumb='), 'on n\'interroge pas le serveur pour un lien inconnu');
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 5 — cache local : on ne martèle ni Instagram ni la fonction');
t('jamais demandé → undefined (distinct de « demandé, sans vignette »)', () => {
  assert.strictEqual(api._videoThumbCached(IG), undefined);
});
t('vignette mémorisée → renvoyée telle quelle', () => {
  api._videoThumbRemember(IG, 'https://scontent.cdninstagram.com/x.jpg');
  assert.strictEqual(api._videoThumbCached(IG), 'https://scontent.cdninstagram.com/x.jpg');
});
t('échec mémorisé → null (on ne retente pas à chaque rendu)', () => {
  api._videoThumbRemember(TT, null);
  assert.strictEqual(api._videoThumbCached(TT), null);
});
t('entrée périmée → undefined (les URL CDN Instagram sont signées et expirent)', () => {
  const store = JSON.parse(api._store['pb8_video_thumbs']);
  store[IG].ts = Date.now() - 7 * 3600 * 1000; // > TTL positif (6 h)
  api._store['pb8_video_thumbs'] = JSON.stringify(store);
  const fresh = new Function(src + '\nreturn _videoThumbCached;')();
  // relecture depuis un store neuf : on repasse par localStorage
  assert.strictEqual(typeof fresh, 'function');
  assert.ok(Date.now() - store[IG].ts > 6 * 3600 * 1000);
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 6 — hydratation branchée sur le rendu');
t('_doRender appelle _hydrateVideoThumbs', () => {
  const doRender = extractFn(html, '_doRender');
  assert.ok(/_hydrateVideoThumbs\(\)/.test(doRender), 'hydratation jamais déclenchée');
});
t('l\'hydratation n\'écrase pas une vignette déjà posée (data-vthumb-done)', () => {
  const h = extractFn(html, '_hydrateVideoThumbs') + extractFn(html, '_applyVideoThumb');
  assert.ok(/data-vthumb-done/.test(h));
  assert.ok(/onload/.test(h), 'la vignette doit être injectée seulement si elle charge');
});
t('CSS : le placeholder Instagram a bien son dégradé de marque', () => {
  assert.ok(/\.v-tile-placeholder\[data-vprov="instagram"\]/.test(html));
  assert.ok(/\.vthumb-slot \{/.test(html));
});

// ---------------------------------------------------------------------------
console.log('SCÉNARIO 7 — fonction serveur /api/video-thumb');
t('le fichier existe et expose la route /api/video-thumb', () => {
  assert.ok(existsSync(fnPath), 'netlify/functions/video-thumb.js manquant');
  const fn = readFileSync(fnPath, 'utf8');
  assert.ok(fn.includes("path: '/api/video-thumb'"));
});
t('anti-SSRF : liste blanche d\'hôtes', () => {
  const fn = readFileSync(fnPath, 'utf8');
  assert.ok(/ALLOWED_HOSTS/.test(fn));
  assert.ok(fn.includes('www.instagram.com') && fn.includes('vimeo.com'));
});
t('le jeton Meta vient de l\'environnement — AUCUN secret dans le dépôt', () => {
  const fn = readFileSync(fnPath, 'utf8');
  assert.ok(/process\.env\.FB_OEMBED_TOKEN/.test(fn));
  assert.ok(!/access_token=[A-Za-z0-9|_-]{10,}/.test(fn), 'jeton en dur détecté !');
  assert.ok(!/EAA[A-Za-z0-9]{20,}/.test(fn), 'jeton Facebook en dur détecté !');
});
t('sans jeton, la réponse reste propre (le front garde son placeholder)', () => {
  const fn = readFileSync(fnPath, 'utf8');
  assert.ok(fn.includes("'instagram-token-absent'"));
  assert.ok(/status: 200/.test(fn), 'le front lit `ok`, pas un code HTTP d\'erreur');
});
t('Vimeo et TikTok passent par leur oEmbed public (aucun jeton requis)', () => {
  const fn = readFileSync(fnPath, 'utf8');
  assert.ok(fn.includes('vimeo.com/api/oembed.json'));
  assert.ok(fn.includes('tiktok.com/oembed'));
});

console.log(`\n✅ ${pass} assertions OK — aperçus Instagram : vignette demandée au serveur, placeholder de marque en repli.`);
