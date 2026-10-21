import * as store from '../store.js';
import { icon } from '../ui/icons.js';
import { esc, countLabel, toast } from '../ui/util.js';
import { createFolderFlow } from '../ui/folder-sheets.js';
import { docCard, addDocFlow } from '../ui/docs.js';
import * as sync from '../sync.js';
import { paintChip } from '../ui/sync.js';

// Kept while the app is open, so coming back from a document keeps the results.
let query = '';

// On lock: the search text may name documents.
export function resetHome() {
  query = '';
}

export function renderHome(app) {
  app.innerHTML = `
    <header class="top">
      <div class="top-text">
        <h1 tabindex="-1">הכספת שלי</h1>
        <p class="sub">${countLabel(store.docCount())} · מוצפן</p>
      </div>
      <a class="chip" href="#/settings" data-sync aria-describedby="sync-label"></a>
      <span class="sr-only" id="sync-label">מצב הגיבוי. מעבר להגדרות</span>
      <a class="icon-btn" href="#/settings" aria-label="הגדרות">${icon('settings')}</a>
    </header>

    <label class="search">
      ${icon('search')}
      <span class="sr-only">חיפוש מסמכים</span>
      <input type="search" placeholder="חיפוש לפי שם או הערה" enterkeyhint="search" autocomplete="off" value="${esc(query)}">
    </label>
    <p class="sr-only" role="status" id="search-status"></p>

    <div id="home-body"></div>

    <div class="bottom-bar">
      <button type="button" class="btn btn-primary btn-lg" id="add-doc">${icon('plus')}הוסף מסמך</button>
    </div>`;

  const body = app.querySelector('#home-body');
  const search = app.querySelector('.search input');
  search.addEventListener('input', () => {
    query = search.value;
    renderBody(body);
  });
  app.querySelector('#add-doc').onclick = () => addDocFlow(null);
  const chip = app.querySelector('[data-sync]');
  paintChip(chip, sync.getStatus());
  const stop = sync.onStatus((st) => paintChip(chip, st));
  renderBody(body);
  return { cleanup: stop };
}

function renderBody(body) {
  const status = document.getElementById('search-status');
  if (query.trim()) {
    const results = store.searchDocs(query);
    const summary = !results.length ? 'לא נמצאו מסמכים'
      : results.length === 1 ? 'נמצא מסמך אחד' : `נמצאו ${results.length} מסמכים`;
    status.textContent = summary;
    body.innerHTML = `
      <h2 class="section-title">${summary}</h2>
      ${results.length ? `<ul class="doc-list">${results.map((d) => docCard(d, { showFolder: true })).join('')}</ul>` : ''}`;
    return;
  }
  status.textContent = '';
  const folders = store.folderList();
  body.innerHTML = `
    <h2 class="section-title">התיקיות שלי</h2>
    <ul class="grid" id="folder-grid">
      ${folders.map((f) => `
        <li data-id="${esc(f.id)}">
          <a class="folder-card" href="#/folder/${encodeURIComponent(f.id)}" draggable="false">
            <span class="f-icon c-${esc(f.color)}">${icon(f.icon)}</span>
            <span class="f-name">${esc(f.name)}</span>
            <span class="f-count">${countLabel(store.docCount(f.id))}</span>
          </a>
        </li>`).join('')}
      <li>
        <button type="button" class="folder-card new" id="new-folder">
          <span class="f-icon">${icon('plus')}</span>
          <span>תיקייה חדשה</span>
        </button>
      </li>
    </ul>
    <p class="hint">לחיצה ארוכה על תיקייה וגרירה משנות את הסדר</p>`;
  body.querySelector('#new-folder').onclick = createFolderFlow;
  enableReorder(body.querySelector('#folder-grid'));
}

// Long-press a folder card, then drag it to a new place in the grid.
function enableReorder(grid) {
  const LONG_PRESS_MS = 400;
  let timer = null;
  let item = null;         // <li> being dragged
  let start = null;        // pointer position at press
  let grab = null;         // pointer offset inside the item
  let suppressClick = false;

  const cancelTimer = () => { clearTimeout(timer); timer = null; };

  function place(x, y) {
    item.style.transform = '';
    const r = item.getBoundingClientRect();
    item.style.transform = `translate(${x - grab.x - r.left}px, ${y - grab.y - r.top}px)`;
  }

  function begin(li, e) {
    item = li;
    const r = li.getBoundingClientRect();
    grab = { x: start.x - r.left, y: start.y - r.top };
    li.classList.add('dragging');
    grid.classList.add('is-dragging');
    grid.setPointerCapture(e.pointerId);
    navigator.vibrate?.(15);
  }

  async function end() {
    cancelTimer();
    if (!item) return;
    item.classList.remove('dragging');
    item.style.transform = '';
    grid.classList.remove('is-dragging');
    item = null;
    suppressClick = true;
    const ids = [...grid.querySelectorAll('li[data-id]')].map((li) => li.dataset.id);
    try {
      await store.reorderFolders(ids);
    } catch {
      toast('השמירה נכשלה. נסה שוב.');
    }
  }

  grid.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-id]');
    suppressClick = false;
    if (!li || e.button > 0) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => begin(li, e), e.pointerType === 'mouse' ? 250 : LONG_PRESS_MS);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!item) {
      if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancelTimer();
      return;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#folder-grid li[data-id]');
    if (over && over !== item) {
      const items = [...grid.querySelectorAll('li[data-id]')];
      over[items.indexOf(over) > items.indexOf(item) ? 'after' : 'before'](item);
    }
    place(e.clientX, e.clientY);
  });

  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
  // Stop the page from scrolling while a card is being dragged.
  grid.addEventListener('touchmove', (e) => { if (item) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest('li[data-id]')) e.preventDefault(); });
  grid.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
  }, true);
}
