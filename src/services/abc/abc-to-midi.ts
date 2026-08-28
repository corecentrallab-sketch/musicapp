/**
 * Standard MIDI File (SMF) writer — turns parsed ABC note events into a
 * binary Standard MIDI File (format 0, single melody track). Pure and
 * dependency-free so it works under Bun/Node and can be unit-tested directly.
 */

import type { ParsedAbc } from "./abc-parser";

const PPQ = 480; // ticks per quarter note (pulses per quarter)
const DEFAULT_BPM = 120;
const VELOCITY = 96;
const TICKS_PER_SEC = (PPQ * DEFAULT_BPM) / 60;

/** Build an SMF byte buffer from a parsed ABC score. */
export function abcToMidiBuffer(parsed: ParsedAbc): Uint8Array {
  const track: number[] = [];

  // --- Track name meta (0xFF 0x03 len name) ---
  pushMetaText(track, 0x03, parsed.title || "NoteSnap melody");

  // --- Tempo meta (0xFF 0x51 0x03 <usecPerQuarter>) ---
  const usecPerQuarter = Math.round(60_000_000 / DEFAULT_BPM);
  pushMetaEvent(track, 0x51, [
    (usecPerQuarter >> 16) & 0xff,
    (usecPerQuarter >> 8) & 0xff,
    usecPerQuarter & 0xff,
  ]);

  // --- Time signature meta (0xFF 0x58 0x04 nn dd cc bb) ---
  const beats = parsed.meter?.beats ?? 4;
  const beatType = parsed.meter?.beatType ?? 4;
  pushMetaEvent(track, 0x58, [beats & 0xff, log2(beatType), 24, 8]);

  // --- Build timed events (note on / note off) ---
  interface Timed {
    tick: number;
    isOn: boolean;
    key: number;
  }
  const timed: Timed[] = [];
  for (const ev of parsed.events) {
    const onTick = Math.round(ev.onsetQb * PPQ);
    const offTick = Math.round((ev.onsetQb + ev.durationQb) * PPQ);
    for (const pitch of ev.pitches) {
      timed.push({ tick: onTick, isOn: true, key: pitch });
      timed.push({ tick: offTick, isOn: false, key: pitch });
    }
  }
  // Sort by tick; note-on before note-off at the same tick keeps notes alive.
  timed.sort((a, b) => a.tick - b.tick || (a.isOn === b.isOn ? 0 : a.isOn ? -1 : 1));

  let lastTick = 0;
  for (const t of timed) {
    const delta = t.tick - lastTick;
    lastTick = t.tick;
    pushVlq(track, delta);
    track.push(t.isOn ? 0x90 : 0x80, t.key & 0x7f, VELOCITY);
  }

  // --- End of track meta (0xFF 0x2F 0x00) ---
  pushVlq(track, 0);
  pushMetaEvent(track, 0x2f, []);

  // --- Assemble chunks ---
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length = 6
    0x00, 0x00, // format 0
    0x00, 0x01, // one track
    (PPQ >> 8) & 0xff, PPQ & 0xff, // division
  ];
  const trackBytes = Uint8Array.from(track);
  const trackLen = trackBytes.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (trackLen >> 24) & 0xff,
    (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff,
    trackLen & 0xff,
  ];

  const out = new Uint8Array(header.length + trackHeader.length + track.length);
  out.set(header, 0);
  out.set(trackHeader, header.length);
  out.set(trackBytes, header.length + trackHeader.length);
  return out;
}

/** Number of bytes actually used by a var-length value. */
function vlqSize(value: number): number {
  let size = 1;
  let v = value;
  while (v >= 0x80) {
    v >>= 7;
    size += 1;
  }
  return size;
}

/** Append a MIDI variable-length quantity (delta time / length) to `arr`. */
function pushVlq(arr: number[], value: number): void {
  const buf = new Array(vlqSize(value));
  for (let i = buf.length - 1; i >= 0; i -= 1) {
    buf[i] = value & 0x7f;
    value >>= 7;
  }
  for (let i = 0; i < buf.length - 1; i += 1) buf[i] |= 0x80;
  arr.push(...buf);
}

/** Append a meta event: 0xFF type len bytes. */
function pushMetaEvent(arr: number[], type: number, data: number[]): void {
  arr.push(0xff, type & 0x7f, data.length & 0x7f, ...data);
}

/** Append a text meta event (0xFF type len <bytes of text>). */
function pushMetaText(arr: number[], type: number, text: string): void {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
  }
  arr.push(0xff, type & 0x7f, bytes.length & 0x7f, ...bytes);
}

function log2(n: number): number {
  let p = 0;
  let v = n;
  while (v > 1) {
    v /= 2;
    p += 1;
  }
  return p;
}

export { TICKS_PER_SEC };
