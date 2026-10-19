/**
 * audioFocusContract.ts — THE AUDIO-FOCUS CONTRACT (v41 item 1).
 *
 * THE OWNER'S v40 DEVICE PASS (10-18) found EVERY player dead, with the device's
 * own exception pasted into the red chip:
 *
 *   AudioUnavailable: the recording could not be opened on this device
 *   (expo.modules.v.AudioFocusNotAcquiredException…)
 *
 * expo-av raises that ONE exception from exactly one place — AVManager
 * .acquireAudioFocus() — which a Sound or Video calls on the way into a play. It
 * throws in three situations, and the app could reach ALL THREE:
 *
 *   1. `!mEnabled` — audio disabled for the experience. The app never calls
 *      Audio.setIsEnabledAsync, so this is not ours.
 *   2. `mAppIsPaused && !mStaysActiveInBackground` — expo-av's OWN pause flag is
 *      up (a camera / WebView / fullscreen-video / permission-dialog transition
 *      pauses the host) and the session says "do not stay active in background",
 *      so every play from then on throws. This is OUR config, verbatim.
 *   3. The OS refused focus at that instant — transient, and the strongest
 *      request (AUDIOFOCUS_GAIN, which expo-av asks for only when
 *      interruptionModeAndroid is 'doNotMix') is what a foreground app gets.
 *
 * And there was a fourth, app-side hole: `ensurePlaybackAudioMode()` returned
 * early whenever it believed the session was already 'playback', so after the
 * recorder (or a mode apply that timed out) the NATIVE session was never
 * re-established — the app said "playback", the device was still in whatever the
 * recorder left behind. Every play then either failed or was inaudible (expo-av
 * reports a play with no focus as success and plays at volume 0).
 *
 * THIS MODULE is the pure half: the session spec itself, the exception
 * classifier, the retry budget, and the source-scan contract that proves every
 * player call-site goes through the ONE guarded play path
 * (`audioSession.playWithAudioFocus`). No expo, no react, no fs — so the tier1
 * gate can assert all of it.
 *
 * THE PLAYERS IT AUDITS (the owner's list, plus the one that could undo the
 * session): practice video, the take listen rows (raw clip + Hum-Along version,
 * on the editor AND on the tab page), the metronome, and the score player.
 */

/** The session keys a playback session must carry (expo-av validates all five). */
export interface PlaybackSessionSpec {
  playsInSilentModeIOS: boolean;
  allowsRecordingIOS: boolean;
  playThroughEarpieceAndroid: boolean;
  shouldDuckAndroid: boolean;
  /**
   * expo-av's NUMERIC InterruptionModeAndroid (1 = DoNotMix, 2 = DuckOthers). It
   * must be the number: expo-av validates with `InterruptionModeAndroid[value]`
   * against a numeric enum, so the STRING 'doNotMix' is rejected outright and
   * setAudioModeAsync throws — which is why this is a documented constant.
   */
  interruptionModeAndroid: number;
  staysActiveInBackground: boolean;
}

/**
 * THE PLAYBACK SESSION — one definition, applied before every play.
 *
 * • `interruptionModeAndroid: 'doNotMix'` makes expo-av request full
 *   AUDIOFOCUS_GAIN instead of the ducking transient hint, which is the request
 *   the OS grants to the app in front of the user.
 * • `staysActiveInBackground: true` closes expo-av's "in the background" throw
 *   path — the one an activity transition (camera, in-app retailer browser,
 *   fullscreen video) can leave behind. Leaving the app PAUSES the players
 *   through our own AppState guard instead (audioSession.pauseAllAudioPlayers),
 *   so nothing keeps playing behind the user.
 * • `playsInSilentModeIOS` keeps the iOS ringer switch from muting the app;
 *   `allowsRecordingIOS: false` releases the record session the capture flow
 *   opens; `playThroughEarpieceAndroid: false` keeps output on the speaker.
 */
/** expo-av's InterruptionModeAndroid.DoNotMix — the numeric value expo-av accepts. */
export const INTERRUPTION_MODE_ANDROID_DO_NOT_MIX = 1;

export const PLAYBACK_SESSION_SPEC: PlaybackSessionSpec = {
  playsInSilentModeIOS: true,
  allowsRecordingIOS: false,
  playThroughEarpieceAndroid: false,
  shouldDuckAndroid: false,
  interruptionModeAndroid: INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
  staysActiveInBackground: true,
};

/** The recording session: the playback session plus the mic. */
export const RECORDING_SESSION_SPEC: PlaybackSessionSpec = {
  ...PLAYBACK_SESSION_SPEC,
  allowsRecordingIOS: true,
};

