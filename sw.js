// Offline support: precache the app shell, serve it cache-first.
const CACHE_VERSION = '0.5.2'; // keep in sync with js/version.js
const CACHE = `idfold-${CACHE_VERSION}`;
const FONT_CACHE = 'idfold-fonts';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/router.js',
  './js/store.js',
  './js/version.js',
  './js/crypto.js',
  './js/strength.js',
  './js/vault.js',
  './js/ui/password.js',
  './js/ui/recovery.js',
  './js/views/setup.js',
  './js/views/restore.js',
  './js/views/lock.js',
  './js/ui/icons.js',
  './js/ui/sheet.js',
  './js/ui/util.js',
  './js/ui/folder-sheets.js',
  './js/views/home.js',
  './js/views/folder.js',
  './js/views/settings.js',
  './js/views/doc.js',
  './js/ui/docs.js',
  './js/files.js',
  './js/pdf.js',
  './js/config.js',
  './js/google.js',
  './js/drive.js',
  './js/sync.js',
  './js/ui/sync.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Some hosts (Cloudflare) redirect index.html to "/". A browser refuses a redirected response
// for a navigation, so the cache keeps a plain copy.
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status, statusText: response.statusText, headers: response.headers
  });
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(async (url) => {
    const res = await fetch(new Request(url, { cache: 'reload' }));
    if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
    await cache.put(url, await unredirect(res));
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: serve from cache, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations always get the app shell (routing is hash based).
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(req)));
    return;
  }

  event.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)));
});
