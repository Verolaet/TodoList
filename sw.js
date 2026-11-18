// Service worker : met l'appli en cache pour une ouverture instantanée, même hors ligne.
// Les données (Firestore) ne passent pas par ici : Firebase gère son propre cache local.
const CACHE = 'todo-v4';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './dateparse.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];

// À l'installation d'une nouvelle version, on télécharge les fichiers sans passer par le cache du navigateur
// (GitHub Pages autorise 10 min de cache : sans cela, la « nouvelle » version pourrait contenir d'anciens fichiers).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHEABLE = (url) =>
  url.origin === self.location.origin
  || url.href.startsWith('https://www.gstatic.com/firebasejs/')
  || url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/Sortable/');

// Stratégie « stale-while-revalidate » : réponse immédiate depuis le cache, mise à jour en arrière-plan.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!CACHEABLE(url)) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  // Nos propres fichiers : toujours revérifiés auprès du serveur (réponse « 304 » très légère s'ils n'ont pas changé)
  const netReq = url.origin === self.location.origin ? new Request(req.url, { cache: 'no-cache' }) : req;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(netReq).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
