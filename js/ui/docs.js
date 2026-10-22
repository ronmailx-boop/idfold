// Document cards and the add / edit / move / delete / share flows.
import * as store from '../store.js';
import { openSheet, confirmSheet, menuSheet } from './sheet.js';
import { icon } from './icons.js';
import { esc, toast } from './util.js';
import { busy, showError } from './password.js';
import { prepareFile, fileMime, baseName, formatSize, isPdf, MAX_FILE_BYTES } from '../files.js';
import { dueInfo, formatAmount, hostOf } from './bills.js';

// ---------- Cards ----------

const pad = (n) => String(n).padStart(2, '0');

// { cls, text } for an expiry date, or null.
export function expiryInfo(expiry) {
  if (!expiry) return null;
  const [y, m, d] = expiry.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(y, m - 1, d) - today) / 864e5);
  const date = `${pad(d)}/${pad(m)}/${y}`;
  if (days < 0) return { cls: 'badge-bad', text: `פג תוקף ב-${date}` };
  if (days === 0) return { cls: 'badge-warn', text: 'התוקף פג היום' };
  if (days <= 90) return { cls: 'badge-warn', text: days === 1 ? 'התוקף פג מחר' : `התוקף פג בעוד ${days} ימים` };
  return { cls: 'badge-ok', text: `בתוקף עד ${date}` };
}

const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function docCard(doc, { showFolder = false } = {}) {
  const bill = store.isBill(doc);
  const exp = bill ? dueInfo(doc) : expiryInfo(doc.expiry);
  const kind = bill ? 'תשלום' : isPdf(doc.mime) ? 'PDF' : 'תמונה';
  const where = showFolder ? store.getFolder(doc.folderId)?.name || '' : kind;
  const detail = bill ? formatAmount(doc.amount) || hostOf(doc.url) : formatSize(doc.size);
  return `<li>
    <a class="doc-card${bill && doc.paidAt ? ' is-paid' : ''}" href="#/doc/${encodeURIComponent(doc.id)}">
      <span class="doc-thumb${bill ? ' is-bill' : ''}">
        ${THUMB_RE.test(doc.thumb) ? `<img src="${doc.thumb}" alt="">` : icon(bill ? 'receipt' : 'file')}
        ${isPdf(doc.mime) ? '<span class="doc-type">PDF</span>' : ''}
      </span>
      <span class="doc-info">
        <span class="doc-name">${esc(doc.name)}</span>
        <span class="doc-meta">${esc(where)}${detail ? ` · <bdi dir="ltr">${esc(detail)}</bdi>` : ''}</span>
        ${doc.note ? `<span class="doc-note-line">${esc(doc.note)}</span>` : ''}
        ${exp ? `<span class="badge ${exp.cls}">${esc(exp.text)}</span>` : ''}
      </span>
    </a>
  </li>`;
}

// ---------- Add ----------

export function pickFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    document.getElementById('file-picker')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'file-picker';
    input.accept = 'application/pdf,image/*';
    input.multiple = multiple;
    input.hidden = true;
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export const folderOptions = (selected) => store.folderList()
  .map((f) => `<option value="${esc(f.id)}"${f.id === selected ? ' selected' : ''}>${esc(f.name)}</option>`).join('');

export const noteField = (value = '') => `<label class="field">
    <span>הערה (לא חובה)</span>
    <textarea class="input textarea" name="note" rows="2" maxlength="${store.NOTE_MAX}">${esc(value)}</textarea>
  </label>`;

const expiryField = (value = '') => `<label class="field">
    <span>תאריך תפוגה (לא חובה)</span>
    <input class="input" type="date" name="expiry" value="${esc(value)}">
  </label>`;

// Must be called from a click handler: the file picker needs the user's tap.
export async function addDocFlow(folderId) {
  const picked = await pickFiles();
  if (!picked.length) return;
  const files = picked.filter((f) => fileMime(f) && f.size <= MAX_FILE_BYTES);
  if (files.length < picked.length) {
    toast(picked.length === 1 ? 'אפשר להוסיף רק PDF או תמונה, עד 25MB.' : 'חלק מהקבצים לא נוספו: רק PDF או תמונה, עד 25MB.');
  }
  if (!files.length) return;
  const single = files.length === 1;

  const d = openSheet({
    title: single ? 'הוספת מסמך' : `הוספת ${files.length} מסמכים`,
    body: `<form novalidate>
      <label class="field">
        <span>תיקייה</span>
        <select class="input" name="folder">
          ${folderId ? '' : '<option value="">בחר תיקייה</option>'}${folderOptions(folderId)}
        </select>
      </label>
      ${files.map((f, i) => `
        <label class="field">
          <span>${single ? 'שם המסמך' : `שם למסמך ${i + 1}`}</span>
          <input class="input" name="name-${i}" maxlength="${store.NAME_MAX}" autocomplete="off" value="${esc(store.cleanText(baseName(f)))}">
        </label>
        <p class="field-hint file-hint" dir="auto">${esc(f.name)} · ${formatSize(f.size)}</p>`).join('')}
      ${single ? noteField() + expiryField() : '<p class="field-hint">הערה ותאריך תפוגה אפשר להוסיף אחר כך בכל מסמך.</p>'}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">${icon('lock')}שמור מוצפן</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form>`
  });
  const form = d.querySelector('form');
  const error = form.querySelector('.field-error');
  d.querySelector('[data-cancel]').onclick = () => d.close();
  form.elements.folder.onchange = () => showError(error, '');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const target = form.elements.folder.value;
    if (!store.getFolder(target)) return showError(error, 'יש לבחור תיקייה.', form.elements.folder);
    showError(error, '');
    let saved = 0;
    await busy(form.querySelector('[type=submit]'), 'מצפין ושומר…', async () => {
      for (const [i, file] of files.entries()) {
        try {
          const { bytes, mime, thumb } = await prepareFile(file);
          await store.addDoc({
            folderId: target,
            name: form.elements[`name-${i}`].value || baseName(file),
            note: single ? form.elements.note.value : '',
            expiry: single ? form.elements.expiry.value : '',
            mime,
            thumb
          }, bytes);
          saved++;
        } catch {
          // Reported below; keep going with the other files.
        }
      }
    });
    if (!saved) return showError(error, 'השמירה נכשלה. ייתכן שאין מספיק מקום במכשיר.');
    d.close();
    const failed = files.length - saved;
    toast(failed ? `${saved} נשמרו, ${failed} לא נשמרו. נסה להוסיף אותם שוב.`
      : saved === 1 ? 'המסמך נשמר מוצפן' : `${saved} מסמכים נשמרו מוצפנים`);
    if (!folderId) location.hash = `#/folder/${encodeURIComponent(target)}`;
  };
}

