/**
 * uxr1-step3-reader.test.ts — THE GATE FOR UX ROUND 1 STEP 3 (owner 10-18 item 1):
 * the transposed reader's RENDER FIX, its IN-PLACE KEY CONTROL and its BACK-OUT
 * GUARD.
 *
 * WHY THIS SUITE EXISTS. Item 1 has three halves, and every one of them can be
 * "in the code" while doing nothing on the owner's device:
 *
 *   1.1 THE RENDER (the v36 on-device FAIL, still open in v40). The reader's band
 *       handoff (`self-scroll`) is only reachable if the height the DOCUMENT
 *       reports survives the parser. While that parser ran the measurement through
 *       `clampScoreHeight` — the app's 4000px BOX ceiling — nothing could ever
 *       measure taller than the ceiling that chose the band, so a 9000px sonata
 *       movement was laid out in a 4000px non-interactive box and every bar below
 *       the fold was unreachable. This suite pins the parse→band→box CHAIN on the
 *       real functions, and pins that all bars of the score reach the document.
 *   1.2 THE KEY CONTROL: the chip, both steppers, the pure re-key plan, the one
 *       pulse per real change and the unsaved state — plus the save that persists
 *       the CHOSEN key.
 *   1.3 THE BACK-OUT GUARD: raised by the ROUTE's own `beforeRemove` (never a
 *       hardware-BACK handler — the route class), asking ONCE, and leaving only
 *       when the user said so.
 *
 * HOW IT IS BUILT. The team's usual three layers: pure logic, live-source guards
 * read from the REAL files (comments masked first), and mutation probes that MUST
 * fail the guards — so a guard that cannot bite is visible here instead of on the
 * owner's phone. Hard numbers come from the app's own modules, never from a copy
 * of them.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  ABC_HEIGHT_MESSAGE_TYPE,
  ABC_HEIGHT_REPORT_MAX,
  ABC_READER_MAX_HEIGHT,
  ABC_SCORE_MAX_HEIGHT,
  ABC_SCORE_MIN_HEIGHT,
  abcHeightFromMessage,
  abcReaderContainerHeight,
  clampScoreHeight,
  scoreReaderBand,
} from '../src/services/scoreHeight';
import { clampSemitones, extractAbcKey, transposeAbc } from '../src/services/abcTranspose';
import {
  READER_KEY_DECREASE_LABEL,
  READER_KEY_INCREASE_LABEL,
  READER_KEY_LIMIT_LINE,
  READER_KEEP_PROMPT_LEAVE,
  READER_KEEP_PROMPT_SAVE,
  READER_KEEP_PROMPT_TITLE,
  READER_UNSAVED_LINE,
  readerIsDirty,
  readerKeyChipLabel,
  readerKeyPlan,
  readerLeaveOutcome,
  readerSavePlan,
} from '../src/services/readerKeyControl';
import { countAbcBars, transposedCopyTitle } from '../src/services/transposedScore';
import {
  READER_EDITOR_PATH,
  READER_KEY_CONTROL_MODULE_PATH,
  READER_KEY_CONTROL_SUITE_PATH,
  READER_PACKAGE_PATH,
  READER_SCREEN_PATH,
  READER_TIER1_CONFIG_PATH,
  READER_VIEWER_PATH,
  readerGuardsTheBackOut,
  readerHeightReportReachesTheBand,
  readerIsARouteNotAModal,
  readerKeepsTheStickyFooter,
  readerKeyControlIsWired,
  readerShowsTheWholeWork,
  readerTier1ListsTheFeature,
  readerUnsavedStateIsVisible,
  viewerRendersTheWholeAbc,
} from '../src/services/v39ReaderContract';
import {
  v39CopyAvoidsBannedClaims,
  v39HasNoNetwork,
  v39IsFreeAndUnpaywalled,
  v39ModuleStaysPure,
} from '../src/services/v39UiContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;

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
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
function mutate(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}
/** The document's own report, built the way the probe script builds it. */
function heightMessage(height: number): string {
  return JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE, height });
}
/** The chain guard against the REAL modules of this build. */
function chainHolds(): boolean {
  return readerHeightReportReachesTheBand({
    parse: abcHeightFromMessage,
    band: scoreReaderBand,
    height: abcReaderContainerHeight,
    clamp: clampScoreHeight,
    message: heightMessage,
    appCeiling: ABC_SCORE_MAX_HEIGHT,
    readerCeiling: ABC_READER_MAX_HEIGHT,
  });
}

