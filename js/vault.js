// Vault state: the header (stored in the clear) and the data key (memory only).
import * as db from './db.js';
import * as c from './crypto.js';

let header = null;
let key = null;

async function saveHeader(next) {
  await db.put('meta', { id: 'vault', data: next });
  header = next;
}

export async function load() {
  header = (await db.get('meta', 'vault'))?.data || null;
  return header;
}

export const exists = () => !!header;
export const isOpen = () => !!key;

export function getKey() {
  if (!key) throw new Error('vault is locked');
  return key;
}

export async function create(password, recoveryCode) {
  // Drop anything stored before encryption existed (stage 1 data was not encrypted).
  for (const store of ['folders', 'docs', 'blobs']) await db.clear(store);
  const vault = await c.createVault(password, recoveryCode);
  await saveHeader(vault.header);
  key = vault.key;
}

// slot: 'password' | 'recovery'. Throws c.WrongSecretError on a wrong secret.
export async function unlock(slot, secret) {
  key = await c.openVault(header, slot, secret);
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
