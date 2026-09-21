// The product film: a real screen recording of this build driving its own golden journey.
//
// Nothing here is staged. The script opens the front door against the running stack, asks the
// assistant a real question, opens the x-ray it read, lets it prepare the request, approves as
// the demo reviewer, watches the record enter the graph, then opens the decision's own ledger.
// Playwright records the tab; the only additions are a caption naming the beat on screen and a
// ring where each click lands, because a recording has no pointer. The manifest beside the
// recording carries the moment each beat began, so the page can seek to it.
//
//   pnpm film                # against http://localhost:3100 (web) and the API behind it
//   pnpm film --base URL --api URL   # other origins (web, API)
//
// Before recording, any open request about the story mare is closed through the API as the demo
// reviewer (the same step the journeys take), so the film shows the request being prepared
// rather than found. That needs the API's AUTH_SECRET from the root .env, as the journeys do.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const web = join(root, 'apps', 'web');
const require = createRequire(join(web, 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3100';
const api = args.includes('--api') ? args[args.indexOf('--api') + 1] : (process.env.API_URL ?? 'http://localhost:3101');

/** The API as the demo reviewer: the token the web app mints per request, from the same secret. */
function reviewerToken() {
  const envText = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '';
  const fromFile = Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const secret = process.env.AUTH_SECRET ?? fromFile.AUTH_SECRET ?? '';
  if (!secret)
    throw new Error('AUTH_SECRET is needed to close open requests before recording (root .env or the environment).');
  const b64 = (v) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      sub: 'usr_demo_reviewer',
      role: 'ADMIN',
      customerId: null,
      iss: 'daysheet-web',
      aud: 'daysheet-api',
      iat: now,
      exp: now + 300,
    }),
  );
  return `${header}.${payload}.${b64(createHmac('sha256', secret).update(`${header}.${payload}`).digest())}`;
}

async function reviewerApi(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${reviewerToken()}`, 'Content-Type': 'application/json' },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}`);
  const text = await response.text();
  return text.length === 0 ? null : JSON.parse(text);
}

/** The precondition, made true: every open request citing the story mare is closed, with a note that says why. */
async function closeOpenRequestsAbout(recordId) {
  const rows = await reviewerApi('/requests');
  const open = rows.filter((r) => r.status === 'OPEN' && r.evidenceIds.includes(recordId));
  for (const row of open)
    await reviewerApi(`/requests/${row.id}/close`, {
      method: 'POST',
      json: { note: 'closed before the film was recorded, so it shows the request being prepared' },
    });
  return open.length;
}
const size = { width: 1280, height: 720 };
const outDir = join(web, 'public', 'film');
const workDir = join(root, '.film-work');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  recordVideo: { dir: workDir, size },
  colorScheme: 'dark',
});
const page = await context.newPage();
const started = Date.now();
const beats = [];
const at = () => Math.round(((Date.now() - started) / 1000) * 10) / 10;

/** A caption for the beat on screen: the only words the film adds. A navigation drops it; `again` puts it back without a new beat. */
async function caption(label, again = false) {
  if (!again) beats.push({ at: at(), label });
  await page.evaluate((text) => {
    let el = document.getElementById('film-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'film-caption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '24px',
        bottom: '24px',
        zIndex: '99999',
        padding: '10px 14px',
        borderRadius: '10px',
        background: 'rgba(15,12,10,0.86)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: '#f3ede4',
        font: '600 13px/1.3 system-ui, sans-serif',
        letterSpacing: '0.02em',
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        transition: 'opacity 240ms ease-out',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = text;
      el.style.opacity = '1';
    }, 240);
  }, label);
}

