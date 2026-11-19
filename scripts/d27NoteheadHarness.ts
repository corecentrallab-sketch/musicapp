/**
 * D27 PIXEL HARNESS — what the notation ACTUALLY measures, before and after.
 *
 * THE POINT (D27 spec §2). "The notes are readable now" is not a claim this
 * build is allowed to make on argument. This script renders the REAL documents
 * — the ones `AbcScoreView` hands the WebView, built by
 * `services/abcHtml.generateAbcHtml` / `generateAbcReaderHtml` — in a headless
 * Chromium at a REAL phone width and at 800×360 landscape, and reads back
 * `getBoundingClientRect()` for a notehead and for a staff (5 lines).
 *
 *   BEFORE = the CARD document in a full-screen box. That is exactly what vc61
 *            shipped as "full screen": `responsive: 'resize'` plus the
 *            `max-width: 100%` cap, so the tune re-flows to fit and nothing is
 *            ever drawn bigger.
 *   AFTER  = the READER document: `scale`, a fixed `staffwidth`, no width cap.
 *
 * WHY DEVICE EMULATION AND NOT `--window-size`. Chromium's headless window has
 * a floor of 500 px: asking for `--window-size=360,800` still laid the page out
 * at 500 CSS px (the first version of this harness reported `viewportWidth: 500`
 * for its "portrait" row, so the portrait number was a 500 px desktop number
 * with a phone label on it). Every screen here is measured through CDP
 * `Emulation.setDeviceMetricsOverride`, which sets the CSS viewport exactly, and
 * the row FAILS if the page's own `window.innerWidth` is not the width asked
 * for. Portrait is 393×852 — a current phone (iPhone 15 / Pixel 8 class), which
 * is also narrower than the 500 px the old harness silently used.
 *
 * It also counts bars per system, because §2 caps that at four, and reports
 * whether the drawing is wider than the phone (i.e. whether there is anything
 * to pan to).
 *
 * RUN:  bun scripts/d27NoteheadHarness.ts [--shots <dir>]
 * It is NOT part of `test:tier1` — it needs a browser, and the gate does not.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { generateAbcHtml, generateAbcReaderHtml, readerLayout, READER_SCALE } from '../src/services/abcHtml';
import { staffKeySignature, takeToAbc } from '../src/services/takeStaff';

const CHROME = process.env.D27_CHROME || '/usr/local/bin/chromium';
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A real 60-second take: 240 eighth notes, eighth = 0.25 s, 4/4 → 30 bars. */
function sixtySecondTakeAbc(): string {
  const scale = [0, 2, 4, 5, 7, 9, 11, 12];
  const notes = Array.from({ length: 240 }, (_, index) => ({
    midi: 60 + scale[index % scale.length],
    startSec: index * 0.25,
    durationSec: 0.24,
  }));
  return takeToAbc(notes, {
    signature: staffKeySignature(null),
    eighthSec: 0.25,
    title: 'D27 harness take',
  });
}

const MEASURE = `
<script>
(function () {
  function box(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  // The card at a phone width squashes a notehead below one CSS pixel, where the
  // rounded box reads 0 wide and looks like "no notehead at all". Keep the exact
  // numbers too, so the BEFORE row reports a size instead of a null.
  function exact(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  }
  function measure() {
    var out = { ok: false };
    var svg = document.querySelector('#paper svg');
    if (!svg) { out.error = 'no svg rendered'; return out; }
    var groups = Array.prototype.slice.call(svg.querySelectorAll('g'));
    var staffGroups = groups.filter(function (g) {
      return (g.getAttribute('class') || '').indexOf('abcjs-staff') >= 0;
    });
    // A staff group holds only the five lines: its box IS the staff height.
    out.staffCount = staffGroups.length;
    out.staff = box(staffGroups[0]);
    out.svg = box(svg);
    out.docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    out.viewportWidth = window.innerWidth;
    out.viewportHeight = window.innerHeight;

    // ── THE NOTEHEAD. Try the class abcjs gives it, then fall back to the
    // smallest filled path inside the first note group (a notehead is a closed
    // filled path; a stem is a stroked one).
    var candidates = svg.querySelectorAll('[data-name="notehead"], path.abcjs-notehead, .abcjs-notehead');
    var picked = null, how = null;
    if (candidates.length) { picked = candidates[0]; how = 'class'; }
    if (!picked) {
      var noteGroups = groups.filter(function (g) {
        var c = g.getAttribute('class') || '';
        return c.indexOf('abcjs-note') >= 0 && c.indexOf('abcjs-notehead') < 0;
      });
      for (var i = 0; i < noteGroups.length && !picked; i++) {
        var paths = noteGroups[i].querySelectorAll('path');
        for (var j = 0; j < paths.length; j++) {
          var b = paths[j].getBoundingClientRect();
          if (b.height > 1 && b.height < 40 && b.width > 1 && b.width < 40) {
            picked = paths[j];
            how = 'first-small-path-in-note-group';
            break;
          }
        }
      }
      // Still nothing in the 1–40 px band? Then the notehead really is smaller
      // than a pixel: take the first drawn path in the first note group anyway
      // and report its exact size, so BEFORE is a number and not a null.
      if (!picked) {
        for (var m = 0; m < noteGroups.length && !picked; m++) {
          var anyPaths = noteGroups[m].querySelectorAll('path');
          for (var n = 0; n < anyPaths.length; n++) {
            var raw = anyPaths[n].getBoundingClientRect();
            if (raw.width > 0 || raw.height > 0) {
              picked = anyPaths[n];
              how = 'sub-pixel-fallback-first-path-in-note-group';
              break;
            }
          }
        }
      }
    }
    out.notehead = box(picked);
    out.noteheadExact = exact(picked);
    out.noteheadHow = how;
    out.noteheadClass = picked ? picked.getAttribute('class') : null;

    // ── BARS PER SYSTEM: count the bar lines inside the first staff's line group.
    var bars = 0;
    var staff = staffGroups[0];
    if (staff && staff.parentNode) {
      var line = staff.parentNode;
      var all = line.querySelectorAll('*');
      for (var k = 0; k < all.length; k++) {
        var cls = all[k].getAttribute('class') || '';
        var name = all[k].getAttribute('data-name') || '';
        if (cls.indexOf('abcjs-bar') >= 0 || name === 'bar') bars++;
      }
    }
    out.barsInFirstSystem = bars;
    // …and the whole drawing, so the system count can be checked against it.
    out.barsTotal = svg.querySelectorAll('[class*="abcjs-bar"]').length;
    out.ok = !!(out.notehead && out.staff);
    return out;
  }
  // Render, then measure after layout settles.
  setTimeout(function () {
    var result;
    try { result = measure(); } catch (e) { result = { ok: false, error: String(e) }; }
    // base64: the dumped DOM HTML-escapes quotes, so plain JSON does not survive
    // the round trip out of the page.
    var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    var pre = document.createElement('pre');
    pre.id = 'd27-measure';
    pre.textContent = 'D27B64:' + encoded;
    document.body.appendChild(pre);
    document.title = 'D27B64:' + encoded;
  }, 400);
})();
</script>`;

