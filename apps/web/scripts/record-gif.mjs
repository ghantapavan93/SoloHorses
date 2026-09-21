// Records the README's ten-second GIF from the running stack: the story page, the exception
// drawer, one question the assistant abstains on. No ffmpeg: frames are Playwright
// screenshots, quantized and encoded in pure JS.
//
// Usage: node scripts/record-gif.mjs [out=../../docs/demo.gif]   (web on WEB_URL, default :3100)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, applyPalette, quantize } = gifenc; // CommonJS package
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? '../../docs/demo.gif');
const VIEWPORT = { width: 1120, height: 640 };
const FPS = 4;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light' });
const frames = [];
const grab = async (seconds) => {
  const count = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < count; i += 1) {
    frames.push(await page.screenshot({ type: 'png' }));
    await page.waitForTimeout(1000 / FPS);
  }
};

await page.goto(`${WEB_URL}/story`, { waitUntil: 'networkidle' });
await page.getByText('Needs a person').waitFor();
await grab(1.5);

// The recipient conflict, then its evidence: the rule that fired.
await page.getByRole('button', { name: /she cannot be held for/ }).click();
await page.getByText('The rule that fired').waitFor();
await grab(2.5);
await page.keyboard.press('Escape');
await grab(0.5);

// The question the assistant must not answer on its own.
const recipId = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/R-\d{4,6}/)?.[0];
await page.getByRole('button', { name: `Is ${recipId} cleared for a transfer?` }).click();
await page
  .getByText(/Veterinary review is required/)
  .first()
  .waitFor({ timeout: 20_000 });
await grab(4.5);

await browser.close();

const gif = GIFEncoder();
for (const [i, png] of frames.entries()) {
  const { width, height, data } = PNG.sync.read(png);
  const palette = quantize(data, 256, { format: 'rgb444' });
  const index = applyPalette(data, palette, 'rgb444');
  // Hold the first and last frames so a loop reads as a scene, not a flicker.
  const delay = i === 0 || i === frames.length - 1 ? 1200 : Math.round(1000 / FPS);
  gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
}
gif.finish();
mkdirSync(dirname(OUT), { recursive: true });
const bytes = gif.bytes();
writeFileSync(OUT, bytes);
console.log(`${OUT}: ${frames.length} frames, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
