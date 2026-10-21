// Two-way encrypted sync with Google Drive:
//   IDfold/idfold-data.enc  vault header (KDF params + wrapped DEK) and the encrypted folders and documents
//   IDfold/files/<id>       each document's file: IV (12 bytes) followed by the AES-GCM ciphertext
// Only ciphertext leaves the device. Drive sees random ids, never names, notes or content.
// Each run: pull the data file if it changed, merge (newest updatedAt wins, tombstones included),
// download missing files, upload new files, upload the data file if this device is ahead, delete leftovers.
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
const RETRY_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
// Errors worth retrying by themselves (the rest need the user).
const TRANSIENT = new Set(['offline', 'rate', 'failed', 'quota']);

// Error codes shown to the user. Codes come from google.AuthError and drive.DriveError.
export const MESSAGES = {
  auth: 'צריך לאשר שוב את החיבור ל-Google. לחץ על "סנכרן עכשיו".',
  offline: 'אין חיבור לאינטרנט. הסנכרון יתבצע כשהחיבור יחזור.',
  quota: 'אין מספיק מקום פנוי ב-Google Drive. פנה מקום ונסה שוב.',
  rate: 'Google Drive עמוס כרגע. ננסה שוב בעוד כמה דקות.',
  foreign: 'בתיקיית IDfold ב-Google Drive יש גיבוי של כספת אחרת, ולכן החיבור בוטל כדי לא לדרוס אותו. כדי להשתמש בו במכשיר הזה, מחק את הנתונים במכשיר ובחר "יש לי גיבוי ב-Google Drive".',
  corrupt: 'הגיבוי ב-Google Drive פגום ולא ניתן לפתוח אותו.',
  denied: 'לא ניתנה הרשאה לשמור קבצים ב-Google Drive. נסה שוב וסמן את ההרשאה במסך של Google.',
  closed: 'ההתחברות ל-Google בוטלה.',
  popup: 'חלון ההתחברות של Google לא נפתח. אפשר חלונות קופצים ונסה שוב.',
  load: 'לא ניתן לטעון את ההתחברות של Google. בדוק את החיבור לאינטרנט.',
  failed: 'הסנכרון נכשל. ננסה שוב בקרוב.'
};

class SyncError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Persisted (encrypted) while connected:
// { email, rootId, filesId, dataId, dataVersion, pending, lastBackup }.
let state = null;
// phase: 'off' | 'pending' | 'busy' | 'synced'. error: a MESSAGES key or null.
// done/total: files moved in the current run.
let status = { phase: 'off', error: null, done: 0, total: 0 };
const listeners = new Set();
const noticeListeners = new Set();

let changeSeq = 0;
let timer = null;
let running = null;
let again = false;
let failures = 0;

export const getStatus = () => ({ ...status, email: state?.email || '', lastBackup: state?.lastBackup || 0 });
export const isConnected = () => !!state;

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// fn('header') when another device changed the password or the recovery code.
export function onNotice(fn) { noticeListeners.add(fn); }

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(getStatus());
}

async function saveState() {
  await db.put('meta', { id: 'sync', data: await encryptJson(vault.getKey(), state, STATE_AAD) });
}

store.onChange((info) => { if (!info?.remote) markDirty(); });
vault.onHeaderChange(markDirty);
addEventListener('online', () => soon());
// Back in the app: pick up what other devices changed meanwhile.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') soon();
});

// Call after the vault is unlocked and the store is loaded.
export async function init() {
  const rec = await db.get('meta', 'sync');
  state = rec ? await decryptJson(vault.getKey(), rec.data, STATE_AAD) : null;
  failures = 0;
  setStatus({ phase: state ? (state.pending ? 'pending' : 'synced') : 'off', error: null, done: 0, total: 0 });
  soon();
}

// Right after the unlock tap: renews the Google access while the tap still allows Google's window.
// If the browser blocks it, the status asks for a tap on "סנכרן עכשיו".
export function resume() {
  if (!state || google.currentToken()) return;
  backup({ interactive: true, quiet: true }).catch(() => {});
}

function markDirty() {
  if (!state || !vault.isOpen()) return;
  changeSeq++;
  if (!state.pending) {
    state.pending = true;
    saveState().catch(() => {});
  }
  if (status.phase !== 'busy') setStatus({ phase: 'pending' });
  schedule(DEBOUNCE_MS);
}

// Syncs shortly, if there is a token to do it with (no Google window without a tap).
function soon() {
  if (state && vault.isOpen() && google.currentToken() && navigator.onLine !== false) schedule(500);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => backup().catch(() => {}), ms);
}