// ---------- Edit / move / delete ----------

async function guard(action) {
  try {
    await action();
    return true;
  } catch {
    toast('השמירה נכשלה. נסה שוב.');
    return false;
  }
}

export function editDocFlow(doc) {
  const d = openSheet({
    title: 'עריכת פרטים',
    body: `<form novalidate>
      <label class="field">
        <span>שם המסמך</span>
        <input class="input" name="name" maxlength="${store.NAME_MAX}" autocomplete="off" value="${esc(doc.name)}">
      </label>
      ${noteField(doc.note)}
      ${expiryField(doc.expiry)}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">שמור</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form>`
  });
  const form = d.querySelector('form');
  d.querySelector('[data-cancel]').onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = store.cleanText(form.elements.name.value);
    if (!name) return showError(form.querySelector('.field-error'), 'יש להזין שם למסמך.', form.elements.name);
    const ok = await guard(() => store.updateDoc(doc.id, {
      name, note: form.elements.note.value, expiry: form.elements.expiry.value
    }));
    if (ok) d.close();
  };
}

export function moveDocFlow(doc) {
  menuSheet({
    title: 'העברה לתיקייה',
    iconFn: icon,
    items: store.folderList().map((f) => ({
      icon: f.icon,
      label: f.name,
      note: f.id === doc.folderId ? 'התיקייה הנוכחית' : '',
      disabled: f.id === doc.folderId,
      onSelect: async () => {
        if (await guard(() => store.updateDoc(doc.id, { folderId: f.id }))) toast(`${store.isBill(doc) ? 'התשלום' : 'המסמך'} הועבר ל"${f.name}"`);
      }
    }))
  });
}

// Resolves true if the document was deleted.
export async function deleteDocFlow(doc) {
  const bill = store.isBill(doc);
  const ok = await confirmSheet({
    title: `למחוק את "${doc.name}"?`,
    message: bill ? 'התשלום, ההודעה והקובץ שלו יימחקו מהכספת. אי אפשר לבטל את הפעולה.' : 'המסמך יימחק מהכספת. אי אפשר לבטל את הפעולה.',
    confirmLabel: bill ? 'מחק תשלום' : 'מחק מסמך',
    danger: true
  });
  if (!ok || !(await guard(() => store.deleteDoc(doc.id)))) return false;
  toast(bill ? 'התשלום נמחק' : 'המסמך נמחק');
  return true;
}

// ---------- Share ----------

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

export function shareFile(bytes, doc) {
  const safe = doc.name.replace(/[\\/:*?"<>|]/g, '-');
  return new File([bytes], `${safe}.${EXT[doc.mime] || 'bin'}`, { type: doc.mime });
}

// file is ready in advance: navigator.share must run straight from the tap.
export function shareFlow(file, title) {
  const canShare = !!navigator.canShare?.({ files: [file] });
  const d = openSheet({
    title: canShare ? 'שיתוף או הורדה' : 'הורדת המסמך',
    body: `<p class="note note-warn">${icon('alert')}<span><strong>העותק ${canShare ? 'ששולחים או מורידים' : 'שיורד למכשיר'} אינו מוצפן.</strong> כל מי שיקבל אותו יוכל לפתוח אותו, והוא עלול להישמר באפליקציה שאליה תשתף. בהורדה הוא נשמר גלוי בתיקיית ההורדות.</span></p>
      <div class="sheet-actions">
        ${canShare ? `<button type="button" class="btn btn-lg btn-primary" data-ok>${icon('share')}שתף בכל זאת</button>` : ''}
        <button type="button" class="btn btn-lg ${canShare ? 'btn-secondary' : 'btn-primary'}" data-download>${icon('download')}הורד למכשיר</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>`
  });
  d.querySelector('[data-cancel]').onclick = () => d.close();
  d.querySelector('[data-cancel]').focus();
  d.querySelector('[data-download]').onclick = () => {
    d.close();
    download(file);
  };
  if (canShare) d.querySelector('[data-ok]').onclick = () => {
    d.close();
    navigator.share({ files: [file], title }).catch((err) => {
      if (err.name !== 'AbortError') toast('השיתוף נכשל.');
    });
  };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  // The browser reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast('הקובץ ירד לתיקיית ההורדות');
}
