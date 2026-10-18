/**
 * takePlayback.ts — re-listening to a SAVED take (v33 slice F1, owner 10-04 email
 * batch: "each History melody row gets a playback control that re-listens to the
 * saved take on device").
 *
 * WHAT IT PLAYS. The row's OWN recording: the clip the capture window persisted in
 * `notesnap-melodies/` and stored on the row as `personalMelody.audioUri`. It is
 * NOT re-synthesised from the note data — the user hears the take they actually
 * hummed/whistled/sang, including everything the auto-clean pass did not put back.
 * A row whose clip is gone says so in words and keeps every other action (notes,
 * MIDI export, the correction editor) working: never a dead end, never silence
 * pretending to be audio.
 *
 * PURE (no react / react-native / fs / expo-av): the copy and the availability
 * decision are asserted by scripts/v33UiWiring.test.ts; the expo-av player itself
 * lives in src/hooks/useTakeClipPlayer.ts.
 */

/** Shown while the clip is playing — the SAME button stops it. */
export const TAKE_PLAY_LABEL = '▶ Play take';
export const TAKE_PLAY_BUSY_LABEL = 'Loading…';
export const TAKE_STOP_LABEL = '⏸ Stop';
/** The honest caption under the control: which audio this actually is. */
export const TAKE_PLAYBACK_CAPTION =
  'Plays the recording you saved — your own take, not a re-synthesis.';
/** The clip is not on this device any more (uninstalled, cleared, synced away). */
export const TAKE_PLAYBACK_MISSING_LINE =
  'The saved recording is not on this device any more — your notes, the MIDI export and the editor still work.';
/** expo-av refused to start it (missing audio route, decode failure, file moved). */
export const TAKE_PLAYBACK_FAILED_LINE =
  'Could not play that recording on this device — your notes, the MIDI export and the editor still work.';

/** The row-side facts this decision reads (a SavedPiece's own fields). */
export interface TakePlaybackRow {
  personalMelody?: { audioUri?: string | null } | null;
}

/**
 * Can this row be re-listened to? Only a row that really kept a clip path — a
 * melody row saved before the clip was persisted (or whose clip was cleared) has
 * no audio to play, and the surface must not offer a button that does nothing.
 */
export function takePlaybackAvailable(row: TakePlaybackRow | null | undefined): boolean {
  const uri = row?.personalMelody?.audioUri;
  return typeof uri === 'string' && uri.trim().length > 0;
}

/** The control's label for the row's current state. */
export function takePlaybackLabel(state: {
  playing?: boolean;
  busy?: boolean;
}): string {
  if (state.busy) return TAKE_PLAY_BUSY_LABEL;
  return state.playing ? TAKE_STOP_LABEL : TAKE_PLAY_LABEL;
}

/** What a screen reader hears for the row's control. */
export function takePlaybackAccessibilityLabel(title: string, playing?: boolean): string {
  const name = typeof title === 'string' && title.trim().length > 0 ? title.trim() : 'this take';
  return playing ? `Stop playing the saved take of ${name}` : `Play the saved take of ${name}`;
}

/** The honest line a row shows when the control cannot play anything. */
export function takePlaybackFailureLine(reason: 'missing' | 'failed'): string {
  return reason === 'missing' ? TAKE_PLAYBACK_MISSING_LINE : TAKE_PLAYBACK_FAILED_LINE;
}