// interactive: called from a tap, so a new Google token may be requested.
// quiet: a failed sign-in window is not reported as such (the user did not ask for it).
export function backup({ interactive = false, quiet = false } = {}) {
  if (!state) return Promise.resolve();
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = run(interactive, quiet).finally(() => {
    running = null;
    if (again && state) {
      again = false;
      schedule(DEBOUNCE_MS);
    }
  });
  return running;
}

async function run(interactive, quiet) {
  let token = google.currentToken();
  try {
    if (!token) {
      if (!interactive) throw new SyncError('auth');
      try {
        token = await google.requestToken(state.email);
      } catch (err) {
        throw quiet ? new SyncError('auth') : err;
      }
    }
    const seq = changeSeq;
    setStatus({ phase: 'busy', error: null, done: 0, total: 0 });
    let more;
    try {
      more = await syncWith(token);
    } catch (err) {
      // Something was removed in Drive (e.g. the folder was deleted): look everything up again.
      if (err.code !== 'notfound') throw err;
      Object.assign(state, { rootId: null, filesId: null, dataId: null, dataVersion: null });
      more = await syncWith(token);
    }
    if (more) again = true;
    state.lastBackup = Date.now();
    if (seq === changeSeq) state.pending = false;
    await saveState();
    failures = 0;
    setStatus({ phase: state.pending ? 'pending' : 'synced', error: null, done: 0, total: 0 });
  } catch (err) {
    const code = MESSAGES[err.code] ? err.code : 'failed';
    if (code === 'auth') google.dropToken();
    if (code === 'foreign') await forget();
    else if (state) {
      setStatus({ phase: 'pending', error: code, done: 0, total: 0 });
      // Offline queue: changes stay marked as pending (in the encrypted state) and are retried.
      if (TRANSIENT.has(code)) schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
    }
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
    Object.assign(state, { filesId: null, dataId: null, dataVersion: null });
  }
  if (!state.filesId || !(await drive.exists(token, state.filesId))) {
    state.filesId = await findOrCreateFolder(token, FILES_NAME, state.rootId);
  }
}

// The data file as stored in Drive: { app, v, header, data: { iv, ct } } (base64).
function parseBackup(buffer) {
  try {
    const file = JSON.parse(new TextDecoder().decode(buffer));
    if (file.app !== 'idfold' || !file.header?.wraps) throw new Error('format');
    return { header: file.header, box: { iv: fromB64(file.data.iv), ct: fromB64(file.data.ct) } };
  } catch {
    return null;
  }
}

// Returns null if there is no backup yet, 'same' if it did not change since the last run,
// or { header, snapshot, version }. A backup this key can't open belongs to another vault.
async function pull(token) {
  if (!state.dataId) {
    const [found] = await drive.listChildren(token, state.rootId, { name: DATA_NAME });
    if (!found) return null;
    state.dataId = found.id;
    state.dataVersion = null;
  }
  const version = await drive.version(token, state.dataId);
  if (version === state.dataVersion) return 'same';
  const backup = parseBackup(await drive.download(token, state.dataId));
  if (!backup) throw new SyncError('foreign');
  let snapshot;
  try {
    snapshot = await decryptJson(vault.getKey(), backup.box, DATA_AAD);
  } catch {
    throw new SyncError('foreign');
  }
  return { header: backup.header, snapshot, version };
}

// The newer header wins: a password changed on another device applies here too.
// Returns true if this device's header must be uploaded.
async function mergeHeader(remoteHeader) {
  const mine = vault.getHeader();
  const [localAt, remoteAt] = [await vault.headerTime(mine), await vault.headerTime(remoteHeader)];
  if (remoteAt > localAt) {
    await vault.adoptHeader(remoteHeader);
    for (const fn of noticeListeners) fn('header');
    return false;
  }
  return JSON.stringify(remoteHeader) !== JSON.stringify(mine);
}

// Pulls and merges until the backup holds still. Returns true if this device is ahead.
async function pullAndMerge(token, push) {
  for (let round = 0; round < 3; round++) {
    const remote = await pull(token);
    if (remote === null) return true;
    if (remote === 'same') return push;
    if (await mergeHeader(remote.header)) push = true;
    if (await store.merge(remote.snapshot)) push = true;
    state.dataVersion = remote.version;
  }
  return push;
}

