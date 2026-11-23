// Service worker : met l'appli en cache pour une ouverture instantanée, même hors ligne.
// Les données (Firestore) ne passent pas par ici : Firebase gère son propre cache local.
// Le numéro de version (version.js, augmenté automatiquement à chaque commit) donne son nom au cache :
// une nouvelle version = un nouveau cache = l'appli se met à jour.
importScripts('./version.js');
const CACHE = 'todo-v' + self.APP_BUILD;
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './dateparse.js', './version.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];
// Bibliothèques externes, indispensables au démarrage : sans elles, app.js ne s'exécute pas (roue sans fin hors ligne).
// Elles sont enregistrées à chaque installation : avant le 23/11/2026, elles n'entraient dans le cache qu'au passage,
// et disparaissaient à chaque nouvelle version. À TENIR À JOUR si la version de Firebase (app.js) ou de SortableJS (index.html) change.
const LIBS = [
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
];

// À l'installation d'une nouvelle version, on télécharge nos fichiers sans passer par le cache du navigateur
// (GitHub Pages autorise 10 min de cache : sans cela, la « nouvelle » version pourrait contenir d'anciens fichiers).
// Les bibliothèques ont un numéro de version dans leur adresse (contenu figé) : le cache du navigateur suffit.
// Si un seul fichier manque, la nouvelle version ne s'installe pas et l'ancienne continue de servir (elle réessaiera plus tard).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll([...SHELL.map((u) => new Request(u, { cache: 'reload' })), ...LIBS]))
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
      // Bibliothèque déjà en cache : contenu figé, inutile de la redemander au réseau (utile quand le réseau est faible)
      if (cached && LIBS.includes(req.url)) return cached;
      const network = fetch(netReq).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
