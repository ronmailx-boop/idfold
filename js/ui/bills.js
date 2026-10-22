// Payments (kind 'bill'): a link to pay, the SMS / WhatsApp message and an optional PDF or screenshot.
import * as store from '../store.js';
import { openSheet, menuSheet } from './sheet.js';
import { icon } from './icons.js';
import { esc, toast, selectAll } from './util.js';
import { busy, showError } from './password.js';
import { addDocFlow, pickFiles, folderOptions, noteField } from './docs.js';
import { prepareFile, fileMime, baseName, formatSize, MAX_FILE_BYTES } from '../files.js';

const pad = (n) => String(n).padStart(2, '0');
const dmy = (y, m, d) => `${pad(d)}/${pad(m)}/${y}`;

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function formatAmount(amount) {
  if (!amount) return '';
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(Number(amount));
}

// { cls, text } for a payment's status badge.
export function dueInfo(doc) {
  if (doc.paidAt) {
    const p = new Date(doc.paidAt);
    return { cls: 'badge-ok', text: `שולם ב-${dmy(p.getFullYear(), p.getMonth() + 1, p.getDate())}` };
  }
  if (!doc.expiry) return { cls: 'badge-warn', text: 'לא שולם' };
  const [y, m, d] = doc.expiry.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(y, m - 1, d) - today) / 864e5);
  if (days < 0) return { cls: 'badge-bad', text: `באיחור · היה לתשלום עד ${dmy(y, m, d)}` };
  if (days === 0) return { cls: 'badge-warn', text: 'לתשלום היום' };
  if (days <= 7) return { cls: 'badge-warn', text: days === 1 ? 'לתשלום עד מחר' : `לתשלום בעוד ${days} ימים` };
  return { cls: 'badge-off', text: `לתשלום עד ${dmy(y, m, d)}` };
}

// The first https link in a message (SMS and WhatsApp texts often end it with punctuation).
export function findUrl(text) {
  for (const raw of String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const url = store.cleanUrl(raw.replace(/[).,;:!?\]}'"״׳]+$/, ''));
    if (url) return url;
  }
  return '';
}

// A short default name from a message: its first line without links, cut at a whole word.
function nameFrom(text) {
  const line = store.cleanText(String(text || '').split('\n').find((l) => l.trim()) || '', 200)
    .replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (line.length <= store.NAME_MAX) return line;
  const cut = line.slice(0, store.NAME_MAX + 1);
  return (cut.slice(0, cut.lastIndexOf(' ')) || cut.slice(0, store.NAME_MAX)).trim();
}

