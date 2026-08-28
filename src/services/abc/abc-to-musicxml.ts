/**
 * MusicXML (score-partwise) writer — turns parsed ABC note events into a
 * MusicXML 3.1 document. Pure and dependency-free; the app downloads the
 * result and shares it.
 */

import type { ParsedAbc } from "./abc-parser";

const DIVISIONS = 4; // a quarter note = 4 divisions

// Tonic letter (lowercase, no accidental) → key signature fifths.
const MAJOR_FIFTHS: Record<string, number> = {
  c: 0, g: 1, d: 2, a: 3, e: 4, b: 5, f: -1,
};
const MINOR_FIFTHS: Record<string, number> = {
  a: 0, e: 1, b: 2, f: -4, c: -3, g: -2, d: -1,
};

/** Pitch-class → MusicXML step letter (flat-friendly default chosen here). */
const PC_STEP = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const PC_ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

/** Map a MIDI pitch to MusicXML <step>, <alter>, <octave>. */
function pitchParts(midi: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  return {
    step: PC_STEP[pc],
    alter: PC_ALTER[pc],
    octave: Math.floor(midi / 12) - 1,
  };
}

/** Human note type for the closest power-of-two ≤ a division count. */
function noteType(divisions: number): { type: string; dots: number } {
  const TYPES: Array<[string, number]> = [
    ["whole", 16],
    ["half", 8],
    ["quarter", 4],
    ["eighth", 2],
    ["16th", 1],
  ];
  for (const [name, unit] of TYPES) {
    if (divisions >= unit) {
      const ratio = divisions / unit;
      if (ratio >= 1.75) return { type: name, dots: 1 };
      if (ratio >= 1.4) return { type: name, dots: 1 };
      if (ratio >= 1.2) return { type: name, dots: 0 };
      const rounded = Math.round(ratio);
      return { type: name, dots: rounded >= 2 ? 1 : 0 };
    }
  }
  return { type: "16th", dots: 0 };
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a MusicXML score-partwise string from parsed ABC. */
export function abcToMusicXml(parsed: ParsedAbc): string {
  const measures = splitIntoMeasures(parsed);

  const fifths = (parsed.key?.mode === "minor"
    ? MINOR_FIFTHS[parsed.key.tonic]
    : MAJOR_FIFTHS[parsed.key?.tonic ?? "c"]) ?? 0;
  const modeName = parsed.key?.mode ?? "major";

  const beats = parsed.meter?.beats ?? 4;
  const beatType = parsed.meter?.beatType ?? 4;

  const measureXml = measures
    .map((events, idx) => {
      const notes = events
        .map((ev) => {
          const divisions = Math.max(1, Math.round(ev.durationQb * DIVISIONS));
          const cells: string[] = [];
          if (ev.pitches.length === 0) {
            cells.push(
              `        <note><rest/><duration>${divisions}</duration><voice>1</voice></note>`,
            );
            return cells;
          }
          ev.pitches.forEach((pitch, i) => {
            const { step, alter, octave } = pitchParts(pitch);
            const { type, dots } = noteType(divisions);
            const alterXml = alter === 0 ? "" : `<alter>${alter}</alter>`;
            const dotXml = dots ? "<dot/>" : "";
            if (i === 0) {
              cells.push(
                `        <note><pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch><duration>${divisions}</duration><voice>1</voice><type>${type}</type>${dotXml}</note>`,
              );
            } else {
              // Chords repeat after a <backup> to stay at the same beat.
              cells.push(`        <backup><duration>${divisions}</duration></backup>`);
              cells.push(
                `        <note><pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch><duration>${divisions}</duration><voice>1</voice><type>${type}</type>${dotXml}</note>`,
              );
            }
          });
          return cells;
        })
        .flat();

      const measure = [
        `    <measure number="${idx + 1}">`,
      ];
      if (idx === 0) {
        measure.push(
          `      <attributes>`,
          `        <divisions>${DIVISIONS}</divisions>`,
          `        <key><fifths>${fifths}</fifths><mode>${modeName}</mode></key>`,
          `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`,
          `        <clef><sign>G</sign><line>2</line></clef>`,
          `      </attributes>`,
        );
      }
      measure.push(...notes);
      measure.push(`    </measure>`);
      return measure.join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`,
    `<score-partwise version="3.1">`,
    `  <work><work-title>${xmlEscape(parsed.title || "NoteSnap melody")}</work-title></work>`,
    `  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>`,
    `  <part id="P1">`,
    measureXml,
    `  </part>`,
    `</score-partwise>`,
    ``,
  ].join("\n");
}

/** Group note events into measures of the metre's length (in quarter beats). */
function splitIntoMeasures(parsed: ParsedAbc): ParsedAbc["events"][] {
  const beats = parsed.meter?.beats ?? 4;
  const beatType = parsed.meter?.beatType ?? 4;
  const measureQb = (beats / beatType) * 4;
  if (!(measureQb > 0) || parsed.events.length === 0) {
    return [parsed.events];
  }
  const out: ParsedAbc["events"][] = [];
  for (const ev of parsed.events) {
    const m = Math.floor(ev.onsetQb / measureQb);
    while (out.length <= m) out.push([]);
    out[m].push(ev);
  }
  return out;
}
