// Payment screen: the pay link (with its site shown before leaving), the saved message and file.
import * as store from '../store.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { esc, toast } from '../ui/util.js';
import { moveDocFlow, deleteDocFlow } from '../ui/docs.js';
import { billFlow, dueInfo, formatAmount, hostOf } from '../ui/bills.js';
import { isPdf, formatSize } from '../files.js';

export function renderBill(app, id) {
  const doc = store.getDoc(id);
  const due = dueInfo(doc);
  const amount = formatAmount(doc.amount);
  const host = hostOf(doc.url);
  app.classList.add('no-bar');
  app.innerHTML = `
    <header class="top">
      <button type="button" class="icon-btn" data-back aria-label="חזרה">${icon('back')}</button>
      <div class="top-text">
        <h1 tabindex="-1">${esc(doc.name)}</h1>
        <p class="sub">${esc(store.getFolder(doc.folderId)?.name || '')} · תשלום</p>
      </div>
      <button type="button" class="icon-btn" data-edit aria-label="עריכת התשלום">${icon('pencil')}</button>
    </header>

    <section class="card card-pad bill-card${doc.paidAt ? ' is-paid' : ''}">
      ${amount ? `<p class="bill-amount"><bdi dir="ltr">${esc(amount)}</bdi></p>` : ''}
      <span class="badge ${due.cls}">${esc(due.text)}</span>
      ${doc.url ? `
        <a class="btn btn-lg btn-primary btn-block bill-pay" href="${esc(doc.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}מעבר לתשלום</a>
        <p class="bill-host">${icon('link')}<span>האתר: <bdi dir="ltr">${esc(host)}</bdi></span></p>
        <p class="bill-tip">לפני שמזינים פרטי אשראי, כדאי לוודא שזה האתר של החברה ששלחה את החשבון.</p>`
      : '<p class="bill-tip">אין קישור לתשלום. אפשר להוסיף אותו בעריכה.</p>'}
      <div class="bill-actions">
        <button type="button" class="btn ${doc.paidAt ? 'btn-secondary' : 'btn-outline'}" data-paid aria-pressed="${doc.paidAt ? 'true' : 'false'}">${icon('check')}${doc.paidAt ? 'בטל סימון "שולם"' : 'סמן כשולם'}</button>
        ${doc.url ? `<button type="button" class="btn btn-secondary" data-copy>${icon('copy')}העתק קישור</button>` : ''}
      </div>
    </section>

    ${doc.msg ? `
    <section class="group" aria-labelledby="bill-msg">
      <h2 class="group-title" id="bill-msg">ההודעה</h2>
      <div class="card card-pad bill-msg" dir="auto">${esc(doc.msg)}</div>
    </section>` : ''}

    <section class="group" aria-labelledby="bill-file">
      <h2 class="group-title" id="bill-file">החשבון</h2>
      <div class="card">
        ${store.hasFile(doc) ? `
        <a class="row" href="#/file/${encodeURIComponent(doc.id)}">
          <span class="row-icon">${icon('file')}</span>
          <span class="row-text">הצגת הקובץ<small>${isPdf(doc.mime) ? 'PDF' : 'תמונה'} · <bdi dir="ltr">${formatSize(doc.size)}</bdi> · אפשר גם לשתף או להוריד</small></span>
        </a>` : `
        <button type="button" class="row" data-attach>
          <span class="row-icon">${icon('paperclip')}</span>
          <span class="row-text">צירוף PDF או צילום מסך<small>לא נשמר עדיין קובץ לתשלום הזה</small></span>
        </button>`}
      </div>
    </section>

    ${doc.note ? `
    <section class="group" aria-labelledby="bill-note">
      <h2 class="group-title" id="bill-note">הערה</h2>
      <div class="card card-pad bill-msg" dir="auto">${esc(doc.note)}</div>
    </section>` : ''}

    <div class="bill-foot">
      <button type="button" class="btn btn-secondary" data-move>${icon('move')}העבר</button>
      <button type="button" class="btn btn-secondary btn-danger-text" data-delete>${icon('trash')}מחק</button>
    </div>`;

  const $ = (sel) => app.querySelector(sel);
  const current = () => store.getDoc(id);
  $('[data-back]').onclick = back;
  $('[data-edit]').onclick = () => current() && billFlow({ doc: current() });
  $('[data-attach]')?.addEventListener('click', () => current() && billFlow({ doc: current() }));
  $('[data-move]').onclick = () => current() && moveDocFlow(current());
  $('[data-delete]').onclick = async () => {
    if (current() && await deleteDocFlow(current())) back();
  };
  $('[data-paid]').onclick = async () => {
    const d = current();
    if (!d) return;
    try {
      await store.updateDoc(id, { paidAt: d.paidAt ? 0 : Date.now() });
      toast(d.paidAt ? 'הסימון בוטל' : 'סומן כשולם');
    } catch {
      toast('השמירה נכשלה. נסה שוב.');
    }
  };
  $('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(current().url);
      toast('הקישור הועתק');
    } catch {
      toast('ההעתקה נכשלה');
    }
  });
}
