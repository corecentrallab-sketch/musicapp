/**
 * Pure helpers for the practice player's A/B section looping.
 *
 * Kept dependency-free so the loop geometry logic can be unit-tested in
 * isolation (no React / expo-av runtime required).
 *
 * All positions are in milliseconds.
 */

/** Clamp a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** True when a loop has two set points and B is strictly after A. */
export function isLoopReady(
  loopStart: number | null,
  loopEnd: number | null,
): boolean {
  return (
    loopStart !== null &&
    loopEnd !== null &&
    loopEnd > loopStart
  );
}

export interface ResolvedPosition {
  /** The position the player should be at. */
  position: number;
  /** True when the position wrapped back to the loop start (a loop jump). */
  looped: boolean;
}

/**
 * Given the current playback position, decide whether it has run past the
 * loop's B point and must wrap back to A. When looping is inactive or the
 * points aren't both set, the position is returned unchanged.
 */
export function resolveLoopPosition(
  position: number,
  loopStart: number | null,
  loopEnd: number | null,
): ResolvedPosition {
  if (isLoopReady(loopStart, loopEnd) && position >= (loopEnd as number)) {
    return { position: loopStart as number, looped: true };
  }
  return { position, looped: false };
}

/** Format a millisecond duration as m:ss (e.g. 75300 -> "1:15"). */
export function formatMillis(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
