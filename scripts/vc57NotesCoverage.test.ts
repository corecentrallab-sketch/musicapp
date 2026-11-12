/**
 * vc57NotesCoverage.test.ts — HOW FAR THE NOTES REACH, PINNED (vc57, D21).
 *
 * THE OWNER (11-11, verbatim): *"this can seem to be misleading for the user
 * thinking they have as much time as they need. Put in an indicator that shows the
 * amount of time they actually have - not think they have. We can always raise the
 * cap later if the demand is there for more time."*
 *
 * THE FACT THE APP USED TO HIDE. A practice video records up to 180 s; the notes
 * are decoded server-side and truncated to 60 s. A two-minute take therefore has
 * notes for its first minute and nothing after — and the lane simply stopped, with
 * no explanation, so a user concluded the app was broken or that they had played
 * badly. Both were wrong. The cap is NOT raised (owner decision); the app says so.
 *
 * THIS SUITE PINS FOUR THINGS:
 *   1. THE CONSTANT — `NOTES_COVERAGE_SECONDS` is exactly 60 and every indicator
 *      renders from it (the copy is re-derived from a different number and changes,
 *      so no line can be carrying a typed 60);
 *   2. THE WIRING — read from the real screen: the record surface states the limit
 *      before a take, and BOTH lanes state it when the take is longer than it;
 *   3. THE STRAY 60 — no second hardcoded 60 anywhere in the practice-video path;
 *   4. THE CROSS-REPO PIN — the app constant and the site's `MAX_RETURN_SECONDS`
 *      must agree. The APP-SIDE assertion runs unconditionally: a guard that skips
 *      when the site checkout is missing is blind, so a missing checkout is a loud
 *      warning and never a silent pass.
 *
 * Every source guard is proven to bite IN THIS SUITE by mutating the real bytes in
 * memory and re-running the same guard; the same mutations were run ON DISK against
 * the compiled gate, and the failing lines are in the PR body.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  NOTES_COVERAGE_MODULE_PATH,
  NOTES_COVERAGE_SECONDS,
  PRACTICE_VIDEO_PATH_FILES,
  VC57_SCREEN_PATH,
  everyLaneStatesTheNotesLimit,
  notesCoverageClock,
  notesCoverageLaneLine,
  notesCoverageLaneNotice,
  notesCoverageRecordLine,
  recordSurfaceStatesTheLimit,
  serverCapAgreesWithTheApp,
  serverNotesCapSeconds,
  siteCoachHandlerCandidates,
  straySixtyLiterals,
  takeIsLongerThanTheNotesCover,
  theNoticeIsComputedFromTheCueTimeline,
} from '../src/services/notesCoverage';

declare const require: (name: string) => any;
declare const process: {
  cwd(): string;
  exit(code: number): void;
  env: Record<string, string | undefined>;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function read(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

const SCREEN = read(VC57_SCREEN_PATH);
const MODULE_SOURCE = read(NOTES_COVERAGE_MODULE_PATH);
const PATH_FILES = PRACTICE_VIDEO_PATH_FILES.map((file) => ({ path: file, source: read(file) }));

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

function straysFor(files: Array<{ path: string; source: string }>): string[] {
  return straySixtyLiterals(files).map((stray) => `${stray.path}:${stray.line}: ${stray.text}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CONSTANT — 60, once, and every indicator renders from it
// ─────────────────────────────────────────────────────────────────────────────

function testTheConstant(): void {
  console.log('\nTHE CONSTANT (pure)');

  assert(
    NOTES_COVERAGE_SECONDS === 60,
    `the app's coverage constant is exactly 60 (got ${NOTES_COVERAGE_SECONDS})`,
  );
  assert(
    notesCoverageClock() === '1:00',
    `the coverage reads as a clock: 1:00 (got ${notesCoverageClock()})`,
  );

  const record = notesCoverageRecordLine();
  assert(
    record.indexOf('60 seconds') >= 0 && record.indexOf('1:00') >= 0,
    `the record surface's line carries the coverage: "${record}"`,
  );
  // THE LINE IS DERIVED, NOT TYPED: hand it a different number and it changes.
  const recordAt90 = notesCoverageRecordLine(90);
  assert(
    recordAt90.indexOf('90 seconds') >= 0 && recordAt90.indexOf('60') < 0,
    `the record line is built from the number it is given, not a typed 60: "${recordAt90}"`,
  );

  const lane = notesCoverageLaneLine();
  const laneAt90 = notesCoverageLaneLine(90);
  assert(
    lane.indexOf('60 seconds') >= 0,
    `the lane's line carries the coverage: "${lane}"`,
  );
  assert(
    laneAt90.indexOf('90 seconds') >= 0 && laneAt90.indexOf('60') < 0,
    `the lane's line is built from the number it is given, not a typed 60: "${laneAt90}"`,
  );

  // One definition, in one module, and nowhere else in the practice-video path.
  const definitions = PATH_FILES.filter((file) =>
    /(?:export\s+)?const\s+NOTES_COVERAGE_SECONDS\s*=/.test(file.source),
  ).map((file) => file.path);
  assert(
    definitions.length === 1 && definitions[0] === NOTES_COVERAGE_MODULE_PATH,
    `NOTES_COVERAGE_SECONDS is defined exactly once, in ${NOTES_COVERAGE_MODULE_PATH} (found: ${definitions.join(', ') || 'none'})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE MECHANISM — when the limit bites, and what it says when it does
// ─────────────────────────────────────────────────────────────────────────────

function testTheMechanism(): void {
  console.log('\nTHE MECHANISM (pure)');

  assert(
    takeIsLongerThanTheNotesCover(45) === false &&
      takeIsLongerThanTheNotesCover(60) === false &&
      takeIsLongerThanTheNotesCover(61) === true,
    'a take inside the coverage (45 s, exactly 60 s) is not flagged; one past it (61 s) is',
  );
  assert(
    takeIsLongerThanTheNotesCover(Number.NaN) === false,
    'a take whose length is unknown is not told it is too long',
  );
  assert(
    notesCoverageLaneNotice(45) === null && notesCoverageLaneNotice(60) === null,
    'no line at all on a take the notes cover — the user is not given a limit they do not have',
  );
  const notice = notesCoverageLaneNotice(120);
  assert(
    typeof notice === 'string' && notice.indexOf('60 seconds') >= 0,
    `a two-minute take gets the sentence: "${String(notice)}"`,
  );

  // IT IS THE APP'S LIMIT, NOT THE USER'S FAILURE (spec §4).
  const blame = ['you played nothing', 'nothing after', 'you stopped', 'no notes', 'failed', 'too long'];
  const said = String(notice).toLowerCase();
  const blamed = blame.filter((phrase) => said.indexOf(phrase) >= 0);
  assert(blamed.length === 0, `the sentence blames neither the user nor the detector (found: ${blamed.join(', ') || 'none'})`);
  assert(
    said.indexOf('not anything you played wrong') >= 0,
    'the sentence says outright that it is not something the user played wrong',
  );
  // NEVER A DEAD END (spec §5): it names a control that is on the surface.
  assert(
    said.indexOf('trim') >= 0,
    'the sentence leaves the user somewhere to go — it names the trim',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE WIRING — read from the real screen
// ─────────────────────────────────────────────────────────────────────────────

function testTheWiring(): void {
  console.log('\nTHE WIRING (real source)');

  assert(
    recordSurfaceStatesTheLimit(SCREEN),
    'the record surface states the notes limit on BOTH pre-record surfaces, from NOTES_COVERAGE_RECORD_LINE',
  );
  assert(
    everyLaneStatesTheNotesLimit(SCREEN),
    'EVERY lane (watch page + full-screen notes window) states the limit when the take is longer than the notes cover',
  );
  assert(
    theNoticeIsComputedFromTheCueTimeline(SCREEN),
    'the notice is computed from cueSet.timelineSec — the same axis the lane draws on',
  );

  const strays = straysFor(PATH_FILES);
  assert(
    strays.length === 0,
    `no stray hardcoded 60 in the practice-video path (${PATH_FILES.length} files)${strays.length ? `:\n      ${strays.join('\n      ')}` : ''}`,
  );

  assert(
    MODULE_SOURCE.indexOf('NOTES_COVERAGE_SECONDS') >= 0,
    'the one constant lives in the module every indicator imports',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE CROSS-REPO PIN — the app constant against the site's cap
// ─────────────────────────────────────────────────────────────────────────────

function testTheCrossRepoPin(): void {
  console.log('\nTHE CROSS-REPO PIN');

  // UNCONDITIONAL, BEFORE ANY FILE IS LOOKED FOR: if the site checkout is missing
  // this is the assertion that still has to run, or the guard is blind.
  assert(
    NOTES_COVERAGE_SECONDS === 60,
    'APP-SIDE (unconditional): the coverage constant is 60, whether or not the site checkout is here',
  );

  const override = process.env.NOTESNAP_SITE_COACH_HANDLER;
  const candidates = siteCoachHandlerCandidates(override);
  const found = candidates.find((candidate) => fs.existsSync(candidate));

  if (!found) {
    // LOUD, NEVER SILENT: a skip that prints nothing reads exactly like a pass.
    console.log('  ⚠ CROSS-REPO PIN NOT CHECKED — no site checkout at:');
    candidates.forEach((candidate) => console.log(`      ${candidate}`));
    console.log('      The app-side assertion above still ran. Re-run with the site repo present (or NOTESNAP_SITE_COACH_HANDLER=<path>) to pin the server cap.');
    passes += 1;
    return;
  }

  console.log(`  site handler: ${found}`);
  // The site checkout is an ABSOLUTE path outside this repo — read it directly,
  // never through the repo-root join the app files use.
  const server = serverNotesCapSeconds(String(fs.readFileSync(found, 'utf8')));
  assert(
    server !== null,
    `the pin can READ the server cap from ${path.basename(found)} (a renamed or removed MAX_RETURN_SECONDS makes this pin blind, not green)`,
  );
  assert(
    serverCapAgreesWithTheApp(server),
    `the server cap (${String(server)} s) agrees with the app's constant (${NOTES_COVERAGE_SECONDS} s)`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE GUARDS BITE — the same real bytes, mutated, must fail
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // (a) The regression exactly as it would be written: the copy typed into the
  //     screen instead of rendered from the constant.
  const typedCopy = SCREEN.split('{NOTES_COVERAGE_RECORD_LINE}').join(
    'The notes cover the first 60 seconds of a take.',
  );
  assert(typedCopy !== SCREEN, 'control: the record line can be replaced in memory');
  assert(
    recordSurfaceStatesTheLimit(typedCopy) === false,
    'GUARD 1 bites: a record surface with the line typed inline is rejected',
  );
  const typedStrays = straysFor([{ path: VC57_SCREEN_PATH, source: typedCopy }]);
  assert(
    typedStrays.length > 0,
    `GUARD 3 bites: the typed 60 is caught as a stray — ${typedStrays.join(' | ')}`,
  );

  // (b) The fix applied to one surface only — the class this repo has shipped before.
  const firstLane = SCREEN.indexOf('<VideoOverlayLane');
  const secondLane = SCREEN.indexOf('<VideoOverlayLane', firstLane + 1);
  const firstNotice = SCREEN.indexOf('{coverageLine ?', firstLane);
  const halfStated =
    SCREEN.slice(0, firstNotice) +
    SCREEN.slice(SCREEN.indexOf('\n', firstNotice) + 1);
  assert(
    everyLaneStatesTheNotesLimit(halfStated) === false,
    'GUARD 2 bites: a screen that states the limit on one lane only is rejected',
  );
  assert(
    secondLane > firstLane && firstNotice > firstLane,
    'control: the screen really does render two lanes, each with its own notice',
  );
  assert(
    everyLaneStatesTheNotesLimit('const nothing = 1;') === false,
    'GUARD 2 bites: a screen that stopped rendering the lane at all is rejected, not passed vacuously',
  );

  // (c) The sentence taken back off the cue timeline — a second opinion about length.
  const offTheTimeline = SCREEN.split('notesCoverageLaneNotice(cueSet.timelineSec)').join(
    'notesCoverageLaneNotice(Math.max(0, Number(ref?.durationSec) || 0))',
  );
  assert(
    offTheTimeline !== SCREEN && theNoticeIsComputedFromTheCueTimeline(offTheTimeline) === false,
    'GUARD 2b bites: a notice computed from the stored video length instead of the cue timeline is rejected',
  );

  // (d) A second coverage constant, hand-typed in the screen.
  const secondConstant =
    SCREEN.replace(
      'const coverageLine = useMemo(',
      'const NOTES_COVERAGE_SECONDS = 60;\n  const coverageLine = useMemo(',
    );
  assert(
    secondConstant !== SCREEN && straysFor([{ path: VC57_SCREEN_PATH, source: secondConstant }]).length > 0,
    'GUARD 3 bites: a second NOTES_COVERAGE_SECONDS = 60 in the screen is caught as a stray',
  );

  // (e) The cross-repo pin, both ways it can go wrong.
  const handlerSource = 'const MAX_UPLOAD_BYTES = 1;\nconst MAX_RETURN_SECONDS = 60;\n';
  assert(
    serverNotesCapSeconds(handlerSource) === 60 && serverCapAgreesWithTheApp(60),
    'control: the pin reads a real 60 out of a handler source and agrees',
  );
  const raisedServer = handlerSource.replace('MAX_RETURN_SECONDS = 60', 'MAX_RETURN_SECONDS = 90');
  assert(
    serverCapAgreesWithTheApp(serverNotesCapSeconds(raisedServer)) === false,
    'GUARD 4 bites: a server cap raised to 90 no longer agrees with the app constant',
  );
  const renamedServer = handlerSource.replace('MAX_RETURN_SECONDS', 'MAX_SECONDS');
  assert(
    serverNotesCapSeconds(renamedServer) === null,
    'GUARD 4 bites: a renamed constant reads as UNREADABLE (null), which fails the pin rather than passing it',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

testTheConstant();
testTheMechanism();
testTheWiring();
testTheCrossRepoPin();
testTheGuardsBite();

console.log(`\n${passes} passed, ${failures} failed (${passes + failures} checks)`);
if (failures > 0) process.exit(1);
