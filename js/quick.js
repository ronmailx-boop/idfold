// Quick unlock on this device: a PIN, or the device's fingerprint/face unlock (WebAuthn PRF).
// Kept in its own record (meta/quick), never in the vault header, so it never reaches Drive.
// It holds only wraps of the data key; the DEK itself is never stored in the clear.
// Record: { pin?: { wrap, fails }, bio?: { credId, evalSalt, wrap }, passwordAt }
import * as db from './db.js';
import * as vault from './vault.js';
import * as c from './crypto.js';

export const PIN_MIN = 6;
export const PIN_MAX = 12;
export const MAX_PIN_FAILS = 5;
// The full password is asked for now and then, so it is not forgotten.
const PASSWORD_EVERY_MS = 14 * 24 * 60 * 60 * 1000;

// code: 'unsupported' (no fingerprint/face unlock with PRF here), 'cancelled', 'failed',
// 'pin-locked' (too many wrong PINs; PIN unlock was turned off).
export class QuickError extends Error {
  constructor(code) { super(code); this.name = 'QuickError'; this.code = code; }
}

let rec = null;

export async function load() {
  rec = (await db.get('meta', 'quick'))?.data || null;
  return rec;
}

async function save(next) {
  rec = next;
  if (next && (next.pin || next.bio || next.passwordAt)) await db.put('meta', { id: 'quick', data: next });
  else await db.del('meta', 'quick');
}

export const hasPin = () => !!rec?.pin;
export const hasBio = () => !!rec?.bio;
// True when the lock screen should ask for the full password this time.
export const passwordDue = () => (hasPin() || hasBio()) && Date.now() - (rec?.passwordAt || 0) > PASSWORD_EVERY_MS;

export async function passwordUsed() {
  await save({ ...rec, passwordAt: Date.now() });
}

export const isPinShape = (pin) => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

// ---------- PIN ----------

export async function enablePin(password, pin) {
  const wrap = await c.wrapWithPin(vault.getHeader(), password, pin);
  await save({ ...rec, pin: { wrap, fails: 0 }, passwordAt: Date.now() });
}

export async function disablePin() {
  const { pin, ...rest } = rec || {};
  await save(rest);
}

// Throws c.WrongSecretError (wrong PIN) or QuickError('pin-locked').
export async function unlockPin(pin) {
  if (!rec?.pin) throw new QuickError('pin-locked');
  // Counted before trying, so closing the app mid-try does not reset the count.
  const fails = rec.pin.fails + 1;
  await save({ ...rec, pin: { ...rec.pin, fails } });
  try {
    vault.openWith(await c.openWithPin(rec.pin.wrap, pin));
  } catch (err) {
    if (err instanceof c.WrongSecretError && fails >= MAX_PIN_FAILS) {
      await disablePin();
      throw new QuickError('pin-locked');
    }
    throw err;
  }
  await save({ ...rec, pin: { ...rec.pin, fails: 0 } });
}

export const pinTriesLeft = () => MAX_PIN_FAILS - (rec?.pin?.fails || 0);

// ---------- Fingerprint / face unlock (WebAuthn PRF) ----------

export async function bioAvailable() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    const caps = await PublicKeyCredential.getClientCapabilities?.().catch(() => null);
    if (caps && caps['extension:prf'] === false) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function webauthnError(err) {
  if (err instanceof QuickError) return err;
  return new QuickError(err?.name === 'NotAllowedError' || err?.name === 'AbortError' ? 'cancelled' : 'failed');
}

async function prfOutput(credId, evalSalt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: c.randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: c.fromB64(credId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: c.fromB64(evalSalt) } } }
    }
  });
  const first = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new QuickError('unsupported');
  return new Uint8Array(first);
}

// Enabling takes up to two taps, since each fingerprint prompt needs its own tap on some
// browsers: createBio() makes the passkey (and may already return the key), readBio() gets it.
// Call vault.verifyPassword() first, so the fingerprint is not asked for in vain.
export async function createBio() {
  const evalSalt = c.toB64(c.randomBytes(32));
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'IDfold', id: location.hostname },
        user: { id: c.randomBytes(16), name: 'IDfold', displayName: 'IDfold' },
        challenge: c.randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: c.fromB64(evalSalt) } } }
      }
    });
    const prf = cred.getClientExtensionResults?.().prf;
    if (!prf?.enabled) throw new QuickError('unsupported');
    const first = prf.results?.first;
    return { credId: c.toB64(cred.rawId), evalSalt, out: first ? new Uint8Array(first) : null };
  } catch (err) {
    throw webauthnError(err);
  }
}

export async function readBio(pending) {
  try {
    return await prfOutput(pending.credId, pending.evalSalt);
  } catch (err) {
    throw webauthnError(err);
  }
}

export async function saveBio(password, pending, out) {
  try {
    const wrap = await c.wrapWithPrf(vault.getHeader(), password, out);
    await save({ ...rec, bio: { credId: pending.credId, evalSalt: pending.evalSalt, wrap }, passwordAt: Date.now() });
  } finally {
    out.fill(0);
  }
}

export async function disableBio() {
  const { bio, ...rest } = rec || {};
  await save(rest);
}

// Must be called from a tap.
export async function unlockBio() {
  if (!rec?.bio) throw new QuickError('failed');
  let out;
  try {
    out = await prfOutput(rec.bio.credId, rec.bio.evalSalt);
  } catch (err) {
    throw webauthnError(err);
  }
  try {
    vault.openWith(await c.openWithPrf(rec.bio.wrap, out));
  } catch {
    throw new QuickError('failed');
  } finally {
    out.fill(0);
  }
}
