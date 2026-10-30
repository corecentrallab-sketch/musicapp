/**
 * videoCompare.ts — ITEM 1: TWO TAKES, SIDE BY SIDE (v47 part B, owner GO 10-28;
 * backlog a49fbe2d; the practice-video brief's Stage 1 spine).
 *
 * WHAT THE OWNER ASKED FOR. Record two takes of the same passage and compare them
 * side by side, on the user's own device, with no network at all.
 *
 * THE FOUR PROPERTIES THIS MODULE PINS, BECAUSE THEY ARE THE WHOLE FEATURE:
 *
 *   1. BOTH VIDEOS ARE LOCAL FILES. The two sides are the user's own documents-dir
 *      videos (`notesnap-practice-videos/…`), handed in as URIs. Nothing here
 *      fetches, uploads or resolves anything: `compareIsOffline` (in
 *      v47PartBContract) asserts the surface and this model carry no network call,
 *      and the copy says the comparison works in airplane mode.
 *   2. THE LAYOUT IS HONEST AT NARROW WIDTH. `compareColumns` divides the CONTENT
 *      width into two equal columns when each one can still hold a readable video
 *      and note lane (≥ COMPARE_MIN_COLUMN_DP), and stacks them when it cannot —
 *      never two unreadably thin strips.
 *   3. THE COPY NEVER JUDGES. This module describes what is on the screen (two
 *      takes, each one's length, how many of its notes fall inside its own video)
 *      and nothing else. There is no verdict, no number out of ten, no claim that
 *      one take is an advance on the other — the tier1 guard sweeps these sources
 *      for exactly those words and fails if one appears.
 *   4. THE NOTES COME FROM THE EXISTING TAKE DATA. Each side's cues are
 *      `noteCuesForVideo(take, { audioOffsetMs, videoDurationSec })` — the SAME
 *      mapping the playback overlay already uses, on THAT side's own clock and
 *      its own measured offset. No new analysis, no second reading of the audio,
 *      no frame inspection: if a take has no notes, the side says so.
 *
 * THE EDGE CASES ARE THE FEATURE (owner brief): one take only (say so, and point
 * at recording a second — never a dead end), a take whose file is gone (that side
 * says so while the other still plays), and takes of different lengths (both play
 * their own full length, and the surface says they differ).
 *
 * PURE: no react, no react-native, no expo, no fs, no network — so the tier1 gate
 * pins the layout, the states and the copy with no device in the loop
 * (scripts/v47TakeCompare.test.ts).
 */
import type { SavedCaptureTake } from './midiExport';
import { practiceVideoIsUsable, type PracticeVideoRef } from './practiceVideoRef';
import { takeNoteShareLine } from './takeNotes';
import { noteCuesForVideo, videoClock, type VideoCue } from './videoTakeSync';

/** The CTA on the playback surface that opens the comparison. */
export const COMPARE_CTA = 'Compare with another take';
/** The surface's title. */
export const COMPARE_TITLE = 'Two takes, side by side';
/**
 * The one-line description of what the screen IS (the owner's own framing): two of
 * the user's takes, on the same clock. It describes the layout, not the playing.
 */
export const COMPARE_SUBTITLE = 'Two of your takes, side by side, on the same clock.';
/**
 * THE HONESTY LINE. It says what NoteSnap does (shows the two takes) and what it
 * does NOT do (judge them). Nothing on this surface ranks, marks or advises.
 */
export const COMPARE_HONESTY =
  'NoteSnap shows you the two takes and adds nothing of its own. What you hear is yours to weigh.';
/**
 * THE AIRPLANE-MODE STATEMENT (owner brief: state it explicitly). Both sides are
 * files in the app's own folder on this phone; the players never open a socket.
 */
export const COMPARE_OFFLINE_LINE =
  'Both videos are your own files on this phone, so this works with no signal at all — airplane mode included.';
/** The shared clock's own labels. */
export const COMPARE_CLOCK_LABEL = 'Same clock';
export const COMPARE_EARLIER_CTA = '− 1s';
export const COMPARE_LATER_CTA = '+ 1s';
export const COMPARE_PLAY_CTA = '▶ Play this take';
export const COMPARE_PAUSE_CTA = '⏸ Pause';
/**
 * WHAT "THE SAME CLOCK" HONESTLY MEANS HERE. Both videos are seeked by one clock,
 * so the user can put both takes on the same moment and play either one from
 * there. Only the take that was pressed plays — the two sounds never mix, and
 * nothing claims the two players are frame-locked to each other.
 */
export const COMPARE_CLOCK_LINE =
  'Both takes sit on one clock. Move the clock and both videos follow it, then play either take from that moment — only the one you press plays, so the two sounds never mix.';

