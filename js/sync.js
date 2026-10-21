// One-way encrypted backup to Google Drive:
//   IDfold/idfold-data.enc  vault header (KDF params + wrapped DEK) and the encrypted folders and documents
//   IDfold/files/<id>       each document's file: IV (12 bytes) followed by the AES-GCM ciphertext
// Only ciphertext leaves the device. Drive sees random ids, never names, notes or content.
import * as db from './db.js';
import * as store from './store.js';
import * as vault from './vault.js';
import * as google from './google.js';
import * as drive from './drive.js';
import { encryptJson, decryptJson, toB64, fromB64 } from './crypto.js';

const ROOT_NAME = 'IDfold';
const FILES_NAME = 'files';
const DATA_NAME = 'idfold-data.enc';
const DATA_AAD = 'idfold-data';
const STATE_AAD = 'meta:sync';
const DEBOUNCE_MS = 4000;

// Error codes shown to the user. Codes come from google.AuthError and drive.DriveError.
export const MESSAGES = {
  auth: 'צריך לאשר שוב את החיבור ל-Google. לחץ על "סנכרן עכשיו".',
  offline: 'אין חיבור לאינטרנט. הגיבוי יתבצע כשהחיבור יחזור.',
  quota: 'אין מספיק מקום פנוי ב-Google Drive. פנה מקום ונסה שוב.',
  rate: 'Google Drive עמוס כרגע. נסה שוב בעוד כמה דקות.',
  foreign: 'בתיקיית IDfold ב-Google Drive יש גיבוי של כספת אחרת. כדי לא לדרוס אותו, החיבור בוטל.',
  denied: 'לא ניתנה הרשאה לשמור קבצים ב-Google Drive. נסה שוב וסמן את ההרשאה במסך של Google.',
  closed: 'ההתחברות ל-Google בוטלה.',
  popup: 'חלון ההתחברות של Google לא נפתח. אפשר חלונות קופצים ונסה שוב.',
  load: 'לא ניתן לטעון את ההתחברות של Google. בדוק את החיבור לאינטרנט.',
  failed: 'הגיבוי נכשל. נסה שוב.'
};

class ForeignVaultError extends Error {
  constructor() { super('foreign'); this.code = 'foreign'; }
}

// Persisted (encrypted) while connected: { email, rootId, filesId, dataId, pending, lastBackup }.
let state = null;
// phase: 'off' | 'pending' | 'busy' | 'synced'. error: a MESSAGES key or null.
let status = { phase: 'off', error: null, done: 0, total: 0 };
const listeners = new Set();

let changeSeq = 0;
let timer = null;
let running = null;
let again = false;

export const getStatus = () => ({ ...status, email: state?.email || '', lastBackup: state?.lastBackup || 0 });
export const isConnected = () => !!state;

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(getStatus());
}

async function saveState() {
  await db.put('meta', { id: 'sync', data: await encryptJson(vault.getKey(), state, STATE_AAD) });
}

let watching = false;
// Call after the vault is unlocked and the store is loaded.
export async function init() {
  const rec = await db.get('meta', 'sync');
  state = rec ? await decryptJson(vault.getKey(), rec.data, STATE_AAD) : null;
  setStatus({ phase: state ? (state.pending ? 'pending' : 'synced') : 'off', error: null });
  if (!watching) {
    watching = true;
    store.onChange(markDirty);
    vault.onHeaderChange(markDirty);
    addEventListener('online', () => {
      if (state?.pending && google.currentToken()) schedule();
    });
  }
  if (state?.pending && google.currentToken()) schedule();
}

function markDirty() {
  if (!state || !vault.isOpen()) return;
  changeSeq++;
  if (!state.pending) {
    state.pending = true;
    saveState().catch(() => {});
  }
  if (status.phase !== 'busy') setStatus({ phase: 'pending' });
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => backup().catch(() => {}), DEBOUNCE_MS);
}

// interactive: called from a tap, so a new Google token may be requested.
export function backup({ interactive = false } = {}) {
  if (!state) return Promise.resolve();
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = run(interactive).finally(() => {
    running = null;
    if (again && state) {
      again = false;
      schedule();
    }
  });
  return running;
}