async function syncWith(token) {
  await ensureFolders(token);
  let push = await pullAndMerge(token, state.pending);

  const live = new Set(store.docList().map((d) => d.id));
  const local = new Set(await db.keys('blobs'));
  const remoteFiles = new Map();
  const extra = [];
  for (const f of await drive.listChildren(token, state.filesId)) {
    if (live.has(f.name) && !remoteFiles.has(f.name)) remoteFiles.set(f.name, f.id);
    else extra.push(f);
  }
  const download = [...live].filter((id) => !local.has(id) && remoteFiles.has(id));
  const upload = [...live].filter((id) => local.has(id) && !remoteFiles.has(id));
  let done = 0;
  setStatus({ done, total: download.length + upload.length });

  for (const id of download) {
    try {
      await store.putDownloadedFile(id, await drive.download(token, remoteFiles.get(id)));
    } catch (err) {
      if (err instanceof drive.DriveError) throw err;
      // A damaged copy in Drive: skip it, the document keeps its details.
    }
    setStatus({ done: ++done });
  }
  // Files first, so the data file never lists a document whose file is missing in Drive.
  for (const id of upload) {
    const rec = await db.get('blobs', id);
    if (rec) await drive.upload(token, { name: id, parentId: state.filesId, body: new Blob([rec.data.iv, rec.data.ct]) });
    setStatus({ done: ++done });
  }

  // Another device may have written meanwhile (e.g. while files were moving): merge it first.
  const seen = state.dataVersion;
  if (push) push = await pullAndMerge(token, push);
  const late = state.dataVersion !== seen;
  if (push) {
    // A fresh IV on every write (encryptJson always draws a new one).
    const box = await encryptJson(vault.getKey(), store.snapshot(), DATA_AAD);
    const body = JSON.stringify({ app: 'idfold', v: 1, header: vault.getHeader(), data: { iv: toB64(box.iv), ct: toB64(box.ct) } });
    const file = await drive.upload(token, { id: state.dataId, name: DATA_NAME, parentId: state.rootId, body });
    state.dataId = file.id;
    state.dataVersion = file.version;
  }

  // Deleted documents (and any duplicates) are removed from Drive last.
  const liveNow = new Set(store.docList().map((d) => d.id));
  for (const f of extra) if (!liveNow.has(f.name) || remoteFiles.has(f.name)) await drive.remove(token, f.id);
  // Documents merged late may still need their files: one more round soon.
  return late;
}

// Called from a tap: signs in to Google and makes the first sync.
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
    // Only used for display and as a sign-in hint.
  }
  state = { email, rootId: null, filesId: null, dataId: null, dataVersion: null, pending: true, lastBackup: 0 };
  await saveState();
  changeSeq++;
  return backup({ interactive: true });
}

// ---------- Restore on a new device ----------

// Called from a tap: signs in and downloads the backup's data file.
// Returns null if this Google account has no backup, else { email, rootId, dataId, header, box }.
export async function findBackup() {
  const token = await google.requestToken();
  const email = await drive.userEmail(token).catch(() => '');
  const [root] = await drive.listChildren(token, 'root', { name: ROOT_NAME, mimeType: drive.FOLDER });
  const [file] = root ? await drive.listChildren(token, root.id, { name: DATA_NAME }) : [];
  if (!file) return null;
  const backup = parseBackup(await drive.download(token, file.id));
  if (!backup) throw new SyncError('corrupt');
  return { email, rootId: root.id, dataId: file.id, ...backup };
}

// After vault.unlockBackup(): stores the backup's folders and documents on this device, then
// syncs to download the files. The header is saved last, so an interrupted restore starts over.
export async function restore(found) {
  let snapshot;
  try {
    snapshot = await decryptJson(vault.getKey(), found.box, DATA_AAD);
  } catch {
    throw new SyncError('corrupt');
  }
  await store.importSnapshot(snapshot);
  state = { email: found.email, rootId: found.rootId, filesId: null, dataId: found.dataId, dataVersion: null, pending: false, lastBackup: 0 };
  await saveState();
  await vault.adoptHeader(found.header);
  return backup();
}

async function forget() {
  clearTimeout(timer);
  state = null;
  await db.del('meta', 'sync').catch(() => {});
  setStatus({ phase: 'off', error: 'foreign', done: 0, total: 0 });
}

// Stops syncing. The encrypted backup stays in Drive.
export async function disconnect() {
  clearTimeout(timer);
  await google.revoke().catch(() => {});
  state = null;
  await db.del('meta', 'sync');
  setStatus({ phase: 'off', error: null, done: 0, total: 0 });
}