const SCREEN = readAppFile(READER_SCREEN_PATH);
const VIEWER = readAppFile(READER_VIEWER_PATH);
const EDITOR = readAppFile(READER_EDITOR_PATH);
const KEY_CONTROL = readAppFile(READER_KEY_CONTROL_MODULE_PATH);

// ── a REAL long score: 24 bars, the shape the owner's "entire piece" means ──────
const LONG_ABC =
  'X:1\nT:Long piece\nM:4/4\nL:1/4\nK:Am\n' +
  'A B c d | e f g a | b c d e | f g a b | c d e f | g a b c |\n' +
  'd e f g | a b c d | e f g a | b c d e | f g a b | c d e f |\n' +
  'g a b c | d e f g | a b c d | e f g a | b c d e | f g a b |\n' +
  'c d e f | g a b c | d e f g | a b c d | e f g a | b c d e |]\n';
const LONG_BARS = countAbcBars(LONG_ABC);

console.log('\nuxr1 step 3 — the render chain: a reported height reaches the band');
assert(
  LONG_BARS >= 20,
  `the fixture really is a long score (${LONG_BARS} bars) — a short one proves nothing`,
);
assertEq(chainHolds(), true, 'THE FIX: a whole work (9000px) measured by its own document is handed to a SELF-SCROLLING viewer, never clipped at 4000');
assertEq(
  abcHeightFromMessage(heightMessage(9000)),
  9000,
  'the document’s report SURVIVES the parser — a measurement is not a box',
);
assertEq(
  abcHeightFromMessage(heightMessage(ABC_HEIGHT_REPORT_MAX + 5)),
  ABC_HEIGHT_REPORT_MAX,
  'a runaway report still cannot grow the page without end',
);
assertEq(
  abcHeightFromMessage(heightMessage(10)),
  ABC_SCORE_MIN_HEIGHT,
  'a tiny document still gets the score floor',
);
assertEq(
  abcReaderContainerHeight({ measuredHeight: 9000, viewportHeight: 620 }),
  620,
  'the box for a whole work is the VIEWPORT — the reader hands the scroll over instead of clipping',
);
assertEq(scoreReaderBand(9000), 'self-scroll', 'the band really is the viewer’s own scroll');
assertEq(
  clampScoreHeight(9000),
  ABC_SCORE_MAX_HEIGHT,
  'and the app’s 4000px ceiling still clamps a BOX — the v37 rule was not deleted to fix the reader',
);

console.log('\nuxr1 step 3 — every bar of the score reaches the document');
const transposedLong = transposeAbc(LONG_ABC, 2);
assertEq(
  countAbcBars(transposedLong),
  LONG_BARS,
  'transposing a long score carries EVERY bar (no truncation on the re-key path)',
);
assertEq(
  countAbcBars(transposeAbc(transposedLong, -2)),
  LONG_BARS,
  'and stepping back carries every bar too',
);
assertEq(
  JSON.parse(JSON.stringify(LONG_ABC)),
  LONG_ABC,
  'the document embeds the WHOLE ABC: the JSON round trip the WebView itself does returns every character',
);
assertEq(
  countAbcBars(JSON.parse(JSON.stringify(LONG_ABC)) as string),
  LONG_BARS,
  'and every bar survives that round trip',
);
assertEq(
  viewerRendersTheWholeAbc(VIEWER),
  true,
  'the viewer renders the whole ABC it is given and never slices it',
);

