// Offline support: precache the app shell, serve it cache-first.
const CACHE_VERSION = '0.7.0'; // keep in sync with js/version.js
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
  './js/quick.js',
  './js/autolock.js',
  './js/install.js',
  './js/ui/password.js',
  './js/ui/recovery.js',
  './js/views/setup.js',
  './js/views/restore.js',
  './js/views/lock.js',
  './js/ui/icons.js',
  './js/ui/sheet.js',
  './js/ui/guide.js',
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
  './icons/icon-maskable-512.png',
  './css/legal.css',
  './privacy.html',
  './terms.html',
  './cookies.html',
  './accessibility.html'
];

// Some hosts (Cloudflare) redirect index.html to "/". A browser refuses a redirected response
// for a navigation, so the cache keeps a plain copy.
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status, statusText: response.statusText, headers: response.headers
  });
}

// Cloudflare serves privacy.html at /privacy: map a navigation back to the cached .html copy.
function prettyToHtml(href) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  if (u.pathname.endsWith('/')) u.pathname += 'index.html';
  else if (!/\.[a-z0-9]+$/i.test(u.pathname)) u.pathname += '.html';
  return u.href;
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

  // The app itself (routing is hash based) always gets the cached shell. Other pages
  // (privacy, terms…) come from the network, or from the cache when offline.
  if (req.mode === 'navigate') {
    const page = prettyToHtml(req.url);
    if (page === new URL('./index.html', self.registration.scope).href) {
      event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(req)));
    } else {
      event.respondWith(fetch(req).catch(async () => (await caches.match(page)) || Response.error()));
    }
    return;
  }

  event.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)));
});
