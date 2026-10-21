// Prepares a picked file for the vault: images are resized and re-encoded
// (which also strips EXIF data such as GPS location), PDFs are kept as they are.
import { openPdf, renderPage } from './pdf.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.88;
const THUMB_W = 128;
const THUMB_H = 160;

const EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' };

// Some pickers leave file.type empty, so fall back to the extension.
export function fileMime(file) {
  if (file.type === 'application/pdf' || file.type.startsWith('image/')) return file.type;
  return EXT_MIME[file.name.split('.').pop().toLowerCase()] || '';
}

export const isPdf = (mime) => mime === 'application/pdf';

// File name without its extension, as a default document name.
export function baseName(file) {
  return file.name.replace(/\.[^.]+$/, '');
}

function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img).finally(() => URL.revokeObjectURL(url));
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

// Centre-cropped JPEG thumbnail as a data URL.
function thumbnail(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const s = Math.max(THUMB_W / w, THUMB_H / h);
  ctx.drawImage(source, (THUMB_W - w * s) / 2, (THUMB_H - h * s) / 2, w * s, h * s);
  return canvas.toDataURL('image/jpeg', 0.7);
}

async function prepareImage(file, mime) {
  let img;
  try {
    img = await loadImage(file);
  } catch {
    // The browser can't decode it (e.g. HEIC on Android): keep the original file.
    return { bytes: await file.arrayBuffer(), mime, thumb: '' };
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await canvasBlob(canvas, JPEG_QUALITY);
  return { bytes: await blob.arrayBuffer(), mime: 'image/jpeg', thumb: thumbnail(canvas, canvas.width, canvas.height) };
}

async function preparePdf(file) {
  const bytes = await file.arrayBuffer();
  let thumb = '';
  let pdf;
  try {
    pdf = await openPdf(bytes);
    const page = await pdf.getPage(1);
    const canvas = document.createElement('canvas');
    await renderPage(page, canvas, THUMB_W * 2);
    thumb = thumbnail(canvas, canvas.width, canvas.height);
  } catch {
    // No preview (e.g. a password-protected PDF); the file itself is still stored.
  } finally {
    pdf?.destroy();
  }
  return { bytes, mime: 'application/pdf', thumb };
}

export function prepareFile(file) {
  const mime = fileMime(file);
  return isPdf(mime) ? preparePdf(file) : prepareImage(file, mime);
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
