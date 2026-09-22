/**
 * recognitionRetry.ts — the retry / resample contract for the "Find any song"
 * (modern-song) flow, plus the honest copy for every way a capture can fail.
 *
 * Why this module exists (owner-reproduced on device, 09-22): after a first pass
 * returned "No modern song found", tapping "Try Again" (or the mic) produced
 * NOTHING AT ALL on pass 2 — no loading spinner, no result, no error, no retry
 * button. The screen simply sat there. Reading the pre-fix code end to end, the
 * pass-2 path had four separate ways to dead-end without a surface:
 *
 *   1. `handleStart` did `const started = await recorder.startRecording();
 *      if (!started) return;` — a start failure returned in COMPLETE SILENCE.
 *      Nothing was set: no interstitial state, no error card, no message.
 *   2. The screen had no "starting" state at all. While the permission check /
 *      `prepareToRecordAsync()` ran (and the 8s permission watchdog window
 *      inside the hook), `checkingPermissions` merely DISABLED the mic button:
 *      the user saw an unchanged, inert screen, and every retry tap was eaten.
 *   3. The retry timer (`setTimeout(() => handleStart(), 300)`) was never stored
 *      in a ref, never cleared, and never guarded. A tap during that 300ms
 *      window started a SECOND `Audio.Recording()` while the first was still
 *      starting: the first recorder was orphaned (never unloaded, mic session
 *      never released) and `recordingRef.current` was overwritten — the classic
 *      recipe for a broken second capture.
 *   4. `stopRecording()` awaited `stopAndUnloadAsync()` / the audio-mode release
 *      / telemetry with NO bound. The caller only shows its surface AFTER stop
 *      resolves, so a stop that never resolves = a screen with nothing on it,
 *      forever (and every later tap re-entered the same hung stop).
 *
 * The pass-2 path is therefore modelled here — free of react / react-native
 * imports — so the tier1 gate can assert every branch produces a visible,
 * honest surface without an emulator. The screen mirrors `micHint()` and
 * `planTap()` exactly, one branch per action.
 *
 * House tone (owner rule): honest words, never a raw percentage or a threshold.
 */

import type { ModernMatch } from '../types';

/** The interstitial state shape the screen owns (structurally identical to
 *  ModernInterstitialState in components/ModernSongInterstitial.tsx — defined
 *  here so this module stays free of react-native imports). */
export interface ModernSurfaceState {
  /** true while the /api/recognize-modern request is in flight. */
  loading: boolean;
  /** user-facing error, or null. */
  error: string | null;
  /** The recognized song, or null when no confident match came back. */
  match: ModernMatch | null;
  /** true only when the server returned a real identified song. */
  recognized: boolean;
}

/** The state every surface-free moment starts from. */
export const IDLE_SURFACE: ModernSurfaceState = {
  loading: false,
  error: null,
  match: null,
  recognized: false,
};

// ─────────────────────────── capture failures ───────────────────────────

/** Why a capture could not be started. */
export type StartFailureReason =
  /** The user (or the OS) refused microphone access. */
  | 'permission-denied'
  /** The permission check never finished (the hook's 8s watchdog). */
  | 'permission-timeout'
  /** The permission check itself threw. */
  | 'permission-error'
  /** Another start was already in flight (the 300ms-retry race). */
  | 'busy'
  /** `new Audio.Recording()` / prepare / start threw. */
  | 'start-error';

/** Why a capture that did start produced nothing usable. */
export type StopFailureReason =
  /** The mic was not actually recording (a stray/late stop). */
  | 'no-recording'
  /** The recorder never finalised a file path. */
  | 'no-uri'
  /** The clip exists but is 0 bytes — the mic delivered no audio. */
  | 'empty';

/** A start failure: the reason (drives which affordances we offer) and the
 *  exact words the user sees. */
export interface StartFailure {
  reason: StartFailureReason;
  message: string;
}

/** A stop failure, in the same shape. */
export interface StopFailure {
  reason: StopFailureReason;
  message: string;
}

/** The single source of truth for start-failure copy (the hook sets the same
 *  string on its own `error`, so the on-screen card and the interstitial agree). */
export const START_FAILURE_COPY: Record<StartFailureReason, string> = {
  'permission-denied':
    'Microphone access is required to recognize music. Please grant permission in your device settings.',
  'permission-timeout':
    'Could not finish checking microphone permission. Please tap again to retry.',
  'permission-error': "Couldn't check microphone permission — please try again.",
  busy: "Couldn't start recording — please try again.",
  'start-error': "Couldn't start recording — please try again.",
};

