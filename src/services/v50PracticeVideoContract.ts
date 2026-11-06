/**
 * v50PracticeVideoContract.ts — THE LIVE-SOURCE GUARDS FOR THE PRACTICE-VIDEO
 * PIPELINE FIX (owner device report 11-04, five defects).
 *
 * WHY THESE EXIST. The tier1 gate never mounts a screen: `tsconfig.tier1.json`
 * compiles the pure `src/services` modules only, and the source-scan suites read
 * `.tsx` files as TEXT. Every defect the owner hit on a real handset was a defect
 * of WIRING, not of any single function — which is exactly the class a pure unit
 * test cannot see. Each guard below reads the REAL file and asks the narrow
 * question the owner's own words ask:
 *
 *   1. "The count timer gets stuck and doesn't count down on 3 & 5 second
 *      intervals."  → `countInTicksToZero`
 *      A countdown whose timer is torn down and rebuilt on every render (because
 *      its dependency array listed a callback that is rebuilt on every render)
 *      repaints its first number for ever. The guard forbids the unstable
 *      dependency and demands the absolute-deadline clock.
 *
 *   2. "Once video is taken, a large blue screen pops in another window up
 *      obscuring the video."  → `recordSurfaceShowsTheTake`
 *      The full-screen notes editor used to open itself over the review surface,
 *      and the review surface showed no video of its own. The guard demands the
 *      take's own video on the surface, before the trim and before the way out,
 *      and forbids the editor opening itself.
 *
 *   3. "I did not see any video timer on the screen or underneath for trimming
 *      the video."  → `recordingClockIsStable` + `trimTimelineIsDrawn`
 *      The length handed to the clip control came from a clock that never moved,
 *      so it was 0 — no timeline, and every ± press silently discarded. The
 *      guards demand a measured length and a drawn bar.
 *
 *   4. "Not recording takes… nothing shows up once processed… a dead end."
 *      → `takeCannotBeDropped`
 *      One long `await` chain with no try/catch held the whole surface on a
 *      spinner: a decode that threw or never resolved left no video, no notes and
 *      no message. The guard demands the review surface BEFORE the decode, a
 *      BOUNDED decode, and a sentence on every failure.
 *
 *   5. "The user is in the watch with notes page but can't watch anything."
 *      → `watchSurfaceIsNeverEmpty`
 *      Same root cause as 4 (no video reached the row) plus a page that said
 *      nothing useful. The guard demands the three honest cases and a way out.
 *
 * Plus the one scoped extra: `billingPermissionIsDeclared` — the Play Billing
 * permission is in the manifest, and NOTHING else about billing was added.
 *
 * Every guard is MUTATION-PROVEN in scripts/v50PracticeVideo.test.ts: the broken
 * bytes are built IN MEMORY from the real file and the guard must return false.
 *
 * PURE: no react, no react-native, no expo, no fs. Comments are masked first, so
 * a documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

// ─── THE FILES THIS FIX OWNS ─────────────────────────────────────────────────

export const V50_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const V50_OPTIONS_PATH = 'src/services/practiceRecordingOptions.ts';
export const V50_CLIP_EDITOR_PATH = 'src/components/TakeClipTagEditor.tsx';
export const V50_CLIP_MODULE_PATH = 'src/services/takeClipTag.ts';
export const V50_STORE_PATH = 'src/services/practiceVideoStore.ts';
export const V50_APP_JSON_PATH = 'app.json';
export const V50_BILLING_MODE_PATH = 'src/services/billingMode.ts';

/** The pure modules the gate must compile (and their suite must run). */
export const V50_TIER1_MODULES: readonly string[] = [
  'src/services/practiceRecordingOptions.ts',
  'src/services/takeClipTag.ts',
  'src/services/v50PracticeVideoContract.ts',
  'scripts/v50PracticeVideo.test.ts',
];

