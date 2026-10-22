import * as store from '../store.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { esc, countLabel } from '../ui/util.js';
import { menuSheet } from '../ui/sheet.js';
import { editFolderFlow, deleteFolderFlow } from '../ui/folder-sheets.js';
import { docCard } from '../ui/docs.js';
import { addChoice } from '../ui/bills.js';
import { tabBar, bindTabBar } from '../ui/tabbar.js';

const backButton = `<button type="button" class="icon-btn" data-back aria-label="חזרה">${icon('back')}</button>`;

export function renderFolder(app, id) {
  const folder = store.getFolder(id);
  if (!folder) {
    app.innerHTML = `
      <header class="top">${backButton}<div class="top-text"><h1 tabindex="-1">התיקייה לא נמצאה</h1></div></header>
      <div class="empty"><p>ייתכן שהתיקייה נמחקה.</p><a class="btn btn-primary" href="#/">לכספת</a></div>`;
    app.querySelector('[data-back]').onclick = back;
    return;
  }

  // Open payments first, paid ones last; otherwise newest first.
  const rank = (d) => (store.isBill(d) ? (d.paidAt ? 2 : 0) : 1);
  const docs = store.docList(folder.id).sort((a, b) => rank(a) - rank(b));
  const n = docs.length;
  app.innerHTML = `
    <header class="top">
      ${backButton}
      <div class="top-text">
        <h1 tabindex="-1">${esc(folder.name)}</h1>
        <p class="sub">${countLabel(n)}</p>
      </div>
      <button type="button" class="icon-btn" id="folder-menu" aria-label="אפשרויות תיקייה">${icon('more')}</button>
    </header>

    ${n ? `<ul class="doc-list">${docs.map((d) => docCard(d)).join('')}</ul>` : `
    <div class="empty">
      <span class="f-icon c-${esc(folder.color)}">${icon(folder.icon)}</span>
      <h2 class="section-title">אין עדיין מסמכים בתיקייה</h2>
      <p>הוסף דרכון, תעודה, חשבון לתשלום או כל מסמך אחר. הכול יישמר מוצפן.</p>
      <button type="button" class="btn btn-secondary" data-add>${icon('plus')}הוספה</button>
    </div>`}

    ${tabBar()}`;

  app.querySelector('[data-back]').onclick = back;
  app.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addChoice(folder.id); });
  bindTabBar(app, { onAdd: () => addChoice(folder.id) });
  app.querySelector('#folder-menu').onclick = () => menuSheet({
    title: folder.name,
    iconFn: icon,
    items: [
      { icon: 'pencil', label: 'שינוי שם, צבע ואייקון', onSelect: () => editFolderFlow(folder) },
      {
        icon: 'trash',
        label: 'מחיקת התיקייה',
        note: folder.keep ? 'אי אפשר למחוק את תיקיית "אחר"' : '',
        danger: true,
        disabled: folder.keep,
        onSelect: async () => { if (await deleteFolderFlow(folder)) back(); }
      }
    ]
  });
}
