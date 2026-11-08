/**
 * vc52DeviceRepairs.test.ts — THE vc52 DEVICE REPAIRS (owner v51 handset pass,
 * 2026-11-08: 3 of the 5 release-gate rows FAILED).
 *
 * THE SIX DEFECTS, EACH WITH THE TEST THAT WOULD HAVE CAUGHT IT:
 *
 *   1. A5 "did not appear in history" — the take was lost across a force-quit and
 *      the app said it had saved it.
 *         → `saveIsVerifiedByReadBack` (the store re-reads what it wrote) +
 *           `saveFailureIsLoud` (the screen says so in a card with a retry) +
 *           the pure `practiceVideoSaveState`.
 *   2. B1 "Black screen" on Watch-with-notes.
 *         → `playbackChecksTheFileExists` + `videoMountPaintsAFrame` + the pure
 *           `practiceVideoPlaybackPlan`.
 *   3. C1 / "light blue text … almost impossible to read".
 *         → the REAL literals of the REAL screen, run through the REAL remapper,
 *           with WCAG contrast measured in both themes; plus `surfaceInkIsThemed`.
 *   4. The trim editor sat a screenful below the video.
 *         → `trimEditorSitsUnderTheVideo`.
 *   5. A4 "the video plays it back as a whole video".
 *         → the pure `trimPlaybackAction` (seek / stop / free) +
 *           `playbackHonoursTheWindow` + `copyNeverClaimsTheFileWasCut`.
 *   6. The build stamp could not be found.
 *         → `stampIsFindableInSettings` (+ the v43 guards still green).
 *
 * EVERY guard is proven to bite twice: here, by mutating the real bytes IN MEMORY
 * (so the regression is permanent in the gate), and once ON DISK during the build,
 * with the failing output captured in /home/team/shared/vc52-mutation-probes.txt.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  TRIM_VIDEO_WHOLE_LINE,
  normaliseTrimSpan,
  trimPlaybackAction,
  trimPlaybackWindowLine,
  trimWindowStartMs,
} from '../src/services/takeClipTag';
import {
  PRACTICE_VIDEO_SAVE_CONFIRMED_LINE,
  PRACTICE_VIDEO_SAVE_FAILED_HEADLINE,
  PRACTICE_VIDEO_FILE_GONE_LINE,
  practiceVideoPlaybackPlan,
  practiceVideoSaveState,
} from '../src/services/practiceVideoRef';
import { themedSheet } from '../src/services/themeApply';
import { DARK_THEME, LIGHT_THEME } from '../src/services/theme';
import {
  AA_TEXT_MIN,
  VC52_APPLY_PATH,
  VC52_CLIP_MODULE_PATH,
  VC52_SCREEN_PATH,
  VC52_SETTINGS_PATH,
  VC52_STORE_PATH,
  contrastRatio,
  copyNeverClaimsTheFileWasCut,
  playbackChecksTheFileExists,
  playbackHonoursTheWindow,
  relativeLuminance,
  saveFailureIsLoud,
  saveIsVerifiedByReadBack,
  stampIsFindableInSettings,
  surfaceInkIsThemed,
  trimEditorSitsUnderTheVideo,
  videoMountPaintsAFrame,
} from '../src/services/vc52DeviceContract';
import { homeCarriesNoBuildStamp, settingsShowsTheBuildStamp } from '../src/services/v43UiContract';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  assert(same, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ─── REPO FILE ACCESS (the suite reads the REAL files, as text) ──────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readRepoFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

const SCREEN = readRepoFile(VC52_SCREEN_PATH);
const STORE = readRepoFile(VC52_STORE_PATH);
const CLIP = readRepoFile(VC52_CLIP_MODULE_PATH);
const SETTINGS = readRepoFile(VC52_SETTINGS_PATH);
const APPLY = readRepoFile(VC52_APPLY_PATH);
const HOME = readRepoFile('src/screens/HomeScreen.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// 5. A4 — PLAYBACK HONOURS THE WINDOW (the pure rule)
// ─────────────────────────────────────────────────────────────────────────────

function testTrimPlaybackAction(): void {
  console.log('\nA4 — playback honours the trim window');
  // The owner's own case: a 10-second video, two seconds trimmed off each end.
  const span = normaliseTrimSpan({ startSec: 2, endSec: 8 }, 10);
  assertEq(span, { startSec: 2, endSec: 8 }, 'the window is 0:02–0:08 of a 0:10 take');

  assertEq(trimPlaybackAction(0, span), { kind: 'seek', toMs: 2000 }, 'play from 0:00 is pulled to the window start');
  assertEq(trimPlaybackAction(1000, span), { kind: 'seek', toMs: 2000 }, 'a second in, still outside the window');
  assertEq(trimPlaybackAction(2000, span), { kind: 'free' }, 'the window start itself plays');
  assertEq(trimPlaybackAction(5000, span), { kind: 'free' }, 'inside the window nothing is forced');
  assertEq(trimPlaybackAction(7900, span), { kind: 'free' }, 'the last frame inside the window plays');
  assertEq(trimPlaybackAction(8000, span), { kind: 'stop', toMs: 2000 }, 'the window end stops AND rewinds');
  assertEq(trimPlaybackAction(9900, span), { kind: 'stop', toMs: 2000 }, 'past the end still rewinds to the start');

  assertEq(trimPlaybackAction(0, null), { kind: 'free' }, 'no window: the whole take plays as before');
  assertEq(trimPlaybackAction(0, { startSec: NaN, endSec: 8 }), { kind: 'free' }, 'an unreadable window never invents one');
  assertEq(trimPlaybackAction(0, { startSec: 8, endSec: 2 }), { kind: 'seek', toMs: 2000 }, 'a reversed window is read in order');

  assertEq(trimWindowStartMs(span), 2000, 'the seek target is the window start');
  assertEq(trimWindowStartMs(null), null, 'no window, no seek target');

  const line = trimPlaybackWindowLine(span, 10);
  assert(line.indexOf('0:02–0:08') >= 0, 'the surface names the window it is playing');
  assert(line.indexOf('not cut') >= 0, 'and says the file itself is not cut');
  assert(
    trimPlaybackWindowLine(null, 10).indexOf('whole take') >= 0,
    'with no window it says the whole take plays',
  );

  // THE COPY MUST NOT CONTRADICT THE BEHAVIOUR (and must not overclaim).
  assert(
    TRIM_VIDEO_WHOLE_LINE.indexOf('cannot cut the video file') >= 0,
    'the send copy still says the file is not cut',
  );
  assert(
    TRIM_VIDEO_WHOLE_LINE.indexOf('plays only the window') >= 0,
    'the send copy now says playback honours the window',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 & 2. A5 / B1 — the pure decisions
// ─────────────────────────────────────────────────────────────────────────────

function testSaveAndPlaybackDecisions(): void {
  console.log('\nA5 — a save that did not happen is never called a save');
  const ok = practiceVideoSaveState(true);
  assert(ok.saved === true && ok.headline === null, 'a verified write is a save, with no headline');
  assertEq(ok.line, PRACTICE_VIDEO_SAVE_CONFIRMED_LINE, 'and it says the take will survive a restart');
  const bad = practiceVideoSaveState(false);
  assert(bad.saved === false, 'an unverified write is NOT a save');
  assertEq(bad.headline, PRACTICE_VIDEO_SAVE_FAILED_HEADLINE, 'and it gets a headline of its own');
  assert(bad.line.length > 80 && bad.line !== ok.line, 'and a full sentence, not the success line');
  assert(
    PRACTICE_VIDEO_SAVE_FAILED_HEADLINE.toLowerCase().indexOf('not saved') >= 0,
    'the headline says "not saved" in plain words',
  );

  console.log('\nB1 — the player is only mounted for a file that is there');
  assertEq(practiceVideoPlaybackPlan(true, true), 'play', 'a usable ref with a real file plays');
  assertEq(practiceVideoPlaybackPlan(true, false), 'file-missing', 'a usable ref whose file is gone says so');
  assertEq(practiceVideoPlaybackPlan(true, null), 'play', 'an unreadable check does not block a play');
  assertEq(practiceVideoPlaybackPlan(false, null), 'no-video', 'no ref means no video at all');
  assert(PRACTICE_VIDEO_FILE_GONE_LINE.indexOf('no longer on this device') >= 0, 'the missing-file sentence is honest');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LIGHT MODE — MEASURED, ON THE REAL LITERALS, THROUGH THE REAL REMAPPER
// ─────────────────────────────────────────────────────────────────────────────

/** The colour literal a StyleSheet key paints, read off the REAL screen source. */
function literalOf(key: string, prop: string): string {
  const re = new RegExp(`\\b${key}:\\s*\\{[^}]*${prop}:\\s*'(#[0-9a-fA-F]{3,6})'`);
  const found = re.exec(SCREEN);
  if (!found) {
    assert(false, `the screen still declares styles.${key}.${prop}`);
    return '#000000';
  }
  return found[1];
}

