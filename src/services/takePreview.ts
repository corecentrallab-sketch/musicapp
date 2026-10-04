/**
 * takePreview.ts — the HUM-ALONG INTERACTIVE PREVIEW's model (v33 slice G,
 * owner-ratified option 4: docked INSIDE the editor, one control row above the
 * sticky save bar — NOT a separate screen).
 *
 * WHAT IT PLAYS: the user's OWN take, synthesized on the device, after their
 * corrections. Nothing here is a recording of a song and nothing here is the
 * original music — the caption says so on the surface, and a modern-song match
 * never renders generated notation at all (standing rule).
 *
 * THE ONE RULE THAT MATTERS MOST: the tempo slider is a PREVIEW CLOCK. It
 * changes how fast the synthesized take is played back and NOTHING else — the
 * note times in the take are never rewritten, so a preview at 70% cannot leak
 * into the MIDI export, History or the saved take.
 *
 * PURE (no react / react-native / fs): the timeline, the loop bracket, the
 * cursor, the tempo scaling and the "notes were not touched" guarantee are
 * asserted by scripts/v33TakeEditor.test.ts.
 */
import type { MidiNoteEvent } from './midiExport';

/** The instrument overlays the preview offers (simple synthesized timbres). */
export interface PreviewInstrument {
  id: PreviewInstrumentId;
  label: string;
  /** What the user hears, in one honest word. */
  timbre: string;
}

export type PreviewInstrumentId = 'piano' | 'strings' | 'guitar';

export const PREVIEW_INSTRUMENTS: readonly PreviewInstrument[] = [
  { id: 'piano', label: 'Piano', timbre: 'a soft struck tone' },
  { id: 'strings', label: 'Strings', timbre: 'a slow bowed tone' },
  { id: 'guitar', label: 'Guitar', timbre: 'a plucked tone' },
];

export const PREVIEW_DEFAULT_INSTRUMENT: PreviewInstrumentId = 'piano';

export function previewInstrument(id: string | null | undefined): PreviewInstrument {
  return (
    PREVIEW_INSTRUMENTS.find((instrument) => instrument.id === id) ??
    PREVIEW_INSTRUMENTS[0]
  );
}

/** The preview's own clock range — a rehearsal aid, not a claim about the take. */
export const PREVIEW_TEMPO_MIN_PCT = 50;
export const PREVIEW_TEMPO_MAX_PCT = 150;
export const PREVIEW_TEMPO_STEP_PCT = 10;
export const PREVIEW_TEMPO_DEFAULT_PCT = 100;

export const PREVIEW_SECTION_TITLE = 'Hum along';
export const PREVIEW_PLAY_LABEL = '▶ Play';
export const PREVIEW_PAUSE_LABEL = '❚❚ Pause';
export const PREVIEW_LOOP_ON_LABEL = '🔁 Loop on';
export const PREVIEW_LOOP_OFF_LABEL = '🔁 Loop off';
export const PREVIEW_PREV_LABEL = '◀ Prev note';
export const PREVIEW_NEXT_LABEL = 'Next note ▶';
export const PREVIEW_ONLY_CAPTION =
  'Preview only — this plays your own take, synthesized on the device. It is not a recording, and not the original song.';
export const PREVIEW_TEMPO_CAPTION =
  'Tempo changes the preview only — your note timing is never rewritten.';
export const PREVIEW_EMPTY_LINE = 'Add a note and the preview will play it.';

/** Clamp a preview tempo percentage into the allowed band. */
export function clampPreviewTempo(pct: number): number {
  const value = Math.round(Number(pct));
  if (!Number.isFinite(value)) return PREVIEW_TEMPO_DEFAULT_PCT;
  return Math.min(PREVIEW_TEMPO_MAX_PCT, Math.max(PREVIEW_TEMPO_MIN_PCT, value));
}

export function previewTempoLabel(pct: number): string {
  const value = clampPreviewTempo(pct);
  return value === PREVIEW_TEMPO_DEFAULT_PCT ? '100% (as recorded)' : `${value}%`;
}

