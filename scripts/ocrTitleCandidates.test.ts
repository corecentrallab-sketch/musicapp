/**
 * v43 item C2/C6 — THE COVER READ IS SCORED, AND DEBRIS IS NEVER A QUERY.
 *
 * The owner's on-device evidence (10-20) is the fixture this file is built from:
 * a photographed page came back as "4ox 2Apx ors white Freddie Mer", and the
 * surface offered to search it. Everything here is the PURE half of the fix
 * (services/ocrTitleCandidates): what a read is worth, and whether it may ever
 * become a query.
 */
const assert = require('assert');
import {
  isBrokenOcrLine,
  isBrokenOcrToken,
  readTitleCandidates,
  type OcrBlock,
  type OcrImageSize,
} from '../src/services/ocrTitleCandidates';
import { OCR_TITLE_CORPUS } from '../src/services/ocrTitleCorpus';

declare const require: any;
declare const process: any;
let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}
function assertTrue(value: boolean, label: string): void {
  assertEq(value, true, label);
}

/** A page photo, in pixels (frames below are in these units). */
const IMAGE: OcrImageSize = { width: 1000, height: 1400 };

/** One recogniser block: a line of text, its box on the page, its letter height. */
function block(text: string, y: number, height: number, x = 60): OcrBlock {
  return {
    text,
    frame: { x, y, width: 800, height },
    lines: [
      {
        text,
        frame: { x, y, width: 800, height },
        elements: text
          .split(' ')
          .filter((token) => token.length > 0)
          .map((token, index) => ({
            text: token,
            frame: { x: x + index * 60, y, width: 50, height },
          })),
      },
    ],
  };
}

// ─── the owner's real garbage ─────────────────────────────────────────────────
console.log('\nv43 C2 — the owner’s real garbage read');
const OWNER_DEBRIS = '4ox 2Apx ors white Freddie Mer';
assertTrue(isBrokenOcrLine(OWNER_DEBRIS), 'the owner’s debris line is recognised as broken (two digit-glued tokens)');
assertTrue(isBrokenOcrToken('4ox'), '"4ox" is a broken token');
assertTrue(isBrokenOcrToken('2Apx'), '"2Apx" is a broken token');
// …and a real catalogue number is NOT debris (the exemption that keeps BWV 1068).
assertEq(isBrokenOcrToken('BWV1068'), false, 'a catalogue number ("BWV1068") is not debris');

const debrisRead = readTitleCandidates({
  blocks: [block(OWNER_DEBRIS, 120, 90)],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertEq(debrisRead.quality, 'garbage', 'the owner’s debris read is garbage');
assertEq(debrisRead.query, null, 'THE STRUCTURAL RULE: a garbage read has NO query at all');
assertEq(debrisRead.reason, 'garbled', 'the reason is the debris, not "empty"');
assertEq(debrisRead.candidates.length, 0, 'a garbage read suggests nothing');

// The second real read from the same device pass: glued inner punctuation.
const SECOND_DEBRIS = "a-thy,Be-cause I'm Freddie Mercury";
assertTrue(isBrokenOcrToken('a-thy,Be-cause'), 'the glued token ("a-thy,Be-cause") is broken');
const secondRead = readTitleCandidates({
  blocks: [block(SECOND_DEBRIS, 120, 90)],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertTrue(
  secondRead.query === null || secondRead.query.indexOf('a-thy') < 0,
  'the glued debris never reaches the query a surface would search',
);

// ─── a good read: a real cover ────────────────────────────────────────────────
console.log('\nv43 C2 — a good cover read becomes a candidate');
const goodRead = readTitleCandidates({
  blocks: [
    block('BOHEMIAN RHAPSODY', 120, 96),
    block('Words and Music by Freddie Mercury', 260, 30),
  ],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertEq(goodRead.quality, 'good', 'a big top-of-page title reads as a GOOD read');
assertEq(goodRead.query !== null, true, 'a good read has a query');
assertEq(goodRead.candidates.length > 0, true, 'a good read suggests at least one piece');
assertEq(goodRead.candidates[0]?.title, 'Bohemian Rhapsody', 'the best suggestion is the piece the cover really is');
assertEq(goodRead.candidates[0]?.source, 'modern', 'a song we hold no score for is marked modern (the retailer route)');
assertEq(goodRead.candidates.length <= 3, true, 'never more than three suggestions');

// ─── a page of printed music is NOT a cover ──────────────────────────────────
console.log('\nv43 C2 — a page of music says so, and searches nothing');
const notationRead = readTitleCandidates({
  blocks: [block('♪♫♩♬', 200, 40), block('— — — —', 400, 40), block('♬♩♫♪', 600, 40), block('‖ ‖ ‖', 800, 40)],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertEq(notationRead.quality, 'garbage', 'symbols are not words');
assertEq(notationRead.reason, 'notation', 'the reason is "notation" — the page-of-music case');
assertEq(notationRead.query, null, 'a page of music has no query');

// ─── determinism (a re-render must not change the answer) ────────────────────
console.log('\nv43 C2 — the decision is deterministic');
const again = readTitleCandidates({
  blocks: [block('BOHEMIAN RHAPSODY', 120, 96), block('Words and Music by Freddie Mercury', 260, 30)],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertEq(JSON.stringify(again), JSON.stringify(goodRead), 'the same read decides the same way twice');
const debrisAgain = readTitleCandidates({
  blocks: [block(OWNER_DEBRIS, 120, 90)],
  imageSize: IMAGE,
  corpus: OCR_TITLE_CORPUS,
});
assertEq(JSON.stringify(debrisAgain), JSON.stringify(debrisRead), 'a garbage read decides the same way twice');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
