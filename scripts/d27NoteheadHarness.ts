/**
 * D27 PIXEL HARNESS — what the notation ACTUALLY measures, before and after.
 *
 * THE POINT (D27 spec §2). "The notes are readable now" is not a claim this
 * build is allowed to make on argument. This script renders the REAL documents
 * — the ones `AbcScoreView` hands the WebView, built by
 * `services/abcHtml.generateAbcHtml` / `generateAbcReaderHtml` — in a headless
 * Chromium at a 360×800 phone and at 800×360 landscape, and reads back
 * `getBoundingClientRect()` for a notehead and for a staff (5 lines).
 *
 *   BEFORE = the CARD document in a full-screen box. That is exactly what vc61
 *            shipped as "full screen": `responsive: 'resize'` plus the
 *            `max-width: 100%` cap, so the tune re-flows to fit and nothing is
 *            ever drawn bigger.
 *   AFTER  = the READER document: `scale`, a fixed `staffwidth`, no width cap.
 *
 * It also counts bars per system, because §2 caps that at four, and reports
 * whether the drawing is wider than the phone (i.e. whether there is anything
 * to pan to).
 *
 * RUN:  bun scripts/d27NoteheadHarness.ts [--shots <dir>]
 * It is NOT part of `test:tier1` — it needs a browser, and the gate does not.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateAbcHtml, generateAbcReaderHtml, readerLayout, READER_SCALE } from '../src/services/abcHtml';
import { staffKeySignature, takeToAbc } from '../src/services/takeStaff';

const CHROME = process.env.D27_CHROME || '/usr/local/bin/chromium';
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;

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
    }
    out.notehead = box(picked);
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

function runChrome(file: string, width: number, height: number, screenshot: string | null) {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=8000',
    '--dump-dom',
  ];
  if (screenshot) args.push(`--screenshot=${screenshot}`);
  args.push(`file://${file}`);
  const run = spawnSync(CHROME, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = `${run.stdout || ''}${run.stderr || ''}`;
  const match = dom.match(/D27B64:([A-Za-z0-9+/=]+)/);
  if (!match) return { ok: false, error: 'no measurement in the dumped DOM', tail: dom.slice(-400) };
  try {
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } catch (error) {
    return { ok: false, error: `unparseable measurement: ${String(error)}` };
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
  screens: {},
};
for (const variant of variants) {
  const file = `/tmp/d27-${variant.name}.html`;
  writeFileSync(file, documentWithProbe(variant.html));
  const screens: Record<string, unknown> = {};
  for (const [label, width, height] of [
    ['portrait-360x800', 360, 800],
    ['landscape-800x360', 800, 360],
  ] as Array<[string, number, number]>) {
    const shot = SHOTS ? `${SHOTS}/d27-${variant.name}-${label}.png` : null;
    screens[label] = runChrome(file, width, height, shot);
  }
  (rows.screens as Record<string, unknown>)[variant.name] = screens;
}

console.log(JSON.stringify(rows, null, 2));