export const V50_TIER1_SUITES: readonly string[] = ['scripts/v50PracticeVideo.test.js'];

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/** The body of a `const x = useCallback(` … `}, [deps]);` block (masked source). */
function callbackBody(source: string, opener: string): string {
  const at = source.indexOf(opener);
  if (at < 0) return '';
  const end = source.indexOf('\n  },', at);
  if (end < 0) return '';
  return source.slice(at, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — THE COUNT-IN ACTUALLY COUNTS DOWN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT. The countdown computed its number from a `started` stamp taken
 * inside the effect that owned the interval, and that effect listed
 * `startBothCaptures` in its dependency array. `useAudioRecorder()` returns a
 * fresh object every render, so that callback has a new identity every render —
 * so React tore the interval down and rebuilt it (with a fresh `started`) on
 * every render. The countdown re-painted its first number for ever.
 *
 * THE RULE NOW. The count is an absolute DEADLINE plus a pure `(deadline, now)`
 * function, the timer depends on the phase and the choice only, and it reaches
 * the current capture callback through a ref that is refreshed every render.
 */
export function countInTicksToZero(screenSource: string, optionsSource: string): boolean {
  const src = maskComments(screenSource);
  const options = maskComments(optionsSource);
  if (src.length < 20000 || options.length < 2000) return false;
  // The pure clock exists…
  if (options.indexOf('export function countInDeadline(') < 0) return false;
  if (options.indexOf('export function countInRemainingSec(') < 0) return false;
  // …and the effect uses it, with NO callback in its dependencies.
  const at = src.indexOf("if (phase !== 'count_in') return undefined;");
  if (at < 0) return false;
  const end = src.indexOf('}, [phase, countInSec]);', at);
  if (end < 0) return false;
  const effect = src.slice(at, end);
  if (effect.indexOf('countInDeadline(countInSec, Date.now())') < 0) return false;
  if (effect.indexOf('countInRemainingSec(deadline, Date.now())') < 0) return false;
  // EXACTLY ONE start, and it is inside the zero branch.
  if (countOf(effect, 'startBothCapturesRef.current()') !== 1) return false;
  if (!/left <= 0[\s\S]{0,240}startBothCapturesRef\.current\(\)/.test(effect)) return false;
  // The displayed number is never reset back to the choice inside the timer.
  if (effect.indexOf('setCountInLeft(countInSec)') >= 0) return false;
  // The ref really is refreshed every render (otherwise the ref would be stale).
  if (src.indexOf('startBothCapturesRef.current = startBothCaptures;') < 0) return false;
  // THE REGRESSION ITSELF: an unstable callback back in a timer's deps.
  if (src.indexOf('}, [phase, countInSec, startBothCaptures]);') >= 0) return false;
  return src.indexOf('}, [phase, recordingLengthSec, handleStop]);') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — THE RECORDING CLOCK MOVES, AND THE LENGTH IS MEASURED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT. The running clock had the same shape as the count-in, with
 * `handleStop` in its dependencies. The metering hook re-renders this screen
 * every 200 ms while recording, so the clock's `started` stamp was reset every
 * 200 ms: the timer read 0:00 for the whole take, the chosen length never
 * triggered its stop, and the take was stored with `durationSec: 0` — which is
 * why the clip control had no timeline (defect 3).
 *
 * THE RULE NOW. One start stamp, taken where the camera is asked to record; the
 * clock and the stored length are both `recordingElapsedSec(stamp, now)`.
 */
export function recordingClockIsStable(screenSource: string, optionsSource: string): boolean {
  const src = maskComments(screenSource);
  const options = maskComments(optionsSource);
  if (src.length < 20000 || options.length < 2000) return false;
  if (options.indexOf('export function recordingElapsedSec(') < 0) return false;
  const at = src.indexOf("if (phase !== 'recording') return undefined;");
  if (at < 0) return false;
  const end = src.indexOf('}, [phase, recordingLengthSec]);', at);
  if (end < 0) return false;
  const effect = src.slice(at, end);
  if (effect.indexOf('recordingStartedAtRef.current || Date.now()') < 0) return false;
  if (effect.indexOf('recordingElapsedSec(startedAt, Date.now())') < 0) return false;
  if (countOf(effect, 'handleStopRef.current()') !== 1) return false;
  // The chosen length still stops the take through the normal stop path.
  if (effect.indexOf('recordingLengthReached(seconds, limit)') < 0) return false;
  // The start stamp is taken ONCE, in the one capture entry point.
  const capture = callbackBody(src, 'const startBothCaptures = useCallback(async () => {');
  if (capture.length === 0) return false;
  if (capture.indexOf('recordingStartedAtRef.current = videoStartMsRef.current;') < 0) return false;
  // The take's length is MEASURED at Stop — never read from the last tick.
  const stop = callbackBody(src, 'const handleStop = useCallback(async () => {');
  if (stop.length === 0) return false;
  if (stop.indexOf('recordingElapsedSec(startedAt, Date.now())') < 0) return false;
  if (!/elapsedRef\.current = Math\.max\([\s\S]{0,160}filmedSec\)/.test(stop)) return false;
  // …and that measured length is what the row's block carries.
  const keep = callbackBody(src, 'const keepTake = useCallback(');
  if (keep.length === 0) return false;
  if (keep.indexOf('durationSec: elapsedRef.current') >= 0) return false;
  return keep.indexOf('durationSec,') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 3 — THE CLIP CONTROL DRAWS A TIMELINE AND HAS A LENGTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT. The clip control drew two rows of ± buttons and two numbers and
 * nothing else: no length, no bar. With a zero length from guard 2 both numbers
 * read 0:00 and every press was silently discarded by `nudgeTrimSpan`.
 *
 * THE RULE NOW. The control draws the take's whole length as a bar with the
 * window lit up, prints the length in words, and DISABLES the ± controls when
 * the length is not known — a press that cannot do anything is a dead control,
 * and a dead control is the defect.
 */
export function trimTimelineIsDrawn(editorSource: string, moduleSource: string): boolean {
  const editor = maskComments(editorSource);
  const module = maskComments(moduleSource);
  if (editor.length < 3000 || module.length < 3000) return false;
  // The pure geometry exists.
  if (module.indexOf('export function trimTimeline(') < 0) return false;
  if (module.indexOf('export function trimTimelineLine(') < 0) return false;
  if (module.indexOf('export const TRIM_LENGTH_UNKNOWN_LINE') < 0) return false;
  // The control uses it…
  if (editor.indexOf('const timeline = trimTimeline(span, durationSec);') < 0) return false;
  if (editor.indexOf('{trimTimelineLine(timeline)}') < 0) return false;
  // …draws a bar with the window on it…
  if (editor.indexOf('styles.timeline') < 0) return false;
  if (editor.indexOf('styles.timelineWindow') < 0) return false;
  if (editor.indexOf('timeline.startFrac') < 0) return false;
  if (editor.indexOf('timeline.widthFrac') < 0) return false;
  // …and disables the controls it cannot honour.
  if (editor.indexOf('const canTrim = !timeline.unknown;') < 0) return false;
  return countOf(editor, 'disabled={!canTrim}') === 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 4 — A COMPLETED TAKE CANNOT BE DROPPED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT (the most important one). "Not recording takes… nothing shows up
 * once processed in the Record your Practice screen either in any of the boxes.
 * A dead end."
 *
 * `keepTake` was ONE chain of awaits — the camera's promise, the video copy, the
 * audio copy, the decode, the row write — with NO try/catch anywhere, called
 * from `handleStop`, which the Stop button invokes with `void`. Any rejection
 * escaped as an unhandled rejection and any slow decode simply held the screen on
 * "Keeping your video…", with no video, no notes and no message. The camera's own
 * refusal was swallowed by an empty `.catch`.
 *
 * THE RULE NOW: the review surface is reached as soon as the VIDEO is on disk;
 * the decode is bounded and its outcome is a sentence; the take is attached to
 * the row through the store's own seam; and nothing in the path can throw out.
 */
export function takeCannotBeDropped(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  const keep = callbackBody(src, 'const keepTake = useCallback(');
  if (keep.length === 0) return false;
  // THE ORDER: the surface first, the decode second.
  const reviewAt = keep.indexOf("setPhase('review')");
  const decodeAt = keep.indexOf('deriveCaptureTakeFromRecording(');
  if (reviewAt < 0 || decodeAt < 0) return false;
  if (decodeAt < reviewAt) return false;
  // The decode is BOUNDED, and both its failure and its timeout are sentences.
  if (keep.indexOf('settleWithin(') < 0) return false;
  if (keep.indexOf('TAKE_DECODE_TIMEOUT_MS') < 0) return false;
  if (keep.indexOf('VIDEO_TAKE_TIMEOUT_LINE') < 0) return false;
  if (keep.indexOf('VIDEO_TAKE_FAILED_LINE') < 0) return false;
  if (keep.indexOf('setTakeLine(') < 0) return false;
  // The take reaches the surface AND the row (a take that is only in React
  // state is a take that vanishes on the next visit).
  if (keep.indexOf('setRow((current) => (current && !current.take') < 0) return false;
  if (keep.indexOf('savePracticeVideoTake(rowId, derivedTake)') < 0) return false;
  // The row write cannot throw the flow out of the screen.
  if (keep.indexOf('try {') < 0) return false;
  // The camera's own refusal is KEPT, not swallowed by an empty catch.
  if (src.indexOf('videoFailureRef.current = VIDEO_CAPTURE_FAILED_LINE;') < 0) return false;
  if (src.indexOf('videoFailureRef.current ?? PRACTICE_VIDEO_NOT_KEPT_LINE') < 0) return false;
  // The stop path catches the keep path, so nothing escapes an un-awaited call.
  const stop = callbackBody(src, 'const handleStop = useCallback(async () => {');
  if (stop.length === 0) return false;
  if (stop.indexOf('await keepTake(') < 0) return false;
  if (stop.indexOf('try {') < 0 || stop.indexOf('await keepTake(') < stop.indexOf('try {')) return false;
  // …and no modal opens itself over the take any more.
  return keep.indexOf('setEditorOpen(true)') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 5 — THE REVIEW SURFACE SHOWS THE TAKE IT JUST FILMED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT. "Once video is taken, a large blue screen pops in another window up
 * obscuring the video." The notes editor (a full-screen modal on a navy
 * background) used to open itself from `keepTake`, and the review surface itself
 * rendered no video at all — so what the user saw where the take should be was a
 * panel with nothing in it.
 *
 * THE RULE NOW: the review surface renders the take's own video, its length, its
 * notes and its clip, in that order, and the only way to open the notes editor is
 * an explicit press.
 */
export function recordSurfaceShowsTheTake(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  const at = src.indexOf("{phase === 'review' ? (");
  if (at < 0) return false;
  const end = src.indexOf('\n        ) : null}', at);
  if (end < 0) return false;
  const review = src.slice(at, end + '\n        ) : null}'.length);
  // THE TAKE'S OWN VIDEO, with its own uri and its own length.
  if (review.indexOf('<Video') < 0) return false;
  if (review.indexOf('source={{ uri: ref.uri }}') < 0) return false;
  if (review.indexOf('videoSizeLine(Math.max(0, Number(ref?.durationSec) || 0)') < 0) return false;
  // THE NOTES, and the honest state while they are being read.
  if (review.indexOf('<TakeStaffCard') < 0) return false;
  if (review.indexOf('VIDEO_TAKE_READING_LINE') < 0) return false;
  // THE CLIP, handed the take's real length.
  if (review.indexOf('<TakeClipTagEditor') < 0) return false;
  if (review.indexOf('durationSec={Math.max(0, Number(ref?.durationSec) || 0)}') < 0) return false;
  // WHEN THERE IS NO VIDEO, THE REASON IS ON THE SURFACE.
  if (review.indexOf('videoFailureRef.current') < 0) return false;
  // THE ORDER: video, then clip, then the way out.
  const videoAt = review.indexOf('<Video');
  const trimAt = review.indexOf('<TakeClipTagEditor');
  const doneAt = review.indexOf('{PRACTICE_VIDEO_DONE_CTA}');
  if (videoAt < 0 || trimAt < 0 || doneAt < 0) return false;
  if (trimAt < videoAt || doneAt < trimAt) return false;
  // NOTHING OPENS ITSELF OVER IT: the editor is mounted on this surface gated on
  // the user's own press, and the old auto-open line is gone from the whole file.
  if (src.indexOf('visible={editorOpen && !!take}') < 0) return false;
  return src.indexOf('if (take && saved) setEditorOpen(true)') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 6 — THE WATCH SURFACE IS NEVER AN EMPTY PAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE DEFECT. "The user is in the watch with notes page but can't watch anything
 * as there's nothing to watch on the page." With no video on the row, the
 * playback surface rendered a generic missing card and then the overlay and
 * transport for a video that was not there.
 *
 * THE RULE NOW: the page names which case it is (no row / no video but a take /
 * nothing at all) and every one of them offers the move that helps.
 */
export function watchSurfaceIsNeverEmpty(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  const at = src.indexOf("if (phase === 'playback') {");
  if (at < 0) return false;
  const end = src.indexOf("if (!permission || (!permission.granted && phase === 'permissions')) {", at);
  if (end < 0 || end <= at) return false;
  const play = src.slice(at, end);
  if (play.indexOf('const noVideoLine =') < 0) return false;
  for (const line of ['VIDEO_MISSING_LINE', 'VIDEO_NOTHING_TO_WATCH_LINE', 'VIDEO_NOTHING_AT_ALL_LINE']) {
    if (play.indexOf(line) < 0) return false;
  }
  if (play.indexOf('{noVideoLine}') < 0) return false;
  // …and the way out is on the page, wired to a real handler.
  if (play.indexOf('{VIDEO_RECORD_AGAIN_CTA}') < 0) return false;
  return play.indexOf('onPress={handleRecordAgain}') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 7 — THE ONE SCOPED EXTRA: THE BILLING PERMISSION, AND NOTHING ELSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The owner is mid-way through the Google Play Billing application and Play
 * Console cannot create in-app products until an uploaded AAB carries
 * `com.android.vending.BILLING`. This build declares the PERMISSION only: no
 * billing library, no price code, no purchase surface, and the app's own billing
 * switch stays OFF.
 */
export function billingPermissionIsDeclared(
  appJsonSource: string,
  packageSource: string,
  billingModeSource: string,
): boolean {
  if (appJsonSource.length < 500) return false;
  if (countOf(appJsonSource, '"com.android.vending.BILLING"') !== 1) return false;
  // It is inside the android permissions ARRAY, not floating somewhere else.
  const permsAt = appJsonSource.indexOf('"permissions"');
  if (permsAt < 0) return false;
  const arrStart = appJsonSource.indexOf('[', permsAt);
  const arrEnd = appJsonSource.indexOf(']', arrStart);
  if (arrStart < 0 || arrEnd < 0) return false;
  const permissions = appJsonSource.slice(arrStart, arrEnd);
  if (permissions.indexOf('"com.android.vending.BILLING"') < 0) return false;
  if (permissions.indexOf('"android.permission.CAMERA"') < 0) return false;
  // THE PERMISSION ONLY: no billing SDK may ride along.
  const banned = ['react-native-iap', 'expo-in-app-purchases', 'expo-iap', 'react-native-google-play-billing'];
  for (const name of banned) {
    if (packageSource.indexOf(name) >= 0) return false;
  }
  // …and the build still sells nothing.
  return billingModeSource.indexOf('BILLING_ENABLED: boolean = false') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 8 — THE GATE ACTUALLY COMPILES AND RUNS THIS FIX
// ─────────────────────────────────────────────────────────────────────────────

/** A guard nobody runs is not a guard: the module and the suite must be gated. */
export function v50IsGated(tsconfigSource: string, packageSource: string): boolean {
  for (const file of V50_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${file}"`) < 0) return false;
  }
  for (const suite of V50_TIER1_SUITES) {
    if (packageSource.indexOf(`/tmp/tier1-test/${suite}`) < 0) return false;
  }
  return true;
}
