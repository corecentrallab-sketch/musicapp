/**
 * vc58NotesRegressionContract.ts — THE vc57 HANDSET PASS'S RED NOTES-LANE ROWS.
 *
 * The owner tested vc57 (2026-11-13) and the notes lane came back red for the third
 * time: a take with an audible melody said "no melody was heard in this take", and
 * with no cues there was no coverage notice under the lane. Both rows passed on
 * vc54. This module holds the RULES those rows are decided by, as pure functions,
 * so the gate can run them without a handset — and the source readers that pin the
 * wiring, so the rules cannot be true in a file the screen does not call.
 *
 * WHAT THE vc54 → vc57 DIFF DID TO THIS ROW (the whole regression, in two moves):
 *
 *  1. vc55 changed what an EMPTY lane says. `videoCueEmptyLine` returned `null` for
 *     a cue set with no notes (the lane then showed its generic "no notes to draw"
 *     line); from vc55 it returns `VIDEO_NO_MELODY_LINE` — "No melody was heard in
 *     this take." That is a VERDICT about the take.
 *  2. vc56 sliced the notes read so the full-screen window opens on the press
 *     (D23). A synchronous read used to own the JS thread, so the review surface
 *     could not paint mid-read and never showed the lane in its empty state; a
 *     sliced read yields every 8 ms, so the surface NOW paints during the read —
 *     with `row.take === null` and an empty cue set.
 *
 * Put together: for the whole length of the read the lane told the owner his take
 * held no melody, about a take whose melody was being read at that moment. The read
 * itself was fine: `detectPitchFramesAsync` returns the SAME frames as
 * `detectPitchFrames` (proved on real samples in the gate, with no injected clock).
 *
 * THREE RULES, and every one of them is a defect the handset row can show:
 *   R1 an empty lane while the read is in flight says it is READING, never a verdict;
 *   R2 a read that outlives the bound is not thrown away — the bound stops the
 *      quiet wait, not the read, and the take lands when it lands;
 *   R3 the cue timeline knows the take's MEASURED length, so the coverage notice
 *      has an axis even before (or without) any notes.
 *
 * Plain Node, no react-native imports — the gate runs it directly.
 */

export const VC58_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const VC58_SYNC_PATH = 'src/services/videoTakeSync.ts';
export const VC58_PITCH_PATH = 'src/services/pitchDetection.ts';

/**
 * Blank out comments while KEEPING the line count, so a guard can never be
 * satisfied (or broken) by prose. Defect class 14: a mutation probe that edits the
 * first match anywhere can edit a comment instead of the code and report green.
 */
export function maskComments(source: string): string {
  const text = typeof source === 'string' ? source : '';
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * R1 — THE LANE'S EMPTY SENTENCE IS DECIDED BY THE READ, NOT ONLY BY THE CUE SET.
 *
 * The screen must hand the lane `laneEmptyLine(cueSet, takeBusy)`: the in-flight
 * flag is part of the sentence. The vc55/vc57 shape — `videoCueEmptyLine(cueSet)` —
 * is the defect, and it is rejected BY NAME so a half-fix cannot pass.
 */
export function theLaneNeverCallsAVerdictWhileReading(screenSource: string): boolean {
  const code = maskComments(screenSource);
  if (code.indexOf('laneEmptyLine(cueSet, takeBusy)') < 0) return false;
  if (code.indexOf('videoCueEmptyLine(cueSet)') >= 0) return false;
  // The flag it reads must be the one the read itself sets, not a second opinion.
  if (code.indexOf('setTakeBusy(true)') < 0) return false;
  return true;
}

/**
 * R2 — THE BOUND STOPS THE WAIT, NOT THE READ.
 *
 * The vc56/vc57 shape resolved the race to `{ take: null, ... }`, and `take: null`
 * is the surface's word for "no melody in this take". A read that outlived the
 * bound therefore became a verdict on the melody. The fix: the race resolves to
 * `null` ("still reading"), the surface says so, and the read's own result is
 * applied when it lands.
 */
export function theBoundIsNotAVerdictOnTheMelody(screenSource: string): boolean {
  const code = maskComments(screenSource);
  // The old shape: the fallback WAS a no-melody verdict.
  if (code.indexOf('{ take: null, unavailable: true, message:') >= 0) return false;
  // The bound resolves to the "still reading" sentinel…
  if (!/settleWithin\(read, TAKE_DECODE_TIMEOUT_MS, null\)/.test(code)) return false;
  // …the surface says it is still reading…
  if (code.indexOf('setTakeLine(VIDEO_TAKE_STILL_READING_LINE)') < 0) return false;
  // …and the read is still applied when it lands, through the ONE landing path.
  if (!/read\s*\n?\s*\.then\(/.test(code) && code.indexOf('.then((late)') < 0) return false;
  if (code.indexOf('applyDerivedTake(late)') < 0) return false;
  return true;
}

/**
 * R3 — THE COVERAGE NOTICE HAS AN AXIS EVEN WITH NO NOTES.
 *
 * `noteCuesForVideo`'s fallback timeline used to be the take's span alone, so a
 * take with no notes yet had a zero-length axis and the coverage notice had nothing
 * to compare. The surface now hands in the filmed seconds it measured at Stop.
 */
export function theCoverageAxisKnowsTheMeasuredLength(screenSource: string): boolean {
  const code = maskComments(screenSource);
  if (code.indexOf('fallbackDurationSec: measuredTakeSec') < 0) return false;
  if (code.indexOf('notesCoverageLaneNotice(cueSet.timelineSec)') < 0) return false;
  return true;
}

/**
 * The frame-for-frame comparison the gate runs on real samples: `true` only when
 * the two reads produced the same count AND the same `tSec`/`midi`/`rms` on every
 * frame, in order. Extracted so the comparator itself can be proved to bite (a
 * comparator that says `true` to everything is a green gate that is blind).
 */
export interface ComparableFrame {
  tSec: number;
  midi: number | null;
  rms: number;
}

export function framesAreIdentical(
  a: ReadonlyArray<ComparableFrame>,
  b: ReadonlyArray<ComparableFrame>,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left.tSec !== right.tSec) return false;
    if (left.midi !== right.midi) return false;
    if (left.rms !== right.rms) return false;
  }
  return true;
}
