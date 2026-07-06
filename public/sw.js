const CACHE_NAME = 'hongmeng-static-v4';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192.svg',
  '/icon-512.svg'
];
const SIGNED_PARAMS = ['X-Amz-Signature', 'X-Amz-Credential', 'Signature', 'Expires'];
const DYNAMIC_PATH_PARTS = ['/download', '/view', '/upload', '/content', '/dashboard', '/connector-parameters'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (SIGNED_PARAMS.some(param => url.searchParams.has(param))) return;
  if (DYNAMIC_PATH_PARTS.some(part => url.pathname.includes(part))) return;
  if (request.mode === 'navigate') return;
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (!response || response.status !== 200) return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }))
  );
});
