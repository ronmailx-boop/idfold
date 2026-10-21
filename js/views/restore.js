// New device: sign in to Google, open the backup with the password or the recovery code, download it.
import * as vault from '../vault.js';
import * as sync from '../sync.js';
import * as store from '../store.js';
import * as google from '../google.js';
import { WrongSecretError, isRecoveryCodeShape } from '../crypto.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/util.js';
import { passwordInput, usernameField, bindToggles, showError, busy } from '../ui/password.js';
import { renderResetPassword } from './lock.js';

export function renderRestore(app, { onDone, onBack }) {
  google.preload()?.catch(() => {});
  app.innerHTML = `
    <div class="setup">
      <img class="logo" src="icons/icon.svg" alt="" width="72" height="72">
      <h1 tabindex="-1">שחזור מגיבוי</h1>
      <p class="step-text">התחבר לחשבון Google שבו נשמר הגיבוי. הגיבוי מוצפן, ולכן תצטרך גם את סיסמת ההצפנה או את קוד השחזור.</p>
      <div class="card card-pad">
        <p class="field-error" role="alert" hidden></p>
        <button type="button" class="btn btn-lg btn-primary btn-block" data-find>${icon('cloud')}התחבר ל-Google ומצא את הגיבוי</button>
      </div>
      <button type="button" class="link-btn" data-back>חזרה ליצירת כספת חדשה</button>
    </div>`;
  app.classList.add('no-bar');
  const error = app.querySelector('.field-error');
  const find = app.querySelector('[data-find]');
  app.querySelector('[data-back]').onclick = onBack;

  // No await before findBackup: the Google window must open inside the tap.
  find.onclick = async () => {
    showError(error, '');
    let found;
    try {
      found = await busy(find, 'מחפש גיבוי…', () => sync.findBackup());
    } catch (err) {
      return showError(error, sync.MESSAGES[err.code] || sync.MESSAGES.failed);
    }
    if (!found) return showError(error, 'לא נמצא גיבוי של IDfold בחשבון Google הזה. בדוק שבחרת את החשבון הנכון.');
    renderOpenBackup(app, found, { onDone, onBack });
  };
  app.querySelector('h1').focus();
}

function renderOpenBackup(app, found, { onDone, onBack }, mode = 'password') {
  const recovery = mode === 'recovery';
  app.innerHTML = `
    <div class="setup">
      <h1 tabindex="-1">נמצא גיבוי</h1>
      <p class="step-text">${found.email ? `בחשבון <bdi dir="ltr">${esc(found.email)}</bdi>. ` : ''}${recovery ? 'הזן את קוד השחזור כדי לפתוח אותו.' : 'הזן את סיסמת ההצפנה כדי לפתוח אותו.'}</p>
      <div class="card card-pad">
        <form novalidate>
          ${recovery
            ? `<div class="field">
                <label for="recovery-code">קוד שחזור</label>
                <input class="input code-input" id="recovery-code" name="secret" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
              </div>`
            : usernameField() + passwordInput({ name: 'secret', label: 'סיסמת הצפנה' })}
          <p class="field-error" role="alert" hidden></p>
          <p class="restore-progress" role="status" hidden></p>
          <button type="submit" class="btn btn-lg btn-primary">שחזר</button>
        </form>
      </div>
      <button type="button" class="link-btn" data-switch>${recovery ? 'חזרה לפתיחה עם סיסמה' : 'שכחתי סיסמה, יש לי קוד שחזור'}</button>
      <button type="button" class="link-btn" data-back>ביטול</button>
    </div>`;
  const form = app.querySelector('form');
  const input = form.elements.secret;
  const error = form.querySelector('.field-error');
  const progress = form.querySelector('.restore-progress');
  const submit = form.querySelector('[type=submit]');
  bindToggles(form);
  app.querySelector('[data-switch]').onclick = () => renderOpenBackup(app, found, { onDone, onBack }, recovery ? 'password' : 'recovery');
  app.querySelector('[data-back]').onclick = onBack;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const secret = input.value;
    if (!secret) return showError(error, recovery ? 'יש להזין את קוד השחזור.' : 'יש להזין את הסיסמה.', input);
    if (recovery && !isRecoveryCodeShape(secret)) return showError(error, 'קוד השחזור צריך להכיל 24 תווים.', input);
    showError(error, '');
    try {
      await busy(submit, 'פותח…', () => vault.unlockBackup(found.header, recovery ? 'recovery' : 'password', secret));
    } catch (err) {
      input.value = '';
      return showError(error, err instanceof WrongSecretError
        ? (recovery ? 'קוד השחזור שגוי.' : 'הסיסמה שגויה.')
        : 'לא ניתן לפתוח את הגיבוי. נסה שוב.', input);
    }
    input.value = '';

    const stop = sync.onStatus((st) => {
      progress.hidden = false;
      progress.textContent = st.total ? `מוריד קבצים: ${st.done} מתוך ${st.total}` : 'משחזר…';
    });
    let warning = '';
    try {
      await busy(submit, 'משחזר…', () => sync.restore(found));
    } catch (err) {
      if (!vault.exists()) {
        // Nothing was kept: the backup could not be opened.
        stop();
        vault.lock();
        store.clearMemory();
        progress.hidden = true;
        return showError(error, sync.MESSAGES[err.code] || sync.MESSAGES.failed);
      }
      // Folders and documents are here; the remaining files download in the next sync.
      warning = 'חלק מהקבצים עדיין לא ירדו. הם יורדו בסנכרון הבא, כשיש חיבור לאינטרנט.';
    }
    stop();
    if (recovery) renderResetPassword(app, secret, onDone, warning);
    else {
      if (warning) alertThen(app, warning, onDone);
      else await onDone();
    }
  };
  app.querySelector('h1').focus();
}

function alertThen(app, message, next) {
  app.innerHTML = `
    <div class="setup">
      <h1 tabindex="-1">השחזור הושלם</h1>
      <div class="card card-pad">
        <p class="note note-warn">${icon('alert')}<span>${message}</span></p>
        <button type="button" class="btn btn-lg btn-primary btn-block" data-next>המשך לכספת</button>
      </div>
    </div>`;
  app.querySelector('[data-next]').onclick = next;
  app.querySelector('h1').focus();
}
