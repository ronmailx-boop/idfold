// Backup status chip, shared by the home and settings screens.
import { icon } from './icons.js';

const CHIPS = {
  off: { cls: 'chip-off', icon: 'cloudOff', text: 'לא מחובר' },
  pending: { cls: 'chip-wait', icon: 'cloud', text: 'ממתין' },
  busy: { cls: 'chip-wait', icon: 'cloud', text: 'מסנכרן…' },
  synced: { cls: 'chip-ok', icon: 'cloud', text: 'מסונכרן' }
};

export function chipParts(status) {
  return CHIPS[status.phase] || CHIPS.off;
}

// Updates a .chip element in place.
export function paintChip(el, status) {
  const c = chipParts(status);
  el.className = `chip ${c.cls}`;
  el.innerHTML = `${icon(c.icon)}${c.text}`;
}

export function formatWhen(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `היום ${time}`;
  return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`;
}
