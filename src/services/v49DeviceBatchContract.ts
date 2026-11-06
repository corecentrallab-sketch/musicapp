/**
 * v49DeviceBatchContract.ts — THE LIVE-SOURCE GUARDS FOR THE vc49 DEVICE BATCH
 * (owner email 11-03: the four fixes the owner hit on a real phone, plus the
 * front-page wording).
 *
 * WHY THESE EXIST. The tier1 gate never mounts a screen: `tsconfig.tier1.json`
 * compiles the pure `src/services` modules only, and the source-scan suites read
 * `.tsx` files as TEXT. So the failure that reaches the owner is always the same
 * shape — the code exists, but it is not on the path, or it is on the path but
 * nothing it needs is wired. Each guard below therefore reads the REAL file and
 * asks the narrow question the owner's report asks:
 *
 *   1. CAMERA FLIP — is the camera's `facing` a value the user controls, and is
 *      the control locked while a capture runs? (The defect: `facing="back"`.)
 *   2. TRIM IN THE RECORD FLOW — does the review surface, the one a user reaches
 *      straight after filming, mount the EXISTING clip control and hand it the
 *      EXISTING state, before the flow can be completed? (The defect: the clip
 *      only existed on a saved take's playback screen.)
 *   3. COUNT-IN CLOCK — is the count-in a phase BEFORE any capture, so the two
 *      start stamps and `recordAsync` are still taken together? (The defect class
 *      this prevents: a lead-in inside the capture, which shifts every note.)
 *   4. RECORDING LENGTH — can the choice exceed the 3-minute cap, and does
 *      reaching it stop the take through the normal stop path?
 *   5. FRONT-PAGE COPY — is it the owner's wording, and does it claim a
 *      tablature feature the app does not have?
 *
 * Every guard is MUTATION-PROVEN in scripts/v49DeviceBatch.test.ts: the broken
 * bytes are built in memory from the real file and the guard must return false.
 * The captured failing lines live in
 * /home/team/shared/vc49-mutation-probes.txt.
 *
 * PURE: no react, no react-native, no expo, no fs. Comments are masked first, so
 * a documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

// ─── THE FILES THIS BATCH OWNS ───────────────────────────────────────────────

export const V49_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const V49_OPTIONS_PATH = 'src/services/practiceRecordingOptions.ts';
export const V49_CLIP_EDITOR_PATH = 'src/components/TakeClipTagEditor.tsx';
export const V49_FRONT_DOOR_PATH = 'src/services/frontDoor.ts';
export const V49_HOME_PATH = 'src/screens/HomeScreen.tsx';

/** The pure modules the gate must compile (and their suite must run). */
export const V49_TIER1_MODULES: readonly string[] = [
  'src/services/practiceRecordingOptions.ts',
  'src/services/v49DeviceBatchContract.ts',
  'scripts/v49DeviceBatch.test.ts',
];

export const V49_TIER1_SUITES: readonly string[] = ['scripts/v49DeviceBatch.test.js'];

/** The owner's own front-page wording (owner email 11-03). */
export const V49_FRONT_PAGE_LINE =
  "Find any Song from Jazz and Classical to today's hits";

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

/**
 * The opening element around a handler reference: from the `<TouchableOpacity`
 * that precedes `needle` to its closing tag. Used to prove that a control's
 * `disabled` prop belongs to THAT control, not to some other button on screen.
 */
function elementAround(source: string, needle: string): string {
  const at = source.indexOf(needle);
  if (at < 0) return '';
  const open = source.lastIndexOf('<TouchableOpacity', at);
  if (open < 0) return '';
  const close = source.indexOf('</TouchableOpacity>', at);
  if (close < 0) return '';
  return source.slice(open, close + '</TouchableOpacity>'.length);
}