/** How many extra attempts a play gets after a focus failure (one retry). */
export const AUDIO_FOCUS_RETRY_LIMIT = 1;
/** How long to wait before the retry (ms) — the OS hands focus back quickly. */
export const AUDIO_FOCUS_RETRY_DELAY_MS = 120;

/**
 * True when the session is configured so expo-av's focus acquisition cannot
 * throw for our own reasons. Asserted by the gate over PLAYBACK_SESSION_SPEC and
 * RECORDING_SESSION_SPEC, so a future edit that flips either key fails loudly.
 */
export function playbackSessionIsFocusSafe(spec: PlaybackSessionSpec): boolean {
  return (
    spec.staysActiveInBackground === true &&
    spec.interruptionModeAndroid === INTERRUPTION_MODE_ANDROID_DO_NOT_MIX &&
    spec.playsInSilentModeIOS === true &&
    spec.playThroughEarpieceAndroid === false
  );
}

/** The words the chip shows when even the retry could not get focus. */
export const AUDIO_FOCUS_FAILED_LINE =
  'this device would not give the app the audio channel';

/**
 * Does this device error come from expo-av's AudioFocusNotAcquiredException?
 * Matched on the message the native module carries, not on the (minified) class
 * name alone, because release builds rewrite `expo.modules.v` and the chip detail
 * is truncated to one line.
 */
export function isAudioFocusError(error: unknown): boolean {
  const text = rawErrorText(error).toLowerCase();
  if (text.length === 0) return false;
  return (
    text.indexOf('audiofocusnotacquired') >= 0 ||
    text.indexOf('audio focus could not be acquired') >= 0 ||
    text.indexOf('audio focus') >= 0 ||
    text.indexOf('audiofocus') >= 0
  );
}

/** A raw error's text: its message, its code, or the string itself. */
function rawErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const record = error as { message?: unknown; code?: unknown; nativeErrorCode?: unknown };
  const parts: string[] = [];
  if (typeof record.message === 'string') parts.push(record.message);
  if (typeof record.code === 'string') parts.push(record.code);
  if (typeof record.nativeErrorCode === 'string') parts.push(record.nativeErrorCode);
  return parts.join(' ');
}

// ─────────────────── the source-scan contract (the tiers) ───────────────────

/**
 * THE PLAYERS. Each of these files plays audio, so each must reach the device
 * through `playWithAudioFocus` — the one path that re-applies the session and
 * retries a refused play.
 */
export const AUDITED_PLAYER_FILES: readonly string[] = [
  'src/hooks/useTakeClipPlayer.ts',
  'src/hooks/useNotePreview.ts',
  'src/hooks/useScoreAudio.ts',
  'src/screens/MetronomeScreen.tsx',
  'src/screens/PracticeVideoScreen.tsx',
];

/** The one guarded play path every player must use. */
export const GUARDED_PLAY_CALLEE = 'playWithAudioFocus';

