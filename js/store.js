// Data layer: keeps decrypted items in memory and persists them through the codec.
// Records on disk are { id, data } so nothing but a random id is ever stored in the clear.
import * as db from './db.js';

// Stage 1 placeholder. Stage 2 replaces this with AES-256-GCM using the vault key.
const codec = {
  encode: async (item) => item,
  decode: async (data) => data
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

const folders = new Map();
const docs = new Map();
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }

async function loadStore(name, map) {
  map.clear();
  for (const rec of await db.getAll(name)) {
    const item = await codec.decode(rec.data);
    map.set(item.id, item);
  }
}

async function save(storeName, map, items) {
  const now = Date.now();
  const records = [];
  for (const item of items) {
    item.updatedAt = now;
    map.set(item.id, item);
    records.push({ id: item.id, data: await codec.encode(item) });
  }
  await db.putMany(storeName, records);
  emit();
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

// Trims, removes control characters and collapses whitespace.
export function cleanText(value, max = NAME_MAX) {
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

export async function wipeAll() {
  folders.clear();
  docs.clear();
  await db.destroy();
}
