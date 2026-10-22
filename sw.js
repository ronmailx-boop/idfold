// Offline support: precache the app shell, serve it cache-first.
const CACHE_VERSION = '0.9.1'; // keep in sync with js/version.js
const CACHE = `idfold-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/fonts.css',
  './vendor/fonts/noto-sans-hebrew-hebrew-400-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-hebrew-500-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-hebrew-600-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-hebrew-700-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-latin-400-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-latin-500-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-latin-600-normal.woff2',
  './vendor/fonts/noto-sans-hebrew-latin-700-normal.woff2',
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
  './js/ui/tabbar.js',
  './js/ui/bills.js',
  './js/views/bill.js',
  './js/share.js',
  './js/ui/menu.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Shared from another app through the Android share sheet (manifest share_target). Held in this
// worker's memory only, until the app takes it after the redirect; never written anywhere.
const SHARE_TTL_MS = 2 * 60 * 1000;
let shared = null;

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const text = (name) => String(form.get(name) || '').slice(0, 4000);
    const file = form.getAll('file').find((f) => f instanceof File && f.size > 0) || null;
    shared = { title: text('title'), text: text('text'), url: text('url'), file, at: Date.now() };
  } catch {
    shared = null;
  }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}

self.addEventListener('message', (event) => {
  if (event.data !== 'take-share' || !event.ports[0]) return;
  const fresh = shared && Date.now() - shared.at < SHARE_TTL_MS ? shared : null;
  shared = null;
  event.ports[0].postMessage(fresh);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;

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
