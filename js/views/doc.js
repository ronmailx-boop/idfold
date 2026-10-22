// Document viewer: decrypts the file into memory only, and forgets it when the screen closes.
import * as store from '../store.js';
import { back } from '../router.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/util.js';
import { expiryInfo, editDocFlow, moveDocFlow, deleteDocFlow, shareFlow, shareFile } from '../ui/docs.js';
import { billFlow } from '../ui/bills.js';
import { isPdf } from '../files.js';
import { openPdf, renderPage } from '../pdf.js';

const backButton = `<button type="button" class="icon-btn" data-back aria-label="חזרה">${icon('back')}</button>`;

export function renderDoc(app, id) {
  if (!store.getDoc(id)) {
    app.innerHTML = `
      <header class="top">${backButton}<div class="top-text"><h1 tabindex="-1">המסמך לא נמצא</h1></div></header>
      <div class="empty"><p>ייתכן שהמסמך נמחק.</p><a class="btn btn-primary" href="#/">לכספת</a></div>`;
    app.querySelector('[data-back]').onclick = back;
    return null;
  }

  app.classList.add('doc-screen');
  app.innerHTML = `
    <header class="top">
      ${backButton}
      <div class="top-text">
        <h1 tabindex="-1" data-title></h1>
        <p class="sub" data-sub></p>
      </div>
      <button type="button" class="icon-btn" data-edit aria-label="עריכת פרטים">${icon('pencil')}</button>
    </header>
    <p class="doc-note" data-note hidden></p>
    <div class="viewer-wrap">
      <div class="viewer" data-viewer role="region" aria-label="תצוגת המסמך">
        <p class="viewer-msg" role="status">מפענח…</p>
      </div>
      <div class="zoom-ctl" hidden>
        <button type="button" class="icon-btn" data-zoom="out" aria-label="הקטנה">${icon('zoomOut')}</button>
        <button type="button" class="icon-btn" data-zoom="in" aria-label="הגדלה">${icon('zoomIn')}</button>
      </div>
    </div>
    <div class="bottom-bar">
      <div class="actions-row">
        <button type="button" class="btn btn-secondary" data-share disabled>${icon('share')}שתף</button>
        <button type="button" class="btn btn-secondary" data-move>${icon('move')}העבר</button>
        <button type="button" class="btn btn-secondary btn-danger-text" data-delete>${icon('trash')}מחק</button>
      </div>
    </div>`;

  const $ = (sel) => app.querySelector(sel);
  const viewer = $('[data-viewer]');
  const current = () => store.getDoc(id);

  function fillHeader() {
    const doc = current();
    if (!doc) return;
    $('[data-title]').textContent = doc.name;
    const exp = store.isBill(doc) ? null : expiryInfo(doc.expiry);
    $('[data-sub]').textContent = [store.getFolder(doc.folderId)?.name, exp?.text].filter(Boolean).join(' · ');
    $('[data-note]').textContent = doc.note;
    $('[data-note]').hidden = !doc.note;
  }
  fillHeader();

  let closed = false;
  let bytes = null;
  let url = null;
  let pdf = null;
  let zoom = null;

  function showMessage(text) {
    viewer.innerHTML = `<p class="viewer-msg" role="status">${esc(text)}</p>`;
  }

  async function showImage(mime) {
    url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.alt = current()?.name || '';
    img.src = url;
    await img.decode();
    if (closed) return;
    const content = document.createElement('div');
    content.className = 'zoom-content';
    content.append(img);
    viewer.replaceChildren(content);
    zoom = setupZoom(viewer, content, app.querySelector('.zoom-ctl'));
  }

  async function showPdf() {
    pdf = await openPdf(bytes);
    if (closed) return;
    const content = document.createElement('div');
    content.className = 'zoom-content pdf-pages';
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `עמוד ${i} מתוך ${pdf.numPages}`);
      content.append(canvas);
      pages.push(canvas);
    }
    viewer.replaceChildren(content);

    // Re-renders every page sharply for the current zoom; a newer call cancels an older one.
    let generation = 0;
    async function draw(scale) {
      const gen = ++generation;
      const width = viewer.clientWidth * (devicePixelRatio || 1) * scale;
      for (let i = 0; i < pages.length; i++) {
        const page = await pdf.getPage(i + 1);
        const canvas = document.createElement('canvas');
        await renderPage(page, canvas, width);
        if (closed || gen !== generation) return;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', pages[i].getAttribute('aria-label'));
        pages[i].replaceWith(canvas);
        pages[i] = canvas;
      }
    }
    await draw(1);
    if (closed) return;
    zoom = setupZoom(viewer, content, app.querySelector('.zoom-ctl'), draw);
  }

  (async () => {
    const doc = current();
    try {
      bytes = await store.readFile(id);
    } catch (err) {
      if (!closed) {
        showMessage(err.message === 'file missing'
          ? 'הקובץ עדיין לא ירד מהגיבוי ב-Google Drive. הוא יורד בסנכרון הבא, כשיש חיבור לאינטרנט.'
          : 'לא ניתן לפענח את הקובץ.');
      }
      return;
    }
    if (closed) return;
    $('[data-share]').disabled = false;
    try {
      if (isPdf(doc.mime)) await showPdf();
      else await showImage(doc.mime);
    } catch {
      if (!closed) showMessage('לא ניתן להציג את הקובץ במכשיר הזה. אפשר עדיין לשתף או להוריד אותו.');
    }
  })();

  $('[data-back]').onclick = back;
  $('[data-edit]').onclick = () => {
    const doc = current();
    if (doc) store.isBill(doc) ? billFlow({ doc }) : editDocFlow(doc);
  };
  $('[data-move]').onclick = () => current() && moveDocFlow(current());
  $('[data-delete]').onclick = async () => {
    if (current() && await deleteDocFlow(current())) back();
  };
  $('[data-share]').onclick = () => {
    const doc = current();
    if (doc && bytes) shareFlow(shareFile(bytes, doc), doc.name);
  };

  return {
    refresh: fillHeader,
    cleanup() {
      closed = true;
      zoom?.destroy();
      if (url) URL.revokeObjectURL(url);
      pdf?.destroy();
      bytes = null;
      url = null;
      pdf = null;
    }
  };
}

