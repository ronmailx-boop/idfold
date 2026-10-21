// Loads the bundled pdf.js on first use and renders pages to canvases.
let lib = null;

async function load() {
  if (!lib) {
    lib = import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
    lib.catch(() => { lib = null; });
  }
  return lib;
}

// bytes is copied, because pdf.js takes ownership of the buffer it gets.
export async function openPdf(bytes) {
  const pdfjs = await load();
  return pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false }).promise;
}

// Keeps a canvas well under the mobile Safari limit (~16M pixels).
const MAX_PIXELS = 12_000_000;

// Draws a page so the canvas is `width` device pixels wide.
export async function renderPage(page, canvas, width) {
  const base = page.getViewport({ scale: 1 });
  let scale = width / base.width;
  const area = base.width * base.height * scale * scale;
  if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}
