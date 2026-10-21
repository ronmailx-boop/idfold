// Shows a new recovery code once, then asks the user to type it back.
import { icon } from './icons.js';
import { esc } from './util.js';
import { normalizeRecoveryCode } from '../crypto.js';
import { showError, busy } from './password.js';

export const NO_RECOVERY_WARNING = 'אין שום דרך לפתוח את הקבצים בלי סיסמת ההצפנה או קוד השחזור. אף אחד לא יכול לשחזר אותם בשבילך, גם לא המפתח של האפליקציה.';

// container: element whose content is replaced by the steps.
// onFinish: async () => void, runs after the code was typed back correctly.
export function recoverySteps(container, code, { finishLabel, busyLabel, onFinish, onCancel }) {
  function showCode() {
    container.innerHTML = `
      <h2 class="step-title" tabindex="-1">קוד השחזור שלך</h2>
      <p class="step-text">זו הדרך היחידה לפתוח את הכספת אם תשכח את הסיסמה. הקוד מוצג <strong>פעם אחת בלבד</strong>.</p>
      <p class="recovery-code" dir="ltr">${code.split('-').map((g) => `<span>${esc(g)}</span>`).join('')}</p>
      <div class="step-actions-inline">
        <button type="button" class="btn btn-secondary" data-copy>${icon('copy')}העתק</button>
      </div>
      <p class="field-hint">רשום אותו על דף ושמור במקום בטוח, או שמור אותו במנהל סיסמאות. אל תשמור אותו בגלריה או בהערה לא מוגנת.</p>
      <p class="note note-warn">${icon('alert')}<span>${NO_RECOVERY_WARNING}</span></p>
      <label class="check">
        <input type="checkbox" data-saved>
        <span>שמרתי את הקוד במקום בטוח</span>
      </label>
      <div class="sheet-actions">
        <button type="button" class="btn btn-lg btn-primary" data-next disabled>המשך</button>
        ${onCancel ? '<button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>' : ''}
      </div>`;
    const next = container.querySelector('[data-next]');
    container.querySelector('[data-saved]').onchange = (e) => { next.disabled = !e.target.checked; };
    const copy = container.querySelector('[data-copy]');
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = 'הועתק';
      } catch {
        copy.textContent = 'ההעתקה נכשלה';
      }
    };
    next.onclick = verify;
    if (onCancel) container.querySelector('[data-cancel]').onclick = onCancel;
    container.querySelector('.step-title').focus();
  }

  function verify() {
    container.innerHTML = `
      <form novalidate>
        <h2 class="step-title" tabindex="-1">אימות קוד השחזור</h2>
        <p class="step-text">הקלד את הקוד ששמרת, כדי לוודא שהוא נשמר נכון.</p>
        <div class="field">
          <label for="code-check">קוד שחזור</label>
          <input class="input code-input" id="code-check" name="code" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
        </div>
        <p class="field-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-lg btn-primary">${esc(finishLabel)}</button>
          <button type="button" class="btn btn-lg btn-secondary" data-back>חזרה לקוד</button>
        </div>
      </form>`;
    const form = container.querySelector('form');
    const input = form.elements.code;
    const error = form.querySelector('.field-error');
    container.querySelector('[data-back]').onclick = showCode;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (normalizeRecoveryCode(input.value) !== normalizeRecoveryCode(code)) {
        showError(error, 'הקוד שהקלדת לא תואם. בדוק ונסה שוב.', input);
        return;
      }
      showError(error, '');
      try {
        await busy(form.querySelector('[type=submit]'), busyLabel, onFinish);
      } catch {
        showError(error, 'הפעולה נכשלה. נסה שוב.');
      }
    };
    input.focus();
  }

  showCode();
}
