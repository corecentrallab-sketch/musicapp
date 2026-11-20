/**
 * vc64 — THE TAKE'S STAFF IS READABLE (owner probe vc63, two defects).
 *
 * THE SCREENSHOT. The practice-video card drew (1) a giant, clipped ABC title
 * across the top of the staff — "video (as humn" — and (2) noteheads four to
 * twelve ledger lines BELOW the treble staff while the take's own chords read
 * Dm/F/Am/Em.
 *
 * WHY THIS SUITE PARSES THE ABC INSTEAD OF TRUSTING A FLAG. Both defects are
 * facts about the DOCUMENT abcjs is handed, so the assertions read the document
 * the card builds (`takeStaffRows` → `takeToAbc`) and turn its tokens back into
 * written MIDI. A guard that only checked "the shift is applied" would pass on a
 * document that is still unreadable; this one fails on the pixels' cause.
 *
 * EVERY PROBE BELOW FAILS ON THE vc63 CODE:
 *   • `T:` was in the header, so the no-title rows fail;
 *   • a low take was written at its detected octave, so the on-staff rows fail.
 */
import {
  staffKeySignature,
  staffOctaveShift,
  staffOctaveLine,
  takeStaffRows,
  takeToAbc,
} from '../src/services/takeStaff';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}
function assertEq<T>(actual: T, expected: T, message: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    failures += 1;
    console.error(`FAIL  ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Read a take's ABC back as WRITTEN MIDI numbers (the pixels' own pitches). */
function writtenMidis(abc: string): number[] {
  const body = abc
    .split('\n')
    .filter((line) => !/^[A-Za-z]:/.test(line))
    .join(' ');
  const out: number[] = [];
  const token = /([_^=]?)([A-Ga-g])([,']*)(\d*)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(body)) !== null) {
    const letter = match[2].toUpperCase();
    const marks = match[3] ?? '';
    let octave = match[2] === match[2].toLowerCase() ? 5 : 4;
    for (const mark of marks) octave += mark === ',' ? -1 : 1;
    let accidental = 0;
    if (match[1] === '^') accidental = 1;
    if (match[1] === '_') accidental = -1;
    out.push((octave + 1) * 12 + LETTER_PC[letter] + accidental);
  }
  return out;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const KEY = staffKeySignature({ tonic: 2, mode: 'major' });
const EIGHTH = 0.25;

function take(midis: number[]) {
  return midis.map((midi, index) => ({
    midi,
    startSec: index * 0.5,
    durationSec: 0.45,
    velocity: 90,
  }));
}

/** The band a phone can read without hunting: staff ± a ledger line or two. */
const READABLE_LOW = 55; // G3 — two ledger lines under the treble staff
const READABLE_HIGH = 81; // A5 — one ledger line above it

console.log('\nvc64 — the take staff: no ABC title, and notes that read on the staff');

// ── 1. THE TITLE IS NOT IN THE DOCUMENT ───────────────────────────────────────
{
  const rows = takeStaffRows({
    rawNotes: take([60, 62, 64, 65]) as never,
    cleanedNotes: take([60, 62, 64, 65]) as never,
    key: { tonic: 2, mode: 'major' },
    tempoBpm: 120,
    title: 'Practice video',
  });
  for (const [name, abc] of [
    ['raw', rows.rawAbc ?? ''],
    ['cleaned', rows.cleanedAbc ?? ''],
  ] as Array<[string, string]>) {
    assert(abc.length > 0, `the ${name} staff has a document at all`);
    assert(abc.indexOf('T:') < 0, `the ${name} staff carries NO ABC title line (vc63 drew a clipped giant one)`);
    assert(
      abc.indexOf('Practice video') < 0,
      `the ${name} staff does not carry the take label — the card's own heading names it`,
    );
    assert(abc.indexOf('as hummed') < 0, `the ${name} staff carries no "(as hummed)" suffix`);
  }
  assert(!!rows.cleanedAbc && rows.cleanedAbc.indexOf('X:1') === 0, 'the document still starts with X:1');
  assert(!!rows.cleanedAbc && rows.cleanedAbc.indexOf('K:D') >= 0, 'and still names the take key');
}

