/**
 * videoOverlayLayout.ts — THE OVERLAY'S LAYOUT MATH (owner GO 10-10, backlog
 * a49fbe2d; design brief §4.2).
 *
 * WHAT THE OVERLAY IS. A native drawing (Views on the surface), NOT the ABC staff:
 * the editor's staff is an ABCjs WebView, which is perfect for a still staff and
 * wrong for a moving overlay — expensive to redraw per frame, it would sit on top
 * of the video's own touch surface, and a WebView can never be composited into an
 * exported video (that is Stage 2's native module, §4.3). So the pixels the user
 * sees and the numbers the tests assert come from ONE pure function here.
 *
 * THE THREE PIECES (brief §4.2):
 *   • the NOTE LANE — a piano roll: `x = timeFraction × laneWidth`,
 *     `y = laneIndex(pitch) × laneHeight`, with the pitch range derived from the
 *     take itself (`pitchRangeFor`). Monophonic, so cues never overlap;
 *   • the CHORD STRIP — the take's suggested / user-overridden chord row as chips,
 *     keyed to the same clock (the chord row is a row, so it is shown as a row);
 *   • the PLAYHEAD — one marker from the video's own position.
 *
 * EVERY DRAW ITEM COMES FROM THE CORRECTED TAKE (decision 4): the cues are handed
 * in by the screen, which built them with `noteCuesForVideo` from the take the
 * editor saved. Nothing here reads a video frame, a video audio track or a raw
 * detection trace.
 *
 * PURE: no react, no react-native, no expo, no fs. Asserted by
 * scripts/v38VideoPractice.test.ts.
 */
import type { VideoCue } from './videoTakeSync';

/** The pitch window the lanes cover, derived from the cues themselves. */
export interface PitchRange {
  minPitch: number;
  maxPitch: number;
  /** How many distinct semitone rows the range spans (>= 1). */
  span: number;
}

/** How many semitone rows the lane draws before it folds the range into bands. */
export const OVERLAY_MAX_LANES = 24;
/** The thinnest a note may be drawn (a 25 ms note is still a visible mark). */
export const OVERLAY_MIN_NOTE_WIDTH = 4;

export type OverlayDrawKind = 'note' | 'playhead';

/** One thing the renderer draws. Pure data: no styles, no colours. */
export interface OverlayDrawItem {
  id: string;
  kind: OverlayDrawKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The note's index in the take (empty for the playhead). */
  label: string;
  midi?: number;
}

export interface OverlayBox {
  width: number;
  height: number;
  /** How many pitch rows the lane is split into (default OVERLAY_MAX_LANES). */
  lanes?: number;
}