// Pinch, double tap and +/- buttons. Zooming widens the content inside the scrolling viewer.
function setupZoom(viewer, content, controls, onSettle) {
  const MIN = 1;
  const MAX = 5;
  let scale = 1;
  let settleTimer = null;

  function apply(next, cx = viewer.clientWidth / 2, cy = viewer.clientHeight / 2) {
    next = Math.min(MAX, Math.max(MIN, next));
    if (Math.abs(next - scale) < 0.01) return;
    // Keep the point under (cx, cy) in place.
    const x = (viewer.scrollLeft + cx) / scale;
    const y = (viewer.scrollTop + cy) / scale;
    scale = next;
    content.style.width = `${scale * 100}%`;
    viewer.scrollLeft = x * scale - cx;
    viewer.scrollTop = y * scale - cy;
    clearTimeout(settleTimer);
    if (onSettle) settleTimer = setTimeout(() => onSettle(scale), 250);
  }

  const local = (x, y) => {
    const r = viewer.getBoundingClientRect();
    return [x - r.left, y - r.top];
  };

  let pinch = null;
  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => {
    if (e.touches.length === 2) pinch = { dist: spread(e.touches), scale };
  };
  const onTouchMove = (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    apply(pinch.scale * spread(e.touches) / pinch.dist, ...local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2));
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinch = null; };
  // iOS Safari zooms the whole page on pinch unless its gesture events are cancelled.
  const onGesture = (e) => e.preventDefault();

  let down = null;
  let lastTap = 0;
  const onPointerDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { lastTap = 0; return; }
    const now = e.timeStamp;
    if (now - lastTap < 300) {
      apply(scale > 1 ? 1 : 2.5, ...local(e.clientX, e.clientY));
      lastTap = 0;
    } else {
      lastTap = now;
    }
  };

  viewer.addEventListener('touchstart', onTouchStart, { passive: true });
  viewer.addEventListener('touchmove', onTouchMove, { passive: false });
  viewer.addEventListener('touchend', onTouchEnd);
  viewer.addEventListener('gesturestart', onGesture);
  viewer.addEventListener('pointerdown', onPointerDown);
  viewer.addEventListener('pointerup', onPointerUp);

  controls.hidden = false;
  controls.querySelector('[data-zoom=in]').onclick = () => apply(scale * 1.5);
  controls.querySelector('[data-zoom=out]').onclick = () => apply(scale / 1.5);

  return {
    destroy() {
      clearTimeout(settleTimer);
      viewer.removeEventListener('touchmove', onTouchMove);
      viewer.removeEventListener('gesturestart', onGesture);
    }
  };
}
