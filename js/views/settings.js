import * as store from '../store.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/util.js';
import { confirmSheet } from '../ui/sheet.js';
import { APP_VERSION } from '../version.js';

const soon = (stage) => `<span class="soon">שלב ${stage}</span>`;

export function renderSettings(app) {
  app.innerHTML = `
    <header class="top">
      <button type="button" class="icon-btn" data-back aria-label="חזרה">${icon('back')}</button>
      <div class="top-text"><h1 tabindex="-1">הגדרות</h1></div>
    </header>

    <section class="group" aria-labelledby="g-sync">
      <h2 class="group-title" id="g-sync">גיבוי וסנכרון</h2>
      <div class="card card-pad">
        <div class="drive">
          <span class="row-icon">${icon('cloudOff')}</span>
          <span class="row-text"><strong>Google Drive</strong><small>לא מחובר</small></span>
          <span class="chip chip-off">לא מחובר</span>
        </div>
        <button type="button" class="btn btn-secondary btn-block" disabled>${icon('refresh')}סנכרן עכשיו</button>
      </div>
    </section>

    <section class="group" aria-labelledby="g-sec">
      <h2 class="group-title" id="g-sec">אבטחה</h2>
      <div class="card">
        <button type="button" class="row" disabled>
          <span class="row-icon">${icon('key')}</span>
          <span class="row-text">שינוי סיסמת הצפנה</span>${soon(2)}
        </button>
        <button type="button" class="row" disabled>
          <span class="row-icon">${icon('refresh')}</span>
          <span class="row-text">הפקת קוד שחזור חדש</span>${soon(2)}
        </button>
        <div class="row is-disabled">
          <span class="row-icon">${icon('fingerprint')}</span>
          <span class="row-text" id="bio-label">פתיחה עם טביעת אצבע</span>${soon(6)}
          <button type="button" class="switch" role="switch" aria-checked="false" aria-labelledby="bio-label" disabled></button>
        </div>
        <button type="button" class="row" disabled>
          <span class="row-icon">${icon('timer')}</span>
          <span class="row-text">נעילה אוטומטית<small>אחרי 5 דקות ברקע</small></span>${soon(6)}
        </button>
      </div>
    </section>

    <section class="group" aria-labelledby="g-data">
      <h2 class="group-title" id="g-data">נתונים</h2>
      <div class="card">
        <button type="button" class="row" disabled>
          <span class="row-icon">${icon('logout')}</span>
          <span class="row-text">התנתקות מ-Google</span>${soon(4)}
        </button>
        <button type="button" class="row danger" id="wipe">
          <span class="row-icon">${icon('trash')}</span>
          <span class="row-text">מחיקת כל הנתונים<small>מוחק את כל התיקיות והמסמכים מהמכשיר הזה</small></span>
        </button>
      </div>
    </section>

    <p class="app-version">IDfold · גרסה ${APP_VERSION}</p>`;

  app.classList.add('no-bar');
  app.querySelector('[data-back]').onclick = back;
  app.querySelector('#wipe').onclick = async () => {
    const ok = await confirmSheet({
      title: 'למחוק את כל הנתונים?',
      message: 'כל התיקיות והמסמכים יימחקו מהמכשיר הזה לצמיתות. אין דרך לבטל את הפעולה.',
      confirmLabel: 'מחק הכול',
      danger: true
    });
    if (!ok) return;
    try {
      await store.wipeAll();
      location.replace('./');
    } catch {
      toast('המחיקה נכשלה. סגור את האפליקציה בלשוניות אחרות ונסה שוב.');
    }
  };
}