export interface ChordChip {
  index: number;
  label: string;
  /** Its share of the strip's width, 0..1 (chips are evenly spread). */
  fraction: number;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function pitchRangeFor(cues: ReadonlyArray<VideoCue> | null | undefined): PitchRange {
  const list = Array.isArray(cues) ? cues : [];
  const pitches = list
    .map((cue) => Number(cue?.midi))
    .filter((midi) => Number.isFinite(midi))
    .map((midi) => Math.round(midi));
  if (pitches.length === 0) return { minPitch: 60, maxPitch: 60, span: 1 };
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  return { minPitch, maxPitch, span: Math.max(1, maxPitch - minPitch) };
}

/**
 * WHICH ROW A PITCH SITS ON — high pitches at the TOP, the way a piano roll reads.
 * Returns 0..lanes-1, so a cue can never be drawn outside the box.
 */
export function laneIndexFor(pitch: number, range: PitchRange, lanes: number): number {
  const count = Math.max(1, Math.round(finiteOr(lanes, OVERLAY_MAX_LANES)));
  const base = Math.round(finiteOr(range?.minPitch, 60));
  const span = Math.max(1, Math.round(finiteOr(range?.span, 1)));
  const value = Math.round(finiteOr(pitch, base));
  const fromBottom = Math.min(span, Math.max(0, value - base)) / span;
  const row = Math.round((1 - fromBottom) * (count - 1));
  return Math.min(count - 1, Math.max(0, row));
}

/** Where a moment of the clock sits horizontally (fraction of the box's width). */
export function timeFraction(sec: number, videoDurationSec: number): number {
  const duration = Math.max(0, finiteOr(videoDurationSec, 0));
  if (duration <= 0) return 0;
  const at = Math.max(0, finiteOr(sec, 0));
  return Math.min(1, at / duration);
}

/**
 * THE DRAW LIST. Cues whose onset is outside the video are absent (the cue set
 * already dropped them — `noteCuesForVideo`), and a cue whose mark would start
 * past the right edge is absent too rather than drawn at the edge.
 */
export function overlayLayout(input: {
  cues: ReadonlyArray<VideoCue> | null | undefined;
  videoDurationSec: number;
  clockMs: number;
  box: OverlayBox;
}): OverlayDrawItem[] {
  const cues = Array.isArray(input?.cues) ? input.cues : [];
  const width = Math.max(1, finiteOr(input?.box?.width, 1));
  const height = Math.max(1, finiteOr(input?.box?.height, 1));
  const lanes = Math.max(1, Math.round(finiteOr(input?.box?.lanes, OVERLAY_MAX_LANES)));
  const duration = Math.max(0, finiteOr(input?.videoDurationSec, 0));
  const range = pitchRangeFor(cues);
  const laneHeight = height / lanes;
  const items: OverlayDrawItem[] = [];

  cues.forEach((cue) => {
    const start = finiteOr(cue?.startSec, 0);
    if (duration <= 0) return;
    const x = timeFraction(start, duration) * width;
    if (x >= width) return;
    const end = Math.max(start, finiteOr(cue?.endSec, start));
    const rawWidth = (timeFraction(end, duration) - timeFraction(start, duration)) * width;
    const w = Math.max(OVERLAY_MIN_NOTE_WIDTH, rawWidth);
    const row = laneIndexFor(Number(cue?.midi), range, lanes);
    items.push({
      id: `note-${cue.index}`,
      kind: 'note',
      x,
      y: row * laneHeight,
      w: Math.min(w, width - x),
      h: Math.max(2, laneHeight - 1),
      label: String(cue.index),
      midi: Math.round(finiteOr(cue?.midi, range.minPitch)),
    });
  });

  const clockSec = Math.max(0, finiteOr(input?.clockMs, 0) / 1000);
  const playheadX = timeFraction(clockSec, duration) * width;
  items.push({
    id: 'playhead',
    kind: 'playhead',
    x: playheadX,
    y: 0,
    w: 2,
    h: height,
    label: 'playhead',
  });
  return items;
}

/** The notes sounding at this moment of the video clock (drives the note readout). */
export function cuesAtClock(
  cues: ReadonlyArray<VideoCue> | null | undefined,
  clockMs: number,
): VideoCue[] {
  const at = Math.max(0, finiteOr(clockMs, 0)) / 1000;
  const list = Array.isArray(cues) ? cues : [];
  return list.filter(
    (cue) => at >= finiteOr(cue?.startSec, 0) && at < Math.max(finiteOr(cue?.endSec, 0), finiteOr(cue?.startSec, 0)),
  );
}

/** The draw items a given clock makes visible — the same function the renderer uses. */
export function visibleCues(
  drawList: ReadonlyArray<OverlayDrawItem> | null | undefined,
  clockMs: number,
): OverlayDrawItem[] {
  const list = Array.isArray(drawList) ? drawList : [];
  const playhead = list.find((item) => item.kind === 'playhead');
  if (!playhead) return [];
  return list.filter(
    (item) => item.kind === 'note' && item.x <= playhead.x && playhead.x <= item.x + item.w,
  );
}

/**
 * THE CHORD STRIP. The take's chord row, evenly spread across the strip: the row
 * carries no per-note timing of its own, so it is drawn as a row and labelled
 * "suggested" exactly as the take is (never as a claim about the performance).
 */
export function chordStripLayout(
  chordRow: ReadonlyArray<string> | null | undefined,
  opts: { maxChips?: number } = {},
): ChordChip[] {
  const names = (Array.isArray(chordRow) ? chordRow : [])
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name) => name.length > 0);
  const max = Math.max(1, Math.round(finiteOr(opts?.maxChips, 8)));
  const shown = names.slice(0, max);
  if (shown.length === 0) return [];
  const step = 1 / shown.length;
  return shown.map((label, index) => ({
    index,
    label,
    fraction: index * step,
  }));
}

/** The lane's own honest caption (never a claim the picture carries notes). */
export const OVERLAY_LANE_LABEL = 'Notes NoteSnap heard in your take';
export const OVERLAY_CHORD_LABEL = 'Chords (suggested)';
export const OVERLAY_EMPTY_LINE = 'No notes to draw — there was no readable melody in this take.';
export const OVERLAY_AWAITING_LINE = 'Press play and the notes line up with the video.';
