// Renders the home-screen icons and the link preview image from img/anog-crest.png.
// Run with `node scripts/brand-assets.mjs`; the PNGs are committed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crest = `data:image/png;base64,${readFileSync(join(root, 'img/anog-crest.png')).toString('base64')}`;

const iconHtml = size => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: ${size}px; height: ${size}px; background: #0B1320; display: flex; align-items: center; justify-content: center; }
  img { width: 73%; height: 73%; object-fit: contain; }
</style></head><body><img src="${crest}" alt=""></body></html>`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;600;700&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap">
<style>html, body { margin: 0; }</style></head><body>
<div style="position: relative; width: 1200px; height: 630px; box-sizing: border-box; overflow: hidden; display: flex; align-items: center; gap: 64px; padding: 72px 96px; background: #0B1320; color: #ffffff; font-family: 'Sofia Sans', system-ui, sans-serif">
  <img src="${crest}" alt="" style="width: 360px; height: 360px; flex: none; object-fit: contain">
  <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
    <span style="align-self: flex-start; display: inline-flex; align-items: center; gap: 12px; padding: 6px 18px; border: 2px solid #FFC23D; border-radius: 6px; color: #FFC23D; font-size: 28px; font-weight: 700; letter-spacing: 0.14em"><span style="width: 14px; height: 14px; border-radius: 50%; background: #FFC23D"></span>LIVE SCORES</span>
    <h1 style="margin: 0; font-family: 'Sofia Sans Extra Condensed', 'Arial Narrow', sans-serif; font-size: 168px; font-weight: 800; line-height: 0.85; letter-spacing: 0.02em">ANOG</h1>
    <p style="margin: 0; font-size: 40px; font-weight: 600; line-height: 1.2; color: #A9B4C2">Every game, goal by goal</p>
  </div>
  <span aria-hidden="true" style="position: absolute; left: 0; right: 0; bottom: 0; height: 12px; background: #FFC23D"></span>
</div></body></html>`;

// Decoded, not just complete: a broken or undecodable crest rejects here instead of being photographed half-drawn.
const decodeImages = page => page.evaluate(() => Promise.all(
  [...document.images].map(img => img.decode().catch(error => {
    throw new Error(`image failed to decode: ${img.src.slice(0, 40)}: ${error.message}`);
  })),
));

const browser = await chromium.launch();
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(iconHtml(size));
    await decodeImages(page);
    await page.screenshot({ path: join(root, `img/icon-${size}.png`) });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(ogHtml, { waitUntil: 'networkidle' });
  await decodeImages(page);
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load("800 168px 'Sofia Sans Extra Condensed'", 'ANOG'),
      document.fonts.load("600 40px 'Sofia Sans'", 'Every game'),
      document.fonts.load("700 28px 'Sofia Sans'", 'LIVE SCORES'),
    ]);
    await document.fonts.ready;
  });
  const loaded = await page.evaluate(() => ({
    condensed: document.fonts.check("800 168px 'Sofia Sans Extra Condensed'", 'ANOG')
      && [...document.fonts].some(f => f.family.includes('Extra Condensed') && f.status === 'loaded'),
    sofia: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Sofia Sans' && f.status === 'loaded'),
  }));
  if (!loaded.condensed || !loaded.sofia) throw new Error(`fonts not loaded: ${JSON.stringify(loaded)}`);
  await page.screenshot({ path: join(root, 'img/og.png') });
} finally {
  await browser.close();
}
