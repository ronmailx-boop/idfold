import * as store from '../store.js';
import * as vault from '../vault.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/util.js';
import { confirmSheet, openSheet, menuSheet } from '../ui/sheet.js';
import { passwordInput, usernameField, newPasswordFields, bindNewPassword, bindToggles, showError, busy } from '../ui/password.js';
import { recoverySteps } from '../ui/recovery.js';
import { WrongSecretError, generateRecoveryCode } from '../crypto.js';
import { APP_VERSION } from '../version.js';
import * as sync from '../sync.js';
import * as google from '../google.js';
import { paintChip, formatWhen } from '../ui/sync.js';
import * as quick from '../quick.js';
import * as autolock from '../autolock.js';
import { installMode, install } from '../install.js';

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
          <span class="row-icon" data-drive-icon></span>
          <span class="row-text"><strong>Google Drive</strong><small data-drive-sub></small></span>
          <span class="chip" data-chip></span>
        </div>
        <p class="sync-error" role="status" data-sync-error></p>
        <button type="button" class="btn btn-block" data-sync-btn></button>
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
        <div class="row">
          <span class="row-icon">${icon('fingerprint')}</span>
          <span class="row-text" id="bio-label">פתיחה עם טביעת אצבע<small data-bio-sub>או זיהוי פנים, לפי המכשיר</small></span>
          <button type="button" class="switch" role="switch" aria-checked="false" aria-labelledby="bio-label" data-bio></button>
        </div>
        <div class="row">
          <span class="row-icon">${icon('lock')}</span>
          <span class="row-text" id="pin-label">פתיחה עם קוד PIN<small>${quick.PIN_MIN} ספרות או יותר, רק במכשיר הזה</small></span>
          <button type="button" class="switch" role="switch" aria-checked="false" aria-labelledby="pin-label" data-pin></button>
        </div>
        <button type="button" class="row" id="autolock">
          <span class="row-icon">${icon('timer')}</span>
          <span class="row-text">נעילה אוטומטית<small data-autolock-sub></small></span>
        </button>
        <button type="button" class="row" id="lock-now">
          <span class="row-icon">${icon('lock')}</span>
          <span class="row-text">נעל עכשיו</span>
        </button>
      </div>
    </section>

    <section class="group" aria-labelledby="g-data">
      <h2 class="group-title" id="g-data">נתונים</h2>
      <div class="card">
        <button type="button" class="row" id="install" hidden>
          <span class="row-icon">${icon('plus')}</span>
          <span class="row-text">התקנה במסך הבית<small>נפתחת כמו אפליקציה רגילה, גם בלי אינטרנט</small></span>
        </button>
        <button type="button" class="row" id="google-logout">
          <span class="row-icon">${icon('logout')}</span>
          <span class="row-text">התנתקות מ-Google<small>הגיבוי ב-Drive נשאר מוצפן</small></span>
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
  const stopSync = bindSync(app);
  app.querySelector('#change-password').onclick = changePasswordSheet;
  app.querySelector('#new-code').onclick = newRecoveryCodeSheet;
  bindQuick(app);
  bindInstall(app);
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
  return { cleanup: stopSync };
}

// ---------- Quick unlock, auto-lock, lock now ----------

const BIO_MESSAGES = {
  unsupported: 'המכשיר או הדפדפן הזה לא תומכים בפתיחה עם טביעת אצבע לאפליקציות אינטרנט. אפשר להשתמש בקוד PIN.',
  cancelled: 'האישור בוטל. נסה שוב.',
  failed: 'ההפעלה לא הצליחה. נסה שוב.'
};

function bindQuick(app) {
  const $ = (sel) => app.querySelector(sel);
  const bio = $('[data-bio]');
  const pin = $('[data-pin]');
  const autoSub = $('[data-autolock-sub]');

  function paint() {
    bio.setAttribute('aria-checked', String(quick.hasBio()));
    pin.setAttribute('aria-checked', String(quick.hasPin()));
    autoSub.textContent = autolock.label();
  }
  quick.bioAvailable().then((ok) => {
    if (ok || quick.hasBio()) return;
    bio.disabled = true;
    bio.closest('.row').classList.add('is-disabled');
    $('[data-bio-sub]').textContent = 'לא נתמך במכשיר או בדפדפן הזה';
  });

  bio.onclick = async () => {
    if (!quick.hasBio()) return enableBioSheet(paint);
    await quick.disableBio();
    paint();
    toast('הפתיחה עם טביעת אצבע בוטלה');
  };
  pin.onclick = async () => {
    if (!quick.hasPin()) return enablePinSheet(paint);
    await quick.disablePin();
    paint();
    toast('הפתיחה עם PIN בוטלה');
  };
  $('#autolock').onclick = () => menuSheet({
    title: 'נעילה אוטומטית',
    iconFn: icon,
    items: autolock.CHOICES.map((m) => ({
      icon: 'timer',
      label: autolock.label(m),
      note: m === autolock.getMinutes() ? 'הבחירה הנוכחית' : '',
      onSelect: async () => {
        await autolock.setMinutes(m).catch(() => toast('השמירה נכשלה. נסה שוב.'));
        paint();
      }
    }))
  });
  $('#lock-now').onclick = () => autolock.lockNow();
  paint();
}