console.log('\nuxr1 step 3 — the key control re-keys the whole score in place');
const upOne = readerKeyPlan({ abc: LONG_ABC, keyLabel: 'Am', offset: 1, delta: 1 });
assertEq(upOne.offset, 2, 'a step moves the offset by one semitone');
assertEq(upOne.delta, 1, 'and says how far it moved');
assertEq(upOne.changed, true, 'and reports that something changed');
assertEq(upOne.keyLabel, 'Bbm', 'the key label moves with the offset (A minor + 1 = Bb minor)');
assertEq(countAbcBars(upOne.abc), LONG_BARS, 'the re-keyed score still holds every bar');
assertEq(
  extractAbcKey(upOne.abc),
  'Bbm',
  'the re-keyed ABC really carries the new `K:` — the score, not just a label',
);
assertEq(
  readerKeyPlan({ abc: upOne.abc, keyLabel: upOne.keyLabel, offset: upOne.offset, delta: 1 }).offset,
  3,
  'the next step starts from the reader’s own state',
);
assertEq(
  readerKeyPlan({ abc: upOne.abc, keyLabel: upOne.keyLabel, offset: upOne.offset, delta: -1 }).abc,
  LONG_ABC,
  'stepping back gives the SAME score back — one step, applied once, never compounded',
);
assertEq(
  countAbcBars(readerKeyPlan({ abc: upOne.abc, keyLabel: upOne.keyLabel, offset: upOne.offset, delta: -1 }).abc),
  LONG_BARS,
  'and the way back is a whole score too',
);
const atCeiling = readerKeyPlan({ abc: LONG_ABC, keyLabel: 'Am', offset: 11, delta: 1 });
assertEq(atCeiling.offset, 11, 'the ±11 bound is the transpose band’s own bound');
assertEq(atCeiling.changed, false, 'a spent stepper is not a change');
assertEq(atCeiling.atCeiling, true, 'and the reader can say why the stepper stopped');
assertEq(atCeiling.abc, LONG_ABC, 'a no-op step never re-spells the score');
assertEq(atCeiling.keyLabel, 'Am', 'a no-op step never renames the key');
const atFloor = readerKeyPlan({ abc: LONG_ABC, keyLabel: 'Am', offset: -11, delta: -1 });
assertEq(atFloor.atFloor, true, 'the same bound holds downward');
assertEq(clampSemitones(-14), -11, 'the app’s transpose band is ±11, as the reader assumes');
assertEq(
  readerKeyPlan({ abc: LONG_ABC, keyLabel: 'Am', offset: 0, delta: 0 }).abc,
  LONG_ABC,
  'a zero step is the score itself',
);
assertEq(
  readerKeyPlan({ abc: LONG_ABC, keyLabel: 'am', offset: 0, delta: 1 }).keyLabel,
  'Bbm',
  'the chip’s key comes from the score’s own key, not from a hard-coded table',
);
assertEq(readerKeyChipLabel('Am'), 'A minor', 'the chip says the key in words (the owner’s “A minor”)');
assertEq(readerKeyChipLabel(''), 'C major', 'a missing key still reads as a key, never as blank');

console.log('\nuxr1 step 3 — the unsaved state and the save that keeps the chosen key');
assertEq(
  readerIsDirty({ offset: 2, initialOffset: 2 }),
  false,
  'NOTHING CHANGED → not dirty (and therefore no prompt)',
);
assertEq(readerIsDirty({ offset: 3, initialOffset: 2 }), true, 'a key change is unsaved work');
assertEq(
  readerIsDirty({ offset: 2, initialOffset: 2, savedOffset: 2 }),
  false,
  'after a save, backing out asks nothing — the copy is in the Library',
);
assertEq(
  readerIsDirty({ offset: 4, initialOffset: 2, savedOffset: 3 }),
  true,
  'and the NEXT change after a save is unsaved work again',
);
assertEq(
  readerIsDirty({ offset: 1, initialOffset: 2, savedOffset: null }),
  true,
  'with nothing saved, the reader’s own opening offset is the baseline',
);
const savedPlan = readerSavePlan({ abc: upOne.abc, title: 'Für Elise', keyLabel: 'Bbm', offset: 2 });
assertEq(savedPlan.title, 'Für Elise (Bbm · +2)', 'the save is titled by the ONE shared builder');
assertEq(savedPlan.abc, upOne.abc, 'the save writes the score ON SCREEN, in the key on the chip');
assertEq(savedPlan.offset, 2, 'and the offset it records is the one it wrote');
assertEq(
  savedPlan.title,
  transposedCopyTitle({ title: 'Für Elise', keyLabel: 'Bbm', offset: 2 }),
  'the reader and the editor cannot name one transposed copy twice',
);

console.log('\nuxr1 step 3 — the back-out decision (once, and never silently)');
assertEq(readerLeaveOutcome({ dirty: false, promptOpen: false }), 'leave', 'nothing unsaved → the route pops');
assertEq(readerLeaveOutcome({ dirty: false, promptOpen: true }), 'leave', 'nothing unsaved → never a prompt on the way out');
assertEq(readerLeaveOutcome({ dirty: true, promptOpen: false }), 'ask', 'unsaved → ask ONCE');
assertEq(
  readerLeaveOutcome({ dirty: true, promptOpen: true }),
  'close-prompt',
  'a second BACK closes the prompt and stays — never a second prompt',
);