/** The single source of truth for stop-failure copy. */
export const STOP_FAILURE_COPY: Record<StopFailureReason, string> = {
  'no-recording': 'No recording in progress. Please try again.',
  'no-uri': 'Recording failed to save. Please try again.',
  empty: 'Recording was empty. Please move closer to the music and try again.',
};

/** Build a start failure with its canonical copy. */
export function startFailure(reason: StartFailureReason): StartFailure {
  return { reason, message: START_FAILURE_COPY[reason] };
}

/** Build a stop failure with its canonical copy. */
export function stopFailure(reason: StopFailureReason): StopFailure {
  return { reason, message: STOP_FAILURE_COPY[reason] };
}

/** Only permission problems are fixed in the device settings — those keep the
 *  hook's inline error (and its "Open Settings" button) alongside the
 *  interstitial. Everything else is a recording problem, and is surfaced once. */
export function isPermissionFailure(reason: StartFailureReason): boolean {
  return (
    reason === 'permission-denied' ||
    reason === 'permission-timeout' ||
    reason === 'permission-error'
  );
}

/** The interstitial state for a start failure — ALWAYS a non-empty error, which
 *  is what makes the "silent dead-end" impossible (test: recognitionRetry). */
export function startFailureSurface(failure: StartFailure | null): ModernSurfaceState {
  const message = failure ? failure.message : START_FAILURE_COPY['start-error'];
  return { loading: false, error: message, match: null, recognized: false };
}

/** The interstitial state for a stop failure (nothing recorded / empty clip). */
export function stopFailureSurface(failure: StopFailure | null): ModernSurfaceState {
  const message = failure ? failure.message : STOP_FAILURE_COPY['no-recording'];
  return { loading: false, error: message, match: null, recognized: false };
}

/**
 * A late/stray stop that finds no recording is only a real failure when the
 * user has nothing else on screen. If a result/error surface is already up, or
 * a request is in flight, a phantom "Recording failed" card would REPLACE the
 * user's result — so that case is a no-op.
 */
export function shouldSurfaceStopFailure(
  reason: StopFailureReason,
  state: { interstitialVisible: boolean; requestInFlight: boolean },
): boolean {
  if (reason !== 'no-recording') return true;
  return !state.interstitialVisible && !state.requestInFlight;
}

// ───────────────────────── the pass-2 decision ─────────────────────────

/** Everything the tap/retry decision depends on. */
export interface CaptureState {
  /** The recorder is live and capturing right now. */
  recording: boolean;
  /** A start attempt is in flight (permission / prepare / startAsync). */
  starting: boolean;
  /** A /api/recognize-modern POST is in flight. */
  requestInFlight: boolean;
}

/** What a mic tap does. */
export type TapAction =
  /** Stop the live capture (tap-to-stop). */
  | 'stop'
  /** Start a fresh capture. */
  | 'start'
  /** A start, a stop or a request is already running — do NOT stack another. */
  | 'wait';

/**
 * The mic button's decision. Never starts a second capture on top of one that
 * is starting or in flight: that is what orphaned pass-1's recorder and left
 * pass 2 with a dead mic.
 */
export function planTap(state: CaptureState): TapAction {
  if (state.starting || state.requestInFlight) return 'wait';
  if (state.recording) return 'stop';
  return 'start';
}

/**
 * The retry decision (the interstitial's "Try Again", or a resample).
 *
 * The retry is ALWAYS a start — after any stale recording has been torn down —
 * except while a start or a request is already in flight, where starting a
 * second one is exactly the race that broke pass 2. In that window the
 * interstitial already shows the loading surface, so waiting is not silent.
 */
export function planRetry(state: CaptureState): 'start' | 'wait' {
  if (state.starting || state.requestInFlight) return 'wait';
  return 'start';
}

/**
 * The on-screen hint under the mic. Every state has words — including the
 * starting state, which used to render nothing at all while the mic button sat
 * disabled underneath (the silent window in the owner's pass-2 repro).
 */
export function micHint(state: {
  recording: boolean;
  starting: boolean;
  checkingPermissions: boolean;
}): string {
  if (state.recording) return 'Listening... tap again to stop & identify.';
  if (state.starting || state.checkingPermissions) {
    return 'Getting the mic ready…';
  }
  return 'Tap the mic and play the music around you (\n8–12s), then stop to identify it.';
}

/** True when the mic is genuinely unavailable (its tap would be swallowed). */
export function micBusy(state: {
  recording: boolean;
  starting: boolean;
  checkingPermissions: boolean;
}): boolean {
  return !state.recording && (state.starting || state.checkingPermissions);
}