// First step of turning on a quick unlock: the password proves who is asking.
function passwordStep(d, intro, onOk) {
  const step = d.querySelector('[data-step]');
  step.innerHTML = `<form novalidate>
      <p class="sheet-msg">${intro}</p>
      ${usernameField()}
      ${passwordInput({ name: 'current', label: 'סיסמת הצפנה' })}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">המשך</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form>`;
  const form = step.querySelector('form');
  const error = form.querySelector('.field-error');
  const current = form.elements.current;
  bindToggles(form);
  form.querySelector('[data-cancel]').onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!current.value) return showError(error, 'יש להזין את הסיסמה.', current);
    const password = current.value;
    const ok = await withCurrentPassword(form.querySelector('[type=submit]'), 'בודק…', error, current,
      () => vault.verifyPassword(password));
    if (ok) onOk(password);
  };
  current.focus();
}

function enablePinSheet(onDone) {
  const d = openSheet({ title: 'פתיחה עם קוד PIN', body: '<div data-step></div>' });
  passwordStep(d, 'קוד PIN פותח את הכספת במכשיר הזה בלבד. הוא לא מחליף את סיסמת ההצפנה, ופעם בשבועיים נבקש גם אותה. כדי להמשיך הזן את סיסמת ההצפנה.', (password) => {
    const step = d.querySelector('[data-step]');
    step.innerHTML = `<form novalidate>
        <p class="sheet-msg">בחר קוד של ${quick.PIN_MIN} עד ${quick.PIN_MAX} ספרות. אחרי ${quick.MAX_PIN_FAILS} ניסיונות שגויים הפתיחה עם PIN תבוטל.</p>
        <div class="field">
          <label for="new-pin">קוד PIN חדש</label>
          <input class="input pin-input" id="new-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="${quick.PIN_MAX}" autocomplete="off" dir="ltr">
        </div>
        <div class="field">
          <label for="confirm-pin">הקלד שוב את הקוד</label>
          <input class="input pin-input" id="confirm-pin" name="confirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="${quick.PIN_MAX}" autocomplete="off" dir="ltr">
        </div>
        <p class="field-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-lg btn-primary">הפעל</button>
          <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
        </div>
      </form>`;
    const form = step.querySelector('form');
    const error = form.querySelector('.field-error');
    const { pin, confirm } = form.elements;
    form.querySelector('[data-cancel]').onclick = () => d.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!quick.isPinShape(pin.value)) return showError(error, `הקוד צריך להכיל ${quick.PIN_MIN} עד ${quick.PIN_MAX} ספרות.`, pin);
      if (/^(\d)\1+$/.test(pin.value) || '01234567890123'.includes(pin.value) || '98765432109876'.includes(pin.value)) {
        return showError(error, 'הקוד קל מדי לניחוש. בחר ספרות פחות צפויות.', pin);
      }
      if (confirm.value !== pin.value) return showError(error, 'הקודים אינם זהים.', confirm);
      showError(error, '');
      try {
        await busy(form.querySelector('[type=submit]'), 'שומר…', () => quick.enablePin(password, pin.value));
      } catch {
        return showError(error, 'השמירה נכשלה. נסה שוב.');
      }
      d.close();
      onDone();
      toast('הפתיחה עם PIN הופעלה');
    };
    pin.focus();
  });
}

