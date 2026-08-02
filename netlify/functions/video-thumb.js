// netlify/functions/video-thumb.js
// ---------------------------------------------------------------------------
// Résolution de VIGNETTE (thumbnail) pour une URL vidéo : Vimeo, TikTok,
// Instagram, YouTube. Appelé par le front via /api/video-thumb?url=…
//
// POURQUOI côté serveur :
//   - Instagram et TikTok n'envoient AUCUN en-tête CORS → un fetch navigateur
//     est bloqué avant même de lire la réponse ;
//   - le navigateur ne peut pas surcharger le User-Agent (en-tête interdit) ;
//   - un jeton Meta (le jour où il existe) n'a rien à faire dans le bundle.
//
// ÉTAT DES LIEUX (vérifié le 2026-08-02, réponses réelles) :
//   - Vimeo    : https://vimeo.com/api/oembed.json → thumbnail_url. OK, public,
//                sans jeton.
//   - TikTok   : https://www.tiktok.com/oembed    → thumbnail_url. Public, mais
//                répond 400 sur une vidéo supprimée/privée.
//   - Instagram: RIEN de public.
//       * api.instagram.com/oembed  → retiré par Meta (oct. 2020) : renvoie une
//         page HTML de connexion, plus du JSON.
//       * graph.facebook.com/<v>/instagram_oembed sans jeton → HTTP 403
//         {"error":{"message":"(#200) Provide valid app ID"}}.
//       * scraping de /p/<id>/ ou /p/<id>/embed/captioned/ depuis une IP
//         serveur → mur de connexion Facebook, ZÉRO balise og:image.
//     ⇒ La seule voie fiable est l'oEmbed officiel Meta, qui exige un jeton.
//
// ACTIVER INSTAGRAM (côté propriétaire du site, rien à coder de plus) :
//   1. developers.facebook.com → créer/ouvrir une app de type « Entreprise » ;
//   2. ajouter le produit « oEmbed Read » (anciennement « Instagram oEmbed »)
//      et le faire valider (revue d'app, gratuit) ;
//   3. récupérer le jeton d'app : <APP_ID>|<APP_SECRET> (ou un jeton long) ;
//   4. Netlify → Site settings → Environment variables → ajouter
//      FB_OEMBED_TOKEN = <le jeton>  (jamais dans le dépôt) ;
//   5. redeploy. Aucun changement de code : la branche 1 ci-dessous s'active
//      d'elle-même et les vignettes Instagram apparaissent.
//   Tant que la variable est absente, la fonction répond proprement
//   {ok:false, reason:'instagram-token-absent'} et le front garde son
//   placeholder de marque (dégradé Instagram + titre du play + ▶).
//
// SÉCURITÉ : anti-SSRF par liste blanche d'hôtes, aucune donnée utilisateur
// relayée, et le jeton n'est JAMAIS renvoyé ni journalisé.
// ---------------------------------------------------------------------------

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const GRAPH_VERSION = 'v21.0';
const TIMEOUT_MS = 6000;

