/**
 * midiStructure.ts — a structural PARSER + VALIDATOR for the .mid files this app
 * writes (v37 item 6, backlog d2e9e2c5, owner v36 ask item 6).
 *
 * WHY IT EXISTS. The owner has no MIDI hardware: the only way they can check an
 * exported take is to open the file on a desktop player (or signal.vercel.app),
 * which means a malformed file costs a whole round trip to discover. The encoder
 * (services/midiExport.ts) is ours and pure — so the check belongs here, in the
 * build: parse the bytes the encoder produced, chunk by chunk, and refuse to hand
 * the user a file that does not parse. `captureMidiExport.ts` runs this before it
 * writes and shares.
 *
 * WHAT "STRUCTURAL" MEANS (and does not). The parser walks the real Standard MIDI
 * File layout — `MThd` header (length 6, format, declared track count, division),
 * then each `MTrk` chunk with its declared length and the events inside it,
 * honouring running status, meta events (`FF tt len data`), sysex, the channel
 * message data-byte counts, end-of-track, and note-on/note-off PAIRING per channel
 * and pitch. It says nothing about musicality (that is the take's business) and it
 * never "repairs" anything: a file that does not parse is reported, not fixed.
 *
 * PURE: no react, no react-native, no fs — so it compiles and runs under plain
 * Node (tsconfig.tier1.json) and the tier1 gate can validate the encoder's own
 * output byte for byte.
 */

/** The message a caller shows when the bytes would not parse (never a silent skip). */
export const MIDI_STRUCTURE_INVALID_MESSAGE =
  'The MIDI file we built did not pass its own structure check, so we did not hand it over. Please try again.';

export const MIDI_HEADER_MAGIC = 'MThd';
export const MIDI_TRACK_MAGIC = 'MTrk';

/** One parsed track: what it declared, what it actually held. */
export interface MidiTrackStructure {
  index: number;
  /** Byte offset of the `MTrk` magic in the file. */
  offset: number;
  /** The chunk length the file DECLARED. */
  declaredLength: number;
  /** The bytes the event walk actually consumed (must equal declaredLength). */
  consumedBytes: number;
  /** The track-name meta event's text, when the track carries one. */
  name: string | null;
  events: number;
  noteOns: number;
  noteOffs: number;
  /** Note-ons with no matching note-off (per channel + pitch) — a stuck note. */
  unpairedNotes: number;
  hasEndOfTrack: boolean;
}

export interface MidiStructureReport {
  /** True only when the whole file parsed and every invariant held. */
  ok: boolean;
  /** Every structural problem found, in the order they were found. */
  errors: string[];
  format: number | null;
  /** The track count the header DECLARED. */
  declaredTrackCount: number | null;
  /** The tracks the file actually contains. */
  tracks: MidiTrackStructure[];
  ticksPerQuarter: number | null;
  headerBytes: number;
  totalBytes: number;
  /** Bytes consumed by header + all chunk payloads (must equal totalBytes). */
  consumedBytes: number;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] & 0xff) << 24) |
    ((bytes[at + 1] & 0xff) << 16) |
    ((bytes[at + 2] & 0xff) << 8) |
    (bytes[at + 3] & 0xff)
  ) >>> 0;
}

function readUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0xff) << 8) | (bytes[at + 1] & 0xff);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i += 1) {
    const code = bytes[i] & 0xff;
    out += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '?';
  }
  return out;
}

/** Reads a variable-length quantity (7 bits per byte, MSB = continue). */
function readVarLen(
  bytes: Uint8Array,
  at: number,
): { value: number; next: number } | null {
  let value = 0;
  let cursor = at;
  for (let i = 0; i < 4; i += 1) {
    if (cursor >= bytes.length) return null;
    const byte = bytes[cursor] & 0xff;
    value = (value << 7) | (byte & 0x7f);
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, next: cursor };
  }
  return null;
}

/** Data-byte count for a channel voice message (`status` high nibble). */
function channelDataBytes(status: number): number {
  const kind = status & 0xf0;
  if (kind === 0xc0 || kind === 0xd0) return 1;
  return 2;
}

