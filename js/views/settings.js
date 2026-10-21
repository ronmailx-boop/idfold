import * as store from '../store.js';
import * as vault from '../vault.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/util.js';
import { confirmSheet, openSheet } from '../ui/sheet.js';
import { passwordInput, newPasswordFields, bindNewPassword, bindToggles, showError, busy } from '../ui/password.js';
import { recoverySteps } from '../ui/recovery.js';
import { WrongSecretError, generateRecoveryCode } from '../crypto.js';
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
        <button type="button" class="row" id="change-password">
          <span class="row-icon">${icon('key')}</span>
          <span class="row-text">שינוי סיסמת הצפנה</span>
        </button>
        <button type="button" class="row" id="new-code">
          <span class="row-icon">${icon('refresh')}</span>
          <span class="row-text">הפקת קוד שחזור חדש<small>הקוד הקודם יפסיק לעבוד</small></span>
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
  app.querySelector('#change-password').onclick = changePasswordSheet;
  app.querySelector('#new-code').onclick = newRecoveryCodeSheet;
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

// Wrong current password → message in errorEl; resolves true when work succeeded.
async function withCurrentPassword(button, label, errorEl, input, work) {
  try {
    await busy(button, label, work);
    return true;
  } catch (err) {
    if (err instanceof WrongSecretError) {
      input.value = '';
      showError(errorEl, 'הסיסמה הנוכחית שגויה.', input);
    } else {
      showError(errorEl, 'הפעולה נכשלה. נסה שוב.');
    }
    return false;
  }
}

function changePasswordSheet() {
  const d = openSheet({
    title: 'שינוי סיסמת הצפנה',
    body: `<form novalidate>
      <p class="sheet-msg">רק המפתח נעטף מחדש. הקבצים לא מוצפנים מחדש וקוד השחזור לא משתנה.</p>
      ${passwordInput({ name: 'current', label: 'הסיסמה הנוכחית' })}
      ${newPasswordFields()}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">שנה סיסמה</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form>`
  });
  const form = d.querySelector('form');
  const error = form.querySelector('.field-error');
  const current = form.elements.current;
  bindToggles(form);
  const validate = bindNewPassword(form, error);
  d.querySelector('[data-cancel]').onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!current.value) return showError(error, 'יש להזין את הסיסמה הנוכחית.', current);
    const next = validate();
    if (!next) return;
    const ok = await withCurrentPassword(form.querySelector('[type=submit]'), 'שומר…', error, current,
      () => vault.changePassword({ slot: 'password', secret: current.value }, next));
    if (ok) {
      d.close();
      toast('הסיסמה שונתה');
    }
  };
  current.focus();
}

function newRecoveryCodeSheet() {
  const d = openSheet({
    title: 'הפקת קוד שחזור חדש',
    body: `<div data-step><form novalidate>
      <p class="sheet-msg">אחרי השמירה הקוד הקודם יפסיק לעבוד. כדי להמשיך הזן את סיסמת ההצפנה.</p>
      ${passwordInput({ name: 'current', label: 'סיסמת הצפנה' })}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">המשך</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form></div>`
  });
  const step = d.querySelector('[data-step]');
  const form = step.querySelector('form');
  const error = form.querySelector('.field-error');
  const current = form.elements.current;
  bindToggles(form);
  d.querySelector('[data-cancel]').onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!current.value) return showError(error, 'יש להזין את הסיסמה.', current);
    const password = current.value;
    // Check the password before showing a code that could not be saved.
    const ok = await withCurrentPassword(form.querySelector('[type=submit]'), 'בודק…', error, current,
      () => vault.verifyPassword(password));
    if (!ok) return;
    const code = generateRecoveryCode();
    d.querySelector('h2').remove();
    recoverySteps(step, code, {
      finishLabel: 'שמור קוד חדש',
      busyLabel: 'שומר…',
      onCancel: () => d.close(),
      onFinish: async () => {
        await vault.replaceRecoveryCode(password, code);
        d.close();
        toast('קוד השחזור הוחלף');
      }
    });
  };
  current.focus();
}