// Hôtes acceptés en ENTRÉE (l'URL vidéo fournie par le front).
const ALLOWED_HOSTS = [
  'instagram.com', 'www.instagram.com', 'instagr.am',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com',
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(obj, maxAge) {
  return new Response(JSON.stringify(obj), {
    status: 200, // toujours 200 : le front lit `ok`, jamais un code d'erreur
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
}

function timedFetch(url, headers) {
  return fetch(url, {
    headers: headers || {},
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function hostAllowed(host) {
  const h = String(host || '').toLowerCase();
  return ALLOWED_HOSTS.indexOf(h) >= 0;
}

// Détection du provider — miroir simplifié de parseVideo() côté front.
function detect(url) {
  let m = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*?&)?v=|embed\/|shorts\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return { provider: 'youtube', id: m[1] };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { provider: 'vimeo', id: m[1] };
  m = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (m) return { provider: 'instagram', id: m[1] };
  if (/tiktok\.com\//i.test(url)) return { provider: 'tiktok', id: '' };
  return { provider: '', id: '' };
}

async function oembedThumb(endpoint) {
  const r = await timedFetch(endpoint, { 'user-agent': BROWSER_UA, accept: 'application/json' });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (ct.indexOf('json') < 0) return null; // oEmbed mort → page HTML de login
  const j = await r.json();
  return (j && j.thumbnail_url) ? String(j.thumbnail_url) : null;
}

// --- Instagram ---------------------------------------------------------------
// 1) oEmbed officiel Meta (le SEUL chemin fiable) — actif si FB_OEMBED_TOKEN.
// 2) Repli best-effort : lecture de l'og:image. Documenté comme quasi toujours
//    en échec depuis une IP serveur (mur de connexion), gardé parce qu'il ne
//    coûte rien et qu'il repasse tout seul si Meta rouvre la porte.
async function instagramThumb(canonicalUrl) {
  const token = process.env.FB_OEMBED_TOKEN || process.env.IG_OEMBED_TOKEN || '';
  if (token) {
    try {
      const ep = `https://graph.facebook.com/${GRAPH_VERSION}/instagram_oembed`
        + `?url=${encodeURIComponent(canonicalUrl)}&fields=thumbnail_url&omitscript=true`
        + `&access_token=${encodeURIComponent(token)}`;
      const thumb = await oembedThumb(ep);
      if (thumb) return { thumb, source: 'graph-oembed' };
    } catch (e) { /* on tombe sur le repli */ }
  }

  const candidates = [
    canonicalUrl.replace(/\/?$/, '/') + 'embed/captioned/',
    canonicalUrl,
  ];
  for (const u of candidates) {
    try {
      const r = await timedFetch(u, {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      if (!r.ok) continue;
      const html = await r.text();
      const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
      const emb = html.match(/class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*src=["']([^"']+)["']/i);
      const dsp = html.match(/"display_url":"([^"]+)"/);
      const raw = (og && og[1]) || (emb && emb[1]) || (dsp && dsp[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
      if (raw && /^https:\/\/[^"']*cdninstagram|^https:\/\/[^"']*fbcdn/.test(raw)) {
        return { thumb: raw.replace(/&amp;/g, '&'), source: 'og-image' };
      }
    } catch (e) { /* candidat suivant */ }
  }
  return { thumb: null, source: token ? 'instagram-blocked' : 'instagram-token-absent' };
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let target;
  try { target = new URL(request.url).searchParams.get('url'); }
  catch { return jsonResponse({ ok: false, reason: 'bad-request' }, 60); }
  if (!target) return jsonResponse({ ok: false, reason: 'url-manquante' }, 60);

  let parsed;
  try { parsed = new URL(target); }
  catch { return jsonResponse({ ok: false, reason: 'url-invalide' }, 60); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return jsonResponse({ ok: false, reason: 'protocole-refuse' }, 3600);
  }
  if (!hostAllowed(parsed.hostname)) {
    return jsonResponse({ ok: false, reason: 'host-non-autorise' }, 3600);
  }

  const { provider, id } = detect(target);
  if (!provider) return jsonResponse({ ok: false, reason: 'provider-inconnu' }, 3600);

  try {
    if (provider === 'youtube') {
      // Déterministe : aucune requête. Le front le sait déjà, on répond
      // quand même pour que la fonction soit utilisable seule.
      return jsonResponse({ ok: true, provider, thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, source: 'static' }, 86400);
    }

    if (provider === 'vimeo') {
      const thumb = await oembedThumb('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/' + id));
      return thumb
        ? jsonResponse({ ok: true, provider, thumb, source: 'vimeo-oembed' }, 21600)
        : jsonResponse({ ok: false, provider, reason: 'vimeo-sans-vignette' }, 600);
    }

    if (provider === 'tiktok') {
      const thumb = await oembedThumb('https://www.tiktok.com/oembed?url=' + encodeURIComponent(target));
      return thumb
        ? jsonResponse({ ok: true, provider, thumb, source: 'tiktok-oembed' }, 21600)
        : jsonResponse({ ok: false, provider, reason: 'tiktok-sans-vignette' }, 600);
    }

    // Instagram
    const canonical = `https://www.instagram.com/p/${id}/`;
    const res = await instagramThumb(canonical);
    return res.thumb
      // Les URL CDN Instagram sont SIGNÉES et expirent : cache court, sinon on
      // sert une vignette morte pendant des heures.
      ? jsonResponse({ ok: true, provider, thumb: res.thumb, source: res.source }, 3600)
      : jsonResponse({ ok: false, provider, reason: res.source }, 900);
  } catch (err) {
    return jsonResponse({ ok: false, provider, reason: 'upstream-erreur' }, 60);
  }
};

export const config = {
  path: '/api/video-thumb',
};
