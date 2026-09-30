/**
 * midiExportContract.ts — the source-scan contracts behind "Export MIDI"
 * (MIDI export Batch A). Pure text predicates over the app's own source, in the
 * style of humBridge.ts / scoreAudioSource.ts: a wiring bug (an affordance that
 * was never wired to the captured take, an export whose outcome is swallowed)
 * cannot be caught by a logic test and there is no emulator on this box.
 *
 * The v29 theses these guards exist for:
 *   • the money/feature surface must RESOLVE — an "Export MIDI" button that
 *     never reaches the captured take is a dead control, exactly the class of
 *     defect the RC rounds keep finding (v28 Test 4b, PR #115/#123);
 *   • failures must be VISIBLE — an export that fails silently reads as a dead
 *     button, so the outcome message has to reach the screen;
 *   • History must export the SAME take the result screen exported — the row
 *     carries the derived capture, and the export consumes it.
 *
 * Pure: no react / react-native / expo imports, so the tier1 gate compiles and
 * runs it under plain Node (tsconfig.tier1.json).
 */
import { maskComments } from './modalBackContract';

/** The hum screen's export call (the recording-URI path). */
export const HUM_MIDI_EXPORT_CALL = 'exportCaptureMidiFromRecording(';
/** The History row's export call (the stored-take path). */
export const HISTORY_MIDI_EXPORT_CALL = 'exportCaptureMidiFromTake(';
/**
 * The EXPORT LABEL IDENTIFIER the screens render. The scan looks for the
 * identifier (`MIDI_EXPORT_LABEL`), not its current value — the copy itself is
 * pinned in the tier1 suite, so a reworded label cannot silently become a
 * hardcoded string on one screen and a constant on the other.
 */
export const MIDI_EXPORT_LABEL_IDENTIFIER = 'MIDI_EXPORT_LABEL';

/** True when a failed/empty export is turned into a message the user sees. */
export function midiExportSurfacesOutcome(source: string): boolean {
  const masked = maskComments(source);
  // The screen must CONDITIONALLY RENDER the outcome text (`{exportNote && …}`
  // on the hum card, `{exportNote?.id === item.id && …}` on a History row) and
  // not merely store it in state — a swallowed outcome is a silent dead button.
  const renders =
    /\{\s*exportNote\s*&&/.test(masked) || /\{\s*exportNote\s*\?\./.test(masked);
  return renders && /setExportNote\s*\(/.test(masked);
}

/**
 * True when the hum screen exports from the take it just RECORDED: the stopped
 * recording's own URI is kept in state and handed to the export call. A form
 * that exported some other (or no) audio would be a fabricated export.
 */
export function humExportConsumesRecordedTake(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(HUM_MIDI_EXPORT_CALL) < 0) return false;
  const keepsUri = /setTakeUri\s*\(\s*stopped\.uri\s*\)/.test(masked);
  const passesUri = /\buri\s*:\s*\w*[Tt]akeUri\b/.test(masked);
  return keepsUri && passesUri;
}

/**
 * True when the hum screen's RESULT card carries the export affordance — the
 * button is inside the `stage === 'result'` block and labelled from
 * MIDI_EXPORT_LABEL, so the label cannot drift from the tested copy.
 */
export function humResultCardOffersMidiExport(source: string): boolean {
  const masked = maskComments(source);
  const marker = masked.indexOf("stage === 'result'");
  if (marker < 0) return false;
  // The JSX block ENCLOSING the marker is the result card (`{stage === 'result'
  // && … ( … )}`), so the brace just before the condition is the one to match.
  const open = masked.lastIndexOf('{', marker);
  if (open < 0) return false;
  const block = blockFrom(masked, open);
  if (!block) return false;
  return (
    block.indexOf(MIDI_EXPORT_LABEL_IDENTIFIER) >= 0 &&
    (block.indexOf('handleExportMidi') >= 0 || block.indexOf(HUM_MIDI_EXPORT_CALL) >= 0)
  );
}

/**
 * True when a History row exports the capture it CARRIES: the row's own
 * `item.capture` reaches the export call. Guards the "History items that came
 * from a capture" half of the feature — a row with no capture must not offer a
 * button that could only fail.
 */
export function historyRowOffersMidiExport(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(HISTORY_MIDI_EXPORT_CALL) < 0) return false;
  const rendersCapture = /\bitem\.capture\b/.test(masked);
  const passesCapture = /exportCaptureMidiFromTake\(\s*[^)]*item\.capture/.test(masked);
  return (
    rendersCapture &&
    passesCapture &&
    masked.indexOf(MIDI_EXPORT_LABEL_IDENTIFIER) >= 0
  );
}

/** Source from the `{` at `open` to its matching `}` (or '' if unbalanced). */
function blockFrom(masked: string, open: number): string {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return '';
}