/** ONE TAKE ONLY — the honest state, and the way forward (never a dead end). */
export const COMPARE_ONE_TAKE_LINE =
  'You have one filmed take so far. Film a second take of the same passage and it will sit here beside this one.';
export const COMPARE_RECORD_SECOND_CTA = 'Record a second take';
/** A take whose video file is no longer on this device. */
export const COMPARE_MISSING_LINE =
  'This take’s video is no longer on this device. The other take still plays, and the take itself is untouched.';
/** Takes of different lengths — each plays its own full length, said plainly. */
export const COMPARE_DIFFERENT_LENGTHS_LINE =
  'The two takes are different lengths — each one plays its own full length.';
/** Takes that happen to match. */
export const COMPARE_SAME_LENGTH_LINE = 'Both takes are the same length.';
/** The two column headings. */
export const COMPARE_LEFT_LABEL = 'This take';
export const COMPARE_RIGHT_LABEL = 'The other take';
/** A side with no notes of its own (the take could not be read). */
export const COMPARE_NO_NOTES_LINE = 'No notes were read from this take.';
/** The back action. */
export const COMPARE_BACK_CTA = '← Back to my practice';

/**
 * THE NARROW-WIDTH RULE. A side-by-side column has to hold a video AND the note
 * lane; below this width the two takes stack instead of being squeezed.
 */
export const COMPARE_MIN_COLUMN_DP = 132;
/** The gap between the two columns. */
export const COMPARE_GAP_DP = 10;
/** The page's own horizontal padding (the component applies it). */
export const COMPARE_PADDING_DP = 16;
/** How many chord chips one side shows before it stops. */
export const COMPARE_MAX_CHIPS = 4;

export interface CompareColumns {
  /** 2 = side by side, 1 = stacked (the honest fallback at narrow width). */
  columns: 1 | 2;
  /** Each column's width in dp, derived from the content width. */
  columnWidth: number;
  gap: number;
}

/**
 * THE LAYOUT. Two equal columns whenever each one is still ≥
 * COMPARE_MIN_COLUMN_DP wide; one column otherwise. Never a negative width, never
 * a column wider than the content box.
 */
export function compareColumns(widthDp: number): CompareColumns {
  const width = Math.max(0, Math.round(Number(widthDp) || 0));
  const gap = COMPARE_GAP_DP;
  const two = Math.floor((width - gap) / 2);
  if (two >= COMPARE_MIN_COLUMN_DP) return { columns: 2, columnWidth: two, gap };
  return { columns: 1, columnWidth: width, gap };
}

/** What a side can be: playable, missing its file, or not there at all. */
export type CompareSideState = 'ready' | 'missing' | 'empty';

/** One take as the comparison needs it — the row's own data, nothing derived. */
export interface CompareSideInput {
  label: string;
  ref: PracticeVideoRef | null;
  take: SavedCaptureTake | null;
  /** The take's own local label (the note the user typed), when it has one. */
  note?: string | null;
}

export interface CompareSide {
  label: string;
  state: CompareSideState;
  /** The local file the player opens (null when there is nothing to play). */
  uri: string | null;
  durationSec: number;
  /** `0:41` — that side's own length. */
  clockLabel: string;
  /** `This take · 0:41` — the heading's second line. */
  lengthLine: string;
  /** The take's notes on THIS video's clock (the existing mapping, per side). */
  cues: VideoCue[];
  /** `2 of 3 notes fall inside the video` — null when nothing was dropped. */
  cuesLine: string | null;
  noteCount: number;
  /** The take's own label line, or null when it has none (older takes). */
  noteLine: string | null;
}

/** Is there a file to play? A ref without a URI is 'missing', not 'ready'. */
export function compareSideState(ref: PracticeVideoRef | null | undefined): CompareSideState {
  if (!ref) return 'empty';
  return practiceVideoIsUsable(ref) ? 'ready' : 'missing';
}

/** One side, built from that row's own data. Reads only; nothing is re-timed. */
export function compareSide(input: CompareSideInput): CompareSide {
  const ref = input?.ref ?? null;
  const take = input?.take ?? null;
  const state = compareSideState(ref);
  const durationSec = Math.max(0, Number(ref?.durationSec) || 0);
  const label = typeof input?.label === 'string' && input.label.length > 0 ? input.label : COMPARE_LEFT_LABEL;
  const cues = state === 'ready'
    ? noteCuesForVideo(take, {
        audioOffsetMs: Math.round(Number(ref?.audioOffsetMs) || 0),
        videoDurationSec: durationSec,
      })
    : { cues: [] as VideoCue[], droppedCount: 0, inVideoCount: 0, totalCount: 0, droppedReason: null };
  const noteCount = Array.isArray(take?.notes) ? take.notes.length : 0;
  return {
    label,
    state,
    uri: state === 'ready' ? (ref?.uri ?? null) : null,
    durationSec,
    clockLabel: videoClock(durationSec),
    lengthLine: `${label} · ${videoClock(durationSec)}`,
    cues: cues.cues,
    cuesLine:
      cues.droppedCount > 0
        ? `${cues.inVideoCount} of ${cues.totalCount} notes fall inside this video`
        : null,
    noteCount,
    noteLine: takeNoteShareLine(input?.note),
  };
}

