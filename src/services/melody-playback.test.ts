/**
 * Regression tests for the melody play-schedule builder (SITE WAVE 1b, P2).
 *
 * The widget synthesises the melody in the browser from this plan, so the plan
 * must be exact: right notes, right onsets, right durations, and an HONEST tempo
 * (the bundled seeds carry no `Q:` marking, so we play at a stated practice tempo
 * instead of implying the composer's metronome mark).
 *
 * Run with: bun test src/services/melody-playback.test.ts
 */
import { describe, test, expect } from "bun:test";
import { MELODY_SEEDS } from "./hum/melody-seeds";
import {
  DEFAULT_MELODY_BPM,
  MAX_MELODY_BPM,
  MIN_MELODY_BPM,
  buildMelodyPlaybackPlan,
  melodyTempoLabel,
  midiToFrequency,
  parseAbcTempoBpm,
} from "./melody-playback";

const furElise = MELODY_SEEDS.find((seed) => seed.pieceId === "fur-elise");
if (!furElise) throw new Error("fur-elise seed missing");

describe("midiToFrequency", () => {
  test("uses A4 = 440 Hz equal temperament", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 2);
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
  });
});

describe("parseAbcTempoBpm", () => {
  test("falls back to the documented practice tempo when the ABC has no Q:", () => {
    expect(parseAbcTempoBpm(furElise.abc)).toEqual({
      bpm: DEFAULT_MELODY_BPM,
      source: "default",
    });
  });

  test("reads a quarter-note marking", () => {
    expect(parseAbcTempoBpm("X:1\nQ:1/4=120\nK:C\nC D E F|")).toEqual({
      bpm: 120,
      source: "abc",
    });
  });

  test("converts a marking counted in eighth notes to quarter-note BPM", () => {
    expect(parseAbcTempoBpm("X:1\nQ:1/8=120\nK:C\nC D E F|").bpm).toBe(60);
    expect(parseAbcTempoBpm("X:1\nQ:1/2=60\nK:C\nC D E F|").bpm).toBe(120);
  });

  test("ignores an unusable marking rather than inventing one", () => {
    expect(parseAbcTempoBpm("X:1\nQ:Allegro\nK:C\nC D E F|").source).toBe("default");
    expect(parseAbcTempoBpm("X:1\nQ:1/4=900\nK:C\nC D E F|").source).toBe("default");
    expect(parseAbcTempoBpm("X:1\nQ:1/0=120\nK:C\nC D E F|").source).toBe("default");
  });

  test("stays inside the accepted tempo band", () => {
    const slow = parseAbcTempoBpm("X:1\nQ:1/4=40\nK:C\nC|");
    const fast = parseAbcTempoBpm(`X:1\nQ:1/4=${MAX_MELODY_BPM}\nK:C\nC|`);
    expect(slow.bpm).toBe(MIN_MELODY_BPM);
    expect(fast.bpm).toBe(MAX_MELODY_BPM);
  });
});

