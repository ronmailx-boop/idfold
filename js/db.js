// Thin promise wrapper around IndexedDB. Every record is { id, data }.
const DB_NAME = 'idfold';
const DB_VERSION = 1;
const STORES = ['meta', 'folders', 'docs', 'blobs'];

let dbPromise = null;

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function tx(store, mode) {
  return (await open()).transaction(store, mode).objectStore(store);
}

export async function getAll(store) {
  return done((await tx(store, 'readonly')).getAll());
}

export async function get(store, id) {
  return done((await tx(store, 'readonly')).get(id));
}

export async function putMany(store, records) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  for (const r of records) os.put(r);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function put(store, record) {
  return putMany(store, [record]);
}

export async function destroy() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await done(indexedDB.deleteDatabase(DB_NAME));
}
