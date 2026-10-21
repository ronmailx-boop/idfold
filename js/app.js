import * as store from './store.js';
import { start, currentRoute } from './router.js';
import { renderHome } from './views/home.js';
import { renderFolder } from './views/folder.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');

function render(route) {
  app.className = '';
  if (route.name === 'folder') renderFolder(app, route.param);
  else if (route.name === 'settings') renderSettings(app);
  else renderHome(app);
}

let firstRoute = true;
function onRoute(route) {
  render(route);
  scrollTo(0, 0);
  // Move focus to the new screen's heading so screen readers announce it.
  if (!firstRoute) app.querySelector('h1')?.focus();
  firstRoute = false;
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
    if (hadController) location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function main() {
  watchConnection();
  registerServiceWorker();
  try {
    await store.init();
  } catch {
    app.innerHTML = `<div class="fatal">
      <h1>לא ניתן לפתוח את האחסון המקומי</h1>
      <p>ייתכן שהדפדפן במצב גלישה פרטית או שהאחסון חסום. פתח את האפליקציה בחלון רגיל ונסה שוב.</p>
    </div>`;
    return;
  }
  // Ask the browser not to evict the vault under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  store.onChange(() => render(currentRoute()));
  start(onRoute);
}

main();
