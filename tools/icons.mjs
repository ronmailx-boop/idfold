// Renders the PNG app icons from icons/icon.svg and icons/icon-maskable.svg.
// Run: npm run icons (needs Playwright with Chromium installed).
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = [
  { src: 'icons/icon.svg', file: 'icons/icon-192.png', size: 192 },
  { src: 'icons/icon.svg', file: 'icons/icon-512.png', size: 512 },
  { src: 'icons/icon-maskable.svg', file: 'icons/icon-maskable-512.png', size: 512 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { src, file, size } of OUT) {
  const svg = await readFile(new URL(`../${src}`, import.meta.url), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../${file}`, import.meta.url).pathname, omitBackground: true });
  console.log(file);
}
await browser.close();
