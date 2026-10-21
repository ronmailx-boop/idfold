// Run with: npm test   (Node 20+, uses the built-in Web Crypto API)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../js/crypto.js';
import { passwordStrength } from '../js/strength.js';

const PASSWORD = 'סוס-ירוק אוכל 7 תפוחים';
const CODE = c.generateRecoveryCode();

const vaultPromise = c.createVault(PASSWORD, CODE);

test('header holds only public parameters', async () => {
  const { header } = await vaultPromise;
  assert.equal(header.v, 1);
  for (const slot of ['password', 'recovery']) {
    const w = header.wraps[slot];
    assert.equal(w.kdf.name, 'PBKDF2');
    assert.equal(w.kdf.hash, 'SHA-256');
    assert.ok(w.kdf.iterations >= 600000);
    assert.equal(c.fromB64(w.kdf.salt).length, 16);
    assert.equal(c.fromB64(w.iv).length, 12);
    assert.equal(c.fromB64(w.ct).length, 32 + 16); // DEK + GCM tag
  }
  const json = JSON.stringify(header);
  assert.ok(!json.includes(PASSWORD) && !json.includes(c.normalizeRecoveryCode(CODE)));
  assert.notEqual(header.wraps.password.kdf.salt, header.wraps.recovery.kdf.salt);
});

test('data key is not extractable', async () => {
  const { key } = await vaultPromise;
  assert.equal(key.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', key));
});

test('password and recovery code open the same key', async () => {
  const { header, key } = await vaultPromise;
  const box = await c.encryptJson(key, { name: 'דרכון' }, 'folders:1');
  const byPassword = await c.openVault(header, 'password', PASSWORD);
  const byCode = await c.openVault(header, 'recovery', CODE.toLowerCase().replace(/-/g, ' '));
  assert.deepEqual(await c.decryptJson(byPassword, box, 'folders:1'), { name: 'דרכון' });
  assert.deepEqual(await c.decryptJson(byCode, box, 'folders:1'), { name: 'דרכון' });
});

test('wrong password or code is rejected with WrongSecretError only', async () => {
  const { header } = await vaultPromise;
  await assert.rejects(c.openVault(header, 'password', PASSWORD + 'x'), c.WrongSecretError);
  await assert.rejects(c.openVault(header, 'password', ''), c.WrongSecretError);
  await assert.rejects(c.openVault(header, 'recovery', c.generateRecoveryCode()), c.WrongSecretError);
  // The password does not work in the recovery slot and vice versa.
  await assert.rejects(c.openVault(header, 'recovery', PASSWORD), c.WrongSecretError);
  await assert.rejects(c.openVault(header, 'password', CODE), c.WrongSecretError);
});

test('swapping wraps between slots fails', async () => {
  const { header } = await vaultPromise;
  const swapped = { ...header, wraps: { password: header.wraps.recovery, recovery: header.wraps.password } };
  await assert.rejects(c.openVault(swapped, 'password', c.normalizeRecoveryCode(CODE)), c.WrongSecretError);
});

test('weakened KDF parameters in a tampered header are refused', async () => {
  const { header } = await vaultPromise;
  const weak = structuredClone(header);
  weak.wraps.password.kdf.iterations = 1000;
  await assert.rejects(c.openVault(weak, 'password', PASSWORD), /unsupported/);
});

test('every encryption uses a fresh IV; tampering and wrong AAD fail', async () => {
  const { key } = await vaultPromise;
  const a = await c.encryptJson(key, { x: 1 }, 'docs:a');
  const b = await c.encryptJson(key, { x: 1 }, 'docs:a');
  assert.equal(a.iv.length, 12);
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(new Uint8Array(a.ct), new Uint8Array(b.ct));
  await assert.rejects(c.decryptJson(key, a, 'docs:b'));
  const bad = new Uint8Array(a.ct);
  bad[0] ^= 1;
  await assert.rejects(c.decryptJson(key, { iv: a.iv, ct: bad }, 'docs:a'));
  const other = await c.createVault('another-password-123', c.generateRecoveryCode());
  await assert.rejects(c.decryptJson(other.key, a, 'docs:a'));
});

test('changing the password re-wraps only the DEK', async () => {
  const { header, key } = await vaultPromise;
  const box = await c.encryptJson(key, { secret: 'id 123' }, 'docs:1');
  const next = await c.rewrapVault(header, { slot: 'password', secret: PASSWORD }, { password: 'new password 2026!' });
  await assert.rejects(c.openVault(next, 'password', PASSWORD), c.WrongSecretError);
  const k = await c.openVault(next, 'password', 'new password 2026!');
  assert.deepEqual(await c.decryptJson(k, box, 'docs:1'), { secret: 'id 123' }); // old data still opens
  assert.deepEqual(next.wraps.recovery, header.wraps.recovery);                   // recovery slot untouched
  await c.openVault(next, 'recovery', CODE);
});

test('re-wrapping requires the right current secret', async () => {
  const { header } = await vaultPromise;
  await assert.rejects(c.rewrapVault(header, { slot: 'password', secret: 'wrong' }, { password: 'x'.repeat(12) }), c.WrongSecretError);
});

test('password reset with the recovery code', async () => {
  const { header } = await vaultPromise;
  const next = await c.rewrapVault(header, { slot: 'recovery', secret: CODE }, { password: 'brand new pass 99' });
  await c.openVault(next, 'password', 'brand new pass 99');
});

test('a new recovery code replaces the old one', async () => {
  const { header } = await vaultPromise;
  const newCode = c.generateRecoveryCode();
  const next = await c.rewrapVault(header, { slot: 'password', secret: PASSWORD }, { recoveryCode: newCode });
  await assert.rejects(c.openVault(next, 'recovery', CODE), c.WrongSecretError);
  await c.openVault(next, 'recovery', newCode);
  await c.openVault(next, 'password', PASSWORD);
});

test('recovery code format', () => {
  const code = c.generateRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  assert.ok(c.isRecoveryCodeShape(code.toLowerCase()));
  assert.ok(!c.isRecoveryCodeShape('ABCD-EFGH'));
  assert.equal(c.normalizeRecoveryCode('o0il-1 ab'), '00111AB');
  assert.notEqual(c.generateRecoveryCode(), c.generateRecoveryCode());
});

test('password strength', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.ok(passwordStrength('aaaaaaaaaaaa').score < 2);
  assert.ok(passwordStrength('1234567890').score < 2);
  assert.ok(passwordStrength('password123').score < 2);
  assert.ok(passwordStrength('גשם בתל אביב 2026').score >= 3);
  assert.ok(passwordStrength('Tr0ub4dor&3xyz').score >= 3);
});