export interface PreviewEvent {
  /** Index into the take's note list (the cursor's own addressing). */
  index: number;
  midi: number;
  /** When the note starts on the preview clock, in milliseconds. */
  atMs: number;
  /** How long it sounds on the preview clock, in milliseconds. */
  durMs: number;
}

export interface PreviewTimeline {
  events: PreviewEvent[];
  /** The last note's end on the preview clock. */
  durationMs: number;
  /** The tempo percentage this timeline was built for. */
  tempoPct: number;
}

/**
 * Build the preview clock. `atMs = startSec × 1000 ÷ (tempoPct / 100)` — a pure
 * mapping: the notes themselves are only READ here, never rewritten.
 */
export function buildPreviewTimeline(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  tempoPct = PREVIEW_TEMPO_DEFAULT_PCT,
): PreviewTimeline {
  const scale = clampPreviewTempo(tempoPct) / 100;
  const list = Array.isArray(notes) ? notes : [];
  const events: PreviewEvent[] = list.map((note, index) => {
    const start = Number.isFinite(note?.startSec) ? Math.max(0, Number(note.startSec)) : 0;
    const duration = Number.isFinite(note?.durationSec) ? Math.max(0.05, Number(note.durationSec)) : 0.25;
    return {
      index,
      midi: Math.round(Number(note?.midi)),
      atMs: Math.round((start * 1000) / scale),
      durMs: Math.round((duration * 1000) / scale),
    };
  });
  const durationMs = events.reduce((end, event) => Math.max(end, event.atMs + event.durMs), 0);
  return { events, durationMs, tempoPct: clampPreviewTempo(tempoPct) };
}

/** The note sounding at this point of the preview clock (null in a gap). */
export function cursorIndexAt(timeline: PreviewTimeline, atMs: number): number | null {
  if (!Number.isFinite(atMs) || atMs < 0) return null;
  for (const event of timeline.events) {
    if (atMs >= event.atMs && atMs < event.atMs + event.durMs) return event.index;
  }
  return null;
}

/** Prev/next note stepping for the control row (wraps at the ends). */
export function stepIndex(current: number | null, dir: -1 | 1, count: number): number | null {
  if (count <= 0) return null;
  if (current === null) return dir === 1 ? 0 : count - 1;
  const next = current + dir;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}

/** The loop bracket: the whole take, or the bracket the user drew. */
export interface LoopBracket {
  fromIndex: number;
  toIndex: number;
}

export function fullLoop(count: number): LoopBracket {
  return { fromIndex: 0, toIndex: Math.max(0, count - 1) };
}

/** Loop from one note to another (inclusive), in either draw direction. */
export function loopBetween(a: number, b: number, count: number): LoopBracket {
  if (count <= 0) return { fromIndex: 0, toIndex: 0 };
  const first = Math.max(0, Math.min(count - 1, Math.min(a, b)));
  const second = Math.max(0, Math.min(count - 1, Math.max(a, b)));
  return { fromIndex: first, toIndex: second };
}

/** The preview clock bounds of a loop bracket (what the player repeats). */
export function loopBoundsMs(
  timeline: PreviewTimeline,
  bracket: LoopBracket | null,
): { fromMs: number; toMs: number } {
  if (!bracket || timeline.events.length === 0) {
    return { fromMs: 0, toMs: timeline.durationMs };
  }
  const from = timeline.events[Math.max(0, Math.min(timeline.events.length - 1, bracket.fromIndex))];
  const to = timeline.events[Math.max(0, Math.min(timeline.events.length - 1, bracket.toIndex))];
  return { fromMs: from.atMs, toMs: to.atMs + to.durMs };
}

/** What the surface says about the preview's state (never a claim it cannot back). */
export function previewStatusLine(input: {
  playing: boolean;
  loop: boolean;
  noteCount: number;
  cursor: number | null;
}): string {
  if (input.noteCount === 0) return PREVIEW_EMPTY_LINE;
  const where = input.cursor === null ? 'between notes' : `note ${input.cursor + 1} of ${input.noteCount}`;
  const state = input.playing ? 'Playing' : 'Paused';
  return `${state} — ${where}${input.loop ? ' · looping' : ''}`;
}

/** The instruction that makes the tempo rule impossible to miss. */
export const PREVIEW_TEMPO_NEVER_REWRITES = true;
