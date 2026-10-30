/**
 * takeClipTag.ts — ITEM 2: CLIP THE PAIR AND LABEL IT FOR THE TEACHER (v47 part B,
 * owner GO 10-28; backlog a49fbe2d).
 *
 * WHAT THIS EXTENDS. The practice-video Send-to pair (v38/v40) already hands the
 * user's own video plus the take's PDF/MIDI to the system share sheet. This adds
 * the two things the owner asked for on top of it: a SPAN (send only part of the
 * take) and a LABEL (tell the teacher what to listen for).
 *
 * ── THE SPAN, AND WHY IT CANNOT HALF-APPLY ───────────────────────────────────
 *
 * The take's notes are stored in AUDIO seconds (`MidiNoteEvent.startSec`); the
 * video's clock is `note.startSec + audioOffsetMs / 1000` — the same mapping the
 * overlay draws with (services/videoTakeSync.ts). So a span is chosen on the
 * VIDEO's clock (that is the clock the user scrubs) and every member of the pair
 * is derived from that ONE span, in one function (`trimmedSendPair`), so a clipped
 * PDF can never travel with notes on the wrong clock:
 *
 *   • THE TAKE MEMBER — the notes whose VIDEO onset falls inside [start, end) are
 *     kept and REBASED: `newStartSec = (note.startSec + offset) − span.startSec`,
 *     and a note that runs past the span end is cut at the end. The trimmed take's
 *     own `durationSec` is the span's length. So 0:00 of the PDF/MIDI is the first
 *     frame of the span, and every later note is the same distance from it as it
 *     was on the video. `scripts/v47TrimTag.test.ts` proves that for every kept
 *     note: `trimmed.startSec + span.startSec === original.startSec + offset`.
 *   • THE VIDEO MEMBER — this app has NO media engine (no ffmpeg, no expo-video,
 *     no composition module), so the .mp4 cannot be cut on the device. The video
 *     therefore travels WHOLE with the span printed on it (share dialog title) and
 *     in the summary, and the surface says exactly that
 *     (`TRIM_VIDEO_WHOLE_LINE`) instead of implying a cut file. In-app the span IS
 *     applied to the video: `trimPlaybackShouldPause` stops the player at the
 *     span's end, so what the user watches is the span.
 *   • NO SPAN AT ALL — every function here returns the input untouched (the same
 *     object), so a take with no clip sends exactly what it sent before this
 *     change, and an older row (no span stored) behaves identically.
 *
 * ── THE LABEL ────────────────────────────────────────────────────────────────
 *
 * The label is the take's OWN local text — the `takeNote` field the app already
 * keeps for a take (services/takeNotes.ts, v39), edited on the History card. This
 * feature surfaces it where the teacher needs it (preset chips + a text box in the
 * clip step) and carries it onto EVERY member of the pair: the summary line
 * (`takeNoteShareLine`), the PDF/MIDI title and the video's dialog title. There is
 * deliberately no second label field, so a take can never carry two labels that
 * disagree, and a take with no label renders exactly as it did before (the older-
 * take rule: absent means absent, never an empty "Note:" line).
 *
 * PURE: no react, no react-native, no expo, no fs, no network — the span math, the
 * pair derivation and the copy are pinned by scripts/v47TrimTag.test.ts.
 */
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';
import { practiceVideoIsUsable, type PracticeVideoRef } from './practiceVideoRef';
import { TAKE_NOTE_MAX_LENGTH, normaliseTakeNote, takeNoteShareLine } from './takeNotes';
import { videoClock } from './videoTakeSync';

// ─────────────────────────────────────────────────────────────────────────────
// THE SPAN
// ─────────────────────────────────────────────────────────────────────────────

/** A clip window, in seconds on the VIDEO's clock. */
export interface TakeTrimSpan {
  startSec: number;
  endSec: number;
}

/** The shortest span we will send — below this there is nothing to hear. */
export const TRIM_MIN_SECONDS = 1;
/** One press of the trim controls. */
export const TRIM_STEP_SECONDS = 1;

/** The clip step's own copy. */
export const TRIM_LABEL = 'Clip this pair';
export const TRIM_HINT =
  'Choose where the clip starts and ends on your video’s clock. The PDF and the MIDI are your take from that window, and the video goes with the same window printed on it.';
