/**
 * audioDiagnostics.ts — WHY NOBODY SHOULD EVER HAVE TO GUESS WHY THE APP WAS
 * QUIET (v34, owner device pass 10-06: "No audible sound recording can be heard
 * from the device… All sampled takes").
 *
 * THE RULE THIS FILE EXISTS FOR. v33's audio paths could fail with no trace at
 * all: `useNotePreview.playTone` swallowed every error (`catch { return false }`),
 * the take player kept its sentence on the row, and the recorder's failures went
 * to screen-level cards. A silent tone and a broken asset therefore looked
 * IDENTICAL on the device — which is exactly how a "no audio anywhere" report
 * arrived with nothing to diagnose it from.
 *
 * So every audio failure now lands HERE, as one small record with an honest
 * sentence, and the app renders it in a visible chip:
 *
 *   "Audio unavailable: <reason>"
 *
 * WHAT THIS FILE IS. Pure: no react, no react-native, no expo, no timers, no
 * console. The store is a plain module-level record with a subscriber list, so
 * `src/hooks/useNotePreview.ts`, `src/hooks/useTakeClipPlayer.ts`,
 * `src/hooks/useAudioRecorder.ts` and `src/services/audioSession.ts` can all
 * report through it and `src/components/AudioUnavailableChip.tsx` can render it
 * without any of them knowing about each other. Fully asserted by
 * scripts/v34Fixes.test.ts (reason → sentence mapping, latest-wins, clear,
 * subscribe/unsubscribe, and the never-blank rule).
 */

/** Which part of the audio stack failed. One source = one chip sentence. */
export type AudioFailureSource =
  | 'audio-session'
  | 'tone-preview'
  | 'take-playback'
  | 'recording';

/** The reason codes the audio stack can report (each maps to fixed, honest copy). */
export type AudioFailureReason =
  | 'session-setup'
  | 'tone-load'
  | 'clip-missing'
  | 'clip-load'
  | 'recorder-error'
  | 'unknown';

/** One reported failure — what failed, why, and the raw detail behind it. */
export interface AudioFailure {
  source: AudioFailureSource;
  reason: AudioFailureReason;
  /** The device's own message (trimmed), or '' when there was none. */
  detail: string;
  /** When it was reported (ms since epoch) — for "is this still current?". */
  at: number;
}

/** The chip's fixed prefix. The reason is added after it, never instead of it. */
export const AUDIO_CHIP_PREFIX = 'Audio unavailable';

/** Longest raw detail the chip will ever carry (one line, never a stack trace). */
export const AUDIO_DETAIL_MAX = 120;

/**
 * Reason → the sentence the USER reads. Plain words about what happened on this
 * device, with no claim about anything the app cannot see: never "your mic is
 * broken", never a guess at a cause.
 */
export function audioFailureReasonLine(reason: AudioFailureReason): string {
  switch (reason) {
    case 'session-setup':
      return 'this device would not accept the audio session';
    case 'tone-load':
      return 'the preview tones could not be loaded from this build';
    case 'clip-missing':
      return 'the recording is not on this device any more';
    case 'clip-load':
      return 'the recording could not be opened on this device';
    case 'recorder-error':
      return 'the microphone could not start on this device';
    default:
      return 'playback failed on this device';
  }
}

/** `Audio unavailable: …` — the whole chip, never blank, never a bare reason code. */
export function audioChipText(
  failure: AudioFailure | null | undefined,
  detail?: string,
): string {
  const reason =
    failure && typeof failure.reason === 'string' ? failure.reason : 'unknown';
  const line = `${AUDIO_CHIP_PREFIX}: ${audioFailureReasonLine(reason as AudioFailureReason)}`;
  const extra = usableDetail(detail ?? failure?.detail ?? '');
  return extra.length > 0 ? `${line} (${extra})` : line;
}

/**
 * A raw error's usable text: the message only (never a stack), single-spaced and
 * bounded, so a native exception cannot take the whole screen. Non-Error values
 * (a string, a null, an object) all resolve to something readable or ''.
 */
export function usableDetail(raw: unknown): string {
  let text = '';
  if (typeof raw === 'string') text = raw;
  else if (raw && typeof raw === 'object') {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === 'string') text = message;
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > AUDIO_DETAIL_MAX
    ? `${collapsed.slice(0, AUDIO_DETAIL_MAX - 1)}…`
    : collapsed;
}

/** What the audio stack hands the store; `at` is stamped here. */
export interface AudioFailureInput {
  source: AudioFailureSource;
  reason: AudioFailureReason;
  detail?: unknown;
}

let current: AudioFailure | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // A broken listener must never take the audio path down with it.
    }
  }
}

/**
 * Report a failure. LATEST WINS (the user is looking at the screen they just
 * pressed, not at a history), and the raw detail is sanitized on the way in so
 * every reader of the record gets the same bounded string.
 */
export function reportAudioFailure(input: AudioFailureInput): AudioFailure {
  current = {
    source: input.source,
    reason: input.reason,
    detail: usableDetail(input.detail),
    at: Date.now(),
  };
  emit();
  return current;
}

/** The failure currently shown, or null when the audio stack is healthy. */
export function currentAudioFailure(): AudioFailure | null {
  return current;
}

/** Dismiss it (the chip's ✕). Returns true when something was actually cleared. */
export function clearAudioFailure(): boolean {
  if (current === null) return false;
  current = null;
  emit();
  return true;
}

/**
 * Subscribe to reports/clears. Returns the unsubscribe — callers MUST call it
 * (React effects do), or a screen that unmounts keeps the store alive.
 */
export function subscribeAudioFailure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many listeners are attached (the tests assert the unsubscribe works). */
export function audioFailureListenerCount(): number {
  return listeners.size;
}
