import * as store from './store.js';
import * as vault from './vault.js';
import { start, currentRoute } from './router.js';
import { renderSetup } from './views/setup.js';
import { renderLock } from './views/lock.js';
import { renderHome } from './views/home.js';
import { renderFolder } from './views/folder.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
const themeColor = document.querySelector('meta[name=theme-color]');

function setDark(dark) {
  document.body.classList.toggle('dark', dark);
  themeColor.content = dark ? '#2b1d63' : '#f6f4ff';
}

function render(route) {
  app.className = '';
  if (route.name === 'folder') renderFolder(app, route.param);
  else if (route.name === 'settings') renderSettings(app);
  else renderHome(app);
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
async function enterApp() {
  setDark(false);
  await store.init();
  if (routerStarted) onRoute(currentRoute());
  else {
    routerStarted = true;
    start(onRoute);
  }
}

function showFatal(title, text) {
  setDark(false);
  app.innerHTML = `<div class="fatal"><h1>${title}</h1><p>${text}</p></div>`;
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reloading would drop the unlocked key; only reload while locked.
    if (hadController && !vault.isOpen()) location.reload();
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
  store.onChange(() => { if (vault.isOpen()) render(currentRoute()); });

  if (vault.exists()) {
    setDark(true);
    renderLock(app, afterUnlock);
  } else {
    setDark(false);
    renderSetup(app, afterUnlock);
  }
}

main();