function enableBioSheet(onDone) {
  const d = openSheet({ title: 'פתיחה עם טביעת אצבע', body: '<div data-step></div>' });
  passwordStep(d, 'טביעת האצבע או זיהוי הפנים פותחים את הכספת במכשיר הזה בלבד. פעם בשבועיים נבקש גם את סיסמת ההצפנה. כדי להמשיך הזן את סיסמת ההצפנה.', (password) => {
    const step = d.querySelector('[data-step]');
    // Each fingerprint prompt gets its own tap (some browsers allow it only inside a tap).
    const tapStep = (text, label, work) => {
      step.innerHTML = `<p class="sheet-msg">${text}</p>
        <p class="field-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-lg btn-primary" data-go>${icon('fingerprint')}${label}</button>
          <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
        </div>`;
      const error = step.querySelector('.field-error');
      const go = step.querySelector('[data-go]');
      step.querySelector('[data-cancel]').onclick = () => d.close();
      go.onclick = async () => {
        showError(error, '');
        try {
          await busy(go, 'ממתין לאישור…', work);
        } catch (err) {
          showError(error, BIO_MESSAGES[err.code] || BIO_MESSAGES.failed);
        }
      };
      go.focus();
    };
    const finish = async (pending, out) => {
      await quick.saveBio(password, pending, out);
      d.close();
      onDone();
      toast('הפתיחה עם טביעת אצבע הופעלה');
    };
    tapStep('עכשיו אשר עם טביעת האצבע או זיהוי הפנים של המכשיר.', 'אשר עם טביעת אצבע', async () => {
      const pending = await quick.createBio();
      if (pending.out) return finish(pending, pending.out);
      tapStep('עוד אישור אחד, כדי לקבל את מפתח הפתיחה מהמכשיר.', 'אשר שוב', async () => finish(pending, await quick.readBio(pending)));
    });
  });
}

function bindInstall(app) {
  const row = app.querySelector('#install');
  const mode = installMode();
  if (!mode) return;
  row.hidden = false;
  row.onclick = async () => {
    if (mode === 'ios') {
      confirmSheet({
        title: 'התקנה במסך הבית',
        message: 'בספארי: לחץ על כפתור השיתוף (ריבוע עם חץ למעלה), ואז על "הוספה למסך הבית".',
        confirmLabel: 'הבנתי'
      });
      return;
    }
    if (await install()) row.hidden = true;
  };
}

// The Drive card and the sign-out row follow the backup status live.
function bindSync(app) {
  const $ = (sel) => app.querySelector(sel);
  const button = $('[data-sync-btn]');
  const logout = $('#google-logout');
  google.preload()?.catch(() => {});

  function paint(st) {
    const connected = sync.isConnected();
    $('[data-drive-icon]').innerHTML = icon(connected ? 'cloud' : 'cloudOff');
    paintChip($('[data-chip]'), st);
    let sub;
    if (!google.isConfigured()) sub = 'החיבור עדיין לא הוגדר. ההוראות נמצאות בקובץ README.';
    else if (!connected) sub = 'גיבוי וסנכרון מוצפנים לתיקייה IDfold ב-Drive שלך';
    else if (st.phase === 'busy') sub = st.total ? `מסנכרן קבצים: ${st.done} מתוך ${st.total}` : 'מסנכרן…';
    else sub = [st.email, st.lastBackup ? `סנכרון אחרון: ${formatWhen(st.lastBackup)}` : ''].filter(Boolean).join(' · ');
    $('[data-drive-sub]').textContent = sub;
    const error = $('[data-sync-error]');
    error.textContent = st.error ? sync.MESSAGES[st.error] : '';
    error.hidden = !st.error;
    button.className = `btn btn-block ${connected ? 'btn-secondary' : 'btn-primary'}`;
    button.innerHTML = connected ? `${icon('refresh')}סנכרן עכשיו` : `${icon('cloud')}חבר את Google Drive`;
    button.disabled = !google.isConfigured() || st.phase === 'busy';
    logout.disabled = !connected;
  }

  // No await before the call: the Google window must open inside the tap.
  button.onclick = () => {
    (sync.isConnected() ? sync.backup({ interactive: true }) : sync.connect()).catch(() => {});
  };
  logout.onclick = async () => {
    const ok = await confirmSheet({
      title: 'להתנתק מ-Google?',
      message: 'הסנכרון האוטומטי ייפסק. הקבצים שכבר גובו נשארים מוצפנים בתיקייה IDfold ב-Drive.',
      confirmLabel: 'התנתק'
    });
    if (!ok) return;
    try {
      await sync.disconnect();
      toast('התנתקת מ-Google');
    } catch {
      toast('ההתנתקות נכשלה. נסה שוב.');
    }
  };

  paint(sync.getStatus());
  return sync.onStatus(paint);
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
      ${usernameField()}
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
      ${usernameField()}
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
