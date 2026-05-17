// ============================================================================
// Service Worker — Playbook BCL
//
// Stratégies :
//   - index.html (navigation HTML)  → network-first (fallback cache si offline)
//     → garantit que l'utilisateur reçoit la dernière version au reload.
//   - style.css + manifest.json    → stale-while-revalidate
//   - autres assets statiques      → stale-while-revalidate
//   - tout ce qui touche Supabase  → skip (l'app gère son propre caching/sync)
//   - POST/PATCH/PUT/DELETE        → skip systématiquement
//   - Netlify functions /api/...   → skip (toujours réseau)
//   - esm.sh / fonts.googleapis    → skip (laisser le browser cache HTTP gérer)
//
// Versioning : bump CACHE_VERSION quand on veut invalider tous les caches.
// ============================================================================

const CACHE_VERSION = 'bcl-cache-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
];

// --- Helpers ---
function shouldBypass(request) {
  const url = new URL(request.url);
  // Mutations : jamais cache
  if (request.method !== 'GET') return true;
  // Supabase (REST + Auth + Storage + Realtime WS upgrade)
  if (/\.supabase\.co$/i.test(url.hostname)) return true;
  if (/\.supabase\.in$/i.test(url.hostname)) return true;
  // Netlify functions
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/.netlify/')) return true;
  // CDNs externes : laisser le HTTP cache du browser gérer
  if (url.hostname === 'esm.sh') return true;
  if (/\.googleapis\.com$/i.test(url.hostname)) return true;
  if (/\.gstatic\.com$/i.test(url.hostname)) return true;
  if (/(^|\.)img\.youtube\.com$/i.test(url.hostname)) return true;
  if (/(^|\.)youtube\.com$/i.test(url.hostname)) return true;
  if (/(^|\.)vimeo\.com$/i.test(url.hostname)) return true;
  if (/(^|\.)vimeocdn\.com$/i.test(url.hostname)) return true;
  if (/(^|\.)ffbb\.com$/i.test(url.hostname)) return true;
  return false;
}

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname.endsWith('/index.html')) return true;
  return false;
}

// --- Install : pre-cache ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] precache failed:', err))
  );
});

// --- Activate : purge old caches + take control ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- Fetch ---
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (shouldBypass(req)) return; // laisser le browser gérer

  // Network-first pour HTML (évite le piège "user voit jamais l'update")
  if (isHtmlRequest(req)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Mettre à jour le cache en arrière-plan si réponse OK
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate pour tout le reste (CSS, JS local, manifest, images…)
  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(req).then(cached => {
        const networkPromise = fetch(req)
          .then(res => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline : retombe sur le cache
        return cached || networkPromise;
      })
    )
  );
});
