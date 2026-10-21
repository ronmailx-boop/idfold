// Lock screen: open with the password, or with the recovery code and then set a new password.
import * as vault from '../vault.js';
import { WrongSecretError, isRecoveryCodeShape } from '../crypto.js';
import { passwordInput, bindToggles, newPasswordFields, bindNewPassword, showError, busy } from '../ui/password.js';

export function renderLock(app, onUnlocked, mode = 'password') {
  const recovery = mode === 'recovery';
  app.innerHTML = `
    <section class="lock">
      <img class="logo" src="icons/icon.svg" alt="" width="80" height="80">
      <h1 tabindex="-1">IDfold</h1>
      <p class="lock-sub">הכספת המוצפנת למסמכי הזהות שלך</p>
      <form novalidate>
        ${recovery
          ? `<div class="field field-dark">
              <label for="recovery-code">קוד שחזור</label>
              <input class="input code-input" id="recovery-code" name="secret" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
            </div>`
          : passwordInput({ name: 'secret', label: 'סיסמת הצפנה', dark: true })}
        <p class="lock-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-lg btn-white">${recovery ? 'פתח עם קוד השחזור' : 'פתח את הכספת'}</button>
      </form>
      <button type="button" class="link-btn" data-switch>${recovery ? 'חזרה לפתיחה עם סיסמה' : 'שכחתי סיסמה, יש לי קוד שחזור'}</button>
    </section>`;
  app.classList.add('no-bar');

  const form = app.querySelector('form');
  const input = form.elements.secret;
  const error = form.querySelector('.lock-error');
  bindToggles(form);
  app.querySelector('[data-switch]').onclick = () => renderLock(app, onUnlocked, recovery ? 'password' : 'recovery');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const secret = input.value;
    if (!secret) return showError(error, recovery ? 'יש להזין את קוד השחזור.' : 'יש להזין את הסיסמה.', input);
    if (recovery && !isRecoveryCodeShape(secret)) return showError(error, 'קוד השחזור צריך להכיל 24 תווים.', input);
    showError(error, '');
    try {
      await busy(form.querySelector('[type=submit]'), 'פותח…', () => vault.unlock(recovery ? 'recovery' : 'password', secret));
    } catch (err) {
      input.value = '';
      return showError(error, err instanceof WrongSecretError
        ? (recovery ? 'קוד השחזור שגוי.' : 'הסיסמה שגויה.')
        : 'לא ניתן לפתוח את הכספת. נסה שוב.', input);
    }
    input.value = '';
    if (recovery) renderResetPassword(app, secret, onUnlocked);
    else await onUnlocked();
  };
  input.focus();
}

// After opening with the recovery code the old password is forgotten, so a new one is required.
function renderResetPassword(app, recoveryCode, onDone) {
  document.body.classList.remove('dark');
  app.innerHTML = `
    <div class="setup">
      <h1 tabindex="-1">בחירת סיסמה חדשה</h1>
      <p class="step-text">הכספת נפתחה עם קוד השחזור. בחר סיסמת הצפנה חדשה. קוד השחזור הנוכחי ממשיך לעבוד.</p>
      <div class="card card-pad">
        <form novalidate>
          ${newPasswordFields()}
          <p class="field-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-lg btn-primary">שמור סיסמה</button>
        </form>
      </div>
    </div>`;
  const form = app.querySelector('form');
  const error = form.querySelector('.field-error');
  bindToggles(form);
  const validate = bindNewPassword(form, error);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const password = validate();
    if (!password) return;
    try {
      await busy(form.querySelector('[type=submit]'), 'שומר…', () => vault.changePassword({ slot: 'recovery', secret: recoveryCode }, password));
    } catch {
      return showError(error, 'השמירה נכשלה. נסה שוב.');
    }
    await onDone();
  };
  app.querySelector('h1').focus();
}