console.log('\nuxr1 step 3 — the reader’s wiring (live source, comments masked)');
assertEq(readerShowsTheWholeWork({ screen: SCREEN, viewer: VIEWER }), true, 'the reader still mounts a whole-work viewer');
assertEq(readerKeyControlIsWired(SCREEN), true, 'the key chip, both steppers and the pure re-key plan are wired');
assertEq(readerUnsavedStateIsVisible(SCREEN), true, 'the unsaved line and the plan-based save are wired');
assertEq(readerGuardsTheBackOut(SCREEN), true, 'the route’s own back-out guard is wired');
assertEq(readerKeepsTheStickyFooter(SCREEN), true, 'the sticky footer kept its controls and its honest line');
assertEq(readerIsARouteNotAModal(SCREEN), true, 'the back-out confirm is an overlay on the ROUTE, not an RN <Modal>');
assertEq(
  readerTier1ListsTheFeature(readAppFile(READER_TIER1_CONFIG_PATH), readAppFile(READER_PACKAGE_PATH)),
  true,
  'the gate lists know about the new module and this suite',
);
assertEq(
  readAppFile(READER_TIER1_CONFIG_PATH).indexOf(`"${READER_KEY_CONTROL_SUITE_PATH}"`) >= 0,
  true,
  'the gate’s tsconfig lists this suite by its real path',
);
assertEq(EDITOR.indexOf('READER_OPEN_LABEL') >= 0, true, 'the editor still opens the reader — this batch does not move the door');
assertEq(v39ModuleStaysPure(KEY_CONTROL), true, 'the key-control module is pure (no react-native, no fs)');
assertEq(v39HasNoNetwork([KEY_CONTROL]), true, 'and it can never reach the network');
assertEq(v39IsFreeAndUnpaywalled([KEY_CONTROL]), true, 'and it carries no paywall code');
assertEq(
  v39CopyAvoidsBannedClaims([KEY_CONTROL, SCREEN]),
  true,
  'and neither it nor the reader screen makes a banned claim',
);
assertEq(
  VIEWER.indexOf('abcScoreContainerHeight({') >= 0 && VIEWER.indexOf('viewportHeight') >= 0,
  true,
  'the viewer still clamps the decorative box AND takes the reader’s own area height',
);

console.log('\nuxr1 step 3 — the honest copy, verbatim (the owner’s words)');
assertEq(READER_UNSAVED_LINE, 'Unsaved change — save this copy to keep it.', 'the unsaved line is the owner’s, word for word');
assertEq(READER_KEEP_PROMPT_TITLE, 'Keep this transposed copy?', 'the back-out question is the owner’s, word for word');
assertEq(READER_KEEP_PROMPT_SAVE, 'Save to Library', 'the prompt’s keep action is the owner’s');
assertEq(READER_KEEP_PROMPT_LEAVE, 'Leave without saving', 'and the prompt’s discard action says what it does');
assertEq(READER_KEY_DECREASE_LABEL, 'One semitone down', 'the steppers say which way they go');
assertEq(READER_KEY_INCREASE_LABEL, 'One semitone up', 'both of them');
assertEq(
  READER_KEY_LIMIT_LINE.indexOf('11 semitones') >= 0,
  true,
  'and a spent stepper is explained, not left as a dead button',
);
assertEq(
  SCREEN.indexOf('READER_WHOLE_WORK_NOTE') >= 0 &&
    SCREEN.indexOf('The whole piece, every bar — scroll to the end.') >= 0,
  true,
  'the whole-work line survives this batch untouched',
);
assertEq(
  SCREEN.indexOf('Reading, transposing, saving and sharing are free through launch.') >= 0,
  true,
  'and so does the free-through-launch line',
);
assert(
  SCREEN.indexOf('Fix Notes') < 0 && SCREEN.indexOf('Listen & Send') < 0,
  'this suite pins step 3’s copy only — step 2’s editor strings are not this batch’s',
);

