/**
 * audioSession.ts — THE AUDIO SESSION AND THE TONE LOADER (v34).
 *
 * Built for the owner's v33 device pass (10-06): "no audio of the take… Unable to
 * hear any audio… device on max volume… the Piano, Strings, Guitar buttons do not
 * produce any audio". Two independent causes were found in the code, and this
 * file is where both are fixed.
 *
 * ── 1. THE PLAYBACK SURFACES NEVER ESTABLISHED A SESSION ────────────────────
 * Only three places in v33 touched the session at all — the recorder (start and
 * stop), the metronome and the score player — and each set a PARTIAL mode
 * (`{ allowsRecordingIOS, playsInSilentModeIOS }`), whose omitted keys expo-av
 * fills in from the mode that was already current. The two surfaces the owner
 * reported as silent, the History take player and the Hum-Along preview /
 * instrument chips, called `Audio.setAudioModeAsync` NOWHERE: they assumed a
 * session nothing guaranteed, and on Android the player's own volume is gated on
 * holding audio focus — expo-av's AVManager computes `getVolumeForDuckAndFocus()`
 * as **0** whenever focus is not held, so a play can succeed and be inaudible
 * with no error at all.
 *
 * So: ONE definition of the playback session (`playsInSilentModeIOS` — the
 * owner's "device on max volume" case with the ringer off — plus ducking, no
 * earpiece routing, not staying active in the background), applied before EVERY
 * play, re-applied after every recording, and every failure reported to the
 * diagnostics store so the user sees "Audio unavailable: …" instead of a silent
 * button.
 *
 * ── 2. THE TONES COULD NOT BE LOADED AT ALL ON ANDROID RELEASE ──────────────
 * See src/services/toneSourceLadder.ts: the packaged resource name and the
 * identifier the app computes for it disagree (`assets_tones_…` vs `tones_…`), and
 * expo-av's default `downloadFirst` awaits expo-asset's copy, which throws on
 * that miss. This file walks the rung ladder instead, remembers the rung that
 * worked, and reports the honest reason when none of them do.
 *
 * NOT tier1-compiled (it imports expo-av / expo-constants) — the testable halves
 * are toneSourceLadder.ts and audioDiagnostics.ts, both pure and both asserted by
 * the gate.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import { reportAudioFailure, usableDetail } from './audioDiagnostics';
import type { AudioFailureReason, AudioFailureSource } from './audioDiagnostics';
import {
  AUDIO_FOCUS_FAILED_LINE,
  AUDIO_FOCUS_RETRY_DELAY_MS,
  AUDIO_FOCUS_RETRY_LIMIT,
  PLAYBACK_SESSION_SPEC,
  RECORDING_SESSION_SPEC,
  isAudioFocusError,
} from './audioFocusContract';
import { toneSourceFor } from './toneBank';
import {
  describeToneSourceRung,
  orderToneSourceLadder,
  toneSourceLadder,
  type ToneSourceKind,
} from './toneSourceLadder';
import type { PreviewInstrumentId } from './takePreview';

/**
 * The package name the Android resource rungs need. Read from the app's own
 * config, with the shipped package as a hard fallback so a build whose config
 * cannot be read still gets a usable rung (it is the package in app.json and on
 * Play).
 */
export const ANDROID_PACKAGE_FALLBACK = 'com.notesnap.sheetmusic';

/** How long a mode change may take before we call it failed (2000 ms). */
export const AUDIO_MODE_TIMEOUT_MS = 2000;

/**
 * THE PLAYBACK SESSION — now defined in ONE pure place, `audioFocusContract`
 * (v41 item 1), so the tier1 gate can assert its keys and the surface can never
 * restate a partial mode of its own.
 *
 * WHY IT CHANGED (owner v40 device pass 10-18: every player silent, the chip
 * carrying expo-av's `AudioFocusNotAcquiredException`): expo-av raises that
 * exception from AVManager.acquireAudioFocus() when the host is paused and the
 * session says `staysActiveInBackground: false` — a camera / in-app browser /
 * fullscreen-video transition pauses the host, and every play after it throws.
 * The session now stays active in the background (so that throw path is closed)
 * and requests full AUDIOFOCUS_GAIN (`interruptionModeAndroid: DoNotMix`) instead
 * of the ducking transient hint. Leaving the app pauses the players through
 * `pauseAllAudioPlayers` below, so nothing plays on behind the user.
 */
export const PLAYBACK_AUDIO_MODE: Partial<Audio.AudioMode> = {
  ...PLAYBACK_SESSION_SPEC,
} as Partial<Audio.AudioMode>;

