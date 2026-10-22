// Side menu, opened from the ☰ button: shortcuts into settings, the guide and "lock now".
import { esc } from './util.js';
import { icon } from './icons.js';
import { chipParts } from './sync.js';
import { openGuide } from './guide.js';
import * as sync from '../sync.js';
import * as quick from '../quick.js';
import * as autolock from '../autolock.js';
import { APP_VERSION } from '../version.js';

// Goes to settings and brings the given control into view.
function toSettings(selector) {
  const reveal = () => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  };
  if (location.hash === '#/settings') return reveal();
  addEventListener('hashchange', () => requestAnimationFrame(reveal), { once: true });
  location.hash = '#/settings';
}

export function openMenu(opener) {
  const status = sync.getStatus();
  const quickLabel = quick.hasBio() ? 'טביעת אצבע' : quick.hasPin() ? 'קוד PIN' : 'כבויה';
  const onHome = !location.hash || location.hash === '#/';
  const item = (key, ic, label, meta = '', cls = '') => `
    <button type="button" class="dnav" data-go="${key}">${icon(ic)}<span>${label}${meta ? `<small class="${cls}">${esc(meta)}</small>` : ''}</span></button>`;

  const d = document.createElement('dialog');
  d.className = 'drawer';
  d.setAttribute('aria-label', 'תפריט');
  d.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head">
        <img src="icons/icon.svg" alt="" width="48" height="48">
        <div class="top-text"><strong>IDfold</strong><small>מוצפן במכשיר שלך</small></div>
        <button type="button" class="icon-btn" data-close aria-label="סגירת התפריט">${icon('close')}</button>
      </div>
      <nav class="drawer-nav" aria-label="תפריט">
        <a class="dnav" href="#/" data-go="home"${onHome ? ' aria-current="page"' : ''}>${icon('home')}<span>הכספת שלי</span></a>
        ${item('drive', 'cloud', 'גיבוי ל-Google Drive', chipParts(status).text, status.phase === 'synced' ? 'on' : '')}
        ${item('quick', 'fingerprint', 'פתיחה מהירה', quickLabel)}
        ${item('autolock', 'timer', 'נעילה אוטומטית', autolock.label())}
      </nav>
      <nav class="drawer-nav" aria-label="עוד">
        ${item('settings', 'settings', 'כל ההגדרות')}
        ${item('guide', 'book', 'מדריך שימוש')}
        <a class="dnav" href="privacy.html" target="_blank" rel="noopener">${icon('shield')}<span>פרטיות ותנאים</span></a>
      </nav>
      <div class="drawer-foot">
        <button type="button" class="btn btn-lg btn-outline" data-lock>${icon('lock')}נעל עכשיו</button>
        <p class="app-version">גרסה ${APP_VERSION} · vplus studio</p>
      </div>
    </div>`;

  const actions = {
    home: () => {},
    drive: () => toSettings('[data-sync-btn]'),
    quick: () => toSettings('[data-bio]'),
    autolock: () => toSettings('#autolock'),
    settings: () => { location.hash = '#/settings'; },
    guide: () => openGuide()
  };
  d.addEventListener('click', (e) => {
    if (e.target === d) return d.close();
    const go = e.target.closest('[data-go]');
    if (!go) return;
    d.close();
    actions[go.dataset.go]();
  });
  d.querySelector('[data-close]').onclick = () => d.close();
  d.querySelector('[data-lock]').onclick = () => autolock.lockNow();
  d.addEventListener('close', () => {
    d.remove();
    if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus();
  });
  document.body.append(d);
  d.showModal();
}