async function run(interactive) {
  let token = google.currentToken();
  try {
    if (!token) {
      if (!interactive) throw Object.assign(new Error('auth'), { code: 'auth' });
      token = await google.requestToken();
    }
    const seq = changeSeq;
    setStatus({ phase: 'busy', error: null, done: 0, total: 0 });
    try {
      await upload(token);
    } catch (err) {
      // Something was removed in Drive (e.g. the folder was deleted): look everything up again.
      if (err.code !== 'notfound') throw err;
      Object.assign(state, { rootId: null, filesId: null, dataId: null });
      await upload(token);
    }
    state.lastBackup = Date.now();
    if (seq === changeSeq) state.pending = false;
    await saveState();
    setStatus({ phase: state.pending ? 'pending' : 'synced', error: null });
  } catch (err) {
    const code = MESSAGES[err.code] ? err.code : 'failed';
    if (code === 'auth') google.dropToken();
    if (code === 'foreign') await forget();
    else setStatus({ phase: 'pending', error: code });
    throw Object.assign(err, { code });
  }
}

async function findOrCreateFolder(token, name, parentId) {
  const [found] = await drive.listChildren(token, parentId, { name, mimeType: drive.FOLDER });
  return found ? found.id : drive.createFolder(token, name, parentId);
}

async function ensureFolders(token) {
  if (!state.rootId || !(await drive.exists(token, state.rootId))) {
    state.rootId = await findOrCreateFolder(token, ROOT_NAME, 'root');
    state.filesId = null;
    state.dataId = null;
  }
  if (!state.filesId || !(await drive.exists(token, state.filesId))) {
    state.filesId = await findOrCreateFolder(token, FILES_NAME, state.rootId);
  }
  if (!state.dataId) {
    // A backup already there must belong to this vault, or it would be overwritten.
    const [found] = await drive.listChildren(token, state.rootId, { name: DATA_NAME });
    if (found) {
      try {
        const remote = JSON.parse(new TextDecoder().decode(await drive.download(token, found.id)));
        await decryptJson(vault.getKey(), { iv: fromB64(remote.data.iv), ct: fromB64(remote.data.ct) }, DATA_AAD);
      } catch (err) {
        if (err instanceof drive.DriveError) throw err;
        throw new ForeignVaultError();
      }
      state.dataId = found.id;
    }
  }
}

async function upload(token) {
  await ensureFolders(token);

  // Files first, so the data file never lists a document whose file is missing in Drive.
  const live = new Set(store.docList().map((d) => d.id));
  const remote = await drive.listChildren(token, state.filesId);
  const have = new Set();
  const extra = [];
  for (const f of remote) {
    if (live.has(f.name) && !have.has(f.name)) have.add(f.name);
    else extra.push(f.id);
  }
  const missing = [...live].filter((id) => !have.has(id));
  setStatus({ done: 0, total: missing.length });
  for (const [i, id] of missing.entries()) {
    const rec = await db.get('blobs', id);
    if (rec) {
      await drive.upload(token, { name: id, parentId: state.filesId, body: new Blob([rec.data.iv, rec.data.ct]) });
    }
    setStatus({ done: i + 1 });
  }

  // A fresh IV on every write (encryptJson always draws a new one).
  const box = await encryptJson(vault.getKey(), store.snapshot(), DATA_AAD);
  const body = JSON.stringify({ app: 'idfold', v: 1, header: vault.getHeader(), data: { iv: toB64(box.iv), ct: toB64(box.ct) } });
  state.dataId = await drive.upload(token, { id: state.dataId, name: DATA_NAME, parentId: state.rootId, body });

  // Deleted documents (and any duplicates) are removed from Drive last.
  for (const id of extra) await drive.remove(token, id);
}

// Called from a tap: signs in to Google and makes the first backup.
export async function connect() {
  let token;
  try {
    setStatus({ error: null });
    token = await google.requestToken();
  } catch (err) {
    setStatus({ phase: 'off', error: MESSAGES[err.code] ? err.code : 'failed' });
    throw err;
  }
  let email = '';
  try {
    email = await drive.userEmail(token);
  } catch {
    // Only used for display.
  }
  state = { email, rootId: null, filesId: null, dataId: null, pending: true, lastBackup: 0 };
  await saveState();
  changeSeq++;
  return backup({ interactive: true });
}

async function forget() {
  clearTimeout(timer);
  state = null;
  await db.del('meta', 'sync').catch(() => {});
  setStatus({ phase: 'off', error: 'foreign', done: 0, total: 0 });
}

// Stops backing up. The encrypted backup stays in Drive.
export async function disconnect() {
  clearTimeout(timer);
  await google.revoke().catch(() => {});
  state = null;
  await db.del('meta', 'sync');
  setStatus({ phase: 'off', error: null, done: 0, total: 0 });
}