// ───────────────── THE TWO VERSIONS OF A TAKE (v40 fix H) ─────────────────
//
// THE OWNER'S ASK, verbatim (10-14 corrections email): "After video practice has
// been recorded, the app takes you to Correct your Take section. From here there
// needs to be a Play your Take button to listen to what was recorded. There is not
// one. There is also a 'Play this Version' button needed for the quantized version.
// Both versions need to be heard."
//
// He is right about the state of the page: the corrected take could only be heard
// through the docked Hum-Along preview row (a "▶ Play" that belongs to the preview
// clock), and the RECORDING he made could not be heard on that page at all — the
// editor is handed the recording's uri but never played it. A take has two
// versions and the page now offers both, named in the user's own words:
//
//   • YOUR TAKE  — the recording itself (`personalMelody.audioUri`), played by the
//     SAME player History uses (hooks/useTakeClipPlayer.ts). Nothing is
//     re-synthesised: it IS what was recorded.
//   • THIS VERSION — the corrected/quantized take, played through the existing
//     Hum-Along preview engine (hooks/useNotePreview.ts → the tone bank). The
//     caption says so, because a re-synthesis must never be passed off as the
//     recording.
//
// The model below is PURE so the gate can prove three things no screenshot can:
// both buttons exist, neither is ever a dead button, and a row can never claim a
// recording it does not have (a gone clip keeps its existing honest line).

/** The heading over the two controls. */
export const TAKE_LISTEN_HEADING = 'Listen to both versions';
export const PLAY_YOUR_TAKE_LABEL = '▶ Play your Take';
export const STOP_YOUR_TAKE_LABEL = '⏸ Stop your Take';
export const PLAY_THIS_VERSION_LABEL = '▶ Play this Version';
export const STOP_THIS_VERSION_LABEL = '⏸ Stop this Version';
/** What each button really plays — the honest caption under it, always shown. */
export const PLAY_YOUR_TAKE_CAPTION = 'Your own recording, exactly as you made it.';
export const PLAY_THIS_VERSION_CAPTION =
  'Your corrected take, played back from NoteSnap’s own tone bank — not a recording.';
/** Shown when the corrected take has no notes to play back yet. */
export const PLAY_THIS_VERSION_EMPTY_LINE =
  'There are no notes in this take to play back yet.';

export interface TakeListenButton {
  label: string;
  /** Never true with no reason: a disabled button always carries its caption. */
  disabled: boolean;
  caption: string;
}

export interface TakeListenModel {
  take: TakeListenButton;
  version: TakeListenButton;
  /** True when at least one of the two really plays something. */
  hasAnyAction: boolean;
}

/**
 * THE TWO CONTROLS for a take's current state. `takeAvailable` is the clip's own
 * availability (`takePlaybackAvailable`), `versionAvailable` whether the corrected
 * take holds any notes. A button that cannot play says WHY instead of going dead.
 */
export function takeListenModel(input: {
  takeAvailable?: boolean;
  takePlaying?: boolean;
  takeBusy?: boolean;
  versionAvailable?: boolean;
  versionPlaying?: boolean;
}): TakeListenModel {
  const takeAvailable = input.takeAvailable === true;
  const versionAvailable = input.versionAvailable === true;
  const take: TakeListenButton = takeAvailable
    ? {
        label: input.takeBusy
          ? TAKE_PLAY_BUSY_LABEL
          : input.takePlaying
            ? STOP_YOUR_TAKE_LABEL
            : PLAY_YOUR_TAKE_LABEL,
        disabled: input.takeBusy === true,
        caption: PLAY_YOUR_TAKE_CAPTION,
      }
    : {
        label: PLAY_YOUR_TAKE_LABEL,
        disabled: true,
        // The recording is gone (uninstalled, cleared, synced away): the button
        // stays on the page with its own reason, so the user is never left
        // wondering whether they mis-tapped.
        caption: TAKE_PLAYBACK_MISSING_LINE,
      };
  const version: TakeListenButton = versionAvailable
    ? {
        label: input.versionPlaying ? STOP_THIS_VERSION_LABEL : PLAY_THIS_VERSION_LABEL,
        disabled: false,
        caption: PLAY_THIS_VERSION_CAPTION,
      }
    : {
        label: PLAY_THIS_VERSION_LABEL,
        disabled: true,
        caption: PLAY_THIS_VERSION_EMPTY_LINE,
      };
  return { take, version, hasAnyAction: takeAvailable || versionAvailable };
}