/** THE RECORDING SESSION: the playback session plus the mic. */
export const RECORDING_AUDIO_MODE: Partial<Audio.AudioMode> = {
  ...RECORDING_SESSION_SPEC,
} as Partial<Audio.AudioMode>;

/** Which session the app believes it is in. */
export type AudioModeName = 'playback' | 'recording' | 'unknown';

let appliedMode: AudioModeName = 'unknown';
let inFlight: Promise<boolean> | null = null;

function androidPackageName(): string {
  const fromConfig = Constants.expoConfig?.android?.package;
  return typeof fromConfig === 'string' && fromConfig.length > 0
    ? fromConfig
    : ANDROID_PACKAGE_FALLBACK;
}

/** Await `p` for at most `ms`; a hung native call must never hang a button. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Apply one mode, reporting the failure honestly. `force` re-applies a mode the
 * app already believes it is in — which is exactly what the recording → playback
 * transition needs, because the recorder changes the session underneath us.
 */
async function applyAudioMode(
  mode: Partial<Audio.AudioMode>,
  name: AudioModeName,
  force: boolean,
): Promise<boolean> {
  if (!force && appliedMode === name) return true;
  if (inFlight) await inFlight;
  let ok = false;
  inFlight = (async () => {
    const result = await withTimeout(
      Audio.setAudioModeAsync(mode).then(() => true).catch(() => false),
      AUDIO_MODE_TIMEOUT_MS,
      false,
    );
    ok = result;
    return result;
  })();
  await inFlight;
  inFlight = null;
  appliedMode = ok ? name : 'unknown';
  if (!ok) {
    reportAudioFailure({
      source: 'audio-session',
      reason: 'session-setup',
      detail: 'Audio.setAudioModeAsync did not complete',
    });
  }
  return ok;
}

/**
 * Put the app in its PLAYBACK session. Safe to call on every play — and it now
 * FORCE-re-applies the native mode every time (v41 item 1). The v34 shape
 * returned early whenever it believed the session was already 'playback', so
 * after the recorder ran (or an apply timed out) the native session was never
 * re-established: the app said "playback", the device was still in whatever the
 * recorder left behind, and the play either threw or was inaudible. A forced
 * apply is one cheap native call and removes that whole class of silence.
 */
export function ensurePlaybackAudioMode(): Promise<boolean> {
  installAudioSessionGuards();
  return applyAudioMode(PLAYBACK_AUDIO_MODE, 'playback', true);
}

/**
 * Put the app in its RECORDING session before a capture. Called by the recorder so
 * the recording starts on a session that actually allows the mic.
 */
export function enterRecordingAudioMode(): Promise<boolean> {
  return applyAudioMode(RECORDING_AUDIO_MODE, 'recording', true);
}

/**
 * Put the app BACK into its playback session. Called after every recording stops:
 * leaving a recording session in place is what makes everything the user presses
 * afterwards silent.
 */
export function restorePlaybackAudioMode(): Promise<boolean> {
  return applyAudioMode(PLAYBACK_AUDIO_MODE, 'playback', true);
}

/** The session the app last applied (diagnostics only). */
export function currentAudioModeName(): AudioModeName {
  return appliedMode;
}

// ───────────────────────── the ONE guarded play path (v41) ─────────────────────

/** Where a failed play is reported to the diagnostics chip. */
export interface AudioPlayReport {
  source: AudioFailureSource;
  reason: AudioFailureReason;
}

/** Await `ms` (a refused focus request is a race, not a state). */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never keep a timer alive on a platform without a real event loop timer.
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref?: () => void }).unref?.();
    }
  });
}

/**
 * THE ONE PLAY PATH. Every player in the app starts sound through this: it
 * (1) re-applies the playback session first, (2) runs the play, and (3) on
 * expo-av's audio-focus refusal — the exception the owner's v40 pass showed on
 * screen — re-establishes the session and retries ONCE. Only if the retry also
 * fails is the failure reported and rethrown, so the surface keeps its own
 * sentence and the chip names the honest reason.
 *
 * The retry is what makes pause/stop/play-again work: the second request is made
 * after the session was applied again, so it is granted.
 */
