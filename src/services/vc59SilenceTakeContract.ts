/**
 * vc59SilenceTakeContract.ts — THE SILENCE-TAKE FIX (D24 + D25), AND ITS GUARDS.
 *
 * THE TWO DEFECTS THIS PINS, both found on the surface a user lands on straight
 * after filming a practice video:
 *
 *   D24 — THE WRONG SENTENCE. When the note read ran and heard nothing, the review
 *         page printed the MIDI EXPORT's message ("…to write a MIDI file…") — a file
 *         format the user never asked for. The watch page already said "No melody
 *         was heard in this take."; the landing surface now says the same thing, in
 *         the app's own words, and keeps the honest decoder-unavailable sentence for
 *         the case where the read never ran at all.
 *
 *   D25 — THE RETAKE THAT COULD NOT RECORD. "Record the notes on their own" called
 *         a function that started the recorder and stopped it on the very next
 *         line: no phase, no Stop control, no clock, a few tens of milliseconds of
 *         whatever was in the room. The user was never given the chance to play the
 *         phrase. It now opens a real record window (`notes_only`) with a clock, the
 *         level meter and a Stop the user presses — and NO camera, which is also the
 *         fix for the watch page flipping into a live preview when that CTA was
 *         pressed from the watch surface.
 *
 * WHY THESE GUARDS EXIST AT ALL. The shipped guards (`scripts/vc54TakeSaveAndCues`
 * and `vc55DeviceFixContract`) asserted that the CTA STRING appeared twice — which
 * it did, on a button that could not record anything, and on a page that spoke in
 * export language. A guard that counts a button is blind to what the button does.
 *
 * Both guards are run again over MUTATED real bytes in
 * `scripts/vc59SilenceTake.test.ts`; each must FAIL there.
 */

import { maskCommentsKeepingLines } from './notesCoverage';

/** The one file these guards read. */
export const VC59_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';

/**
 * The body of the function that starts at `at`, by brace matching — so a guard
 * cannot be fooled by a fixed-size window that runs into the NEXT function (the
 * old `slice(at, at + 900)` idiom: it would have read the Stop's own
 * `stopRecording()` as if it belonged to the start).
 */
function functionBody(source: string, at: number): string {
  const open = source.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — THE CAMERA-OFF RETAKE RECORDS UNTIL THE USER STOPS IT (D25)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE PROPERTY, in three parts, because any one alone leaves the defect alive:
 *
 *   1. `recordSeparateTake` does NOT stop the recorder. Its body may start the
 *      recorder and open the window; it may not contain `stopRecording` at all.
 *      This is the D25 defect stated as a rule: the stop is never the next line.
 *   2. The stop is a control the user presses: `stopSeparateTake` stops the
 *      recorder and keeps the take through `keepTake(stopped.uri, true)`, and the
 *      window's render wires that callback to a real `TouchableOpacity` carrying
 *      the Stop CTA, beside the clock and the level meter.
 *   3. The window mounts NO camera — the same fact that stops the watch page
 *      flipping into a live preview when the CTA is pressed there.
 */
export function theCameraOffRetakeWaitsForTheUserToStop(screenSource: string): boolean {
  const src = maskCommentsKeepingLines(typeof screenSource === 'string' ? screenSource : '');
  if (src.length < 20000) return false;

  // The phase the window opens in is part of the machine, not a flag beside it.
  if (src.indexOf("| 'notes_only'") < 0) return false;

  // (1) THE START DOES NOT STOP ITSELF.
  const startAt = src.indexOf('const recordSeparateTake = useCallback(');
  if (startAt < 0) return false;
  const startBody = functionBody(src, startAt);
  if (startBody.length === 0) return false;
  if (startBody.indexOf('stopRecording') >= 0) return false;
  // …and it really starts the recorder and opens the window.
  if (startBody.indexOf('startRecording()') < 0) return false;
  if (startBody.indexOf("setPhase('notes_only')") < 0) return false;

  // (2) THE STOP IS A CONTROL THE USER PRESSES.
  const stopAt = src.indexOf('const stopSeparateTake = useCallback(');
  if (stopAt < 0) return false;
  const stopBody = functionBody(src, stopAt);
  if (stopBody.length === 0) return false;
  if (stopBody.indexOf('recorder.stopRecording()') < 0) return false;
  if (stopBody.indexOf('keepTake(stopped.uri, true)') < 0) return false;

  const blockAt = src.indexOf("{phase === 'notes_only' ? (");
  if (blockAt < 0) return false;
  const block = src.slice(blockAt, blockAt + 1800);
  if (block.indexOf('onPress={() => void stopSeparateTake()}') < 0) return false;
  if (block.indexOf('{VIDEO_NOTES_ON_ITS_OWN_STOP_CTA}') < 0) return false;
  if (block.indexOf('recordingClock(elapsedSec)') < 0) return false;
  if (block.indexOf('recorder.liveLevels') < 0) return false;

  // (3) NO CAMERA IN THAT WINDOW.
  return src.indexOf("phase !== 'review' && phase !== 'notes_only'") >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — THE SURFACE SPEAKS ITS OWN VERDICT, NOT THE EXPORT'S (D24)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE PROPERTY:
 *   • the MIDI export's no-melody sentence is not on this surface at all — not
 *     imported, not rendered, not passed through a variable;
 *   • the one landing path (`applyDerivedTake`) asks the ONE reader
 *     (`takeReadLine(takeReadOutcome(derived), …)`, services/takeReadVerdict.ts) for
 *     its words, and hands the export's own message over only as
 *     `unavailableMessage` — the read that could not run;
 *   • and that sentence reaches the page: the review surface renders `takeLine`
 *     while the read is NOT in flight — which is exactly the state a finished read
 *     leaves behind, and the state the user lands in.
 */
export function theSurfaceSpeaksItsOwnNoMelodySentence(screenSource: string): boolean {
  const src = maskCommentsKeepingLines(typeof screenSource === 'string' ? screenSource : '');
  if (src.length < 20000) return false;

  // The export's words belong to the export.
  if (src.indexOf('MIDI_NO_MELODY_MESSAGE') >= 0) return false;

  const at = src.indexOf('const applyDerivedTake = async (');
  if (at < 0) return false;
  const body = functionBody(src, at);
  if (body.length === 0) return false;
  /**
   * vc60 ROUTED THE SENTENCE THROUGH ONE READER, and the property survived the
   * rewrite: the landing path no longer names `VIDEO_NO_MELODY_LINE` itself, it
   * asks `takeReadLine(takeReadOutcome(derived), …)` — and the export's own message
   * reaches that reader ONLY as `unavailableMessage`, the read that never ran. A
   * read that ran and heard nothing still gets the lane's own sentence, which the
   * reader returns (services/takeReadVerdict.ts). The guard follows the WIRING, not
   * the deleted line of text: a guard keyed to exact source text goes green by
   * dying, which is the one way it can lie.
   */
  if (body.indexOf('takeReadLine(takeReadOutcome(derived)') < 0) return false;
  // The read that never ran keeps its own honest sentence — and nothing else does.
  if (body.indexOf('unavailableMessage: derived.message') < 0) return false;

  // …and it reaches the review page when the read has finished and there is no take.
  if (src.indexOf('{!takeBusy && takeLine ?') < 0) return false;
  return src.indexOf('{takeLine}') >= 0;
}
