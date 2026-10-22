import * as store from './store.js';
import * as vault from './vault.js';
import * as sync from './sync.js';
import * as quick from './quick.js';
import * as autolock from './autolock.js';
import * as google from './google.js';
import './install.js';
import { start, currentRoute } from './router.js';
import { renderSetup } from './views/setup.js';
import * as guide from './ui/guide.js';
import { renderLock } from './views/lock.js';
import { renderHome, resetHome } from './views/home.js';
import { renderFolder } from './views/folder.js';
import { renderSettings } from './views/settings.js';
import { renderDoc } from './views/doc.js';
import { toast } from './ui/util.js';

const app = document.getElementById('app');
const themeColor = document.querySelector('meta[name=theme-color]');

function setDark(dark) {
  document.body.classList.toggle('dark', dark);
  themeColor.content = dark ? '#2b1d63' : '#f6f4ff';
}

// The current screen may return { cleanup, refresh }: cleanup runs before the next render,
// refresh replaces a full re-render when data changes (the viewer keeps its decrypted file).
let screen = null;

function render(route) {
  screen?.cleanup?.();
  app.className = '';
  if (route.name === 'folder') screen = renderFolder(app, route.param);
  else if (route.name === 'doc') screen = renderDoc(app, route.param);
  else if (route.name === 'settings') screen = renderSettings(app);
  else screen = renderHome(app);
}

let firstRoute = true;
function onRoute(route) {
  if (!vault.isOpen()) return;
  render(route);
  scrollTo(0, 0);
  // Move focus to the new screen's heading so screen readers announce it.
  if (!firstRoute) app.querySelector('h1')?.focus();
  firstRoute = false;
}

let routerStarted = false;
let entered = false;
async function enterApp() {
  setDark(false);
  await store.init();
  await sync.init();
  sync.resume();
  entered = true;
  await autolock.start(lockNow);
  if (routerStarted) onRoute(currentRoute());
  else {
    routerStarted = true;
    start(onRoute);
  }
  guide.showOnce().catch(() => {});
}

function showFatal(title, text) {
  setDark(false);
  app.innerHTML = `<div class="fatal"><h1>${title}</h1><p>${text}</p></div>`;
}

// Locks now: forgets the key, every decrypted item and the Google token, and shows the lock screen.
function lockNow() {
  if (!vault.isOpen()) return;
  autolock.stop();
  document.querySelectorAll('dialog').forEach((d) => d.close());
  screen?.cleanup?.();
  screen = null;
  entered = false;
  sync.suspend();
  google.dropToken();
  store.clearMemory();
  resetHome();
  vault.lock();
  // A new version waited for the lock (reloading while open would drop the key).
  if (updateReady) return location.reload();
  showLock();
}

async function showLock() {
  setDark(true);
  await quick.load().catch(() => {});
  renderLock(app, afterUnlock);
}

async function afterUnlock() {
  try {
    await enterApp();
  } catch {
    vault.lock();
    store.clearMemory();
    showFatal('לא ניתן לפענח את הנתונים', 'ייתכן שהנתונים במכשיר פגומים. נסה לסגור ולפתוח את האפליקציה.');
  }
}

function watchConnection() {
  const banner = document.getElementById('offline');
  const update = () => { banner.hidden = navigator.onLine; };
  addEventListener('online', update);
  addEventListener('offline', update);
  update();
}

let updateReady = false;
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    // Reloading would drop the unlocked key; only reload while locked, or at the next lock.
    if (vault.isOpen()) updateReady = true;
    else location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function main() {
  watchConnection();
  registerServiceWorker();
  try {
    await vault.load();
  } catch {
    showFatal('לא ניתן לפתוח את האחסון המקומי', 'ייתכן שהדפדפן במצב גלישה פרטית או שהאחסון חסום. פתח את האפליקציה בחלון רגיל ונסה שוב.');
    return;
  }
  // Ask the browser not to evict the vault under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  store.onChange(() => {
    if (!entered || !vault.isOpen()) return;
    if (screen?.refresh) screen.refresh();
    else render(currentRoute());
  });

  sync.onNotice(() => toast('סיסמת ההצפנה שונתה במכשיר אחר. מעכשיו פותחים עם הסיסמה החדשה.'));

  if (vault.exists()) {
    await showLock();
  } else {
    setDark(false);
    renderSetup(app, afterUnlock);
  }
}

main();
