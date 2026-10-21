// Vault cryptography. Pure Web Crypto, no DOM, so it also runs under Node for tests.
//
// A random 256-bit data key (DEK) encrypts everything with AES-256-GCM.
// The DEK is stored only wrapped (AES-GCM) by keys derived with PBKDF2-SHA256
// from the password and from the recovery code. The header holding the wraps
// and KDF parameters contains no secret and may be stored in the clear.

export const KDF_ITERATIONS = 600_000;
const MIN_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEK_BYTES = 32;
const HEADER_VERSION = 1;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class WrongSecretError extends Error {
  constructor() { super('wrong secret'); this.name = 'WrongSecretError'; }
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

// ---------- Key derivation and wrapping ----------

async function deriveKek(secret, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Binds each wrap to its slot so a wrap can't be moved to the other slot.
const slotAad = (slot) => enc.encode(`idfold/v${HEADER_VERSION}/dek/${slot}`);

async function wrapDek(rawDek, secret, slot) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveKek(secret, salt, KDF_ITERATIONS);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: slotAad(slot) }, kek, rawDek);
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ct: toB64(ct)
  };
}

function checkKdf(kdf) {
  if (kdf?.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS) {
    throw new Error('unsupported vault header');
  }
}

async function decryptWrap(kek, wrap, slot) {
  try {
    const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrap.iv), additionalData: slotAad(slot) }, kek, fromB64(wrap.ct));
    return new Uint8Array(raw);
  } catch {
    // GCM tag mismatch: wrong secret. Nothing else is revealed.
    throw new WrongSecretError();
  }
}

// Returns the raw DEK bytes. The caller must wipe them (fill(0)) when done.
async function unwrapRawDek(header, slot, secret) {
  const wrap = header?.wraps?.[slot];
  if (header?.v !== HEADER_VERSION) throw new Error('unsupported vault header');
  checkKdf(wrap?.kdf);
  return decryptWrap(await deriveKek(secret, fromB64(wrap.kdf.salt), wrap.kdf.iterations), wrap, slot);
}

function importDek(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Creates a new vault. Returns { header, key } where key is a non-extractable CryptoKey.
export async function createVault(password, recoveryCode) {
  const raw = randomBytes(DEK_BYTES);
  try {
    const header = {
      v: HEADER_VERSION,
      wraps: {
        password: await wrapDek(raw, password, 'password'),
        recovery: await wrapDek(raw, normalizeRecoveryCode(recoveryCode), 'recovery')
      }
    };
    return { header, key: await importDek(raw) };
  } finally {
    raw.fill(0);
  }
}

// slot: 'password' | 'recovery'. Throws WrongSecretError on a wrong secret.
export async function openVault(header, slot, secret) {
  const raw = await unwrapRawDek(header, slot, slot === 'recovery' ? normalizeRecoveryCode(secret) : secret);
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

// Re-wraps the same DEK with new secrets; files are not re-encrypted.
// auth: { slot, secret } proving access. changes: { password?, recoveryCode? }
export async function rewrapVault(header, auth, changes) {
  const secret = auth.slot === 'recovery' ? normalizeRecoveryCode(auth.secret) : auth.secret;
  const raw = await unwrapRawDek(header, auth.slot, secret);
  try {
    const wraps = { ...header.wraps };
    if (changes.password) wraps.password = await wrapDek(raw, changes.password, 'password');
    if (changes.recoveryCode) wraps.recovery = await wrapDek(raw, normalizeRecoveryCode(changes.recoveryCode), 'recovery');
    return { ...header, wraps };
  } finally {
    raw.fill(0);
  }
}

// ---------- Quick unlock (local only, never synced) ----------
// The same DEK, wrapped once more on this device: by a PIN (PBKDF2, like the password) or by
// a key from the device's fingerprint/face unlock (WebAuthn PRF output through HKDF).
// Creating either needs the password, since the DEK in memory can't be exported.

export async function wrapWithPin(header, password, pin) {
  const raw = await unwrapRawDek(header, 'password', password);
  try {
    return await wrapDek(raw, pin, 'pin');
  } finally {
    raw.fill(0);
  }
}

// Throws WrongSecretError on a wrong PIN.
export async function openWithPin(wrap, pin) {
  checkKdf(wrap?.kdf);
  const raw = await decryptWrap(await deriveKek(pin, fromB64(wrap.kdf.salt), wrap.kdf.iterations), wrap, 'pin');
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

// prfOutput: the 32 bytes the authenticator returns for this app's salt.
async function prfKek(prfOutput, salt) {
  const base = await subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`idfold/v${HEADER_VERSION}/prf`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapWithPrf(header, password, prfOutput) {
  const raw = await unwrapRawDek(header, 'password', password);
  try {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: slotAad('prf') }, await prfKek(prfOutput, salt), raw);
    return { kdf: { name: 'HKDF', hash: 'SHA-256', salt: toB64(salt) }, iv: toB64(iv), ct: toB64(ct) };
  } finally {
    raw.fill(0);
  }
}

export async function openWithPrf(wrap, prfOutput) {
  const raw = await decryptWrap(await prfKek(prfOutput, fromB64(wrap.kdf.salt)), wrap, 'prf');
  try {
    return await importDek(raw);
  } finally {
    raw.fill(0);
  }
}

// ---------- Data encryption ----------

// aad binds the ciphertext to its record (e.g. "folders:<id>") so records can't be swapped.
export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes);
  return { iv, ct };
}

export async function decryptBytes(key, { iv, ct }, aad) {
  return subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, ct);
}

export async function encryptJson(key, value, aad) {
  return encryptBytes(key, enc.encode(JSON.stringify(value)), aad);
}

export async function decryptJson(key, box, aad) {
  return JSON.parse(dec.decode(await decryptBytes(key, box, aad)));
}

// ---------- Recovery code ----------

// Crockford base32: no I, L, O, U. 24 characters = 120 random bits.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 24;

export function generateRecoveryCode() {
  // 256 is a multiple of 32, so masking keeps the distribution uniform.
  const chars = [...randomBytes(CODE_LENGTH)].map((b) => CODE_ALPHABET[b & 31]).join('');
  return chars.match(/.{4}/g).join('-');
}

// Uppercases, drops separators and maps look-alike characters.
export function normalizeRecoveryCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export function isRecoveryCodeShape(input) {
  const n = normalizeRecoveryCode(input);
  return n.length === CODE_LENGTH && [...n].every((c) => CODE_ALPHABET.includes(c));
}