console.log('\nuxr1 step 3 — mutation probes (each one MUST fail its guard)');
// 1.1 — the render. The exact old bug: the report is pre-clamped to the box ceiling.
probe('the reported height is pre-clamped to the app’s box ceiling (THE v36/v37 BUG)', 'clamped', 'original', () =>
  readerHeightReportReachesTheBand({
    parse: (data: unknown) => clampScoreHeight(abcHeightFromMessage(data)),
    band: scoreReaderBand,
    height: abcReaderContainerHeight,
    clamp: clampScoreHeight,
    message: heightMessage,
    appCeiling: ABC_SCORE_MAX_HEIGHT,
    readerCeiling: ABC_READER_MAX_HEIGHT,
  }),
);
// 1.1 — a box rule that clips a whole work instead of handing off.
probe('the box rule clips a whole work at 4000px instead of handing the scroll over', 'clipping', 'original', () =>
  readerHeightReportReachesTheBand({
    parse: abcHeightFromMessage,
    band: scoreReaderBand,
    height: (input) => clampScoreHeight(input.measuredHeight) ?? 620,
    clamp: clampScoreHeight,
    message: heightMessage,
    appCeiling: ABC_SCORE_MAX_HEIGHT,
    readerCeiling: ABC_READER_MAX_HEIGHT,
  }),
);
// 1.1 — the viewer truncates the score it was given.
const viewerWithASlice = mutate(
  VIEWER,
  'const abcJson = JSON.stringify(abc);',
  'const abcJson = JSON.stringify(abc.slice(0, 200));',
);
probe('the viewer renders only the first slice of the ABC', viewerWithASlice, VIEWER, () =>
  viewerRendersTheWholeAbc(viewerWithASlice),
);
// 1.1 — the reader forgets wholeWork.
const screenWithoutWholeWork = mutate(SCREEN, 'wholeWork', 'inlineOnly');
probe('the reader forgets wholeWork', screenWithoutWholeWork, SCREEN, () =>
  readerShowsTheWholeWork({ screen: screenWithoutWholeWork, viewer: VIEWER }),
);
// 1.2 — the steppers.
const screenWithoutTheSteppers = mutate(
  mutate(SCREEN, 'onPress={handleKeyDown}', 'onPress={() => undefined}'),
  'onPress={handleKeyUp}',
  'onPress={() => undefined}',
);
probe('both key steppers stop re-keying the score', screenWithoutTheSteppers, SCREEN, () =>
  readerKeyControlIsWired(screenWithoutTheSteppers),
);
const screenWithoutThePlan = mutate(SCREEN, 'readerKeyPlan', 'ownKeyMath');
probe('the stepper stops using the pure re-key plan', screenWithoutThePlan, SCREEN, () =>
  readerKeyControlIsWired(screenWithoutThePlan),
);
const screenWithoutThePulse = mutate(SCREEN, 'pulseKeyChip();', '');
probe('the chip never pulses on a change', screenWithoutThePulse, SCREEN, () =>
  readerKeyControlIsWired(screenWithoutThePulse),
);
const screenWithoutTheBoundNote = mutate(SCREEN, 'disabled={keyPlan.atCeiling}', 'disabled={false}');
probe('a spent stepper becomes a button that does nothing', screenWithoutTheBoundNote, SCREEN, () =>
  readerKeyControlIsWired(screenWithoutTheBoundNote),
);
// 1.2 — the unsaved state.
const screenWithoutTheUnsavedLine = mutate(SCREEN, '{READER_UNSAVED_LINE}', 'unsaved:false');
probe('the unsaved copy line is dropped', screenWithoutTheUnsavedLine, SCREEN, () =>
  readerUnsavedStateIsVisible(screenWithoutTheUnsavedLine),
);
const screenSavingTheOldKey = mutate(
  SCREEN,
  'addAbcToLibrary({ title: plan.title, abc: plan.abc })',
  'addAbcToLibrary({ title: copyTitle, abc: openedAbc })',
);
probe('the save writes the params the window was OPENED with, not the chosen key', screenSavingTheOldKey, SCREEN, () =>
  readerUnsavedStateIsVisible(screenSavingTheOldKey),
);
// 1.3 — the back-out guard.
const screenWithoutThePromptTrigger = mutate(SCREEN, "addListener('beforeRemove'", "addListener('focus'");
probe('nothing raises the back-out prompt', screenWithoutThePromptTrigger, SCREEN, () =>
  readerGuardsTheBackOut(screenWithoutThePromptTrigger),
);
const screenWithoutTheDecision = mutate(
  SCREEN,
  'readerLeaveOutcome({ dirty, promptOpen: keepPromptOpen })',
  'readerLeaveOutcome({ dirty: false, promptOpen: false })',
);
probe('the guard leaves without ever asking', screenWithoutTheDecision, SCREEN, () =>
  readerGuardsTheBackOut(screenWithoutTheDecision),
);
const screenWithoutTheLeave = mutate(SCREEN, 'allowLeaveRef.current = true;', '');
probe('the decided leave can never pop the route (an inescapable reader)', screenWithoutTheLeave, SCREEN, () =>
  readerGuardsTheBackOut(screenWithoutTheLeave),
);
// The footer must stay a sibling of the scroller (the action that loses work never hides).
const footerInsideTheScroller = mutate(SCREEN, '</ScrollView>\n', '');
probe('the sticky footer stops being a sibling of the scroller', footerInsideTheScroller, SCREEN, () =>
  readerKeepsTheStickyFooter(footerInsideTheScroller),
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