/** Where the click lands: a ring for 700 ms, then the real click. */
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.evaluate(
      ({ x, y }) => {
        const ring = document.createElement('div');
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${x - 14}px`,
          top: `${y - 14}px`,
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          border: '2px solid #d48a60',
          boxShadow: '0 0 0 6px rgba(212,138,96,0.22)',
          zIndex: '99998',
          pointerEvents: 'none',
          transition: 'transform 300ms ease-out, opacity 300ms ease-out',
        });
        document.body.appendChild(ring);
        setTimeout(() => {
          ring.style.transform = 'scale(0.6)';
          ring.style.opacity = '0';
        }, 400);
        setTimeout(() => ring.remove(), 800);
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    await page.waitForTimeout(650);
  }
  await locator.click();
}

const settle = (ms) => page.waitForTimeout(ms);
/** Scrolls a section under the fixed top bar, the way a person would leave it. */
const scrollTo = async (selector) => {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: 'smooth' });
  }, selector);
  await settle(900);
};

try {
  const story = await reviewerApi('/story');
  const closed = await closeOpenRequestsAbout(story.recip.id);
  if (closed > 0) console.log(`closed ${closed} open request(s) about ${story.recip.id} before recording`);

  // 01 · the records already exist: the threshold, walked through at a reader's pace
  // The built threshold, asked for by name: under automation the page would otherwise draw the cheaper one.
  await page.goto(`${base}/?scene=3d`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.getByRole('heading', { name: /The records already exist/ }).waitFor();
  await page.locator('[data-testid="ranch"][data-scene="3d"] canvas').waitFor({ timeout: 60_000 });
  await settle(1500);
  const decisionFrame = await page.getByTestId('story-decision').innerText();
  if (/already open/i.test(decisionFrame))
    throw new Error(
      'The story mare still has an open request; the API may be serving a stale read. Restart it and run again.',
    );
  await caption('01 · The records already exist');
  await settle(1600);
  const poster = join(outDir, 'journey-poster.jpg');
  await page.screenshot({ path: poster, type: 'jpeg', quality: 82 });
  const range = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="ranch"]');
    return el ? el.getBoundingClientRect().height + window.scrollY - window.innerHeight : 0;
  });
  for (let i = 1; i <= 10; i += 1) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), Math.round((range * i) / 10));
    await settle(i === 4 ? 1400 : 700);
  }
  await settle(1800);
  await scrollTo('[data-testid="converge"]');
  await settle(2400);

  // 02 · what needs the vet: the answer is a worklist
  await caption('02 · What needs the vet today? — the answer is a worklist');
  await scrollTo('#ask');
  await settle(1000);
  const recip = (await page.getByTestId('story-prompts').innerText()).match(/R-\d{4,6}/)?.[0];
  if (!recip) throw new Error('No story mare in the prompts.');
  await click(page.getByTestId('story-prompts').getByRole('button', { name: 'What needs the vet today?' }));
  await page.getByTestId('answer-rows').waitFor({ timeout: 60_000 });
  await settle(3600);

  // 03 · why she cannot leave
  await caption(`03 · Why can't ${recip} leave?`);
  await click(page.getByTestId('story-prompts').getByRole('button', { name: `Why can't ${recip} leave?` }));
  await page.getByTestId('investigation-conclusion').waitFor({ timeout: 60_000 });
  await settle(3000);

  // 04 · the x-ray
  await caption('04 · It shows its work: her records, the rules, the person it waits for');
  await click(page.getByTestId('answer-peek').first());
  await settle(5200);

  // 05 · prepare, then a person decides
  await scrollTo('#ask');
  await settle(400);
  await caption('05 · Ask prepares the next step — and stops');
  await click(page.getByTestId('answer-action-prepare_vet_request'));
  await page.getByTestId('decision-approve').waitFor({ timeout: 60_000 });
  await page.getByTestId('decision-after').waitFor({ timeout: 30_000 });
  await scrollTo('#decide');
  await settle(3400);
  await caption('06 · A person approves, under their name');
  await settle(1000);
  await click(page.getByTestId('decision-approve'));
  await page.getByTestId('story-outcome').waitFor({ timeout: 60_000 });
  await settle(2000);
  const outcome = await page.getByTestId('story-outcome').innerText();
  const requestId = outcome.match(/RQ-\d{2}-\d{4,6}/)?.[0] ?? null;

  // 06 · the record exists
  await caption(`07 · The record exists${requestId ? ` · ${requestId}` : ''} — and enters the x-ray`);
  await page.getByTestId('xray-new').waitFor({ timeout: 30_000 });
  await scrollTo('#xray');
  await settle(4200);

  // 07 · the ledger
  const ledgerHref = await page.getByTestId('decision-ledger-link').getAttribute('href');
  if (ledgerHref) {
    await caption('08 · Every decision. On record.');
    await page.goto(`${base}${ledgerHref}`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.getByTestId('decision-diff').waitFor({ timeout: 30_000 });
    await settle(600);
    await caption('08 · Every decision. On record.', true);
    await settle(5200);
  }
  const durationSec = at();
  await page.close();
  await context.close();
  await browser.close();

  const recorded = readdirSync(workDir).find((f) => f.endsWith('.webm'));
  if (!recorded) throw new Error('Playwright wrote no recording.');
  const file = join(outDir, 'journey.webm');
  copyFileSync(join(workDir, recorded), file);
  let commit = null;
  try {
    commit = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    commit = null;
  }
  // The beats as a captions track: the same words as the on-screen chip, for a reader and for the accessibility rule that asks for one.
  const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(3).padStart(6, '0')}`;
  const cues = beats
    .map((b, i) => `${i + 1}\n${clock(b.at)} --> ${clock(beats[i + 1]?.at ?? durationSec)}\n${b.label}\n`)
    .join('\n');
  writeFileSync(join(outDir, 'journey.vtt'), `WEBVTT\n\n${cues}`);
  const manifest = {
    file: 'film/journey.webm',
    poster: existsSync(poster) ? 'film/journey-poster.jpg' : null,
    captions: 'film/journey.vtt',
    recordedAt: new Date().toISOString(),
    commit,
    durationSec,
    width: size.width,
    height: size.height,
    beats,
  };
  writeFileSync(join(outDir, 'journey.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `film: ${file} · ${durationSec}s · ${(statSync(file).size / 1_048_576).toFixed(1)} MB · ${beats.length} beats`,
  );
  for (const b of beats) console.log(`  ${b.at.toFixed(1).padStart(5)}s  ${b.label}`);
} catch (error) {
  await browser.close().catch(() => undefined);
  console.error(`film failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
