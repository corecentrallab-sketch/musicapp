/**
 * notesCoverage.ts — HOW FAR THE NOTES REACH, IN ONE PLACE (vc57, D21).
 *
 * THE OWNER (11-11, verbatim): *"this can seem to be misleading for the user
 * thinking they have as much time as they need. Put in an indicator that shows the
 * amount of time they actually have - not think they have. We can always raise the
 * cap later if the demand is there for more time."*
 *
 * THE TWO NUMBERS THAT ARE DIFFERENT, AND MUST NEVER BE CONFUSED:
 *   • the practice video records up to `PRACTICE_VIDEO_MAX_SECONDS` (180 s);
 *   • the notes are decoded server-side and truncated to 60 s — `MAX_RETURN_SECONDS`
 *     in the SITE repo's `src/services/coach-pcm-handler.ts`.
 * A two-minute take therefore has notes for its first minute and nothing after,
 * and until vc57 the app said nothing about it: a lane that stopped halfway read
 * as "the app is broken" or "I played it badly". Both wrong. The cap is NOT raised
 * (owner decision); the app tells the truth instead.
 *
 * ONE CONSTANT, ONE SOURCE OF TRUTH: `NOTES_COVERAGE_SECONDS` below. Every
 * indicator renders from it — the record surface states it before a take, and the
 * notes lane states it on a take longer than it covers — so a raised cap is one
 * number and no copy left behind. `straySixtyLiterals()` is the guard that keeps a
 * second hardcoded 60 out of the practice-video path.
 *
 * CROSS-REPO PIN: the app constant and the server cap live in TWO repositories and
 * a mismatch is invisible — raise the server cap and the app keeps telling users
 * 60, which is a lie. `serverNotesCapSeconds()` reads the cap out of the handler's
 * source; the tier1 suite compares it with the constant. The APP-SIDE assertion is
 * unconditional (a guard that skips when the site checkout is missing is blind);
 * the cross-repo half reports loudly when it cannot see the handler.
 *
 * PURE: no react, no react-native, no fs, no network. The files the guards read are
 * passed in as STRINGS; the test does the reading.
 */

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE NUMBER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE SECONDS OF A TAKE THE NOTES ACTUALLY COVER.
 *
 * It mirrors `MAX_RETURN_SECONDS` in the site repo's coach-pcm-handler.ts. It is
 * 60 because that is what the server decodes and returns today — NOT a product
 * choice this file is free to make. Raising it is a server change first, then this
 * number, and the cross-repo pin below fails until both agree.
 */
export const NOTES_COVERAGE_SECONDS = 60;

/** `1:00` — the coverage as a clock, built from the one constant. */
export function notesCoverageClock(seconds: number = NOTES_COVERAGE_SECONDS): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * ── 2. SAY IT BEFORE THE USER RECORDS ────────────────────────────────────────
 *
 * One honest line on the record surface, in the same voice as "Up to 3 minutes per
 * practice video". Not a warning banner, not an error: the take is fine, the notes
 * simply stop at the coverage. The number is interpolated, never typed.
 */
export function notesCoverageRecordLine(seconds: number = NOTES_COVERAGE_SECONDS): string {
  const coverage = Math.max(0, Math.round(Number(seconds) || 0));
  return `The notes cover the first ${coverage} seconds of a take. Film for longer and the video keeps going, but the notes stop at ${notesCoverageClock(coverage)}.`;
}

/** The record surface's line, from the one constant. */
export const NOTES_COVERAGE_RECORD_LINE = notesCoverageRecordLine();

/**
 * ── 3/4/5. SAY IT ON THE TAKE WHEN IT BITES ─────────────────────────────────
 *
 * The lane used to trail off into blank space with no explanation. The sentence is
 * about the APP's window, never about the user's playing ("not anything you played
 * wrong" is the disclaimer, said plainly), and it is never a dead end: it names the
 * trim, which is a real control on the surface the lane sits on.
 */
export function notesCoverageLaneLine(seconds: number = NOTES_COVERAGE_SECONDS): string {
  const coverage = Math.max(0, Math.round(Number(seconds) || 0));
  return `The notes run to ${coverage} seconds and stop there — that is the whole window NoteSnap asks for, not anything you played wrong. Trim the clip to the part the notes cover.`;
}

/** The lane's line, from the one constant. */
export const NOTES_COVERAGE_LANE_LINE = notesCoverageLaneLine();