type Sheet = Record<string, Record<string, string>>;

function testLightModeContrast(): void {
  console.log('\nC1 — the practice-video surface is legible in BOTH themes (measured)');

  // The sheet is built from the REAL literals in the REAL screen file…
  const sheet: Sheet = {
    container: { backgroundColor: literalOf('container', 'backgroundColor') },
    title: { color: literalOf('title', 'color') },
    honest: { color: literalOf('honest', 'color') },
    meta: { color: literalOf('meta', 'color') },
    error: { color: literalOf('error', 'color') },
    missingCard: { backgroundColor: literalOf('missingCard', 'backgroundColor') },
    missingText: { color: literalOf('missingText', 'color') },
    secondaryBtn: { backgroundColor: literalOf('secondaryBtn', 'backgroundColor') },
    secondaryBtnText: { color: literalOf('secondaryBtnText', 'color') },
    chip: { backgroundColor: literalOf('chip', 'backgroundColor') },
    chipText: { color: literalOf('chipText', 'color') },
  };
  const dark = themedSheet(sheet, 'dark') as Sheet;
  const light = themedSheet(sheet, 'light') as Sheet;

  assertEq(dark.container.backgroundColor, sheet.container.backgroundColor, 'dark mode is the identity (unchanged design)');

  const pairs: Array<[string, string, string]> = [
    ['title on the page', 'title', 'container'],
    ['honest/hint on the page', 'honest', 'container'],
    ['meta body text on the page', 'meta', 'container'],
    ['error on the page', 'error', 'container'],
    ['missing-card text on its card', 'missingText', 'missingCard'],
    ['button label on its button', 'secondaryBtnText', 'secondaryBtn'],
    ['chip label on its chip', 'chipText', 'chip'],
  ];

  pairs.forEach(([label, inkKey, fillKey]) => {
    const ink = light[inkKey].color;
    const fill = light[fillKey].backgroundColor;
    const ratio = contrastRatio(ink, fill);
    assert(ratio >= AA_TEXT_MIN, `LIGHT: ${label} ${ink} on ${fill} = ${ratio}:1 (AA ${AA_TEXT_MIN})`);
    const darkRatio = contrastRatio(dark[inkKey].color, dark[fillKey].backgroundColor);
    assert(darkRatio >= AA_TEXT_MIN, `DARK:  ${label} ${dark[inkKey].color} on ${dark[fillKey].backgroundColor} = ${darkRatio}:1`);
  });

  // THE OWNER'S EXACT COMPLAINT, AS A NUMBER. Pale blue on paper-white is what he
  // photographed; it is measured here so "unreadable" is not an opinion.
  const paleBlueOnPaper = contrastRatio('#cfe4ff', LIGHT_THEME.surface);
  assert(paleBlueOnPaper < AA_TEXT_MIN, `the v51 failure reproduces: #cfe4ff on light surface = ${paleBlueOnPaper}:1`);
  const remapped = light.meta.color;
  assert(
    contrastRatio(remapped, LIGHT_THEME.background) >= AA_TEXT_MIN,
    `and the remapped body ink ${remapped} is legible on the light page`,
  );
  // The light palette's own tokens must clear AA on their own surfaces.
  assert(contrastRatio(LIGHT_THEME.chipText, LIGHT_THEME.chipBg) >= AA_TEXT_MIN, 'chipText on chipBg clears AA');
  assert(contrastRatio(LIGHT_THEME.subtext, LIGHT_THEME.background) >= AA_TEXT_MIN, 'subtext on background clears AA');
  assert(contrastRatio(LIGHT_THEME.text, LIGHT_THEME.surface) >= AA_TEXT_MIN, 'text on surface clears AA');
  // …and dark mode's own pair, because dark is the shipped default.
  assert(contrastRatio(DARK_THEME.chipText, DARK_THEME.background) >= AA_TEXT_MIN, 'dark chipText on background clears AA');
  assert(relativeLuminance('#ffffff') === 1 && relativeLuminance('#000000') === 0, 'the luminance anchor is right');
  assertEq(contrastRatio('#ffffff', '#000000'), 21, 'white on black is 21:1');
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SOURCE GUARDS, EACH PROVEN TO BITE IN MEMORY
// ─────────────────────────────────────────────────────────────────────────────

interface Guard {
  name: string;
  run: () => boolean;
  /** A mutation of the REAL source that the guard must reject. */
  bite: () => boolean;
  /** True when `bite()` returned false (i.e. the guard caught the regression). */
  bit: boolean;
}

function mutate(source: string, from: string, to: string): string {
  if (source.indexOf(from) < 0) return source;
  return source.replace(from, to);
}

const guards: Guard[] = [
  {
    name: 'saveIsVerifiedByReadBack',
    run: () => saveIsVerifiedByReadBack(STORE),
    bite: () =>
      saveIsVerifiedByReadBack(
        mutate(
          mutate(STORE, 'const stored = await loadPracticeVideoRow(piece.id);', 'const stored = piece;'),
          'if (!stored) return null;',
          'if (false) return null;',
        ),
      ),
    bit: false,
  },
  {
    name: 'saveFailureIsLoud',
    run: () => saveFailureIsLoud(SCREEN),
    bite: () => saveFailureIsLoud(mutate(SCREEN, '{PRACTICE_VIDEO_SAVE_FAILED_HEADLINE}', "'Saved to your History.'")),
    bit: false,
  },
  {
    name: 'playbackChecksTheFileExists',
    run: () => playbackChecksTheFileExists(SCREEN),
    bite: () => playbackChecksTheFileExists(mutate(SCREEN, 'await practiceVideoFileExists(storedRef.uri)', 'true')),
    bit: false,
  },
  {
    name: 'videoMountPaintsAFrame',
    run: () => videoMountPaintsAFrame(SCREEN),
    bite: () => videoMountPaintsAFrame(mutate(SCREEN, 'onLoad={() => handleVideoLoad()}', 'onNothing={() => 0}')),
    bit: false,
  },
  {
    name: 'surfaceInkIsThemed',
    run: () => surfaceInkIsThemed(SCREEN, APPLY),
    bite: () => surfaceInkIsThemed(SCREEN, mutate(APPLY, "'#cfe4ff': 'chipText',", '')),
    bit: false,
  },
  {
    name: 'trimEditorSitsUnderTheVideo',
    run: () => trimEditorSitsUnderTheVideo(SCREEN),
    bite: () => trimEditorSitsUnderTheVideo(mutate(SCREEN, '<TakeClipTagEditor', '<ClipPanelGone')),
    bit: false,
  },
  {
    name: 'playbackHonoursTheWindow',
    run: () => playbackHonoursTheWindow(SCREEN, CLIP),
    bite: () => playbackHonoursTheWindow(SCREEN, mutate(CLIP, 'export function trimPlaybackAction', 'function trimPlaybackActionGone')),
    bit: false,
  },
  {
    name: 'copyNeverClaimsTheFileWasCut',
    run: () => copyNeverClaimsTheFileWasCut(CLIP),
    bite: () =>
      copyNeverClaimsTheFileWasCut(
        mutate(
          CLIP,
          'cannot cut the video file itself, so the file itself travels whole',
          'is trimmed for you, so the file itself travels cut',
        ),
      ),
    bit: false,
  },
  {
    name: 'stampIsFindableInSettings',
    run: () => stampIsFindableInSettings(SETTINGS),
    bite: () => stampIsFindableInSettings(mutate(SETTINGS, 'sub={stampLine}', 'sub={aboutVersionLine(appVersion)}')),
    bit: false,
  },
];

function testSourceGuards(): void {
  console.log('\nTHE vc52 SOURCE GUARDS (each run on the real file, then on a mutation of it)');
  guards.forEach((guard) => {
    const ok = guard.run();
    assert(ok, `${guard.name} — passes on the real source`);
    if (ok) {
      guard.bit = guard.bite() === false;
      assert(guard.bit, `${guard.name} — BITES: the mutation is rejected`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NO REGRESSION IN THE v43 STAMP CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

function testStampContractStillHolds(): void {
  console.log('\nTHE v43 STAMP CONTRACT STILL HOLDS');
  assert(settingsShowsTheBuildStamp(SETTINGS), 'Settings still renders the stamp from the live build constants');
  assert(homeCarriesNoBuildStamp(HOME), 'Home still carries NO stamp (owner 10-26 stands)');
  // …and the stamp's own shape is unchanged.
  assert(SETTINGS.indexOf('BUILD_STAMP_TAG') >= 0, 'the stamp keeps its accessibility tag');
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

testTrimPlaybackAction();
testSaveAndPlaybackDecisions();
testLightModeContrast();
testSourceGuards();
testStampContractStillHolds();

console.log(`\n${passes} passed, ${failures} failed (${passes + failures} checks)`);
if (failures > 0) process.exit(1);
