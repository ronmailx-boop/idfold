// Vault state: the header (stored in the clear) and the data key (memory only).
import * as db from './db.js';
import * as c from './crypto.js';

let header = null;
let key = null;
const headerListeners = new Set();

// Called after the password or recovery code changes (the backup must carry the new header).
export function onHeaderChange(fn) { headerListeners.add(fn); }

// The header carries when it last changed, so the newest one wins between devices. The time is
// encrypted with the data key and bound to the wraps, so it can't be read or moved to other wraps.
const stampAad = (h) => `idfold-header:${JSON.stringify({ password: h.wraps?.password, recovery: h.wraps?.recovery })}`;

async function stamp(h, k) {
  const box = await c.encryptJson(k, Date.now(), stampAad(h));
  return { ...h, at: { iv: c.toB64(box.iv), ct: c.toB64(box.ct) } };
}

// When the header last changed (ms), or 0 if unknown. Needs the vault to be open.
export async function headerTime(h = header) {
  try {
    return await c.decryptJson(getKey(), { iv: c.fromB64(h.at.iv), ct: c.fromB64(h.at.ct) }, stampAad(h));
  } catch {
    return 0;
  }
}

async function saveHeader(next, k = key) {
  next = await stamp(next, k);
  await db.put('meta', { id: 'vault', data: next });
  header = next;
  for (const fn of headerListeners) fn();
}

// A newer header from another device (or from the backup when restoring), kept as it is.
export async function adoptHeader(next) {
  await db.put('meta', { id: 'vault', data: next });
  header = next;
}

export async function load() {
  header = (await db.get('meta', 'vault'))?.data || null;
  return header;
}

export const exists = () => !!header;
export const getHeader = () => header;
export const isOpen = () => !!key;

export function getKey() {
  if (!key) throw new Error('vault is locked');
  return key;
}

export async function create(password, recoveryCode) {
  // Drop anything stored before encryption existed (stage 1 data was not encrypted).
  for (const store of ['folders', 'docs', 'blobs']) await db.clear(store);
  await db.del('meta', 'sync');
  const vault = await c.createVault(password, recoveryCode);
  await saveHeader(vault.header, vault.key);
  key = vault.key;
}

// slot: 'password' | 'recovery'. Throws c.WrongSecretError on a wrong secret.
export async function unlock(slot, secret) {
  key = await c.openVault(header, slot, secret);
}

// Restoring on a new device: opens a backup's header. Nothing is saved until adoptHeader().
export async function unlockBackup(backupHeader, slot, secret) {
  key = await c.openVault(backupHeader, slot, secret);
}

// Throws c.WrongSecretError if the password is wrong.
export async function verifyPassword(password) {
  await c.openVault(header, 'password', password);
}

export function lock() {
  key = null;
}

export async function changePassword(auth, newPassword) {
  await saveHeader(await c.rewrapVault(header, auth, { password: newPassword }));
}

export async function replaceRecoveryCode(currentPassword, newCode) {
  await saveHeader(await c.rewrapVault(header, { slot: 'password', secret: currentPassword }, { recoveryCode: newCode }));
}