export const TRIM_START_LABEL = 'Starts at';
export const TRIM_END_LABEL = 'Ends at';
export const TRIM_EARLIER_LABEL = '−';
export const TRIM_LATER_LABEL = '+';
export const TRIM_CLEAR_CTA = 'Use the whole take';
export const TRIM_WHOLE_TAKE_LINE = 'The whole take goes to your teacher.';
/** Too short / unusable span — said plainly, never silently ignored. */
export const TRIM_TOO_SHORT_LINE = 'That window is too short to send — pick at least one second.';
/**
 * THE VIDEO MEMBER'S HONEST LIMIT (see the header). It states why the video file
 * travels whole and what the span does instead of pretending the .mp4 was cut.
 */
export const TRIM_VIDEO_WHOLE_LINE =
  'Your phone cannot cut the video file itself, so the video travels whole — the window is printed on it and in the summary, and the PDF and MIDI are your take from that window only.';
/** A span that holds no notes: nothing to print, but the pair still goes. */
export const TRIM_NO_NOTES_LINE =
  'No notes of this take fall inside that window, so there is no PDF or MIDI for it — your video and the summary still go.';

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * THE SPAN AS IT WILL BE STORED: ordered, inside the video, at least
 * TRIM_MIN_SECONDS long. Returns null when the input cannot describe a real
 * window (no video, a video shorter than the minimum, a non-finite bound).
 */
export function normaliseTrimSpan(
  span: TakeTrimSpan | null | undefined,
  durationSec: number,
): TakeTrimSpan | null {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < TRIM_MIN_SECONDS) return null;
  if (!span) return null;
  const rawStart = Number(span.startSec);
  const rawEnd = Number(span.endSec);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const start = Math.min(Math.max(0, round3(rawStart)), duration);
  const end = Math.min(Math.max(start, round3(rawEnd)), duration);
  if (end - start < TRIM_MIN_SECONDS) return null;
  return { startSec: start, endSec: end };
}

/** Why a proposed span cannot be used, or null when it is fine. */
export function trimSpanProblem(
  span: TakeTrimSpan | null | undefined,
  durationSec: number,
): string | null {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < TRIM_MIN_SECONDS) return TRIM_TOO_SHORT_LINE;
  if (!span) return null;
  return normaliseTrimSpan(span, duration) === null ? TRIM_TOO_SHORT_LINE : null;
}

/** `0:12–0:38` — the window as every member of the pair prints it. */
export function trimSpanLabel(span: TakeTrimSpan | null | undefined): string | null {
  if (!span) return null;
  const start = Number(span.startSec);
  const end = Number(span.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return `${videoClock(start)}–${videoClock(end)}`;
}

/** Move one end of the span by `delta` seconds and re-normalise it. */
export function nudgeTrimSpan(
  span: TakeTrimSpan | null | undefined,
  edge: 'start' | 'end',
  delta: number,
  durationSec: number,
): TakeTrimSpan | null {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < TRIM_MIN_SECONDS) return null;
  const base = span ?? { startSec: 0, endSec: duration };
  const step = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  const next: TakeTrimSpan =
    edge === 'start'
      ? { startSec: base.startSec + step, endSec: base.endSec }
      : { startSec: base.startSec, endSec: base.endSec + step };
  // A start that would pass the end (or an end that would pass the start) stops
  // one minimum-span short of it instead of collapsing the window.
  if (edge === 'start' && next.startSec > next.endSec - TRIM_MIN_SECONDS) {
    next.startSec = next.endSec - TRIM_MIN_SECONDS;
  }
  if (edge === 'end' && next.endSec < next.startSec + TRIM_MIN_SECONDS) {
    next.endSec = next.startSec + TRIM_MIN_SECONDS;
  }
  return normaliseTrimSpan(next, duration);
}

export interface TrimmedTake {
  take: SavedCaptureTake | null;
  span: TakeTrimSpan | null;
  keptCount: number;
  droppedCount: number;
  totalCount: number;
  /** False when no span was applied — the take came back as the same object. */
  trimmed: boolean;
}

/**
 * APPLY THE SPAN TO THE TAKE (the alignment rule, in code). Notes are selected by
 * their VIDEO onset — `note.startSec + audioOffsetMs / 1000` — and rebased so the
 * span's first frame is 0. A note that runs past the span end is cut there. Notes
 * outside the window are dropped, never clamped.
 *
 * With no span the ORIGINAL take object is returned (identity), which is what makes
 * "no clip ⇒ exactly what we sent before" a property of the code.
 */
