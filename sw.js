// ============================================================================
// KILL-SWITCH SERVICE WORKER — Playbook BCL
//
// L'ancien SW (déployé brièvement) causait un chargement infini chez certains
// utilisateurs. Comme un SW reste installé côté navigateur même après un
// rollback du code, on publie ce SW "vide" qui :
//   1. S'installe immédiatement (skipWaiting)
//   2. Active immédiatement (claim) en supprimant TOUS les caches
//   3. Force un reload de toutes les pages contrôlées
//   4. N'a AUCUN listener fetch → n'intercepte plus rien
//
// Combiné au snippet `getRegistrations().then(r => r.unregister())` dans
// index.html, le SW est totalement désenregistré au prochain load.
// ============================================================================

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Purger tous les caches (peu importe leur nom)
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // 2. Prendre le contrôle des clients existants
    await self.clients.claim();
    // 3. Forcer un reload de toutes les pages contrôlées
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { await c.navigate(c.url); } catch (e) { /* swallow */ }
    }
  })());
});

// PAS de fetch listener → toutes les requêtes vont directement au réseau,
// même tant que ce SW est encore actif (jusqu'à son unregister).
