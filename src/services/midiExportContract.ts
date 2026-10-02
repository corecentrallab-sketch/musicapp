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
 * RE-TARGETED FOR BUNDLE A (owner 10-02). The hum screen's own
 * `stage === 'result'` card is retired: a hum match now renders on the ONE shared
 * result surface (`RecognitionResultView`), which renders the export affordance
 * from the caller's `midiExport` contract. So the hum half of this contract is
 * split across the two files that really hold the halves:
 *   • `humTakeReachesSurface(caller, surface)` — the caller keeps the recording it
 *     just made and hands it (plus the export state and the outcome) DOWN;
 *   • `humResultCardOffersMidiExport(surface)` — the surface renders the button,
 *     wired to the caller's own handler and gated on the take;
 *   • `midiExportSurfacesOutcome(caller, surface)` / `rendersDetectedKey(caller,
 *     surface)` — the caller OWNS the state (it sets the outcome, it derives the
 *     key caption from the take's own key) and the surface RENDERS it.
 * The v30 behaviour is unchanged: a take still writes out as a .mid from the
 * surface, and no outcome is ever swallowed.
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

/** The ONE shared result surface, where the hum take's export affordance lives
 *  since bundle A. */
export const RESULT_SURFACE_PATH = 'src/components/RecognitionResultView.tsx';
/** The prop the shared surface renders the export affordance FROM. */
export const MIDI_EXPORT_PROP = 'midiExport';
/** The contract field that carries the recorded take down to the surface. */
export const MIDI_EXPORT_TAKE_FIELD = 'takeUri';

/** True when a failed/empty export is turned into a message the user sees.
 *
 *  TWO honest shapes, because the outcome belongs to the file that OWNS the export
 *  state and can be rendered by it or by the surface it is handed to (bundle A):
 *    • the file renders its own outcome — the History row's
 *      `{exportNote?.id === item.id && …}`;
 *    • the file owns the outcome and hands it to the shared surface
 *      (`note: exportNote`), which renders it — `{midiExport.note && …}`.
 *  Either way the outcome is really RENDERED (not merely stored in state) and is
 *  set by that file's own `setExportNote(…)`: a swallowed outcome is a silent dead
 *  button, and a surface that renders an outcome nobody ever sets shows nothing.
 */
export function midiExportSurfacesOutcome(source: string, surfaceSource?: string): boolean {
  const masked = maskComments(source);
  if (!/setExportNote\s*\(/.test(masked)) return false;
  // Shape 1: the file renders the outcome itself.
  if (/\{\s*exportNote\s*&&/.test(masked) || /\{\s*exportNote\s*\?\./.test(masked)) {
    return true;
  }
  // Shape 2: the file hands the outcome it owns to a surface that renders it.
  if (surfaceSource === undefined) return false;
  if (!/\bnote\s*:\s*exportNote\b/.test(masked)) return false;
  return surfaceRendersExportOutcome(surfaceSource);
}

/** True when the shared surface renders the outcome the caller handed it. */
export function surfaceRendersExportOutcome(surfaceSource: string): boolean {
  const surface = maskComments(surfaceSource);
  return new RegExp(`\\{\\s*${MIDI_EXPORT_PROP}\\.note\\s*(?:&&|\\?)`).test(surface);
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
 * True when the hum take's export AFFORDANCE is really rendered by the shared
 * result surface (bundle A): a `TouchableOpacity` labelled from
 * `MIDI_EXPORT_LABEL` whose `onPress` IS the caller's export handler
 * (`onPress={midiExport.onExport}`), inside a block GATED on the take
 * (`midiExport && midiExport.takeUri`) — so a result with no take shows no button,
 * never a control that could only fail.
 *
 * Pre-bundle-A this scanned the hum screen's `stage === 'result'` block, which no
 * longer exists; the button's home is the surface now, so the contract follows the
 * affordance rather than staying pinned to the retired card.
 */
export function humResultCardOffersMidiExport(surfaceSource: string): boolean {
  const masked = maskComments(surfaceSource);
  const gate = new RegExp(
    `\\{\\s*${MIDI_EXPORT_PROP}\\s*&&\\s*${MIDI_EXPORT_PROP}\\.${MIDI_EXPORT_TAKE_FIELD}\\s*\\?`,
  );
  if (!gate.test(masked)) return false;
  const press = new RegExp(`onPress=\\{\\s*${MIDI_EXPORT_PROP}\\.onExport\\s*\\}`);
  const at = masked.search(press);
  if (at < 0) return false;
  const button = enclosingElement(masked, at, 'TouchableOpacity');
  return button.length > 0 && button.indexOf(MIDI_EXPORT_LABEL_IDENTIFIER) >= 0;
}

/**
 * True when the take the hum pass RECORDED reaches the shared result surface:
 *
 *   1. the caller keeps the stopped recording's OWN URI (`setTakeUri(stopped.uri)`);
 *   2. it hands that URI into the surface's export contract
 *      (`midiExport={{ takeUri, … }}`) — not a copy, not a preview asset;
 *   3. when the surface source is supplied, the surface consumes it
 *      (`midiExport.takeUri`) to decide whether the button exists at all.
 *
 * A caller that exported some other (or no) audio would be a fabricated export,
 * and a surface that never read the take would render a button that can only fail.
 */
export function humTakeReachesSurface(callerSource: string, surfaceSource?: string): boolean {
  const masked = maskComments(callerSource);
  if (!/setTakeUri\s*\(\s*stopped\.uri\s*\)/.test(masked)) return false;
  const handoff = new RegExp(
    `\\b${MIDI_EXPORT_PROP}\\s*=\\s*\\{\\{[\\s\\S]{0,240}?\\b${MIDI_EXPORT_TAKE_FIELD}\\b`,
  );
  if (!handoff.test(masked)) return false;
  if (surfaceSource === undefined) return true;
  const surface = maskComments(surfaceSource);
  return new RegExp(`\\b${MIDI_EXPORT_PROP}\\.${MIDI_EXPORT_TAKE_FIELD}\\b`).test(surface);
}

/** Source of the `TouchableOpacity` element enclosing `at` ('' when there is
 *  none, i.e. the handler is not attached to a button at all). */
function enclosingElement(masked: string, at: number, tag: string): string {
  const open = masked.lastIndexOf(`<${tag}`, at);
  if (open < 0) return '';
  const close = masked.indexOf(`</${tag}`, at);
  if (close < 0) return '';
  return masked.slice(open, close);
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

/** The object literal that starts at/after `open` (or '' when there is none). */
function objectLiteralAt(masked: string, open: number): string {
  if (open < 0) return '';
  return blockFrom(masked, open);
}

// ─── The detected key reaches the FILE and the SCREEN ───────────

/** The encoder call the device-side take export must make. */
export const ENCODE_MIDI_CALL = 'encodeMidiFile(';
/** The exported-outcome status whose object must carry the key back to the UI. */
export const MIDI_EXPORTED_STATUS_LITERAL = "status: 'exported'";
/** The key-caption helper the screens render the detected key from. */
export const KEY_CAPTION_CALL = 'keyCaption(';

/** `key: take?.key ?? null` — the take's own detected key, never anything else. */
const DETECTED_KEY_FIELD = /\bkey\s*:\s*take\??\.\s*key\b/;

/**
 * True when the take-export path (services/captureMidiExport.ts) really THREADS
 * the take's detected key — both halves of it:
 *
 *   1. the encodeMidiFile call RECEIVES it, so the SMF key-signature meta event
 *      (FF 59 02 sf mi) is actually written when a key exists;
 *   2. the 'exported' outcome CARRIES it, so the surface can name the key.
 *
 * This is the guard for the exact defect it exists for: the key is computed
 * (`take.key`), the encoder supports it (`MidiFileInput.key`), and the value is
 * nevertheless dropped between them — leaving a file with no key signature and
 * a card that can never show the key. A green logic test cannot see that: the
 * device path imports expo-file-system, so nothing compiles or runs it under
 * plain Node (the coachCapture seam has the same shape).
 */
export function takeExportThreadsDetectedKey(source: string): boolean {
  const masked = maskComments(source);
  const callAt = masked.indexOf(ENCODE_MIDI_CALL);
  if (callAt < 0) return false;
  const encodeArgs = objectLiteralAt(masked, masked.indexOf('{', callAt));
  if (!DETECTED_KEY_FIELD.test(encodeArgs)) return false;

  const statusAt = masked.indexOf(MIDI_EXPORTED_STATUS_LITERAL);
  if (statusAt < 0) return false;
  const outcome = objectLiteralAt(masked, masked.lastIndexOf('{', statusAt));
  return DETECTED_KEY_FIELD.test(outcome);
}

/**
 * True when a surface renders the DETECTED key honestly:
 *
 *   • the caption is DERIVED from the detected key the file holds (its
 *     `result.key`, its `take.key`, or the capture the History row carries) —
 *     a hardcoded "Key: C major" would be a guess and fails here;
 *   • the caption line is CONDITIONAL (`{exportKey && …}` /
 *     `{keyCaption(…) && …}` / the shared surface's `{midiExport.keyLine && …}`),
 *     so a take with no detected key shows no key text at all rather than a
 *     placeholder.
 *
 * The two halves may live in two files since bundle A: the hum caller derives the
 * caption from the take it owns and hands the line down (`keyLine: exportKey`),
 * and the shared surface renders it. Pass the surface source for that pair; a file
 * that derives AND renders its own key (the History row) is complete on its own.
 */
export function rendersDetectedKey(callerSource: string, surfaceSource?: string): boolean {
  const caller = maskComments(callerSource);
  if (caller.indexOf(KEY_CAPTION_CALL) < 0) return false;
  const derived = /keyCaption\s*\(\s*(?:result\b|take\b|item\??\.capture)/.test(caller);
  if (!derived) return false;
  if (/\{\s*(?:exportKey|keyCaption\([^)]*\))\s*&&/.test(caller)) return true;
  // The caption is derived HERE and rendered by the surface it is handed to.
  if (surfaceSource === undefined) return false;
  if (!/\bkeyLine\s*:\s*exportKey\b/.test(caller)) return false;
  const surface = maskComments(surfaceSource);
  return new RegExp(`\\{\\s*${MIDI_EXPORT_PROP}\\.keyLine\\s*&&`).test(surface);
}