function documentWithProbe(html: string): string {
  return html.replace('</body>', `${MEASURE}\n</body>`);
}

// ── CHROMIUM, DRIVEN OVER CDP ───────────────────────────────────────────────
// One browser for every row. `Emulation.setDeviceMetricsOverride` is what makes
// the CSS viewport exactly the width asked for — `--window-size` cannot go below
// 500 px in headless, which is the bug this harness used to report.

type Waiter = { resolve: (value: any) => void; reject: (error: unknown) => void };

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private waiting = new Map<number, Waiter>();
  private events = new Map<string, Array<(params: any) => void>>();

  constructor(url: string) {
    this.ws = new WebSocket(url);
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (event) => reject(event);
    });
    this.ws.onmessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const waiter = this.waiting.get(message.id);
        if (!waiter) return;
        this.waiting.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params);
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(event: string): Promise<any> {
    return new Promise((resolve) => {
      const listener = (params: any) => {
        const list = this.events.get(event) || [];
        this.events.set(event, list.filter((entry) => entry !== listener));
        resolve(params);
      };
      this.events.set(event, [...(this.events.get(event) || []), listener]);
    });
  }

  close(): void {
    try { this.ws.close(); } catch { /* already gone */ }
  }
}

let browser: ChildProcess | null = null;
let profileDir = '';

async function startBrowser(): Promise<number> {
  const port = 9500 + (process.pid % 400);
  profileDir = `/tmp/d27-chrome-${process.pid}`;
  browser = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--mute-audio',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return port;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('chromium did not open its debugging port');
}

function stopBrowser(): void {
  if (browser) browser.kill('SIGKILL');
  browser = null;
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}

async function measureAt(
  port: number,
  file: string,
  width: number,
  height: number,
  screenshot: string | null,
): Promise<Record<string, unknown>> {
  const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = new Cdp(created.webSocketDebuggerUrl);
  await cdp.open();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: width,
      screenHeight: height,
      positionX: 0,
      positionY: 0,
    });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `file://${file}` });
    await Promise.race([loaded, sleep(10000)]);

    let measured: Record<string, any> | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const title = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      const value = String(title?.result?.value ?? '');
      if (value.startsWith('D27B64:')) {
        measured = JSON.parse(Buffer.from(value.slice('D27B64:'.length), 'base64').toString('utf8'));
        break;
      }
      await sleep(100);
    }

    if (screenshot) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    }

    if (!measured) return { ok: false, error: 'the page never published a measurement' };
    // THE ROW IS ONLY AS GOOD AS ITS VIEWPORT. If the emulation did not take,
    // say so here rather than reporting a number measured at some other width.
    if (measured.viewportWidth !== width) {
      return {
        ...measured,
        ok: false,
        error: `emulation did not take: asked for ${width} CSS px, page laid out at ${measured.viewportWidth}`,
      };
    }
    return measured;
  } finally {
    cdp.close();
    try { await fetch(`http://127.0.0.1:${port}/json/close/${created.id}`); } catch { /* tab goes with the browser */ }
  }
}

const abc = sixtySecondTakeAbc();
const layout = readerLayout(READER_SCALE);
const variants: Array<{ name: string; html: string }> = [
  { name: 'before-card-document', html: generateAbcHtml(abc) },
  { name: 'after-reader-document', html: generateAbcReaderHtml(abc) },
];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const rows: Record<string, unknown> = {
  abcBars: (abc.match(/\|/g) || []).length,
  readerLayout: layout,
  emulation: 'CDP Emulation.setDeviceMetricsOverride (CSS px, mobile: true)',
  screens: {},
};

const port = await startBrowser();
try {
  for (const variant of variants) {
    const file = `/tmp/d27-${variant.name}.html`;
    writeFileSync(file, documentWithProbe(variant.html));
    const screens: Record<string, unknown> = {};
    for (const [label, width, height] of [
      ['portrait-393x852', 393, 852],
      ['landscape-800x360', 800, 360],
    ] as Array<[string, number, number]>) {
      const shot = SHOTS ? `${SHOTS}/d27-${variant.name}-${label}.png` : null;
      screens[label] = await measureAt(port, file, width, height, shot);
    }
    (rows.screens as Record<string, unknown>)[variant.name] = screens;
  }
} finally {
  stopBrowser();
}

console.log(JSON.stringify(rows, null, 2));