export interface ComparePairInput {
  left: CompareSideInput;
  /** The other take, or null when the user has only one. */
  right: CompareSideInput | null;
  /** The content width in dp (the component measures it). */
  widthDp: number;
}

export interface ComparePair {
  columns: CompareColumns;
  sides: CompareSide[];
  /** How many sides can really play. */
  readyCount: number;
  /** True when only ONE filmed take exists at all (the honest one-take state). */
  oneTake: boolean;
  /** The length honesty line, or null when a side cannot be measured. */
  lengthLine: string | null;
  /** The longest of the two videos, in seconds — the shared clock's upper bound. */
  longestSec: number;
  honesty: string;
  offlineLine: string;
  clockLine: string;
}

/**
 * THE PAIR. `right` is null when the user has filmed only one take: the surface
 * then shows the one-take line and the way to film a second, rather than an empty
 * column with a control that cannot work.
 */
export function comparePair(input: ComparePairInput): ComparePair {
  const left = compareSide(input?.left ?? { label: COMPARE_LEFT_LABEL, ref: null, take: null });
  const right = input?.right ? compareSide(input.right) : null;
  const sides = right ? [left, right] : [left];
  const readyCount = sides.filter((side) => side.state === 'ready').length;
  return {
    columns: compareColumns(input?.widthDp ?? 0),
    sides,
    readyCount,
    oneTake: right === null,
    lengthLine: right ? compareLengthLine(left, right) : null,
    longestSec: compareLongestSec(sides),
    honesty: COMPARE_HONESTY,
    offlineLine: COMPARE_OFFLINE_LINE,
    clockLine: COMPARE_CLOCK_LINE,
  };
}

/** The longest playable side, in seconds — the shared clock never exceeds it. */
export function compareLongestSec(sides: ReadonlyArray<CompareSide>): number {
  let longest = 0;
  for (const side of sides ?? []) {
    const seconds = Math.max(0, Number(side?.durationSec) || 0);
    if (seconds > longest) longest = seconds;
  }
  return longest;
}

/**
 * THE SHARED CLOCK'S SEEK TARGET: where both players are moved to. Clamped to
 * `[0, longestSec]` and never negative, so a press can neither wrap nor seek past
 * the end of the longer take.
 */
export function compareSeekTarget(
  currentMs: number,
  deltaMs: number,
  longestDurationSec: number,
): number {
  const max = Math.max(0, Math.round((Number(longestDurationSec) || 0) * 1000));
  const current = Number.isFinite(Number(currentMs)) ? Number(currentMs) : 0;
  const delta = Number.isFinite(Number(deltaMs)) ? Number(deltaMs) : 0;
  return Math.min(max, Math.max(0, Math.round(current + delta)));
}

/**
 * THE LENGTH LINE. Two takes of the same passage are rarely the same length, and
 * the surface says which case it is — it never implies that the shorter one is
 * unfinished or the longer one is complete.
 */
export function compareLengthLine(left: CompareSide, right: CompareSide): string | null {
  if (!left || !right) return null;
  if (left.state !== 'ready' || right.state !== 'ready') return null;
  const a = Math.round(Number(left.durationSec) || 0);
  const b = Math.round(Number(right.durationSec) || 0);
  return a === b ? COMPARE_SAME_LENGTH_LINE : COMPARE_DIFFERENT_LENGTHS_LINE;
}

/**
 * THE SHARED TRANSPORT'S CLOCK. `Play both` starts both players from zero; the
 * surface's single readout is the later of the two positions, so it never claims a
 * moment one of the players has not reached.
 */
export function compareClockMs(positionsMs: ReadonlyArray<number>): number {
  let clock = 0;
  for (const value of positionsMs ?? []) {
    const ms = Number(value);
    if (Number.isFinite(ms) && ms > clock) clock = ms;
  }
  return Math.round(clock);
}

/** The one-take state's own line, or null when two takes are present. */
export function compareOneTakeLine(pair: ComparePair | null | undefined): string | null {
  return pair && pair.oneTake ? COMPARE_ONE_TAKE_LINE : null;
}

/**
 * Which side, if any, cannot play — so the surface can print the honest missing
 * line once, under the right column, instead of leaving a black rectangle.
 */
export function compareMissingSide(pair: ComparePair | null | undefined): CompareSide | null {
  const sides = pair?.sides ?? [];
  for (const side of sides) if (side.state === 'missing') return side;
  return null;
}