export function applyTrimToTake(
  take: SavedCaptureTake | null | undefined,
  span: TakeTrimSpan | null | undefined,
  audioOffsetMs: number,
): TrimmedTake {
  const notes: ReadonlyArray<MidiNoteEvent> = Array.isArray(take?.notes) ? take.notes : [];
  const total = notes.length;
  /**
   * The span is taken as given here (the caller clamps it to the video's length
   * with `normaliseTrimSpan`); all this function insists on is a real, ordered
   * window. A span that cannot be read is treated as "no span", never as an
   * empty take — a take must not lose its notes to a bad window.
   */
  const rawStart = Number(span?.startSec);
  const rawEnd = Number(span?.endSec);
  const clean =
    span && Number.isFinite(rawStart) && Number.isFinite(rawEnd)
      ? {
          startSec: Math.min(rawStart, rawEnd),
          endSec: Math.max(rawStart, rawEnd),
        }
      : null;
  if (!take || !clean || clean.endSec - clean.startSec < TRIM_MIN_SECONDS) {
    return { take: take ?? null, span: null, keptCount: total, droppedCount: 0, totalCount: total, trimmed: false };
  }
  const offsetSec = (Number.isFinite(Number(audioOffsetMs)) ? Number(audioOffsetMs) : 0) / 1000;
  const start = Math.min(clean.startSec, clean.endSec);
  const end = Math.max(clean.startSec, clean.endSec);
  const kept: MidiNoteEvent[] = [];
  let dropped = 0;
  notes.forEach((note) => {
    const midi = Number(note?.midi);
    const startRaw = Number(note?.startSec);
    if (!Number.isFinite(midi) || !Number.isFinite(startRaw)) {
      dropped += 1;
      return;
    }
    const videoOnset = startRaw + offsetSec;
    if (videoOnset < start || videoOnset >= end) {
      dropped += 1;
      return;
    }
    const length = Math.max(0, Number.isFinite(Number(note?.durationSec)) ? Number(note.durationSec) : 0);
    const videoEnd = Math.min(videoOnset + length, end);
    kept.push({
      ...note,
      midi: Math.round(midi),
      startSec: round3(videoOnset - start),
      durationSec: round3(Math.max(0, videoEnd - videoOnset)),
    });
  });
  const trimmed: SavedCaptureTake = {
    ...take,
    notes: kept,
    durationSec: round3(end - start),
  };
  return {
    take: trimmed,
    span: { startSec: start, endSec: end },
    keptCount: kept.length,
    droppedCount: dropped,
    totalCount: total,
    trimmed: true,
  };
}

/**
 * DOES THE PLAYER STOP AT THE SPAN'S END? The in-app half of "the span applies to
 * the video too": with a span set, the playback surface pauses when the video
 * reaches it, so the user watches the window they are about to send.
 */