export async function playWithAudioFocus<T>(
  run: () => Promise<T>,
  report?: AudioPlayReport,
): Promise<T> {
  await ensurePlaybackAudioMode();
  try {
    return await run();
  } catch (err) {
    if (!isAudioFocusError(err) || AUDIO_FOCUS_RETRY_LIMIT < 1) {
      reportPlayFailure(report, err);
      throw err;
    }
    // The retry: session again, then the same play.
    await ensurePlaybackAudioMode();
    await delay(AUDIO_FOCUS_RETRY_DELAY_MS);
    try {
      return await run();
    } catch (second) {
      reportPlayFailure(report, second ?? AUDIO_FOCUS_FAILED_LINE);
      throw second;
    }
  }
}

function reportPlayFailure(report: AudioPlayReport | undefined, err: unknown): void {
  if (!report) return;
  reportAudioFailure({
    source: report.source,
    reason: report.reason,
    detail: usableDetail(err) || AUDIO_FOCUS_FAILED_LINE,
  });
}

// ───────────────────── the app-state guard (v41 item 1) ────────────────────────

/**
 * Players that can be silenced when the app leaves the foreground. The session
 * stays active in the background (that is what closes expo-av's focus throw), so
 * the APP — not expo-av — is responsible for stopping sound on the way out.
 */
const pauseHandlers = new Set<() => void>();

/** Register a player's own pause. Returns the unsubscribe (React effects call it). */
export function registerAudioPauseHandler(handler: () => void): () => void {
  pauseHandlers.add(handler);
  return () => {
    pauseHandlers.delete(handler);
  };
}

/** Pause every registered player. Returns how many were asked. */
export function pauseAllAudioPlayers(): number {
  const handlers = Array.from(pauseHandlers);
  for (const handler of handlers) {
    try {
      handler();
    } catch {
      // A broken player must never take the app-state path down with it.
    }
  }
  return handlers.length;
}

/** How many players are registered (diagnostics + the gate's wiring check). */
export function audioPauseHandlerCount(): number {
  return pauseHandlers.size;
}

let guardsInstalled = false;

/**
 * Install the app-state guard ONCE. On the way back into the app the playback
 * session is re-applied (a microphone-app or a call may have taken the session
 * while we were away); on the way out every registered player is paused.
 * Called from `ensurePlaybackAudioMode`, so the first play of any surface installs
 * it — no App.tsx edit and no screen that can forget it.
 */
export function installAudioSessionGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  try {
    AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void ensurePlaybackAudioMode();
        return;
      }
      pauseAllAudioPlayers();
    });
  } catch {
    // A host without AppState still plays; the guard is an improvement, not a
    // precondition for sound.
  }
}

/** The rung that already worked for a pitch — so the ladder is paid once. */
const workingRung = new Map<string, ToneSourceKind>();

/** Forget the cached rungs (used when a tone that used to work starts failing). */
export function resetToneSourceCache(): void {
  workingRung.clear();
}

/** A tone that loaded, plus the rung it came from. */
export interface LoadedTone {
  sound: Audio.Sound;
  kind: ToneSourceKind;
}

/**
 * Load one one-shot tone from the tone bank, walking the rung ladder. Resolves to
 * null when NO rung could load it — and in that case the reason is reported, so
 * the surface can say "Audio unavailable: the preview tones could not be loaded
 * from this build" instead of doing nothing.
 *
 * `replay` is deliberately NOT done here: the caller decides when a sound is heard.
 */
export async function loadToneSound(
  instrument: PreviewInstrumentId | string,
  midi: number,
): Promise<LoadedTone | null> {
  const moduleId = toneSourceFor(instrument, midi);
  const key = `${String(instrument)}:${Math.round(Number(midi) || 0)}`;
  const preferred = workingRung.get(key) ?? null;
  const rungs = orderToneSourceLadder(
    toneSourceLadder({
      instrument: String(instrument),
      midi,
      moduleId,
      packageName: androidPackageName(),
    }),
    preferred,
  );

  // The session first: a play on a session that was never set up is the silent
  // path this whole file exists to close.
  await ensurePlaybackAudioMode();

  let lastDetail = '';
  for (const rung of rungs) {
    try {
      const created = await Audio.Sound.createAsync(
        rung.source,
        { shouldPlay: false, volume: 1 },
        undefined,
        // The module rung is the only one expo-asset can copy (that copy is what
        // the resources rungs exist to replace); URI rungs need no download step.
        rung.kind === 'module',
      );
      workingRung.set(key, rung.kind);
      return { sound: created.sound, kind: rung.kind };
    } catch (err) {
      lastDetail = `${describeToneSourceRung(rung)}: ${usableDetail(err)}`;
    }
  }

  reportAudioFailure({
    source: 'tone-preview',
    reason: 'tone-load',
    detail: lastDetail || `no source rung for ${key}`,
  });
  return null;
}
