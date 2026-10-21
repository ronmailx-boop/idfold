// Locks the vault after some minutes without use (in the app or in the background).
// The choice is stored encrypted on this device (meta/prefs).
import * as db from './db.js';
import * as vault from './vault.js';
import { encryptJson, decryptJson } from './crypto.js';

export const CHOICES = [1, 5, 15, 60];
const DEFAULT_MINUTES = 5;
const PREFS_AAD = 'meta:prefs';
const CHECK_MS = 15_000;

let minutes = DEFAULT_MINUTES;
let lastUse = Date.now();
let onLock = null;
let interval = null;

const touch = () => { lastUse = Date.now(); };
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) {
  addEventListener(type, touch, { capture: true, passive: true });
}

function check() {
  if (onLock && Date.now() - lastUse >= minutes * 60_000) {
    const fn = onLock;
    stop();
    fn();
  }
}

// Timers sleep in the background, so the time is checked again on return.
document.addEventListener('visibilitychange', () => {
  // Hides the vault from the app switcher's preview while away.
  document.body.classList.toggle('away', document.visibilityState === 'hidden' && !!onLock);
  if (document.visibilityState === 'visible') check();
});

async function loadPrefs() {
  const rec = await db.get('meta', 'prefs');
  return rec ? await decryptJson(vault.getKey(), rec.data, PREFS_AAD) : {};
}

// Call after unlocking. lockFn runs once, when the time is up.
export async function start(lockFn) {
  const prefs = await loadPrefs().catch(() => ({}));
  minutes = CHOICES.includes(prefs.autoLock) ? prefs.autoLock : DEFAULT_MINUTES;
  touch();
  onLock = lockFn;
  clearInterval(interval);
  interval = setInterval(check, CHECK_MS);
}

// The "lock now" button.
export function lockNow() {
  const fn = onLock;
  stop();
  fn?.();
}

export function stop() {
  clearInterval(interval);
  interval = null;
  onLock = null;
  document.body.classList.remove('away');
}

export const getMinutes = () => minutes;

export async function setMinutes(value) {
  if (!CHOICES.includes(value)) return;
  minutes = value;
  touch();
  await db.put('meta', { id: 'prefs', data: await encryptJson(vault.getKey(), { autoLock: value }, PREFS_AAD) });
}

export function label(value = minutes) {
  return value === 1 ? 'אחרי דקה בלי שימוש' : value === 60 ? 'אחרי שעה בלי שימוש' : `אחרי ${value} דקות בלי שימוש`;
}
