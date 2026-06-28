// ============================================================================
// PUSH SERVICE WORKER — Playbook BCL (Phase 2 notifications)
// ----------------------------------------------------------------------------
// VOLONTAIREMENT MINIMAL. Gère UNIQUEMENT :
//   - 'push'             → affiche une notification + met à jour le badge d'app
//   - 'notificationclick'→ focus l'app et navigue vers l'écran pertinent (url)
//
// ⚠️ AUCUN listener 'fetch' : ce SW n'intercepte JAMAIS les requêtes de
// navigation. C'est LE point qui empêche de rejouer le bug historique
// (chargement infini dû à un respondWith() qui ne se résolvait jamais, PR #9 /
// rollback 810a299). Sans fetch handler, ce SW ne peut pas bloquer un load.
//
// skipWaiting + clients.claim : la nouvelle version prend le contrôle vite.
// ============================================================================

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Playbook BCL';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pb8',            // une notif de même tag remplace l'ancienne (anti-spam)
    renotify: true,
    data: { url: data.url || '/' }
  };
  const tasks = [self.registration.showNotification(title, options)];
  // Met à jour le badge d'app même app fermée (si l'API est dispo dans le SW).
  if (typeof self.registration.setAppBadge === 'function' || (self.navigator && self.navigator.setAppBadge)) {
    const setter = self.registration.setAppBadge ? self.registration.setAppBadge.bind(self.registration)
      : self.navigator.setAppBadge.bind(self.navigator);
    const clearer = self.registration.clearAppBadge ? self.registration.clearAppBadge.bind(self.registration)
      : (self.navigator && self.navigator.clearAppBadge ? self.navigator.clearAppBadge.bind(self.navigator) : null);
    const n = Number(data.badge_count);
    try {
      if (Number.isFinite(n) && n > 0) tasks.push(setter(n));
      else if (n === 0 && clearer) tasks.push(clearer());
    } catch (e) { /* badge best-effort */ }
  }
  event.waitUntil(Promise.all(tasks).catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // App déjà ouverte → focus + on lui passe l'URL cible via postMessage.
      if ('focus' in c) { try { c.postMessage({ type: 'pb-notif-nav', url }); } catch (e) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })().catch(() => {}));
});