export function trimPlaybackShouldPause(
  positionMs: number,
  span: TakeTrimSpan | null | undefined,
): boolean {
  if (!span) return false;
  const position = Number(positionMs);
  const end = Number(span.endSec);
  if (!Number.isFinite(position) || !Number.isFinite(end)) return false;
  return position >= end * 1000 - 50;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LABEL (the take's own note, teacher-facing)
// ─────────────────────────────────────────────────────────────────────────────

/** The label step's copy — what the teacher is told to listen for. */
export const TAKE_TAG_LABEL = 'What should your teacher listen for?';
export const TAKE_TAG_HINT =
  'A few words on this take — it stays on this device and travels with the pair when you share it.';
export const TAKE_TAG_PLACEHOLDER = 'e.g. bars 12–16, the run at the end';
export const TAKE_TAG_PRESETS_LABEL = 'Or pick one:';
/** A small, honest set — each one names a thing to listen for, not a verdict. */
export const TAKE_TAG_PRESETS: readonly string[] = [
  'Tricky bars',
  'Sight-reading',
  'Scales',
  'Chords',
  'Timing',
  'The ending',
];
export const TAKE_TAG_CLEAR_CTA = 'Clear the label';
export const TAKE_TAG_SAVED_LINE = 'Label saved with this take.';
export const TAKE_TAG_CLEARED_LINE = 'Label cleared — the take is unchanged.';
export const TAKE_TAG_FAILED_LINE =
  'That label could not be saved just now — the take is unchanged. Please try again.';
/** The label's limit is the take note's own limit (one field, one rule). */
export const TAKE_TAG_MAX_CHARS = TAKE_NOTE_MAX_LENGTH;

/** The stored label, normalised (null when there is none — older takes). */
export function normaliseTakeTag(raw: string | null | undefined): string | null {
  return normaliseTakeNote(raw);
}

/** The label as the pair prints it, or null when the take has none. */
export function tagLineFor(raw: string | null | undefined): string | null {
  return takeNoteShareLine(raw);
}

/** Is this preset the label the take already carries? (case-insensitive) */
export function tagPresetIsActive(preset: string, raw: string | null | undefined): boolean {
  const current = normaliseTakeTag(raw);
  if (!current) return false;
  return current.toLowerCase() === String(preset ?? '').trim().toLowerCase();
}

/** The label trimmed for a file name / dialog title (the full one rides the summary). */
export function tagForTitle(raw: string | null | undefined, max = 40): string | null {
  const tag = normaliseTakeTag(raw);
  if (!tag) return null;
  return tag.length <= max ? tag : `${tag.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PAIR — ONE SPAN, BOTH MEMBERS
// ─────────────────────────────────────────────────────────────────────────────

export interface TrimmedPairInput {
  ref: PracticeVideoRef | null;
  take: SavedCaptureTake | null;
  span: TakeTrimSpan | null;
  note?: string | null;
  /** The row's title (`Practice video`), used in the shared names. */
  title?: string | null;
}

export interface TrimmedSendPair {
  /** The one span both members came from (null = the whole take). */
  span: TakeTrimSpan | null;
  spanLabel: string | null;
  /** The video member: the same local file, with the span carried on it. */
  video: PracticeVideoRef | null;
  /** The take member: the span's notes, on the span's own clock. */
  take: SavedCaptureTake | null;
  /** The take's own label (null when it has none). */
  note: string | null;
  noteLine: string | null;
  keptCount: number;
  droppedCount: number;
  totalCount: number;
  /** `Practice video — 0:12–0:38` (the video's share dialog title). */
  title: string;
  /** `Take — tricky bars — 0:12–0:38` (the PDF/MIDI name). */
  takeTitle: string;
  /** The window, in words, for the summary and the surface. */
  spanLine: string | null;
  /** True when the span holds no notes: no PDF/MIDI, video + summary still go. */
  spanHasNoNotes: boolean;
}

/** `Practice video — 0:12–0:38` / `Take — bars 12–16 — 0:12–0:38`. */
export function pairMemberTitle(
  kind: 'video' | 'take',
  note: string | null | undefined,
  span: TakeTrimSpan | null | undefined,
  baseTitle?: string | null,
): string {
  const stem = kind === 'video'
    ? ((typeof baseTitle === 'string' && baseTitle.trim()) || 'Practice video')
    : 'Take';
  const parts = [stem];
  const tag = tagForTitle(note);
  if (tag) parts.push(tag);
  const label = trimSpanLabel(span);
  if (label) parts.push(label);
  return parts.join(' — ');
}

/**
 * THE PAIR, DERIVED FROM ONE SPAN. Both members come out of this single call, so
 * the sheet cannot hand the share sheet a clipped PDF and an unlabelled video (or
 * the reverse): the video member carries the span, the take member IS the span, and
 * both titles name it.
 */
export function trimmedSendPair(input: TrimmedPairInput): TrimmedSendPair {
  const span = input?.span ?? null;
  const note = normaliseTakeTag(input?.note);
  const trimmed = applyTrimToTake(input?.take ?? null, span, Math.round(Number(input?.ref?.audioOffsetMs) || 0));
  const usableSpan = trimmed.span;
  const spanLabel = trimSpanLabel(usableSpan);
  return {
    span: usableSpan,
    spanLabel,
    /**
     * THE VIDEO MEMBER carries the window ON IT (`trim`), so the value the share
     * path hands the platform is the same object that says which window it covers.
     */
    video: practiceVideoIsUsable(input?.ref ?? null)
      ? { ...(input.ref as PracticeVideoRef), trim: usableSpan }
      : null,
    take: trimmed.take,
    note,
    noteLine: tagLineFor(note),
    keptCount: trimmed.keptCount,
    droppedCount: trimmed.droppedCount,
    totalCount: trimmed.totalCount,
    title: pairMemberTitle('video', note, usableSpan, input?.title),
    takeTitle: pairMemberTitle('take', note, usableSpan, input?.title),
    spanLine: usableSpan
      ? `This pair covers ${spanLabel} of your video: the video goes whole with that window on it, and the PDF and MIDI are your take from ${spanLabel}, starting at 0:00 of the window.`
      : null,
    spanHasNoNotes: trimmed.trimmed && trimmed.keptCount === 0,
  };
}
