// First run: choose a password, then save and confirm the recovery code.
import * as vault from '../vault.js';
import * as google from '../google.js';
import { generateRecoveryCode } from '../crypto.js';
import { icon } from '../ui/icons.js';
import { newPasswordFields, bindNewPassword, bindToggles, usernameField } from '../ui/password.js';
import { recoverySteps, NO_RECOVERY_WARNING } from '../ui/recovery.js';
import { renderRestore } from './restore.js';

export function renderSetup(app, onCreated) {
  app.innerHTML = `
    <div class="setup">
      <img class="logo" src="icons/icon.svg" alt="" width="72" height="72">
      <h1 tabindex="-1">יצירת כספת</h1>
      <p class="step-text">המסמכים מוצפנים במכשיר שלך לפני שהם נשמרים או מגובים. רק מי שיודע את סיסמת ההצפנה יכול לפתוח אותם.</p>
      <div class="card card-pad" id="setup-step">
        <form novalidate>
          ${usernameField()}
          ${newPasswordFields()}
          <p class="field-error" role="alert" hidden></p>
          <p class="note note-warn">${icon('alert')}<span>${NO_RECOVERY_WARNING}</span></p>
          <button type="submit" class="btn btn-lg btn-primary">המשך</button>
        </form>
      </div>
      ${google.isConfigured() ? '<button type="button" class="link-btn" data-restore>יש לי גיבוי ב-Google Drive</button>' : ''}
      <p class="legal-links"><a href="privacy.html" target="_blank" rel="noopener">מדיניות פרטיות</a> · <a href="terms.html" target="_blank" rel="noopener">תנאי שימוש</a> · <a href="accessibility.html" target="_blank" rel="noopener">נגישות</a></p>
    </div>`;
  app.classList.add('no-bar');

  const restore = app.querySelector('[data-restore]');
  if (restore) restore.onclick = () => renderRestore(app, { onDone: onCreated, onBack: () => renderSetup(app, onCreated) });

  const step = app.querySelector('#setup-step');
  const form = step.querySelector('form');
  bindToggles(form);
  const validate = bindNewPassword(form, form.querySelector('.field-error'));

  form.onsubmit = (e) => {
    e.preventDefault();
    const password = validate();
    if (!password) return;
    const code = generateRecoveryCode();
    recoverySteps(step, code, {
      finishLabel: 'צור את הכספת',
      busyLabel: 'יוצר את הכספת…',
      onFinish: async () => {
        await vault.create(password, code);
        await onCreated();
      }
    });
  };
}
