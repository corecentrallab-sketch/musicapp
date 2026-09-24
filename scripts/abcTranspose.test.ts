/**
 * Unit tests for the ABC transpose engine.
 *
 * Run with: npm run test:transpose
 * Compiles the pure transpose module + this test to CommonJS and runs it
 * under plain Node (no test framework / no app runtime required).
 *
 * The tests assert:
 *  1. Key-signature transpose (C major +2 → D major).
 *  2. A known melodic fragment shifts by the expected interval.
 *  3. Round-trip: transpose +N then -N returns the original pitch structure
 *     (the "renderer round-trip" guarantee at the notation-data level).
 */
import {
  transposeAbc,
  transposeKeyLabel,
  clampSemitones,
  parseKey,
} from '../src/services/abcTranspose';

// Minimal ambient decl so this test compiles/runs without @types/node.
declare const process: { exit(code: number): never };

let failures = 0;
let passes = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}

function assertEq(actual: string, expected: string, msg: string): void {
  const ok = actual === expected;
  if (ok) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('abcTranspose unit tests');
console.log('───────────────────────');

// Test 1: clampSemitones.
assertEq(String(clampSemitones(500)), '11', 'clamp 500 → 11');
assertEq(String(clampSemitones(-500)), '-11', 'clamp -500 → -11');
assertEq(String(clampSemitones(2.6)), '3', 'clamp 2.6 → 3 (rounded)');

// Test 2: C major +2 → D major.
const cMajor = [
  'X:1',
  'T:Test scale',
  'M:4/4',
  'L:1/4',
  'K:C',
  'C D E F G A B c',
].join('\n');
const upTwo = transposeAbc(cMajor, 2);
assertEq(
  upTwo,
  [
    'X:1',
    'T:Test scale',
    'M:4/4',
    'L:1/4',
    'K:D',
    'D E ^F G A B ^c d',
  ].join('\n'),
  'C major +2 → D major (key line + every note)'
);

// Test 3: known melodic fragment shifts by the expected interval.
// "Twinkle" opening in C: C C G G A A G → +2 semitones = D D A A B B A.
const twinkleC = [
  'X:1',
  'T:Twinkle',
  'M:4/4',
  'L:1/8',
  'K:C',
  'C C G G A A G2',
].join('\n');
const twinkleD = transposeAbc(twinkleC, 2);
assertEq(
  twinkleD,
  [
    'X:1',
    'T:Twinkle',
    'M:4/4',
    'L:1/8',
    'K:D',
    'D D A A B B A2',
  ].join('\n'),
  'Twinkle in C +2 → D D A A B B A (2 /=5 transformed, fragment shift verified)'
);

// Test 4: transpose up by 4 (a major third) — happiness.
const fragC4 = transposeAbc(
  ['X:1', 'T:f', 'K:C', 'C E G'].join('\n'),
  4
);
assertEq(
  fragC4,
  ['X:1', 'T:f', 'K:E', 'E ^G B'].join('\n'),
  'C-E-G (C major) +4 → E-G#-B (E major)'
);

// Test 6: transpose UP by +3 (a minor third) — flat spelling.
const upThree = transposeAbc(
  ['X:1', 'T:f', 'K:C', 'c e g'].join('\n'),
  3
);
assertEq(
  upThree,
  ['X:1', 'T:f', 'K:Eb', '_e g _b'].join('\n'),
  'C-E-G (C major) +3 → Eb-G-Bb (Eb major, flat spelling)'
);

// Test 6: minor key.
const aMinor = [
  'X:1',
  'T:Minor',
  'M:3/4',
  'L:1/8',
  'K:Am',
  'A B c',
].join('\n');
const eMinor = transposeAbc(aMinor, 7);
assertEq(
  eMinor,
  [
    'X:1',
    'T:Minor',
    'M:3/4',
    'L:1/8',
    'K:Em',
    'e ^f g',
  ].join('\n'),
  'A minor +7 → E minor (dominant)'
);

// Test 7: round-trip +2 then -2 restores the original pitch structure.
const roundTrip = transposeAbc(transposeAbc(twinkleC, 2), -2);
assertEq(
  roundTrip,
  twinkleC.replace('K:D', 'K:C'), // reversed key label back to C
  '+2 then -2 round-trip returns the original C-major notation'
);

// Test 8: header lines (with note-like letters) are NOT corrupted.
const titled = [
  'X:1',
  'T:Fur Elise (the E is not a note to transpose)',
  'K:C',
  'c d e',
].join('\n');
const titledOut = transposeAbc(titled, 2);
assert(
  titledOut.startsWith('X:1\nT:Fur Elise (the E is not a note to transpose)'),
  'title line with a note-like letter is left intact'
);
assert(
  /K:D/.test(titledOut),
  'K: line transposed C → D in the titled tune'
);

// Test 9: parseKey + transposeKeyLabel convenience.
assert(parseKey('Dm')?.mode === 'minor', 'parseKey(Dm) → minor');
assert(parseKey('F#')?.pc === 6, 'parseKey(F#) → pc 6');
const label = transposeKeyLabel('C', 2);
assertEq(label.from, 'C major', 'label from C major');
assertEq(label.to, 'D major', 'label to D major');
const minorLabel = transposeKeyLabel('Am', 7);
assertEq(minorLabel.to, 'E minor', 'label Am +7 → E minor');

// Test 10: chords & rests & ties are preserved.
const withChords = [
  'X:1',
  'T:c',
  'M:4/4',
  'L:1/4',
  'K:C',
  '[CEG] z C - D | E2',
].join('\n');
const chordOut = transposeAbc(withChords, 2);
assertEq(
  chordOut,
  [
    'X:1',
    'T:c',
    'M:4/4',
    'L:1/4',
    'K:D',
    '[D^FA] z D - E | ^F2',
  ].join('\n'),
  'chords, rests, ties preserved while notes transpose'
);

console.log('───────────────────────');
console.log(`${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