test('PIN wrap opens the same data key and rejects a wrong PIN', async () => {
  const { header, key } = await vaultPromise;
  const wrap = await c.wrapWithPin(header, PASSWORD, '482913');
  assert.ok(wrap.kdf.iterations >= 600000);
  assert.ok(!JSON.stringify(wrap).includes('482913'));
  const k = await c.openWithPin(wrap, '482913');
  const box = await c.encryptJson(key, { a: 1 }, 'x');
  assert.deepEqual(await c.decryptJson(k, box, 'x'), { a: 1 });
  await assert.rejects(c.openWithPin(wrap, '482914'), c.WrongSecretError);
  await assert.rejects(c.wrapWithPin(header, 'wrong password', '482913'), c.WrongSecretError);
});

test('PRF wrap opens the data key only with the same authenticator output', async () => {
  const { header, key } = await vaultPromise;
  const prf = c.randomBytes(32);
  const wrap = await c.wrapWithPrf(header, PASSWORD, prf);
  const k = await c.openWithPrf(wrap, prf);
  const box = await c.encryptJson(key, 'ok', 'y');
  assert.equal(await c.decryptJson(k, box, 'y'), 'ok');
  await assert.rejects(c.openWithPrf(wrap, c.randomBytes(32)), c.WrongSecretError);
});

test('a quick-unlock wrap cannot be used in another slot', async () => {
  const { header } = await vaultPromise;
  const wrap = await c.wrapWithPin(header, PASSWORD, '111111');
  const moved = { ...header, wraps: { ...header.wraps, password: wrap } };
  await assert.rejects(c.openVault(moved, 'password', '111111'), c.WrongSecretError);
});
