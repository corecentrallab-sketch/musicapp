/**
 * takeReadLabel.ts — WHICH TAKE THE CLOCK BELONGS TO (vc62, D30).
 *
 * THE OWNER'S DEFECT, verbatim: on the vc61 review page the read's clock said
 * `0:07 so far · about 0:08 left.` with nothing beside it saying WHICH take it was
 * timing. vc61 also lets a second take be started while the first is still reading
 * (his row-5 complaint), so "a clock with no take on it" is worse than a cosmetic
 * gap: the user cannot tell whether the number belongs to the take on screen or to
 * the one they just started.
 *
 * WHAT A LABEL IS MADE OF: only facts the app already holds — when the take was
 * filmed (its own stored `filmedAt` stamp) and how long it is (measured at Stop).
 * No index, no invented "Take 1": a number the app cannot keep consistent across a
 * relaad is worse than none.
 *
 * PURE: no react, no react-native, no expo, no storage. Asserted by
 * scripts/vc62ServerNotesRead.test.ts.
 */

/** How a take is named before its clock. */
export const TAKE_LABEL_PREFIX = 'Take';

/** The label used when the take carries no filmed stamp at all. */
export const TAKE_LABEL_UNKNOWN = 'This take';

/**
 * An ISO stamp → `14:32` in the DEVICE'S OWN timezone, or null.
 *
 * Local, not the raw UTC text: the stamp is stored as ISO (`…Z`), and printing its
 * characters would tell a Sydney user the wrong hour. A stamp that does not parse
 * is null — a made-up time would be a fabricated fact on the surface.
 */
export function formatTakeClock(filmedAt: string | null | undefined): string | null {
  if (typeof filmedAt !== 'string' || filmedAt.length === 0) return null;
  const when = new Date(filmedAt);
  const time = when.getTime();
  if (!Number.isFinite(time)) return null;
  const hours = when.getHours();
  const minutes = when.getMinutes();
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Seconds → `0:48` / `3:00`, or null when the length was not measured. */
export function formatTakeLength(durationSec: number | null | undefined): string | null {
  const seconds = Number(durationSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * THE LABEL BESIDE THE CLOCK:
 *
 *   Take filmed at 14:32 · 0:48 long
 *   Take filmed at 14:32
 *   This take · 0:48 long
 *   This take
 */
export function takeReadLabel(input: {
  filmedAt?: string | null;
  durationSec?: number | null;
} | null | undefined): string {
  const clock = formatTakeClock(input?.filmedAt ?? null);
  const length = formatTakeLength(input?.durationSec ?? null);
  const head = clock ? `${TAKE_LABEL_PREFIX} filmed at ${clock}` : TAKE_LABEL_UNKNOWN;
  return length ? `${head} · ${length} long` : head;
}

/**
 * The same label as a stored read's own line — null when the read has none, so a
 * caller never prints an empty row above a timing line.
 */
export function takeReadLabelLine(label: string | null | undefined): string | null {
  return typeof label === 'string' && label.trim().length > 0 ? label : null;
}
