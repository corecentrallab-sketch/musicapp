/**
 * Unit tests for the ABC → MIDI / ABC → MusicXML conversion logic.
 * Run with: bun test (from /home/team/shared/site).
 */
import { describe, test, expect } from "bun:test";
import { parseAbc } from "./abc-parser";
import { abcToMidiBuffer } from "./abc-to-midi";
import { abcToMusicXml } from "./abc-to-musicxml";

const SAMPLE = [
  "X:1",
  "T:Test Melody",
  "C:Tester",
  "M:4/4",
  "L:1/8",
  "K:C",
  "c4 c2 | d2 e2 | z4 g2 |]",
].join("\n");

describe("parseAbc", () => {
  test("parses headers correctly", () => {
    const p = parseAbc(SAMPLE);
    expect(p.title).toBe("Test Melody");
    expect(p.composer).toBe("Tester");
    expect(p.meter).toEqual({ beats: 4, beatType: 4 });
    expect(p.defaultLength).toEqual({ num: 1, den: 8 });
    expect(p.key).toEqual({ tonic: "c", mode: "major" });
  });

  test("extracts melody with correct pitches and durations (quarter-beat units)", () => {
    const p = parseAbc(SAMPLE);
    // c4 = 4 x L(1/8=0.5) = 2 quarter beats, pitch C4=60.
    expect(p.events[0]).toEqual({ onsetQb: 0, pitches: [60], durationQb: 2 });
    // c2 = 1 quarter beat at onset 2.
    expect(p.events[1]).toEqual({ onsetQb: 2, pitches: [60], durationQb: 1 });
    // d2 -> D4 = 62.
    expect(p.events[2].pitches).toEqual([62]);
    expect(p.events[2].onsetQb).toBe(3);
    // e2 -> E4 = 64.
    expect(p.events[3].pitches).toEqual([64]);
    // z4 = rest: advances time, no pitch.
    expect(p.events[4].pitches).toEqual([]);
    expect(p.events[4].durationQb).toBe(2);
    expect(p.events[5].pitches).toEqual([67]); // g2 -> G4
    expect(p.events[5].onsetQb).toBe(7);
  });

  test("handles accidentals, octave markers and chords", () => {
    const p = parseAbc([
      "X:1", "T:A", "M:4/4", "L:1/8", "K:C",
      "^c _c c' C, [e g] c2",
    ].join("\n"));
    expect(p.events[0].pitches).toEqual([61]); // C#4
    expect(p.events[1].pitches).toEqual([59]); // Cb4
    expect(p.events[2].pitches).toEqual([72]); // c' = C5
    expect(p.events[3].pitches).toEqual([36]); // C, = C2
    // Chord [e g] = {64,67} at same onset.
    expect(p.events[4].pitches).toEqual([64, 67]);
    expect(p.events[5].pitches).toEqual([60]);
  });
});

describe("abcToMidiBuffer", () => {
  test("produces a valid SMF header and track chunk", () => {
    const buf = abcToMidiBuffer(parseAbc(SAMPLE));
    // "MThd"
    expect(Array.from(buf.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]);
    // "MTrk" at offset 14 (8-byte header + 6-byte format/division).
    expect(Array.from(buf.slice(14, 18))).toEqual([0x4d, 0x54, 0x72, 0x6b]);
    // Non-trivial size (has real note data).
    expect(buf.length).toBeGreaterThan(40);
    // Format 0 (bytes 8-9 are 0x00 0x00).
    expect(buf[8]).toBe(0);
    expect(buf[9]).toBe(0);
  });

  test("contains a note-on for MIDI 60 (middle C)", () => {
    const buf = abcToMidiBuffer(parseAbc(SAMPLE));
    const bytes = Array.from(buf);
    // Somewhere there is a status byte 0x90 paired with key 0x3C (60).
    let found = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x90 && bytes[i + 1] === 60) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe("abcToMusicXml", () => {
  test("emits pitch/octave/duration correctly for a quarter-note beat model", () => {
    const xml = abcToMusicXml(parseAbc(SAMPLE));
    // c4 (half note) = 2 quarter beats * 4 divisions = 8.
    expect(xml).toContain("<duration>8</duration>");
    // Middle C = step C, octave 4.
    expect(xml).toContain("<step>C</step><octave>4</octave>");
    // Key signature C major = 0 fifths.
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain("<mode>major</mode>");
    // Time signature 4/4.
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
    // Rests are emitted as <rest/>.
    expect(xml).toContain("<rest/>");
  });

  test("escaping does not corrupt the XML document shape", () => {
    const xml = abcToMusicXml(parseAbc(SAMPLE));
    expect(xml.startsWith("<?xml version=\"1.0\"")).toBe(true);
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("</score-partwise>");
  });
});