// "www.iec.co.il/pay" → "https://www.iec.co.il/pay"; an http link becomes https.
function normalizeUrl(text) {
  const t = text.trim();
  if (!t) return '';
  if (/^http:\/\//i.test(t)) return store.cleanUrl(`https://${t.slice(7)}`);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[^\s/]+\.[^\s/]{2,}/.test(t)) return store.cleanUrl(`https://${t}`);
  return store.cleanUrl(t);
}

// "+" in the tab bar: a document or a payment.
export function addChoice(folderId) {
  menuSheet({
    title: 'מה להוסיף?',
    iconFn: icon,
    items: [
      { icon: 'file', label: 'מסמך', note: 'צילום, תמונה או PDF', onSelect: () => addDocFlow(folderId) },
      { icon: 'receipt', label: 'תשלום', note: 'קישור לתשלום, הודעת SMS או וואטסאפ, חשבון ב-PDF', onSelect: () => billFlow({ folderId }) }
    ]
  });
}

// Add (no doc) or edit (doc) a payment. prefill comes from another app's share: { title, text, url, file }.
export function billFlow({ folderId = null, doc = null, prefill = null } = {}) {
  const editing = !!doc;
  const pre = prefill || {};
  const preText = [pre.title, pre.text].filter(Boolean).join('\n');
  const preUrl = store.cleanUrl(pre.url) || findUrl(preText);
  let file = null;
  if (pre.file) {
    if (fileMime(pre.file) && pre.file.size <= MAX_FILE_BYTES) file = pre.file;
    else toast('הקובץ ששותף לא נוסף: רק PDF או תמונה, עד 25MB.');
  }
  const preName = nameFrom(pre.title || preText) || (file ? store.cleanText(baseName(file)) : '') || hostOf(preUrl);
  const v = editing ? doc : { name: preName, url: preUrl, msg: preText, amount: '', expiry: '', note: '' };
  const canPaste = !!navigator.clipboard?.readText;
  const fileSlot = editing && store.hasFile(doc);

  const d = openSheet({
    title: editing ? 'עריכת תשלום' : 'תשלום חדש',
    body: `<form novalidate>
      ${canPaste ? `<button type="button" class="btn btn-secondary btn-block paste-btn" data-paste>${icon('paste')}הדבק הודעה או קישור</button>` : ''}
      <label class="field">
        <span>תיקייה</span>
        <select class="input" name="folder">
          ${(editing ? doc.folderId : folderId) ? '' : '<option value="">בחר תיקייה</option>'}${folderOptions(editing ? doc.folderId : folderId)}
        </select>
      </label>
      <label class="field">
        <span>שם</span>
        <input class="input" name="name" maxlength="${store.NAME_MAX}" autocomplete="off" placeholder="למשל: חשמל – אוקטובר" value="${esc(v.name)}">
      </label>
      <label class="field">
        <span>קישור לתשלום</span>
        <input class="input ltr" type="url" name="url" inputmode="url" dir="ltr" autocomplete="off" placeholder="https://" maxlength="${store.URL_MAX}" value="${esc(v.url)}">
      </label>
      <label class="field">
        <span>הודעת SMS או וואטסאפ (לא חובה)</span>
        <textarea class="input textarea" name="msg" rows="3" dir="auto" maxlength="${store.MSG_MAX}">${esc(v.msg)}</textarea>
      </label>
      <p class="field-hint" data-found hidden>הקישור מההודעה הועתק לשדה "קישור לתשלום".</p>
      <div class="field-row">
        <label class="field">
          <span>סכום (לא חובה)</span>
          <input class="input ltr" name="amount" inputmode="decimal" dir="ltr" autocomplete="off" placeholder="₪ 0.00" value="${esc(v.amount)}">
        </label>
        <label class="field">
          <span>לתשלום עד (לא חובה)</span>
          <input class="input" type="date" name="expiry" value="${esc(v.expiry)}">
        </label>
      </div>
      ${noteField(v.note)}
      ${fileSlot ? '' : `<div class="field">
        <span>חשבון ב-PDF או צילום מסך (לא חובה)</span>
        <div class="attach" data-attach></div>
      </div>`}
      <p class="field-error" role="alert" hidden></p>
      <div class="sheet-actions">
        <button type="submit" class="btn btn-lg btn-primary">${icon('lock')}${editing ? 'שמור' : 'שמור מוצפן'}</button>
        <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
      </div>
    </form>`
  });
  const form = d.querySelector('form');
  const f = form.elements;
  const error = form.querySelector('.field-error');
  if (editing) selectAll(f.name);
  const found = form.querySelector('[data-found]');
  d.querySelector('[data-cancel]').onclick = () => d.close();
  form.addEventListener('input', () => { if (!error.hidden) showError(error, ''); });

  const attach = form.querySelector('[data-attach]');
  function paintAttach() {
    if (!attach) return;
    attach.innerHTML = file
      ? `<span class="attach-name" dir="auto">${icon('paperclip')}${esc(file.name)} · <bdi dir="ltr">${formatSize(file.size)}</bdi></span>
         <button type="button" class="btn btn-secondary" data-remove>הסר</button>`
      : `<button type="button" class="btn btn-secondary btn-block" data-pick>${icon('paperclip')}צרף קובץ</button>`;
    attach.querySelector('[data-pick]')?.addEventListener('click', async () => {
      const [picked] = await pickFiles({ multiple: false });
      if (!picked) return;
      if (!fileMime(picked) || picked.size > MAX_FILE_BYTES) return toast('אפשר לצרף רק PDF או תמונה, עד 25MB.');
      file = picked;
      if (!f.name.value.trim()) f.name.value = store.cleanText(baseName(picked));
      paintAttach();
    });
    attach.querySelector('[data-remove]')?.addEventListener('click', () => { file = null; paintAttach(); });
  }
  paintAttach();

  // A link inside the message fills the link field when it is empty.
  function takeLinkFrom(text) {
    const url = findUrl(text);
    if (url && !f.url.value.trim()) {
      f.url.value = url;
      found.hidden = false;
    }
  }
  f.msg.addEventListener('input', () => takeLinkFrom(f.msg.value));

  d.querySelector('[data-paste]')?.addEventListener('click', async () => {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      return toast('אין גישה ללוח. אפשר להדביק ידנית בשדה.');
    }
    if (!text) return toast('הלוח ריק');
    const only = normalizeUrl(text);
    if (only && !/\s/.test(text)) {
      f.url.value = only;
    } else {
      f.msg.value = text.slice(0, store.MSG_MAX);
      takeLinkFrom(text);
    }
    if (!f.name.value.trim()) f.name.value = nameFrom(text) || hostOf(f.url.value);
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const target = f.folder.value;
    if (!store.getFolder(target)) return showError(error, 'יש לבחור תיקייה.', f.folder);
    const urlText = f.url.value.trim();
    const url = normalizeUrl(urlText);
    if (urlText && !url) return showError(error, 'הקישור לא תקין. אפשר לשמור רק קישור מאובטח (https).', f.url);
    const amountText = f.amount.value.trim();
    if (amountText && !store.cleanAmount(amountText)) return showError(error, 'הסכום לא תקין. כותבים רק מספר, למשל 245.90', f.amount);
    if (!editing && !url && !f.msg.value.trim() && !file) return showError(error, 'יש להוסיף קישור, הודעה או קובץ.', f.url);
    showError(error, '');
    const fields = {
      folderId: target,
      name: f.name.value || hostOf(url) || 'תשלום',
      url,
      msg: f.msg.value,
      amount: amountText,
      expiry: f.expiry.value,
      note: f.note.value
    };
    let ok = false;
    await busy(form.querySelector('[type=submit]'), 'מצפין ושומר…', async () => {
      try {
        const prepared = file ? await prepareFile(file) : null;
        if (editing) {
          await store.updateDoc(doc.id, fields);
          if (prepared) await store.attachFile(doc.id, prepared);
        } else {
          await store.addBill(fields, prepared);
        }
        ok = true;
      } catch {
        // Reported below.
      }
    });
    if (!ok) return showError(error, 'השמירה נכשלה. ייתכן שאין מספיק מקום במכשיר.');
    d.close();
    toast(editing ? 'התשלום עודכן' : 'התשלום נשמר מוצפן');
    if (!editing && location.hash !== `#/folder/${encodeURIComponent(target)}`) location.hash = `#/folder/${encodeURIComponent(target)}`;
  };
}