/** The empty report every failure path starts from. */
function emptyReport(totalBytes: number): MidiStructureReport {
  return {
    ok: false,
    errors: [],
    format: null,
    declaredTrackCount: null,
    tracks: [],
    ticksPerQuarter: null,
    headerBytes: 0,
    totalBytes,
    consumedBytes: 0,
  };
}

/**
 * Parse the bytes of a Standard MIDI File and report exactly what is wrong with
 * it. NEVER throws — a null/empty/truncated input is a report with errors, so a
 * caller (and a test) can always read a verdict.
 */
export function parseMidiStructure(
  bytes: Uint8Array | null | undefined,
): MidiStructureReport {
  const data =
    bytes && typeof bytes.length === 'number' ? bytes : new Uint8Array(0);
  const report = emptyReport(data.length);
  const fail = (message: string): MidiStructureReport => {
    report.errors.push(message);
    report.ok = false;
    return report;
  };

  if (data.length < 14) {
    return fail('file is shorter than a MIDI header chunk (14 bytes)');
  }
  if (
    data[0] !== 0x4d ||
    data[1] !== 0x54 ||
    data[2] !== 0x68 ||
    data[3] !== 0x64
  ) {
    return fail('header chunk magic is not "MThd"');
  }
  const headerLength = readUint32(data, 4);
  report.headerBytes = 8 + headerLength;
  if (headerLength !== 6) {
    return fail(`header chunk length is ${headerLength}, expected 6`);
  }
  const format = readUint16(data, 8);
  const declaredTrackCount = readUint16(data, 10);
  const division = readUint16(data, 12);
  report.format = format;
  report.declaredTrackCount = declaredTrackCount;
  report.ticksPerQuarter = (division & 0x8000) === 0 ? division : null;

  if (format !== 0 && format !== 1 && format !== 2) {
    report.errors.push(`header format ${format} is not 0, 1 or 2`);
  }
  if (declaredTrackCount < 1) {
    report.errors.push('header declares no tracks');
  }
  if (division === 0) {
    report.errors.push('header division is 0 (no timing)');
  }

  let cursor = 8 + headerLength;
  let index = 0;
  // A declared count is only a claim: walk the chunks that are really there, and
  // compare at the end (both directions are defects a player would trip over).
  while (cursor + 8 <= data.length) {
    const magic = ascii(data, cursor, cursor + 4);
    if (magic !== MIDI_TRACK_MAGIC) {
      report.errors.push(
        `chunk at byte ${cursor} is "${magic}", expected "${MIDI_TRACK_MAGIC}"`,
      );
      break;
    }
    const declared = readUint32(data, cursor + 4);
    const bodyStart = cursor + 8;
    const bodyEnd = bodyStart + declared;
    const track: MidiTrackStructure = {
      index,
      offset: cursor,
      declaredLength: declared,
      consumedBytes: 0,
      name: null,
      events: 0,
      noteOns: 0,
      noteOffs: 0,
      unpairedNotes: 0,
      hasEndOfTrack: false,
    };
    report.tracks.push(track);
    index += 1;

    if (bodyEnd > data.length) {
      report.errors.push(
        `track ${track.index} declares ${declared} bytes but only ${data.length - bodyStart} remain`,
      );
      track.consumedBytes = Math.max(0, data.length - bodyStart);
      cursor = data.length;
      break;
    }

    // ── walk the track's events ──
    const open: { [key: string]: number } = {};
    let at = bodyStart;
    let runningStatus = 0;
    let broke = false;
    while (at < bodyEnd) {
      const delta = readVarLen(data, at);
      if (!delta) {
        report.errors.push(`track ${track.index} has an unterminated delta-time`);
        broke = true;
        break;
      }
      at = delta.next;
      if (at >= bodyEnd) {
        report.errors.push(`track ${track.index} ends inside an event header`);
        broke = true;
        break;
      }
      let status = data[at] & 0xff;
      if (status < 0x80) {
        // Running status: the previous status byte still applies.
        if (runningStatus === 0) {
          report.errors.push(
            `track ${track.index} uses running status before any status byte`,
          );
          broke = true;
          break;
        }
        status = runningStatus;
      } else {
        at += 1;
        runningStatus = status;
      }
      track.events += 1;

      if (status === 0xff) {
        const type = data[at] & 0xff;
        const length = readVarLen(data, at + 1);
        if (!length) {
          report.errors.push(`track ${track.index} has a malformed meta event`);
          broke = true;
          break;
        }
        const payloadStart = length.next;
        const payloadEnd = payloadStart + length.value;
        if (payloadEnd > bodyEnd) {
          report.errors.push(
            `track ${track.index} meta event overruns its track chunk`,
          );
          broke = true;
          break;
        }
        if (type === 0x03 && track.name === null) {
          track.name = ascii(data, payloadStart, payloadEnd);
        }
        if (type === 0x2f) {
          track.hasEndOfTrack = true;
          if (length.value !== 0) {
            report.errors.push(`track ${track.index} end-of-track carries data`);
          }
        }
        at = payloadEnd;
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const length = readVarLen(data, at);
        if (!length) {
          report.errors.push(`track ${track.index} has a malformed sysex event`);
          broke = true;
          break;
        }
        at = length.next + length.value;
        if (at > bodyEnd) {
          report.errors.push(`track ${track.index} sysex event overruns its chunk`);
          broke = true;
          break;
        }
        continue;
      }
      if (status < 0x80) {
        report.errors.push(`track ${track.index} has an invalid status byte`);
        broke = true;
        break;
      }

      const dataBytes = channelDataBytes(status);
      if (at + dataBytes > bodyEnd) {
        report.errors.push(
          `track ${track.index} channel event at byte ${at} overruns its chunk`,
        );
        broke = true;
        break;
      }
      const channel = status & 0x0f;
      const kind = status & 0xf0;
      if (kind === 0x90 || kind === 0x80) {
        const pitch = data[at] & 0xff;
        const velocity = data[at + 1] & 0xff;
        const key = `${channel}:${pitch}`;
        const isOn = kind === 0x90 && velocity > 0;
        if (isOn) {
          track.noteOns += 1;
          open[key] = (open[key] ?? 0) + 1;
        } else {
          track.noteOffs += 1;
          if ((open[key] ?? 0) > 0) {
            open[key] = (open[key] ?? 0) - 1;
          } else {
            report.errors.push(
              `track ${track.index} has a note-off for pitch ${pitch} (channel ${channel}) that never started`,
            );
          }
        }
      }
      at += dataBytes;
    }
    if (broke) {
      track.consumedBytes = Math.max(0, at - bodyStart);
      cursor = bodyEnd;
      break;
    }
    track.consumedBytes = at - bodyStart;
    if (track.consumedBytes !== declared) {
      report.errors.push(
        `track ${track.index} consumed ${track.consumedBytes} of its declared ${declared} bytes`,
      );
    }
    let stuck = 0;
    for (const key of Object.keys(open)) stuck += open[key];
    track.unpairedNotes = stuck;
    if (stuck > 0) {
      report.errors.push(
        `track ${track.index} leaves ${stuck} note(s) without a note-off`,
      );
    }
    if (!track.hasEndOfTrack) {
      report.errors.push(`track ${track.index} has no end-of-track event`);
    }
    cursor = bodyEnd;
  }

  report.consumedBytes = cursor;
  if (cursor !== data.length) {
    report.errors.push(
      `${data.length - cursor} trailing byte(s) after the last track chunk`,
    );
  }
  if (
    report.declaredTrackCount !== null &&
    report.tracks.length !== report.declaredTrackCount
  ) {
    report.errors.push(
      `header declares ${report.declaredTrackCount} track(s), the file holds ${report.tracks.length}`,
    );
  }
  if (report.tracks.length === 0) {
    report.errors.push('file holds no track chunks');
  }
  if (report.tracks.length > 64) {
    report.errors.push(`file holds ${report.tracks.length} tracks, which is not sane`);
  }

  report.ok = report.errors.length === 0;
  return report;
}

/** The one-line verdict a caller gates on, plus the report for the message. */
export function validateMidiStructure(
  bytes: Uint8Array | null | undefined,
): { ok: boolean; errors: string[]; report: MidiStructureReport } {
  const report = parseMidiStructure(bytes);
  return { ok: report.ok, errors: report.errors, report };
}
