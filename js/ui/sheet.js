// Bottom sheets built on <dialog>: focus trap, Esc and Android back come for free.
import { esc } from './util.js';

export function openSheet({ title, body = '', label = title }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', label);
  dialog.innerHTML = `<div class="sheet-handle"></div>${title ? `<h2>${esc(title)}</h2>` : ''}${body}`;
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// Resolves true when confirmed, false otherwise.
export function confirmSheet({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const d = openSheet({
      title,
      body: `<p class="sheet-msg">${esc(message)}</p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-lg ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
          <button type="button" class="btn btn-lg btn-secondary" data-cancel>ביטול</button>
        </div>`
    });
    let ok = false;
    d.querySelector('[data-ok]').onclick = () => { ok = true; d.close(); };
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.addEventListener('close', () => resolve(ok));
    d.querySelector('[data-cancel]').focus();
  });
}

// Menu of actions: items = [{ icon, label, danger, disabled, onSelect }]
export function menuSheet({ title, items, iconFn }) {
  const d = openSheet({
    title,
    body: `<div class="sheet-menu">${items.map((it, i) => `
      <button type="button" class="row${it.danger ? ' danger' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}>
        <span class="row-icon">${iconFn(it.icon)}</span>
        <span class="row-text">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</span>
      </button>`).join('')}</div>`
  });
  d.querySelectorAll('[data-i]').forEach((btn) => {
    btn.onclick = () => { d.close(); items[btn.dataset.i].onSelect(); };
  });
}