// ── 2. A HUMMED MID-RANGE TAKE LANDS ON OR NEAR THE STAFF ────────────────────
{
  // A3–A4: exactly what a hummed melody looks like as MIDI (the live route returns
  // A3 = 57.0 for a 220 Hz tone). Centred on A4 it needs no move at all.
  const midis = [64, 65, 67, 69, 71, 72, 71, 69];
  const abc = takeToAbc(take(midis) as never, { signature: KEY, eighthSec: EIGHTH, title: 'video' });
  const written = writtenMidis(abc);
  assertEq(written.length, midis.length, 'every hummed note is written');
  assert(
    written.every((midi) => midi >= READABLE_LOW && midi <= READABLE_HIGH),
    `a mid-range hum reads on/near the staff (got ${written.join(',')})`,
  );
  assertEq(staffOctaveShift(take(midis)), 0, 'a take that already reads on the staff is not moved');
  assertEq(staffOctaveLine(0), null, 'and the card says nothing about an octave');
}

// ── 3. THE OWNER'S TAKE: LOW NOTES, TWELVE LEDGER LINES UNDER (vc63) ─────────
{
  // What the vc63 card drew: the take came back roughly two octaves under the
  // hummed register, which is where the twelve ledger lines came from.
  const midis = [33, 35, 36, 38, 40, 41, 40, 38];
  const rows = takeStaffRows({
    rawNotes: take(midis) as never,
    cleanedNotes: take(midis) as never,
    key: { tonic: 2, mode: 'major' },
    tempoBpm: 120,
    title: 'Practice video',
  });
  const written = writtenMidis(rows.cleanedAbc ?? '');
  assertEq(written.length, midis.length, 'the low take still writes every note');
  assert(
    written.every((midi) => midi >= READABLE_LOW && midi <= READABLE_HIGH),
    `a low take is written ON the staff, not twelve ledger lines under it (got ${written.join(',')})`,
  );
  assert(
    medianOf(written) >= 62 && medianOf(written) <= 76,
    `its middle note sits in the staff body (median ${medianOf(written)})`,
  );
  // The same shift on BOTH staves, or the raw and cleaned lines would disagree.
  assertEq(
    writtenMidis(rows.rawAbc ?? ''),
    written,
    'the raw trace and the cleaned line are written in the SAME octave',
  );
  assertEq(rows.octaveShift, 36, 'the move is three whole octaves, and it is reported');
  assert(
    !!rows.octaveLine && rows.octaveLine.indexOf('higher') >= 0,
    'and the card says so in words rather than moving the octave silently',
  );
}

// ── 4. A WHISTLED TAKE IS BROUGHT DOWN, NOT LEFT OVER THE STAFF ──────────────
{
  const midis = [84, 86, 88, 89, 91, 93];
  const written = writtenMidis(
    takeToAbc(take(midis) as never, { signature: KEY, eighthSec: EIGHTH, title: 'whistle' }),
  );
  assert(
    written.every((midi) => midi >= READABLE_LOW && midi <= READABLE_HIGH),
    `a high whistle also reads on the staff (got ${written.join(',')})`,
  );
  assert(staffOctaveShift(take(midis)) < 0, 'and its shift is downward');
}

// ── 5. THE MOVE IS WHOLE OCTAVES, SO THE MELODY CANNOT CHANGE ────────────────
{
  const midis = [33, 35, 36, 38, 40, 41];
  const written = writtenMidis(
    takeToAbc(take(midis) as never, { signature: KEY, eighthSec: EIGHTH, title: 'video' }),
  );
  assertEq(
    written.map((midi) => ((midi % 12) + 12) % 12),
    midis.map((midi) => ((midi % 12) + 12) % 12),
    'every written pitch class matches the take — the chords and key cannot drift',
  );
  assertEq(
    written.slice(1).map((midi, index) => midi - written[index]),
    midis.slice(1).map((midi, index) => midi - midis[index]),
    'and so does every interval',
  );
  const deltas = written.map((midi, index) => midi - midis[index]);
  assert(
    deltas.every((delta) => delta === deltas[0] && delta % 12 === 0),
    `the shift is ONE whole number of octaves for every note (got ${deltas.join(',')})`,
  );
}

// ── 6. THE CARD'S HEADING STILL CARRIES THE NAME (the title was not lost) ────
{
  const rows = takeStaffRows({
    rawNotes: take([60, 62]) as never,
    cleanedNotes: take([60, 62]) as never,
    key: { tonic: 2, mode: 'major' },
    tempoBpm: 120,
    title: 'Practice video',
  });
  assertEq(rows.rawLabel, 'As you hummed it', 'the raw row keeps its own heading');
  assertEq(rows.cleanedLabel, 'Auto-cleaned', 'and so does the cleaned row');
}

if (failures > 0) {
  // Throwing is the non-zero exit this gate uses (the tier1 tsconfig has no node types).
  throw new Error(`vc64 take notation: ${failures} assertion(s) FAILED`);
}
console.log('vc64 take notation: PASS (no ABC title; hummed, low and whistled takes all read on the staff)');
