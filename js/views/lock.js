// Lock screen: open with fingerprint/face unlock, a PIN, the password, or the recovery code
// (and then set a new password).
import * as vault from '../vault.js';
import * as quick from '../quick.js';
import { WrongSecretError, isRecoveryCodeShape } from '../crypto.js';
import * as google from '../google.js';
import { icon } from '../ui/icons.js';
import { passwordInput, usernameField, bindToggles, newPasswordFields, bindNewPassword, showError, busy } from '../ui/password.js';

const QUICK_MESSAGES = {
  unsupported: 'המכשיר הזה לא תומך בפתיחה עם טביעת אצבע. פתח עם הסיסמה.',
  cancelled: 'הפתיחה עם טביעת אצבע בוטלה. נסה שוב או פתח עם הסיסמה.',
  failed: 'הפתיחה עם טביעת אצבע לא הצליחה. פתח עם הסיסמה.',
  'pin-locked': `הוזן קוד PIN שגוי ${quick.MAX_PIN_FAILS} פעמים, ולכן הפתיחה עם PIN בוטלה. פתח עם הסיסמה והפעל אותה מחדש בהגדרות.`
};

function defaultMode() {
  if (quick.passwordDue()) return 'password';
  if (quick.hasBio()) return 'bio';
  if (quick.hasPin()) return 'pin';
  return 'password';
}

// mode: 'bio' | 'pin' | 'password' | 'recovery'
export function renderLock(app, onUnlocked, mode = defaultMode(), message = '') {
  const due = mode === 'password' && quick.passwordDue();
  // Ready before the tap, so Google's window can open right after unlocking (to renew Drive access).
  google.preload()?.catch(() => {});
  const links = [];
  if (!due && mode !== 'bio' && quick.hasBio()) links.push(['bio', 'פתח עם טביעת אצבע']);
  if (!due && mode !== 'pin' && quick.hasPin()) links.push(['pin', 'פתח עם קוד PIN']);
  if (mode !== 'password') links.push(['password', mode === 'recovery' ? 'חזרה לפתיחה עם סיסמה' : 'פתח עם סיסמה']);
  if (mode === 'password') links.push(['recovery', 'שכחתי סיסמה, יש לי קוד שחזור']);

  let body;
  if (mode === 'bio') {
    body = `<div class="lock-form">
        <p class="lock-error" role="alert" hidden></p>
        <button type="button" class="btn btn-lg btn-white" data-bio>${icon('fingerprint')}פתח עם טביעת אצבע</button>
      </div>`;
  } else {
    let field;
    if (mode === 'recovery') {
      field = `<div class="field field-dark">
          <label for="recovery-code">קוד שחזור</label>
          <input class="input code-input" id="recovery-code" name="secret" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
        </div>`;
    } else if (mode === 'pin') {
      field = `<div class="field field-dark">
          <label for="pin">קוד PIN</label>
          <input class="input pin-input" id="pin" name="secret" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="${quick.PIN_MAX}" autocomplete="off" dir="ltr">
        </div>`;
    } else {
      field = usernameField() + passwordInput({ name: 'secret', label: 'סיסמת הצפנה', dark: true });
    }
    const label = { recovery: 'פתח עם קוד השחזור', pin: 'פתח', password: 'פתח את הכספת' }[mode];
    body = `<form class="lock-form" novalidate>
        ${field}
        ${due ? '<p class="lock-note">פעם בשבועיים נבקש את הסיסמה המלאה, כדי שלא תישכח.</p>' : ''}
        <p class="lock-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-lg btn-white">${label}</button>
      </form>`;
  }

  app.innerHTML = `
    <section class="lock">
      <img class="logo" src="icons/icon.svg" alt="" width="80" height="80">
      <h1 tabindex="-1">IDfold</h1>
      <p class="lock-sub">הכספת המוצפנת למסמכי הזהות שלך</p>
      ${body}
      ${links.map(([m, text]) => `<button type="button" class="link-btn" data-mode="${m}">${text}</button>`).join('')}
    </section>`;
  app.classList.add('no-bar');
  app.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = () => renderLock(app, onUnlocked, btn.dataset.mode);
  });
  const error = app.querySelector('.lock-error');
  if (message) showError(error, message);

  if (mode === 'bio') {
    const button = app.querySelector('[data-bio]');
    // No await before unlockBio: the fingerprint prompt must open inside the tap.
    button.onclick = async () => {
      showError(error, '');
      try {
        await busy(button, 'פותח…', () => quick.unlockBio());
      } catch (err) {
        return showError(error, QUICK_MESSAGES[err.code] || QUICK_MESSAGES.failed);
      }
      await onUnlocked();
    };
    button.focus();
    return;
  }

  const form = app.querySelector('form');
  const input = form.elements.secret;
  bindToggles(form);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const secret = input.value;
    if (mode === 'pin') {
      if (!quick.isPinShape(secret)) return showError(error, `קוד ה-PIN מכיל ${quick.PIN_MIN} עד ${quick.PIN_MAX} ספרות.`, input);
      showError(error, '');
      try {
        await busy(form.querySelector('[type=submit]'), 'פותח…', () => quick.unlockPin(secret));
      } catch (err) {
        input.value = '';
        if (err.code === 'pin-locked') return renderLock(app, onUnlocked, 'password', QUICK_MESSAGES['pin-locked']);
        const left = quick.pinTriesLeft();
        return showError(error, err instanceof WrongSecretError
          ? `קוד ה-PIN שגוי. ${left === 1 ? 'נשאר ניסיון אחד' : `נשארו ${left} ניסיונות`} לפני שהפתיחה עם PIN תבוטל.`
          : 'לא ניתן לפתוח את הכספת. נסה שוב.', input);
      }
      input.value = '';
      return onUnlocked();
    }
    const recovery = mode === 'recovery';
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
    if (!recovery && (quick.hasPin() || quick.hasBio())) await quick.passwordUsed().catch(() => {});
    if (recovery) renderResetPassword(app, secret, onUnlocked);
    else await onUnlocked();
  };
  input.focus();
}

// After opening with the recovery code the old password is forgotten, so a new one is required.
export function renderResetPassword(app, recoveryCode, onDone, warning = '') {
  document.body.classList.remove('dark');
  app.innerHTML = `
    <div class="setup">
      <h1 tabindex="-1">בחירת סיסמה חדשה</h1>
      <p class="step-text">הכספת נפתחה עם קוד השחזור. בחר סיסמת הצפנה חדשה. קוד השחזור הנוכחי ממשיך לעבוד.</p>
      ${warning ? `<p class="note note-warn">${icon('alert')}<span>${warning}</span></p>` : ''}
      <div class="card card-pad">
        <form novalidate>
          ${usernameField()}
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