describe("buildMelodyPlaybackPlan", () => {
  test("schedules every pitched note of the Für Elise seed, skipping rests", () => {
    const plan = buildMelodyPlaybackPlan(furElise.abc);
    // "e ^d e | ^d e B | d c A | A, z z |" = 10 notes + 2 rests.
    expect(plan.notes.length).toBe(10);
    expect(plan.bpm).toBe(DEFAULT_MELODY_BPM);
    expect(plan.tempoSource).toBe("default");
    // L:1/8 at 100 BPM → each eighth note is 0.3 s (M:3/8 is three of them).
    expect(plan.beatSec).toBeCloseTo(0.6, 6);
    expect(plan.notes[0].durationSec).toBeCloseTo(0.3, 6);
    expect(plan.totalSec).toBeCloseTo(3, 6);
  });

  test("first two Für Elise notes are the E–D# motif, with ordered onsets", () => {
    const plan = buildMelodyPlaybackPlan(furElise.abc);
    // Lower-case `e` in the parser's convention is MIDI 64 (E4).
    expect(plan.notes[0].midi).toBe(64);
    expect(plan.notes[0].frequencyHz).toBeCloseTo(329.628, 2);
    // The second note is an explicit sharp: ^d = 62 + 1 = 63.
    expect(plan.notes[1].midi).toBe(63);
    for (let i = 1; i < plan.notes.length; i += 1) {
      expect(plan.notes[i].startSec).toBeGreaterThan(plan.notes[i - 1].startSec);
    }
  });

  test("tones are slightly shorter than the written note and audible", () => {
    const plan = buildMelodyPlaybackPlan(furElise.abc);
    for (const note of plan.notes) {
      expect(note.soundingSec).toBeLessThan(note.durationSec);
      expect(note.soundingSec).toBeGreaterThanOrEqual(0.06);
    }
  });

  test("rests advance time without producing notes", () => {
    const plan = buildMelodyPlaybackPlan("X:1\nM:4/4\nL:1/4\nK:C\nz2 z2|");
    expect(plan.notes).toHaveLength(0);
    expect(plan.totalSec).toBe(0);
  });

  test("a chord is reduced to its median pitch (one scheduled note)", () => {
    // The parser reads `[C E G]` as three chord members sharing one onset.
    const plan = buildMelodyPlaybackPlan("X:1\nM:4/4\nL:1/4\nK:C\n[C E G] z|");
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0].midi).toBe(52); // C, E, G → median E (midi 52)
    expect(plan.notes[0].startSec).toBe(0);
  });

  test("a score tempo marking wins over the practice default", () => {
    const plan = buildMelodyPlaybackPlan("X:1\nQ:1/4=120\nM:4/4\nL:1/4\nK:C\nC D E F|");
    expect(plan.bpm).toBe(120);
    expect(plan.tempoSource).toBe("abc");
    expect(plan.notes[0].durationSec).toBeCloseTo(0.5, 6);
  });

  test("a caller override slows the melody without claiming a score tempo", () => {
    const plan = buildMelodyPlaybackPlan(furElise.abc, { bpm: 60 });
    expect(plan.tempoSource).toBe("caller");
    expect(plan.notes[0].durationSec).toBeCloseTo(0.5, 6);
    expect(plan.totalSec).toBeCloseTo(5, 6);
  });

  test("an ABC with no tune body yields an empty plan, not a fabricated one", () => {
    const plan = buildMelodyPlaybackPlan("X:1\nT:Nothing yet\nM:4/4\nL:1/4\nK:C\n");
    expect(plan.notes).toHaveLength(0);
    expect(plan.totalSec).toBe(0);
  });

  test("every bundled seed produces a playable plan", () => {
    expect(MELODY_SEEDS.length).toBe(8);
    for (const seed of MELODY_SEEDS) {
      const plan = buildMelodyPlaybackPlan(seed.abc);
      expect(plan.notes.length).toBeGreaterThanOrEqual(4);
      expect(plan.totalSec).toBeGreaterThan(0);
      expect(Number.isFinite(plan.totalSec)).toBe(true);
      for (const note of plan.notes) {
        expect(note.midi).toBeGreaterThan(20);
        expect(note.midi).toBeLessThan(108);
      }
    }
  });
});

describe("melodyTempoLabel", () => {
  test("attributes a score marking to the score", () => {
    const plan = buildMelodyPlaybackPlan("X:1\nQ:1/4=120\nM:4/4\nL:1/4\nK:C\nC D|");
    expect(melodyTempoLabel(plan)).toBe("120 BPM (from the score)");
  });

  test("labels our own tempo choice as a practice tempo", () => {
    const plan = buildMelodyPlaybackPlan(furElise.abc);
    expect(melodyTempoLabel(plan)).toBe("100 BPM (practice tempo — our choice)");
  });
});
