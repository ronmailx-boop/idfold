const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function countLabel(n) {
  if (n === 1) return 'מסמך אחד';
  return `${n} מסמכים`;
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Focuses a field with its whole text selected, so one tap on the keyboard's delete clears it.
export function selectAll(input) {
  input.focus();
  input.select();
}
