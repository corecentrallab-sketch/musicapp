/**
 * takeProbeSource.ts — WHICH FILE THE DECODER PROBE READS (D34, vc64).
 *
 * THE DEFECT. The review page handed the probe `ref?.uri ?? audioUriRef.current`:
 * the CAMERA VIDEO whenever the take had one, and only the take's separate .m4a
 * when it did not. So on every real take the probe read a video — and because the
 * read is capped at PROBE_MAX_READ_BYTES, it read a truncated prefix of an MP4,
 * which has no index for the tail and cannot be decoded at any memory budget. The
 * card's own copy promised it read "this take's own audio"; the code read the
 * film. The answer was "the decode did not finish" on every take, which is
 * indistinguishable from a real device limit (defect class 20).
 *
 * THE RULE, IN ONE PLACE. The probe reads the take's AUDIO file first — a few MB
 * for a 3-minute take, decodable in one read — and falls back to the video only
 * when the take has no separate audio copy. That decision lives here, pure, so the
 * screen, the card and the gate all read the same answer.
 *
 * PURE: no react, no react-native, no expo, no fs. Asserted by
 * scripts/vc64ProbeSource.test.ts.
 */

/** Which of the take's two files the probe is about to read. */
export type TakeProbeSourceKind = 'audio' | 'video';

export interface TakeProbeSource {
  kind: TakeProbeSourceKind;
  uri: string;
}

/** A usable file URI, or null — an empty/blank string is not a file. */
function usableUri(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * THE AUDIO FILE FIRST. The video is the fallback, never the preference: a take
 * whose audio copy could not be made is the only case the video is read, and the
 * card says so (see `takeProbeSourceLine`).
 */
export function pickTakeProbeSource(
  input: { audioUri?: string | null; videoUri?: string | null } | null | undefined,
): TakeProbeSource | null {
  const audio = usableUri(input?.audioUri);
  if (audio) return { kind: 'audio', uri: audio };
  const video = usableUri(input?.videoUri);
  if (video) return { kind: 'video', uri: video };
  return null;
}

/** The last path segment — enough to name the file without printing a whole URI. */
export function takeProbeFileName(uri: string | null | undefined): string | null {
  const usable = usableUri(uri);
  if (!usable) return null;
  const withoutQuery = usable.split('?')[0].split('#')[0];
  const parts = withoutQuery.split('/');
  const name = parts[parts.length - 1];
  return name && name.length > 0 ? name : null;
}

/**
 * WHAT THE PROBE READ, SAID ON THE CARD — the file, and which of the two it is.
 * This is the sentence that was missing in vc63: the card claimed "this take's own
 * audio" while the code read the video, and nothing on screen could tell you.
 */
export function takeProbeSourceLine(
  source: TakeProbeSource | null | undefined,
): string {
  const name = takeProbeFileName(source?.uri ?? null);
  if (!source || !name) {
    return 'probe reads: nothing — this take has no audio or video file to read.';
  }
  if (source.kind === 'audio') {
    return `probe reads: the take's audio file — ${name}`;
  }
  return `probe reads: the camera video — ${name} (this take has no separate audio copy, so the read is a capped prefix of the film)`;
}
