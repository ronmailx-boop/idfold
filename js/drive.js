// Minimal Google Drive v3 REST client. Only sees files this app created (drive.file scope).
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';
const BINARY = 'application/octet-stream';
const MAX_RETRIES = 4;

// code: 'auth' (token expired or revoked), 'quota' (Drive is full), 'rate' (still rate limited
// after retries), 'offline', 'notfound', 'failed'.
export class DriveError extends Error {
  constructor(code) { super(code); this.name = 'DriveError'; this.code = code; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function reasonOf(res) {
  try {
    const body = await res.json();
    return String(body.error?.errors?.[0]?.reason || body.error?.status || '');
  } catch {
    return '';
  }
}

// fetch with the token, retrying rate limits and server errors with exponential backoff.
async function call(token, url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    } catch {
      throw new DriveError('offline');
    }
    if (res.ok) return res;
    const reason = await reasonOf(res);
    if (res.status === 401) throw new DriveError('auth');
    if (res.status === 404) throw new DriveError('notfound');
    if (/storageQuota|quotaExceeded/i.test(reason)) throw new DriveError('quota');
    const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(reason));
    if (!retry) throw new DriveError('failed');
    if (attempt === MAX_RETRIES) throw new DriveError('rate');
    await wait(2 ** attempt * 1000 + Math.random() * 500);
  }
}

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export async function userEmail(token) {
  const res = await call(token, `${API}/about?fields=user(emailAddress)`);
  return (await res.json()).user?.emailAddress || '';
}

// Lists a folder's files: [{ id, name }].
export async function listChildren(token, parentId, { name, mimeType } = {}) {
  let q = `${quote(parentId)} in parents and trashed = false`;
  if (name) q += ` and name = ${quote(name)}`;
  if (mimeType) q += ` and mimeType = ${quote(mimeType)}`;
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '1000', fields: 'nextPageToken,files(id,name)' });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await (await call(token, `${API}/files?${params}`)).json();
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files;
}

// True if the file exists and is not in the trash.
export async function exists(token, id) {
  try {
    const res = await call(token, `${API}/files/${encodeURIComponent(id)}?fields=trashed`);
    return !(await res.json()).trashed;
  } catch (err) {
    if (err.code === 'notfound') return false;
    throw err;
  }
}

// The file's version, which grows on every change. Throws 'notfound' if it was deleted or trashed.
export async function version(token, id) {
  const res = await call(token, `${API}/files/${encodeURIComponent(id)}?fields=trashed,version`);
  const body = await res.json();
  if (body.trashed) throw new DriveError('notfound');
  return String(body.version);
}

export async function createFolder(token, name, parentId) {
  const res = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
  });
  return (await res.json()).id;
}

// Resumable upload (works for any size). Creates the file, or replaces its content if id is given.
// Returns { id, version }.
export async function upload(token, { id, name, parentId, body }) {
  const blob = body instanceof Blob ? body : new Blob([body]);
  const start = await call(token, id
    ? `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=id,version`
    : `${UPLOAD}/files?uploadType=resumable&fields=id,version`, {
    method: id ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': BINARY,
      'X-Upload-Content-Length': String(blob.size)
    },
    body: JSON.stringify(id ? {} : { name, parents: [parentId], mimeType: BINARY })
  });
  const session = start.headers.get('Location');
  if (!session) throw new DriveError('failed');
  const res = await call(token, session, { method: 'PUT', headers: { 'Content-Type': BINARY }, body: blob });
  const file = await res.json();
  return { id: file.id, version: String(file.version) };
}

export async function download(token, id) {
  const res = await call(token, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  return res.arrayBuffer();
}

export async function remove(token, id) {
  try {
    await call(token, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (err.code !== 'notfound') throw err;
  }
}
