// Data layer: keeps decrypted items in memory and persists them encrypted.
// Records on disk are { id, data: { iv, ct } }; only the random id is stored in the clear.
import * as db from './db.js';
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from './crypto.js';
import { getKey } from './vault.js';

const codec = {
  encode: (storeName, item) => encryptJson(getKey(), item, `${storeName}:${item.id}`),
  decode: (storeName, rec) => decryptJson(getKey(), rec.data, `${storeName}:${rec.id}`)
};

const DEFAULT_FOLDERS = [
  { name: 'דרכון', icon: 'passport', color: 'purple' },
  { name: 'תעודת זהות', icon: 'idcard', color: 'blue' },
  { name: 'רישיון נהיגה', icon: 'wheel', color: 'orange' },
  { name: 'רכב', icon: 'car', color: 'teal' },
  { name: 'בריאות', icon: 'heart', color: 'pink' },
  { name: 'אחר', icon: 'folder', color: 'gray', keep: true }
];

export const NAME_MAX = 40;
export const NOTE_MAX = 300;
export const URL_MAX = 2000;
export const MSG_MAX = 2000;

const folders = new Map();
const docs = new Map();
const listeners = new Set();

// Listeners get { remote: true } when the change came from another device (the sync merge).
export function onChange(fn) { listeners.add(fn); }
function emit(info = {}) { for (const fn of listeners) fn(info); }

async function loadStore(name, map) {
  map.clear();
  for (const rec of await db.getAll(name)) {
    const item = await codec.decode(name, rec);
    map.set(item.id, item);
  }
}

async function save(storeName, map, items, info) {
  const now = Date.now();
  const records = [];
  for (const item of items) {
    item.updatedAt = now;
    map.set(item.id, item);
    records.push({ id: item.id, data: await codec.encode(storeName, item) });
  }
  await db.putMany(storeName, records);
  emit(info);
}

export async function init() {
  await loadStore('folders', folders);
  await loadStore('docs', docs);
  if (folders.size === 0) {
    const now = Date.now();
    await save('folders', folders, DEFAULT_FOLDERS.map((f, i) => ({
      id: crypto.randomUUID(), order: i, createdAt: now, keep: false, ...f
    })));
  }
}

// Trims, removes control characters and collapses whitespace (keeps line breaks if multiline).
export function cleanText(value, max = NAME_MAX, multiline = false) {
  if (multiline) {
    return String(value ?? '').split(/\r?\n/).map((line) => cleanText(line, max)).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  }
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function folderList() {
  return [...folders.values()].filter((f) => !f.deleted).sort((a, b) => a.order - b.order);
}

export function getFolder(id) {
  const f = folders.get(id);
  return f && !f.deleted ? f : null;
}

function otherFolder() {
  return folderList().find((f) => f.keep);
}

export function docCount(folderId) {
  let n = 0;
  for (const d of docs.values()) if (!d.deleted && (!folderId || d.folderId === folderId)) n++;
  return n;
}

export async function createFolder({ name, icon, color }) {
  const order = Math.max(-1, ...folderList().map((f) => f.order)) + 1;
  const folder = { id: crypto.randomUUID(), name: cleanText(name), icon, color, order, keep: false, createdAt: Date.now() };
  await save('folders', folders, [folder]);
  return folder;
}

export async function updateFolder(id, patch) {
  const f = getFolder(id);
  if (!f) return;
  const next = { ...f };
  if ('name' in patch) next.name = cleanText(patch.name);
  if ('icon' in patch) next.icon = patch.icon;
  if ('color' in patch) next.color = patch.color;
  await save('folders', folders, [next]);
}

export async function reorderFolders(ids) {
  const changed = [];
  ids.forEach((id, i) => {
    const f = getFolder(id);
    if (f && f.order !== i) changed.push({ ...f, order: i });
  });
  if (changed.length) await save('folders', folders, changed);
}

// Moves the folder's documents to "אחר" and leaves a tombstone for sync.
export async function deleteFolder(id) {
  const f = getFolder(id);
  const other = otherFolder();
  if (!f || f.keep || !other) return;
  const moved = [...docs.values()]
    .filter((d) => !d.deleted && d.folderId === id)
    .map((d) => ({ ...d, folderId: other.id }));
  if (moved.length) await save('docs', docs, moved);
  await save('folders', folders, [{ id, deleted: true }]);
}

// ---------- Documents ----------
// A document is { id, folderId, name, note, expiry ('YYYY-MM-DD' or ''), mime, size, thumb (data URL or ''), createdAt }.
// Its file is a separate encrypted record in 'blobs' with the same id.
// A payment (kind 'bill') adds { url, msg, amount, paidAt }: expiry is its due date, and the file is
// optional (mime '' and size 0 when there is none).

const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Only https links are kept (no javascript:, data: and the like).
export function cleanUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > URL_MAX) return '';
  try {
    const u = new URL(text);
    return u.protocol === 'https:' && u.hostname ? u.href : '';
  } catch {
    return '';
  }
}

