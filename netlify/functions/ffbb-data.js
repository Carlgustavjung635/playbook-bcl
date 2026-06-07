// netlify/functions/ffbb-data.js
// ---------------------------------------------------------------------------
// Proxy JSON pour l'API de données FFBB (api.ffbb.app = Directus,
// meilisearch-prod.ffbb.app = Meilisearch).
//
// POURQUOI un proxy serveur (et pas un fetch direct depuis le navigateur) :
//   - api.ffbb.app (Directus) renvoie 403 pour tout User-Agent "navigateur"
//     (Mozilla/*) : seule une UA type `okhttp` passe. Le navigateur NE PEUT PAS
//     surcharger l'en-tête User-Agent (header interdit) → appel direct = 403.
//   - api.ffbb.app n'envoie AUCUN en-tête CORS → même sans le filtre UA, le
//     navigateur bloquerait la réponse.
//   - L'endpoint de configuration (qui distribue les jetons publics) est lui
//     aussi sur api.ffbb.app → impossible de récupérer le jeton côté client.
//   Conclusion : on relaie côté serveur (Node n'a pas ces restrictions), en
//   injectant l'UA `okhttp` + le bearer public adéquat selon le host cible.
//
// AUCUN secret : les deux jetons (key_dh = Directus, key_ms = Meilisearch) sont
// PUBLICS, servis par l'endpoint /items/configuration. On les récupère et on les
// met en cache module (≈1 h) pour éviter un appel config à chaque requête.
// ---------------------------------------------------------------------------

const FFBB_CONFIG_URL = 'https://api.ffbb.app/items/configuration';
const OKHTTP_UA = 'okhttp/4.12.0';

// Seuls ces hosts sont relayables (anti-SSRF).
const ALLOWED_HOSTS = new Set(['api.ffbb.app', 'meilisearch-prod.ffbb.app']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Cache module des jetons publics (persiste entre invocations à chaud) ---
let _tokenCache = { dh: null, ms: null, fetchedAt: 0 };
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h

async function getTokens() {
  const now = Date.now();
  if (_tokenCache.dh && _tokenCache.ms && (now - _tokenCache.fetchedAt) < TOKEN_TTL_MS) {
    return _tokenCache;
  }
  const resp = await fetch(FFBB_CONFIG_URL, { headers: { 'user-agent': OKHTTP_UA } });
  if (!resp.ok) throw new Error(`config HTTP ${resp.status}`);
  const json = await resp.json();
  const data = (json && json.data) ? json.data : json;
  if (!data || !data.key_dh || !data.key_ms) throw new Error('config: jetons absents');
  _tokenCache = { dh: data.key_dh, ms: data.key_ms, fetchedAt: now };
  return _tokenCache;
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let targetUrl;
  try {
    const reqUrl = new URL(request.url);
    targetUrl = reqUrl.searchParams.get('url');
  } catch {
    return jsonResponse(400, { error: 'URL de requête invalide' });
  }

  if (!targetUrl) return jsonResponse(400, { error: 'Paramètre ?url= manquant' });

  let targetHost;
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch {
    return jsonResponse(400, { error: 'Paramètre url mal formé' });
  }
  if (!ALLOWED_HOSTS.has(targetHost)) {
    return jsonResponse(403, { error: `Host non autorisé: ${targetHost}` });
  }

  try {
    const tokens = await getTokens();
    // Choix du jeton selon la cible.
    const bearer = (targetHost === 'meilisearch-prod.ffbb.app') ? tokens.ms : tokens.dh;

    const headers = {
      'user-agent': OKHTTP_UA,
      'Authorization': `Bearer ${bearer}`,
      'Accept': 'application/json',
    };

    const init = { method: request.method, headers };
    if (request.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = await request.text();
    }

    const upstream = await fetch(targetUrl, init);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        // Cache court côté CDN : les calendriers bougent peu en intra-journée.
        'Cache-Control': 'public, max-age=120',
      },
    });
  } catch (err) {
    return jsonResponse(502, { error: 'Proxy FFBB: ' + (err && err.message ? err.message : String(err)) });
  }
};

export const config = {
  path: '/api/ffbb-data',
};
