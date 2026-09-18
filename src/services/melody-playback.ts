/**
 * melody-playback.ts — turn a reference melody's ABC into a schedule of
 * synthesiser notes (SITE WAVE 1b, P2: the "play the melody" widget).
 *
 * The widget synthesises the melody in the browser with the Web Audio API — no
 * audio files, no R2 objects, no infra, and it keeps working offline because the
 * ABC is embedded in the rendered page. This module is the pure half of that:
 * ABC -> timed notes in seconds, at an honest tempo. The browser half
 * (`components/MelodyPlayer.tsx`) only schedules oscillators from this plan, so
 * the scheduling logic itself is unit-testable without a DOM or an AudioContext.
 *
 * Tempo: the bundled public-domain seeds carry no `Q:` (tempo) header, so there
 * is no score tempo to quote. We therefore play at a documented practice tempo
 * (DEFAULT_MELODY_BPM) and SAY SO in the UI — the widget never implies the
 * composer's metronome mark. If an ABC ever does carry `Q:`, that marking wins.
 *
 * Pure: no network, no DOM, no environment.
 */
import { parseAbc } from "./abc/abc-parser";

/** Practice tempo used when the ABC carries no `Q:` marking (the seeds). */
export const DEFAULT_MELODY_BPM = 100;
/** Refuse an absurd `Q:` value (a parse accident) instead of playing nonsense. */
export const MIN_MELODY_BPM = 40;
export const MAX_MELODY_BPM = 240;
/**
 * Upper bound on scheduled notes. The eight seeds are 4-bar excerpts (<25 notes);
 * this is only a guard against a pathological ABC in a future seed list, not a
 * limit any real melody should hit.
 */
export const MAX_MELODY_NOTES = 400;
/** Tone length as a fraction of the written note — a small gap keeps it musical. */
export const SOUNDING_RATIO = 0.92;
/** Shortest audible tone, so a 32nd note is not a click. */
export const MIN_SOUNDING_SEC = 0.06;
/** Silence after the last note before the player reports "finished". */
export const STOP_TAIL_SEC = 0.4;

export type TempoSource = "abc" | "default" | "caller";

export interface ScheduledMelodyNote {
  midi: number;
  frequencyHz: number;
  /** Seconds from the start of the melody. */
  startSec: number;
  /** Written duration in seconds (incl. the gap before the next note). */
  durationSec: number;
  /** Duration the oscillator actually sounds (durationSec × SOUNDING_RATIO). */
  soundingSec: number;
}

export interface MelodyPlaybackPlan {
  notes: ScheduledMelodyNote[];
  /** End of the last note, in seconds. 0 when there is nothing to play. */
  totalSec: number;
  bpm: number;
  tempoSource: TempoSource;
  /** Seconds per quarter-note beat at `bpm`. */
  beatSec: number;
}

/** Equal temperament, A4 = MIDI 69 = 440 Hz. */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Read a `Q:` tempo marking when the ABC has one, else the documented practice
 * tempo. `Q:1/4=120` → 120 BPM; `Q:1/8=120` → 60 quarter-note BPM (the marking
 * counts eighth notes). Nonsense or out-of-range values are ignored — we would
 * rather play at our stated practice tempo than guess.
 */
export function parseAbcTempoBpm(abc: string): {
  bpm: number;
  source: TempoSource;
} {
  for (const line of abc.replace(/\r\n/g, "\n").split("\n")) {
    const tag = /^\s*Q:\s*(.*)$/.exec(line);
    if (!tag) continue;
    const raw = tag[1].trim();
    const equals = /=\s*(\d{1,3})(?:\.\d+)?/.exec(raw);
    if (!equals) continue;
    const value = Number(equals[1]);
    if (!Number.isFinite(value) || value <= 0) continue;

    let bpm = value;
    const unit = /(\d+)\s*\/\s*(\d+)/.exec(raw.split("=")[0] ?? "");
    if (unit) {
      const den = Number(unit[2]);
      if (!Number.isFinite(den) || den <= 0) continue;
      bpm = value * (4 / den);
    }
    if (bpm < MIN_MELODY_BPM || bpm > MAX_MELODY_BPM) continue;
    return { bpm: Math.round(bpm), source: "abc" };
  }
  return { bpm: DEFAULT_MELODY_BPM, source: "default" };
}

/**
 * Build the play schedule for an ABC melody.
 *
 * Rests advance time but produce no note; a chord is reduced to its median pitch
 * (the seeds are single-line melodies — the reduction matches `hum/skeleton.ts`).
 * `opts.bpm` overrides the tempo for a caller that wants a slower practice run.
 */
export function buildMelodyPlaybackPlan(
  abc: string,
  opts?: { bpm?: number },
): MelodyPlaybackPlan {
  const parsedTempo = parseAbcTempoBpm(abc);
  const override =
    typeof opts?.bpm === "number" && Number.isFinite(opts.bpm) && opts.bpm > 0
      ? opts.bpm
      : null;
  const bpm = override ?? parsedTempo.bpm;
  const tempoSource: TempoSource = override
    ? "caller"
    : parsedTempo.source;
  const beatSec = 60 / bpm;

  const events = parseAbc(abc).events;
  const notes: ScheduledMelodyNote[] = [];
  for (const ev of events) {
    if (notes.length >= MAX_MELODY_NOTES) break;
    if (!ev.pitches || ev.pitches.length === 0) continue; // rest — time only
    const sorted = ev.pitches.slice().sort((a, b) => a - b);
    const midi = sorted[Math.floor(sorted.length / 2)];
    const durationSec = round3(ev.durationQb * beatSec);
    const startSec = round3(ev.onsetQb * beatSec);
    notes.push({
      midi,
      frequencyHz: round3(midiToFrequency(midi)),
      startSec,
      durationSec,
      soundingSec: round3(
        Math.max(MIN_SOUNDING_SEC, Math.min(durationSec, durationSec * SOUNDING_RATIO)),
      ),
    });
  }

  const totalSec = notes.reduce(
    (max, note) => Math.max(max, note.startSec + note.durationSec),
    0,
  );

  return { notes, totalSec: round3(totalSec), bpm, tempoSource, beatSec };
}

/**
 * The tempo line the widget shows under the player. Honest about where the
 * number came from: a score marking is attributed to the score, our own choice
 * is labelled as a practice tempo.
 */
export function melodyTempoLabel(plan: MelodyPlaybackPlan): string {
  return plan.tempoSource === "abc"
    ? `${plan.bpm} BPM (from the score)`
    : `${plan.bpm} BPM (practice tempo — our choice)`;
}
