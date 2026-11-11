/**
 * videoScrub.ts — THE SCRUB BAR'S ONE MODEL (vc53, item 4).
 *
 * WHAT THE OWNER ASKED FOR: "a draggable progress bar at the bottom of the video
 * that seeks forward and backward."
 *
 * WHAT THE LEAD DECIDED, AND WHY IT IS ONE TIMELINE: the bar spans the WHOLE
 * recording. The trimmed-out ends are DIMMED, playback stays clamped to the trim
 * window, and a drag that lands in a dimmed end SNAPS to the nearest window edge.
 * A second bar that spanned only the window would be a second truth: the user
 * could never see how much of the take they had cut, and the two would disagree
 * the first time the trim changed.
 *
 * PURE. No React Native, no player, no clock of its own: the surface feeds in the
 * player's position and the row's trim span, and gets back a fraction to draw and
 * a millisecond to seek to. That is what makes the bar assertable in tier1 —
 * `scripts/vc53MediaControls.test.ts` walks the snapping rules below.
 */
import { videoClock } from './videoTakeSync';
import type { TakeTrimSpan } from './takeClipTag';

/** The bar's own caption (rendered above it). */
export const SCRUB_LABEL = 'Move through the take';
/** What the bar means, in one sentence. */
export const SCRUB_HINT =
  'Drag the bar to move through the take. The faded ends are outside your clip — playback stays inside the clip you chose.';
/** Accessibility label for the bar itself. */
export const SCRUB_SEEK_LABEL = 'Drag to move through the take';

/**
 * How close to the window's end a snapped seek may land. `trimPlaybackAction`
 * treats a position within 50 ms of the end as "the window is over", so snapping
 * to the exact end would stop the player the instant the user let go. Landing one
 * tolerance inside keeps the last frame playable.
 */
export const SCRUB_END_TOLERANCE_MS = 50;

/** The part of the whole recording that is inside the trim window, as 0…1 fractions. */
export interface ScrubWindow {
  startFraction: number;
  endFraction: number;
}

function safeDuration(durationMs: number): number {
  const value = Number(durationMs);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * THE DIMMED ENDS. The window as fractions of the whole recording, so the bar can
 * fade everything the clip leaves out. No window (or an unusable one) means the
 * whole take is playable: 0…1.
 */
export function scrubWindowFractions(
  span: TakeTrimSpan | null | undefined,
  durationMs: number,
): ScrubWindow {
  const duration = safeDuration(durationMs);
  if (duration === 0 || !span) return { startFraction: 0, endFraction: 1 };
  const start = Number(span.startSec);
  const end = Number(span.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { startFraction: 0, endFraction: 1 };
  const startMs = Math.max(0, Math.min(start, end) * 1000);
  const endMs = Math.max(startMs, Math.max(start, end) * 1000);
  return {
    startFraction: clamp01(startMs / duration),
    endFraction: clamp01(endMs / duration),
  };
}

/** Where the playhead sits on the bar: the position as a 0…1 fraction. */
export function scrubRatioForPosition(positionMs: number, durationMs: number): number {
  const duration = safeDuration(durationMs);
  const position = Number(positionMs);
  if (duration === 0 || !Number.isFinite(position)) return 0;
  return clamp01(position / duration);
}

/**
 * WHERE A DRAG LANDS. The bar spans the whole recording, so the fraction is read
 * against the whole length; a fraction inside the window seeks there, and one in a
 * dimmed end snaps to the NEAREST window edge (never to the file's own ends, which
 * would play the trimmed-out audio the user cut).
 */
export function scrubSeekTargetMs(
  ratio: number,
  durationMs: number,
  span: TakeTrimSpan | null | undefined,
): number {
  const duration = safeDuration(durationMs);
  if (duration === 0) return 0;
  const wanted = Math.round(clamp01(ratio) * duration);
  if (!span) return Math.min(duration, Math.max(0, wanted));
  const start = Number(span.startSec);
  const end = Number(span.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Math.min(duration, Math.max(0, wanted));
  const startMs = Math.max(0, Math.min(start, end) * 1000);
  const rawEndMs = Math.max(startMs, Math.max(start, end) * 1000);
  const endMs = Math.max(startMs, rawEndMs - SCRUB_END_TOLERANCE_MS);
  if (wanted <= startMs) return Math.round(startMs);
  if (wanted >= endMs) return Math.round(endMs);
  return wanted;
}

/** `0:12 / 0:38` — where the playhead is, against the whole recording. */
export function scrubTimeLine(positionMs: number, durationMs: number): string {
  const duration = safeDuration(durationMs);
  const position = Number(positionMs);
  const at = Number.isFinite(position) ? Math.min(duration, Math.max(0, position)) : 0;
  return `${videoClock(at / 1000)} / ${videoClock(duration / 1000)}`;
}
