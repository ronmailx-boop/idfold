// Create / edit / delete folder flows, shared by the home and folder screens.
import * as store from '../store.js';
import { openSheet, confirmSheet } from './sheet.js';
import { icon, FOLDER_ICONS, FOLDER_COLORS } from './icons.js';
import { esc, countLabel, toast } from './util.js';

const ICON_KEYS = new Set(FOLDER_ICONS.map((i) => i.key));
const COLOR_KEYS = new Set(FOLDER_COLORS.map((c) => c.key));

// Resolves { name, icon, color } or null if cancelled.
function folderForm({ title, submitLabel, folder }) {
  const cur = folder || { name: '', icon: 'folder', color: 'purple' };
  return new Promise((resolve) => {
    const d = openSheet({
      title,
      body: `<form novalidate>
        <label class="field">
          <span>שם התיקייה</span>
          <input class="input" name="name" maxlength="${store.NAME_MAX}" autocomplete="off" required value="${esc(cur.name)}">
          <span class="field-error" id="folder-name-error" hidden>יש להזין שם לתיקייה</span>
        </label>
        <fieldset>
          <legend>צבע</legend>
          <div class="opt-grid">${FOLDER_COLORS.map((c) => `
            <label class="opt c-${c.key}">
              <input type="radio" name="color" value="${c.key}"${c.key === cur.color ? ' checked' : ''}>
              <span class="swatch"></span><span class="sr-only">${c.label}</span>
            </label>`).join('')}</div>
        </fieldset>
        <fieldset class="icon-set c-${esc(cur.color)}">
          <legend>אייקון</legend>
          <div class="opt-grid">${FOLDER_ICONS.map((i) => `
            <label class="opt">
              <input type="radio" name="icon" value="${i.key}"${i.key === cur.icon ? ' checked' : ''}>
              <span class="opt-face">${icon(i.key)}</span><span class="sr-only">${i.label}</span>
            </label>`).join('')}</div>
        </fieldset>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-lg btn-primary">${esc(submitLabel)}</button>
          <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
        </div>
      </form>`
    });
    const form = d.querySelector('form');
    const nameInput = form.elements.name;
    const error = d.querySelector('#folder-name-error');
    const iconSet = d.querySelector('.icon-set');
    let result = null;

    nameInput.addEventListener('input', () => {
      error.hidden = true;
      nameInput.removeAttribute('aria-invalid');
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'color') iconSet.className = `icon-set c-${e.target.value}`;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = store.cleanText(nameInput.value);
      if (!name) {
        error.hidden = false;
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.setAttribute('aria-describedby', error.id);
        nameInput.focus();
        return;
      }
      const iconKey = form.elements.icon.value;
      const colorKey = form.elements.color.value;
      result = {
        name,
        icon: ICON_KEYS.has(iconKey) ? iconKey : 'folder',
        color: COLOR_KEYS.has(colorKey) ? colorKey : 'purple'
      };
      d.close();
    });
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.addEventListener('close', () => resolve(result));
    if (!folder) nameInput.focus();
  });
}

// Runs a store action; resolves false (after telling the user) if it failed.
async function guard(action) {
  try {
    await action();
    return true;
  } catch {
    toast('השמירה נכשלה. נסה שוב.');
    return false;
  }
}

export async function createFolderFlow() {
  const values = await folderForm({ title: 'תיקייה חדשה', submitLabel: 'צור תיקייה' });
  if (values) await guard(() => store.createFolder(values));
}

export async function editFolderFlow(folder) {
  const values = await folderForm({ title: 'עריכת תיקייה', submitLabel: 'שמור', folder });
  if (values) await guard(() => store.updateFolder(folder.id, values));
}

// Resolves true if the folder was deleted.
export async function deleteFolderFlow(folder) {
  const n = store.docCount(folder.id);
  const ok = await confirmSheet({
    title: `למחוק את התיקייה "${folder.name}"?`,
    message: n ? `${countLabel(n)} שבתיקייה יועברו לתיקייה "אחר".` : 'התיקייה ריקה.',
    confirmLabel: 'מחק תיקייה',
    danger: true
  });
  if (!ok || !(await guard(() => store.deleteFolder(folder.id)))) return false;
  toast('התיקייה נמחקה');
  return true;
}
