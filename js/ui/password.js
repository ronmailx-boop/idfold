// Password inputs: show/hide toggle, new-password fields with strength meter.
import { icon } from './icons.js';
import { passwordStrength, MIN_PASSWORD_LENGTH, MIN_SCORE } from '../strength.js';

let uid = 0;

// The vault has no user name, but password managers want one to save the password under.
// A fixed hidden one keeps them from asking "add a user name".
export const usernameField = () => '<input type="text" name="username" autocomplete="username" value="IDfold" hidden>';

export function passwordInput({ name, label, autocomplete = 'current-password', dark = false }) {
  const id = `pw-${++uid}`;
  return `<div class="field${dark ? ' field-dark' : ''}">
    <label for="${id}">${label}</label>
    <div class="pw">
      <input class="input" type="password" id="${id}" name="${name}" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" dir="auto">
      <button type="button" class="pw-toggle" data-toggle aria-label="הצג סיסמה" aria-pressed="false">${icon('eye')}</button>
    </div>
  </div>`;
}

// Wires every show/hide toggle inside root.
export function bindToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const input = btn.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'הסתר סיסמה' : 'הצג סיסמה');
      btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
    };
  });
}

export function newPasswordFields() {
  return `${passwordInput({ name: 'newPassword', label: 'סיסמת הצפנה חדשה', autocomplete: 'new-password' })}
    <div class="meter" data-meter="0">
      <span class="meter-bar"><i></i></span>
      <span class="meter-label" aria-live="polite"></span>
    </div>
    <p class="field-hint">לפחות ${MIN_PASSWORD_LENGTH} תווים. משפט קצר שקל לך לזכור הוא סיסמה טובה.</p>
    ${passwordInput({ name: 'confirmPassword', label: 'הקלד שוב את הסיסמה', autocomplete: 'new-password' })}`;
}

// Returns validate(): the new password, or null after showing the problem in errorEl.
export function bindNewPassword(form, errorEl) {
  const pw = form.elements.newPassword;
  const confirm = form.elements.confirmPassword;
  const meter = form.querySelector('.meter');
  const label = meter.querySelector('.meter-label');

  pw.addEventListener('input', () => {
    const s = passwordStrength(pw.value);
    meter.dataset.meter = pw.value ? String(s.score + 1) : '0';
    label.textContent = pw.value ? `חוזק: ${s.label}` : '';
  });

  return function validate() {
    let msg = '';
    let field = pw;
    if ([...pw.value].length < MIN_PASSWORD_LENGTH) msg = `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
    else if (passwordStrength(pw.value).score < MIN_SCORE) msg = 'הסיסמה חלשה מדי. הוסף מילים, ספרות או סימנים.';
    else if (confirm.value !== pw.value) { msg = 'הסיסמאות אינן זהות.'; field = confirm; }
    showError(errorEl, msg, field);
    return msg ? null : pw.value;
  };
}

export function showError(errorEl, msg, field) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
  if (msg && field) field.focus();
}

// Disables a submit button and swaps its label while work runs.
export async function busy(button, text, work) {
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = text;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = original;
  }
}
