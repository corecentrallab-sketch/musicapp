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