/**
 * Is this take longer than the notes cover? The timeline handed in is the SAME
 * axis the lane draws on (`VideoCueSet.timelineSec`), so the sentence and the
 * pixels can never disagree about how long the take is.
 */
export function takeIsLongerThanTheNotesCover(
  timelineSec: number,
  coverage: number = NOTES_COVERAGE_SECONDS,
): boolean {
  const timeline = Number(timelineSec);
  const limit = Number(coverage);
  if (!Number.isFinite(timeline) || !Number.isFinite(limit)) return false;
  return timeline > limit;
}

/**
 * What the lane says under itself: the honest sentence when the take runs past the
 * coverage, and NOTHING at all when it does not. A take inside the coverage has no
 * limit to explain, and a line there would invent a problem the user does not have.
 */
export function notesCoverageLaneNotice(
  timelineSec: number,
  coverage: number = NOTES_COVERAGE_SECONDS,
): string | null {
  return takeIsLongerThanTheNotesCover(timelineSec, coverage)
    ? notesCoverageLaneLine(coverage)
    : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CROSS-REPO PIN
// ─────────────────────────────────────────────────────────────────────────────

/** Where the cap lives in the site repo. */
export const SITE_COACH_HANDLER_PATH = 'src/services/coach-pcm-handler.ts';

/**
 * The site checkouts to look in, in order. `overridePath` is the caller's own
 * candidate (the tier1 suite passes `NOTESNAP_SITE_COACH_HANDLER` so a probe can
 * point the pin at a mutated copy without touching the shared checkout).
 */
export function siteCoachHandlerCandidates(overridePath?: string): string[] {
  const list: string[] = [];
  const override = typeof overridePath === 'string' ? overridePath.trim() : '';
  if (override.length > 0) list.push(override);
  list.push(`/home/team/shared/site-fresh/${SITE_COACH_HANDLER_PATH}`);
  list.push(`/home/team/shared/site/${SITE_COACH_HANDLER_PATH}`);
  return list;
}

/**
 * THE SERVER'S CAP, read out of the handler's source.
 *
 * `null` means "I could not read it" — the constant was renamed or removed — and
 * that is a FAILURE of the pin, not a pass: a pin that silently stops reading the
 * server is blind (defect class 4). Only a real number can agree or disagree.
 */
export function serverNotesCapSeconds(source: string): number | null {
  const text = maskCommentsKeepingLines(typeof source === 'string' ? source : '');
  const match = /const\s+MAX_RETURN_SECONDS\s*=\s*(\d+)\s*;/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Does the server cap the pin read agree with the app's constant? */
export function serverCapAgreesWithTheApp(serverSeconds: number | null): boolean {
  return serverSeconds !== null && serverSeconds === NOTES_COVERAGE_SECONDS;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SOURCE GUARDS (pure: the source text is handed in)
// ─────────────────────────────────────────────────────────────────────────────

export const VC57_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const VC57_LANE_PATH = 'src/components/VideoOverlayLane.tsx';
export const NOTES_COVERAGE_MODULE_PATH = 'src/services/notesCoverage.ts';

/**
 * THE FILES THAT MAKE UP THE PRACTICE-VIDEO PATH. The stray-60 guard reads every
 * one of them, so a hardcoded 60 cannot hide in a service instead of the screen.
 */
export const PRACTICE_VIDEO_PATH_FILES: readonly string[] = [
  VC57_SCREEN_PATH,
  VC57_LANE_PATH,
  NOTES_COVERAGE_MODULE_PATH,
  'src/services/videoTakeSync.ts',
  'src/services/practiceVideoRef.ts',
  'src/services/practiceRecordingOptions.ts',
  'src/services/videoOverlayLayout.ts',
  'src/services/videoScrub.ts',
  'src/services/videoCompare.ts',
  'src/services/videoSendTo.ts',
  'src/services/practiceVideoSave.ts',
];

/**
 * Strip comments WITHOUT moving a line: a comment becomes spaces of the same
 * length, so a guard's reported line number is the line in the real file. Prose
 * must never satisfy a guard, and a multi-line comment must never swallow the
 * lines after it.
 */
export function maskCommentsKeepingLines(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length));
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = text.indexOf(needle);
  while (from >= 0) {
    count += 1;
    from = text.indexOf(needle, from + needle.length);
  }
  return count;
}

/**
 * GUARD 1 — THE RECORD SURFACE STATES THE LIMIT BEFORE ANYTHING IS FILMED.
 *
 * It must appear on BOTH pre-record surfaces (the permission gate and the record
 * body), because the owner's rule is that no page in this flow is a dead end and
 * a user can start a take from either. Rendered from the constant, never typed.
 */
export function recordSurfaceStatesTheLimit(source: string): boolean {
  const text = maskCommentsKeepingLines(source);
  return countOccurrences(text, '{NOTES_COVERAGE_RECORD_LINE}') >= 2;
}

/**
 * GUARD 2 — EVERY LANE STATES THE LIMIT WHEN THE TAKE IS LONGER THAN IT.
 *
 * The lane is rendered twice (the watch page and the full-screen notes window) and
 * this repo has shipped a fix applied to one of them before. Each lane element must
 * be followed by its own notice render, and the notice must be derived from the
 * cue timeline through this module — so the sentence, the axis and the constant are
 * one chain and not three opinions.
 */
export function everyLaneStatesTheNotesLimit(source: string): boolean {
  const text = maskCommentsKeepingLines(source);
  const laneAt = [...text.matchAll(/<VideoOverlayLane\b/g)].map((match) => match.index ?? -1);
  const noticeAt = [...text.matchAll(/\{\s*coverageLine\s*\?/g)].map((match) => match.index ?? -1);
  if (laneAt.length === 0) return false;
  if (noticeAt.length !== laneAt.length) return false;
  return laneAt.every((lane, index) => {
    const next = index + 1 < laneAt.length ? laneAt[index + 1] : text.length;
    return noticeAt.some((notice) => notice > lane && notice < next);
  });
}

/** The notice is computed from the cue timeline, through this module's function. */
export function theNoticeIsComputedFromTheCueTimeline(source: string): boolean {
  const text = maskCommentsKeepingLines(source);
  return /notesCoverageLaneNotice\(\s*cueSet\.timelineSec\s*\)/.test(text);
}

/**
 * GUARD 3 — NO SECOND HARDCODED 60 IN THE PRACTICE-VIDEO PATH.
 *
 * The coverage number may be written once, in `NOTES_COVERAGE_SECONDS`. The
 * remaining 60s in this path are NOT the coverage and are exempt by concept (not by
 * exact text, so rewriting them does not silently disarm the guard):
 *   • MINUTE ARITHMETIC — `total % 60`, `Math.floor(total / 60)`, `(value + 60) / 60`
 *     convert seconds to a clock; they are 60 seconds to a minute.
 *   • MIDDLE C — a MIDI pitch default (`minPitch: 60`) is the note, not a duration.
 *   • THE TAKE'S OWN LENGTH — `RECORDING_LENGTH_OPTIONS` offers 60 s as a recording
 *     length and `PRACTICE_VIDEO_WARN_SECONDS` is the warning point of the 180 s cap.
 *     Both are about how long the VIDEO is, never about how far the notes reach.
 * Anything else — an inline "60 seconds" of copy, a second coverage constant, a
 * hand-typed number in a label — is a stray and fails.
 */
const MINUTE_ARITHMETIC = /(?:[%+*/-]\s*60\b|\b60\s*[%+*/-])/;
const MIDDLE_C_PITCH = /pitch/i;
const THE_TAKES_OWN_LENGTH = /RECORDING_LENGTH|WARN_SECONDS/;
const THE_ONE_COVERAGE_DEFINITION = /(?:export\s+)?const\s+NOTES_COVERAGE_SECONDS\s*=\s*60\b/;

export interface PracticeVideoSource {
  path: string;
  source: string;
}

export interface StraySixty {
  path: string;
  line: number;
  text: string;
}

/** Every `60` in the practice-video path that is NOT one of the exemptions above. */
export function straySixtyLiterals(files: ReadonlyArray<PracticeVideoSource>): StraySixty[] {
  const strays: StraySixty[] = [];
  for (const file of files) {
    const lines = maskCommentsKeepingLines(file.source).split('\n');
    lines.forEach((line, index) => {
      if (!/\b60\b/.test(line)) return;
      if (file.path === NOTES_COVERAGE_MODULE_PATH && THE_ONE_COVERAGE_DEFINITION.test(line)) return;
      if (MINUTE_ARITHMETIC.test(line)) return;
      if (MIDDLE_C_PITCH.test(line)) return;
      if (THE_TAKES_OWN_LENGTH.test(line)) return;
      strays.push({ path: file.path, line: index + 1, text: line.trim() });
    });
  }
  return strays;
}