/** A play call: a player method that STARTS sound. */
const PLAY_CALL_PATTERN = /\.(?:replayAsync|playAsync)\s*\(/g;

/**
 * A load/create call that starts sound BY ITSELF (`shouldPlay: true`) — the
 * practice video and the History clip both load-and-play in one call, so that
 * call is a play. A plain load (`shouldPlay: false`, or none) is not.
 */
const AUTOPLAY_CREATE_PATTERN = /\.(?:createAsync|loadAsync)\s*\(/g;

/**
 * Reads the app's source text: blank out comments (so a commented-out play can
 * never pass), and answer "is this index inside a call to `callee`?" by counting
 * parentheses from the callee's own opening bracket, skipping string literals.
 */
export function insideCallSpan(
  source: string,
  index: number,
  callee: string,
): boolean {
  const text = maskSourceComments(source);
  let from = 0;
  for (;;) {
    const at = text.indexOf(callee, from);
    if (at < 0) return false;
    from = at + callee.length;
    if (!isCalleeToken(text, at, callee)) continue;
    const open = text.indexOf('(', from);
    if (open < 0) return false;
    const close = matchingParen(text, open);
    if (close < 0) return false;
    if (index > open && index < close) return true;
    // Keep looking: a nested guarded call can wrap another one.
  }
}

/** A callee match must be a whole identifier (not `notplayWithAudioFocus`). */
function isCalleeToken(text: string, at: number, callee: string): boolean {
  const before = at > 0 ? text.charAt(at - 1) : '';
  const after = text.charAt(at + callee.length);
  const word = /[A-Za-z0-9_$]/;
  if (before.length > 0 && word.test(before)) return false;
  return !(after.length > 0 && word.test(after));
}

/** The index of the `)` that closes the `(` at `open`, skipping strings. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '"' || ch === "'" || ch === '`') {
      at = skipString(text, at);
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** The index of the closing quote of the string that starts at `quote`. */
function skipString(text: string, quote: number): number {
  const mark = text.charAt(quote);
  for (let at = quote + 1; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '\\') {
      at += 1;
      continue;
    }
    if (ch === mark) return at;
  }
  return text.length;
}

/**
 * Blank `//` and block comments while keeping every offset (so an index found in
 * the masked text is the same index in the real text). Strings are left intact —
 * they are what the copy assertions read.
 */
export function maskSourceComments(source: string): string {
  let out = '';
  let at = 0;
  while (at < source.length) {
    const ch = source.charAt(at);
    const next = source.charAt(at + 1);
    if (ch === '/' && next === '/') {
      while (at < source.length && source.charAt(at) !== '\n') {
        out += ' ';
        at += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      at += 2;
      while (at < source.length) {
        if (source.charAt(at) === '*' && source.charAt(at + 1) === '/') {
          out += '  ';
          at += 2;
          break;
        }
        out += source.charAt(at) === '\n' ? '\n' : ' ';
        at += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(source, at);
      out += source.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    out += ch;
    at += 1;
  }
  return out;
}

/**
 * Every play call in `source` that is NOT inside a `playWithAudioFocus(…)` call,
 * as `<method>@<index>` labels. An empty list means the file's plays are all
 * guarded — which is the contract.
 */
export function unguardedPlayCallSites(source: string): string[] {
  const text = maskSourceComments(source);
  const found: string[] = [];
  collect(text, PLAY_CALL_PATTERN, found, false);
  collect(text, AUTOPLAY_CREATE_PATTERN, found, true);
  return found.sort();
}

function collect(
  text: string,
  pattern: RegExp,
  found: string[],
  autoplayOnly: boolean,
): void {
  const scan = new RegExp(pattern.source, 'g');
  let match = scan.exec(text);
  while (match) {
    const at = match.index;
    const callable = !autoplayOnly || autoPlaysALoadedFile(text, at);
    if (callable && !insideCallSpan(text, at, GUARDED_PLAY_CALLEE)) {
      const method = match[0].replace(/[.(]/g, '');
      found.push(`${method}@${at}`);
    }
    match = scan.exec(text);
  }
}

/**
 * True when the createAsync call at `at` starts its own playback — the options
 * object in its arguments contains `shouldPlay: true`.
 */
export function autoPlaysALoadedFile(source: string, at: number): boolean {
  const open = source.indexOf('(', at);
  if (open < 0) return false;
  const close = matchingParen(source, open);
  if (close < 0) return false;
  const args = source.slice(open, close).replace(/\s+/g, ' ');
  return /shouldPlay:\s*true/.test(args);
}

/** One file's audit result: the plays that bypass the guarded path. */
export interface PlayerAudit {
  file: string;
  guardedCalls: number;
  unguarded: string[];
  ok: boolean;
}

/** Audit one player file. */
export function auditPlayerSource(file: string, source: string): PlayerAudit {
  const text = maskSourceComments(source);
  let guardedCalls = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(GUARDED_PLAY_CALLEE, from);
    if (at < 0) break;
    from = at + GUARDED_PLAY_CALLEE.length;
    if (isCalleeToken(text, at, GUARDED_PLAY_CALLEE)) guardedCalls += 1;
  }
  const unguarded = unguardedPlayCallSites(source);
  return {
    file,
    guardedCalls,
    unguarded,
    ok: guardedCalls > 0 && unguarded.length === 0,
  };
}

/** Audit every player file; returns the ones that are not guarded. */
export function unguardedPlayers(files: Record<string, string>): PlayerAudit[] {
  const audits: PlayerAudit[] = [];
  for (const file of AUDITED_PLAYER_FILES) {
    const source = files[file];
    if (typeof source !== 'string' || source.length === 0) {
      audits.push({ file, guardedCalls: 0, unguarded: ['<file not read>'], ok: false });
      continue;
    }
    audits.push(auditPlayerSource(file, source));
  }
  return audits.filter((audit) => !audit.ok);
}

/**
 * The session must be applied by ONE module and never re-stated by a screen.
 * A screen that calls `Audio.setAudioModeAsync({…})` with its own partial object
 * silently overrides the shared session's keys (expo-av merges the partial mode
 * over the CURRENT one) — that is how the score player used to put
 * `staysActiveInBackground: false` back and re-open the exception path.
 */
export function strayAudioModeCalls(source: string): string[] {
  const text = maskSourceComments(source);
  const found: string[] = [];
  const scan = /\.setAudioModeAsync\s*\(/g;
  let match = scan.exec(text);
  while (match) {
    found.push(`setAudioModeAsync@${match.index}`);
    match = scan.exec(text);
  }
  return found;
}

/** The ONE file allowed to state the session. */
export const AUDIO_SESSION_MODULE = 'src/services/audioSession.ts';