// "1,234.5" → "1234.50"; anything else → ''.
export function cleanAmount(value) {
  const text = String(value ?? '').replace(/[₪,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return '';
  return Number(text).toFixed(2);
}

function cleanDocFields(patch) {
  const out = {};
  if ('name' in patch) out.name = cleanText(patch.name) || 'מסמך';
  if ('note' in patch) out.note = cleanText(patch.note, NOTE_MAX, true);
  if ('expiry' in patch) out.expiry = EXPIRY_RE.test(patch.expiry || '') ? patch.expiry : '';
  if ('folderId' in patch && getFolder(patch.folderId)) out.folderId = patch.folderId;
  if ('url' in patch) out.url = cleanUrl(patch.url);
  if ('msg' in patch) out.msg = cleanText(patch.msg, MSG_MAX, true);
  if ('amount' in patch) out.amount = cleanAmount(patch.amount);
  if ('paidAt' in patch) out.paidAt = Number.isFinite(patch.paidAt) && patch.paidAt > 0 ? patch.paidAt : 0;
  return out;
}

export const isBill = (doc) => doc?.kind === 'bill';
export const hasFile = (doc) => !!doc?.mime;

export function getDoc(id) {
  const d = docs.get(id);
  return d && !d.deleted ? d : null;
}

// Newest first.
export function docList(folderId) {
  return [...docs.values()]
    .filter((d) => !d.deleted && (!folderId || d.folderId === folderId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

const fold = (s) => s.toLowerCase().replace(/[֑-ׇ]/g, '');

const host = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

// Every word of the query must appear in the name, the note, or a payment's message or site.
export function searchDocs(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return docList().filter((d) => {
    const text = fold(`${d.name} ${d.note} ${d.msg || ''} ${d.url ? host(d.url) : ''}`);
    return words.every((w) => text.includes(w));
  });
}

export async function addDoc({ folderId, name, note, expiry, mime, thumb }, bytes) {
  const doc = {
    id: crypto.randomUUID(), folderId: null, name: '', note: '', expiry: '',
    mime, size: bytes.byteLength, thumb: thumb || '', createdAt: Date.now(),
    ...cleanDocFields({ folderId, name, note, expiry })
  };
  if (!doc.folderId) throw new Error('unknown folder');
  // File first: a document record never points at a missing file.
  await db.put('blobs', { id: doc.id, data: await encryptBytes(getKey(), bytes, `blobs:${doc.id}`) });
  await save('docs', docs, [doc]);
  return doc;
}

// Unpaid payments: overdue and soonest first, those without a due date last.
export function unpaidBills() {
  return docList().filter((d) => isBill(d) && !d.paidAt)
    .sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || b.createdAt - a.createdAt);
}

// file is null or { bytes, mime, thumb }.
export async function addBill({ folderId, name, note, expiry, url, msg, amount }, file) {
  const doc = {
    id: crypto.randomUUID(), kind: 'bill', folderId: null, name: '', note: '', expiry: '',
    url: '', msg: '', amount: '', paidAt: 0,
    mime: file?.mime || '', size: file?.bytes.byteLength || 0, thumb: file?.thumb || '', createdAt: Date.now(),
    ...cleanDocFields({ folderId, name, note, expiry, url, msg, amount })
  };
  if (!doc.folderId) throw new Error('unknown folder');
  if (file) await db.put('blobs', { id: doc.id, data: await encryptBytes(getKey(), file.bytes, `blobs:${doc.id}`) });
  await save('docs', docs, [doc]);
  return doc;
}

// Attaches a file to a payment that has none. (A replaced file would not reach the backup:
// the sync uploads a file only when Drive has none under that id.)
export async function attachFile(id, { bytes, mime, thumb }) {
  const d = getDoc(id);
  if (!d || hasFile(d)) return;
  await db.put('blobs', { id, data: await encryptBytes(getKey(), bytes, `blobs:${id}`) });
  await save('docs', docs, [{ ...d, mime, size: bytes.byteLength, thumb: thumb || '' }]);
}

export async function updateDoc(id, patch) {
  const d = getDoc(id);
  if (!d) return;
  await save('docs', docs, [{ ...d, ...cleanDocFields(patch) }]);
}

export async function deleteDoc(id) {
  if (!getDoc(id)) return;
  await save('docs', docs, [{ id, deleted: true }]);
  await db.del('blobs', id);
}

// Decrypts a document's file. Returns an ArrayBuffer.
export async function readFile(id) {
  const rec = await db.get('blobs', id);
  if (!rec) throw new Error('file missing');
  return decryptBytes(getKey(), rec.data, `blobs:${id}`);
}

// Every folder and document, tombstones included (for the backup).
export function snapshot() {
  return { folders: [...folders.values()], docs: [...docs.values()] };
}

// ---------- Sync merge ----------

const ID_RE = /^[0-9a-f-]{36}$/;
const pick = (item, keys) => Object.fromEntries(keys.filter((k) => k in item).map((k) => [k, item[k]]));

// Items from the backup are checked like any other input before they are stored or shown.
function cleanRemote(kind, item) {
  if (!item || typeof item.id !== 'string' || !ID_RE.test(item.id) || !Number.isFinite(item.updatedAt)) return null;
  if (item.deleted) return { id: item.id, deleted: true, updatedAt: item.updatedAt };
  if (kind === 'folders') {
    return {
      ...pick(item, ['icon', 'color', 'order', 'createdAt', 'updatedAt']),
      id: item.id, name: cleanText(item.name), keep: item.keep === true
    };
  }
  const doc = {
    ...pick(item, ['folderId', 'mime', 'size', 'thumb', 'createdAt', 'updatedAt']),
    id: item.id,
    name: cleanText(item.name) || 'מסמך',
    note: cleanText(item.note, NOTE_MAX, true),
    expiry: EXPIRY_RE.test(item.expiry || '') ? item.expiry : '',
    thumb: typeof item.thumb === 'string' && item.thumb.startsWith('data:image/jpeg;base64,') ? item.thumb : ''
  };
  if (item.kind === 'bill') {
    Object.assign(doc, { kind: 'bill', ...cleanDocFields({ url: item.url, msg: item.msg, amount: item.amount, paidAt: item.paidAt }) });
  }
  return doc;
}

// Merges another device's folders and documents: for each id the newest updatedAt wins, deletions
// included. Returns true if this device has changes the other side doesn't (they need uploading).
export async function merge(remote) {
  let ahead = false;
  let changed = false;
  const dropped = [];
  for (const [kind, map] of [['folders', folders], ['docs', docs]]) {
    const theirs = new Map();
    for (const raw of Array.isArray(remote?.[kind]) ? remote[kind] : []) {
      const item = cleanRemote(kind, raw);
      if (item) theirs.set(item.id, item);
    }
    const records = [];
    for (const item of theirs.values()) {
      const mine = map.get(item.id);
      if (mine && mine.updatedAt >= item.updatedAt) {
        if (mine.updatedAt > item.updatedAt) ahead = true;
        continue;
      }
      map.set(item.id, item);
      records.push({ id: item.id, data: await codec.encode(kind, item) });
      if (kind === 'docs' && item.deleted) dropped.push(item.id);
    }
    for (const id of map.keys()) if (!theirs.has(id)) ahead = true;
    if (records.length) {
      await db.putMany(kind, records);
      changed = true;
    }
  }
  for (const id of dropped) await db.del('blobs', id);
  // A folder deleted on one device while a document was moved into it on another.
  const other = otherFolder();
  const orphans = [...docs.values()].filter((d) => !d.deleted && !getFolder(d.folderId));
  if (other && orphans.length) {
    await save('docs', docs, orphans.map((d) => ({ ...d, folderId: other.id })), { remote: true });
    ahead = true;
  } else if (changed) {
    emit({ remote: true });
  }
  return ahead;
}

// New device: replaces everything here with the backup's folders and documents.
export async function importSnapshot(remote) {
  folders.clear();
  docs.clear();
  for (const name of ['folders', 'docs', 'blobs']) await db.clear(name);
  await merge(remote);
}

// Saves a document's file as downloaded from the backup (IV followed by the ciphertext).
// The file is decrypted once to make sure it is whole and belongs to this document.
export async function putDownloadedFile(id, buffer) {
  const data = { iv: new Uint8Array(buffer.slice(0, 12)), ct: buffer.slice(12) };
  await decryptBytes(getKey(), data, `blobs:${id}`);
  await db.put('blobs', { id, data });
}

// Forgets all decrypted data (on lock).
export function clearMemory() {
  folders.clear();
  docs.clear();
}

export async function wipeAll() {
  folders.clear();
  docs.clear();
  await db.destroy();
}