/** The body of a `const NAME = useCallback(...)` block, to its closing line. */
function callbackBody(source: string, declaration: string): string {
  const at = source.indexOf(declaration);
  if (at < 0) return '';
  const inlineEnd = source.indexOf('\n  }, [', at);
  const multilineEnd = source.indexOf('\n  );', at);
  let marker = -1;
  if (inlineEnd >= 0 && (multilineEnd < 0 || inlineEnd < multilineEnd)) {
    marker = inlineEnd;
  } else if (multilineEnd >= 0) {
    marker = multilineEnd;
  }
  if (marker < 0) return '';
  const end = source.indexOf('\n', marker + 1);
  return source.slice(at, end < 0 ? source.length : end);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — THE CAMERA FLIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The owner's report: "i could not turn it around to face me". The camera's
 * `facing` prop must READ STATE, the state must have both values, a visible
 * control must call the flip handler, and that control must be DISABLED while a
 * capture is running (changing the camera under a live `recordAsync` loses the
 * recording). `mode="video"` and `mute={false}` must survive untouched: the
 * single-mic audio path and the two-file pair depend on them.
 */
export function cameraFacingIsUserControlled(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  // THE JSX TAG, never the type argument `useRef<CameraView>`.
  const opened = /<CameraView\s/.exec(src);
  if (opened === null) return false;
  const close = src.indexOf('/>', opened.index);
  if (close < 0) return false;
  const tag = src.slice(opened.index, close + 2);
  if (tag.length > 1200) return false;
  // A LITERAL facing is the defect itself — either direction.
  if (/facing="/.test(tag)) return false;
  if (tag.indexOf('facing={facing}') < 0) return false;
  // The audio path and the mode are NOT part of this change.
  if (tag.indexOf('mode="video"') < 0) return false;
  if (tag.indexOf('mute={false}') < 0) return false;
  // The state, with both directions reachable.
  if (src.indexOf("useState<CameraFacing>('back')") < 0) return false;
  const handler = callbackBody(src, 'const handleFlipCamera = useCallback(() => {');
  if (handler.length === 0) return false;
  if (handler.indexOf("setFacing('front')") < 0) return false;
  if (handler.indexOf("setFacing('back')") < 0) return false;
  // …and it refuses to fire mid-take, whatever the control's state.
  if (handler.indexOf('if (flipLocked) return;') < 0) return false;
  // The lock itself must name the recording phase.
  const locked = src.slice(src.indexOf('const flipLocked ='), src.indexOf('\n', src.indexOf('const flipLocked =')));
  if (locked.indexOf("'recording'") < 0) return false;
  // THE CONTROL: visible, wired to the handler, disabled by that lock.
  const control = elementAround(src, 'onPress={handleFlipCamera}');
  if (control.length === 0) return false;
  if (control.indexOf('disabled={flipLocked}') < 0) return false;
  if (control.indexOf('FLIP_CAMERA_CTA') < 0) return false;
  return src.indexOf('FLIP_LOCKED_LINE') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — THE TRIM IS OFFERED WHERE THE USER RECORDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The owner: "the trim editor to cut the recording". The clip control already
 * existed — on a SAVED take's playback screen — so a user who had just filmed
 * never saw it. This guard demands the RECORD flow's review surface mount the
 * SAME `TakeClipTagEditor`, reading the SAME `trimSpan`, written through the
 * SAME `handleSpanChange` (which persists it on the row), and that the flow's
 * completion CTA sits AFTER it in the file so it cannot be reached first.
 *
 * It also refuses a second trim model: exactly one `useState<TakeTrimSpan|null>`
 * in the whole screen, and the notes editor must not auto-open over the surface
 * (that modal is what hid the clip in the first place).
 */
export function recordFlowOffersTheTrim(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  // ONE trim model, not two.
  if (countOf(src, 'useState<TakeTrimSpan | null>') !== 1) return false;
  if (src.indexOf('normaliseTrimSpan(') < 0) return false;
  // The record flow's review surface (its own top-level block, 8-space close).
  const reviewAt = src.indexOf("{phase === 'review' ? (");
  if (reviewAt < 0) return false;
  const reviewEnd = src.indexOf('\n        ) : null}', reviewAt);
  if (reviewEnd < 0) return false;
  const review = src.slice(reviewAt, reviewEnd + '\n        ) : null}'.length);
  if (review.indexOf('<TakeClipTagEditor') < 0) return false;
  if (review.indexOf('span={trimSpan}') < 0) return false;
  if (review.indexOf('onSpanChange={(next) => void handleSpanChange(next)}') < 0) return false;
  if (review.indexOf('practiceVideoIsUsable(ref) ?') < 0) return false;
  // The clip is persisted on the row through the ONE handler (so it survives
  // leaving and re-entering the take, and keeps driving `trimmedSendPair`).
  const handler = callbackBody(src, 'const handleSpanChange = useCallback(');
  if (handler.length === 0) return false;
  if (handler.indexOf('normaliseTrimSpan(') < 0) return false;
  if (handler.indexOf('attachPracticeVideo(row.rowId, updated)') < 0) return false;
  // The flow cannot be completed before the trim is offered (the JSX use, not
  // the import at the top of the file).
  const done = src.indexOf('{PRACTICE_VIDEO_DONE_CTA}');
  if (done < 0 || done < reviewAt) return false;
  // …and nothing opens the notes editor over the review surface on save.
  const keep = callbackBody(src, 'const keepTake = useCallback(');
  if (keep.length === 0) return false;
  return keep.indexOf('setEditorOpen(true)') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 3 — THE COUNT-IN CANNOT SHIFT THE TAKE'S START
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE ONE RULE THAT MATTERS: the count-in must not touch the clock. The notes
 * are drawn at `note.startSec + audioOffsetMs/1000`, and `audioOffsetMs` is the
 * measured difference between the two start stamps taken inside
 * `startBothCaptures`. So:
 *
 *   • `startBothCaptures` — the ONLY function that stamps the clocks and calls
 *     `recordAsync` — must contain no count-in input at all;
 *   • Start must route through the `count_in` PHASE and return, so no capture
 *     exists during the countdown;
 *   • the countdown must call `startBothCaptures()` only when it reaches zero.
 *
 * A count-in implemented as a delay inside the capture (or as a stamp taken
 * before it) fails every one of those.
 */
export function countInCannotShiftTheTakeStart(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  // The phase exists in the machine.
  if (src.indexOf("| 'count_in'") < 0) return false;
  // ONE capture entry point.
  if (countOf(src, 'recordAsync(') !== 1) return false;
  const capture = callbackBody(src, 'const startBothCaptures = useCallback(async () => {');
  if (capture.length === 0) return false;
  if (capture.indexOf('videoStartMsRef.current = Date.now()') < 0) return false;
  if (capture.indexOf('audioStartMsRef.current = Date.now()') < 0) return false;
  if (capture.indexOf('recordAsync({') < 0) return false;
  // THE CLOCK RULE: no count-in input reaches the capture start.
  if (/countIn/i.test(capture)) return false;
  // Start routes through the count-in phase and returns before capturing.
  const start = callbackBody(src, 'const handleStart = useCallback(() => {');
  if (start.length === 0) return false;
  const gate = start.indexOf('if (countInSec > 0) {');
  if (gate < 0) return false;
  const startPhase = start.indexOf("setPhase('count_in')", gate);
  if (startPhase < 0) return false;
  const earlyReturn = start.indexOf('return;', startPhase);
  const captureCall = start.indexOf('void startBothCaptures();', startPhase);
  if (earlyReturn < 0 || captureCall < 0) return false;
  if (captureCall < earlyReturn) return false;
  // The countdown is the only thing that starts the captures, and only at zero.
  if (src.indexOf("if (phase !== 'count_in') return undefined;") < 0) return false;
  const effectAt = src.indexOf("if (phase !== 'count_in') return undefined;");
  /**
   * vc50: the effect's dependencies are the PHASE and the CHOICE only. The
   * callback it calls lives in a ref (`startBothCapturesRef`), because a callback
   * built from `useAudioRecorder()` changes identity on every render and used to
   * restart the interval on every render — the "count timer gets stuck" defect.
   */
  const effectEnd = src.indexOf('}, [phase, countInSec]);', effectAt);
  if (effectEnd < 0) return false;
  const effect = src.slice(effectAt, effectEnd);
  // EXACTLY ONE start, and it is inside the zero branch (a second call on any
  // other tick would start a capture mid-count).
  if (countOf(effect, 'startBothCapturesRef.current()') !== 1) return false;
  if (src.indexOf('startBothCapturesRef.current = startBothCaptures;') < 0) return false;
  return /left <= 0[\s\S]{0,240}startBothCapturesRef\.current\(\)/.test(effect);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 4 — THE RECORDING LENGTH CANNOT EXCEED THE CAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The user picks the length; the 3-minute cap stays the outer bound. So the
 * choice is written ONLY through `clampRecordingLength` (one writer), the clamp
 * itself can never return more than `PRACTICE_VIDEO_MAX_SECONDS`, the camera's
 * own `maxDuration` is still the cap, and reaching the chosen length stops the
 * take through the normal `handleStop` — the same path the Stop button uses, so
 * the pair is kept and handed to the trim step rather than truncated.
 */
export function recordingLengthIsBounded(screenSource: string, optionsSource: string): boolean {
  const src = maskComments(screenSource);
  const options = maskComments(optionsSource);
  if (src.length < 20000 || options.length < 2000) return false;
  // THE CLAMP: a hard ceiling at the app's cap.
  const clampAt = options.indexOf('export function clampRecordingLength(');
  if (clampAt < 0) return false;
  const clamp = options.slice(clampAt, options.indexOf('\n}', clampAt) + 2);
  if (clamp.indexOf('Math.min') < 0) return false;
  if (clamp.indexOf('PRACTICE_VIDEO_MAX_SECONDS') < 0) return false;
  // The offered lengths are a real list, and the default is the cap.
  if (options.indexOf('RECORDING_LENGTH_OPTIONS') < 0) return false;
  // ONE writer, and it clamps.
  if (countOf(src, 'setRecordingLengthSec(') !== 1) return false;
  if (src.indexOf('setRecordingLengthSec(clampRecordingLength(') < 0) return false;
  // The camera's own bound is untouched: the cap is not delegated to our timer.
  const call = src.indexOf('recordAsync({');
  if (call < 0) return false;
  const callEnd = src.indexOf('})', call);
  if (callEnd < 0) return false;
  if (src.slice(call, callEnd).indexOf('maxDuration: PRACTICE_VIDEO_MAX_SECONDS') < 0) return false;
  // The chosen length is clamped where it is USED, too.
  if (src.indexOf('const limit = clampRecordingLength(recordingLengthSec);') < 0) return false;
  if (src.indexOf('recordingLengthReached(seconds, limit)') < 0) return false;
  // Reaching it stops the take the normal way (never a silent truncation).
  // vc50: through the current `handleStop`, held in a ref so the timer's own
  // dependencies stay stable (see `countInCannotShiftTheTakeStart`).
  return /autoStopRef\.current[\s\S]{0,400}handleStopRef\.current\(\)/.test(src);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 5 — THE FRONT-PAGE COPY
// ─────────────────────────────────────────────────────────────────────────────

/** The owner's line, read out of the real source (null when absent). */
export function frontPageLineFrom(frontDoorSource: string): string | null {
  const src = maskComments(frontDoorSource);
  const match = /HOME_PROMISE_ALL_GENRES\s*=\s*\n?\s*"([^"]+)"/.exec(src);
  return match ? match[1] : null;
}

/**
 * The owner asked for "Find any Song from Jazz and Classical to today's hits" and
 * for guitar to be mentioned — but this build has NO tablature feature, so no
 * promise may say "tab", "tabs" or "tablature". Guitar may only be named beside
 * what really exists today: the tuner, and the chords/key read from the user's
 * take.
 */
export function frontPageCopyIsHonest(frontDoorSource: string, homeSource: string): boolean {
  const src = maskComments(frontDoorSource);
  const home = maskComments(homeSource);
  if (src.length < 5000 || home.length < 5000) return false;
  if (frontPageLineFrom(src) !== V49_FRONT_PAGE_LINE) return false;
  const guitar = /HOME_PROMISE_GUITAR\s*=\s*\n?\s*"([^"]+)"/.exec(src);
  if (guitar === null) return false;
  const guitarLine = guitar[1];
  if (!/guitar/i.test(guitarLine)) return false;
  if (!/tuner/i.test(guitarLine)) return false;
  // THE HONESTY RULE: no tablature claim anywhere in the front-page promise.
  const promises = `${frontPageLineFrom(src) ?? ''}\n${guitarLine}`;
  if (/\btab(s|ature)?\b/i.test(promises)) return false;
  // …and the line is really RENDERED on the front page, not merely defined.
  return home.indexOf('{homePromiseCopy(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 6 — THE GATE ACTUALLY COMPILES AND RUNS THIS BATCH
// ─────────────────────────────────────────────────────────────────────────────

/** A guard nobody runs is not a guard: the module and the suite must be gated. */
export function v49IsGated(tsconfigSource: string, packageSource: string): boolean {
  const tsconfig = tsconfigSource;
  const pkg = packageSource;
  for (const file of V49_TIER1_MODULES) {
    if (tsconfig.indexOf(`"${file}"`) < 0) return false;
  }
  for (const suite of V49_TIER1_SUITES) {
    if (pkg.indexOf(`/tmp/tier1-test/${suite}`) < 0) return false;
  }
  return true;
}
