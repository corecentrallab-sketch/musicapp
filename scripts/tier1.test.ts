/**
 * Unit tests for the Tier-1 recognition parsing/decision logic
 * (src/services/tier1.ts): POST /api/hum and POST /api/recognize-modern
 * response parsing + the honest match-vs-no-match decision.
 *
 * Run with: npm run test:tier1
 * Compiles the pure module + this test to CommonJS and runs under plain Node
 * (same convention as the repo's transpose tests — no test framework, no app
 * runtime required).
 */
import {
  parseHumResponse,
  humOutcome,
  humPhraseHint,
  parseModernResponse,
  modernOutcome,
} from '../src/services/tier1';

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
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const ok = actual === expected;
  if (ok) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

console.log('\n— /api/hum response parsing —');
const humRaw = {
  success: true,
  matches: [
    { piece_id: 'beethoven-fur-elise', title: 'Für Elise', composer: 'Ludwig van Beethoven', confidence: 1 },
    { piece_id: 'other', title: 'Other', composer: 'X', confidence: 0.12 },
  ],
  query_duration_ms: 120,
  contour_stats: { notes: 8, deltas: 7, voiced_frames: 40, total_frames: 60 },
};
const humParsed = parseHumResponse(humRaw);
assert(humParsed !== null, 'valid hum payload parses to a response');
assertEq(humParsed?.matches.length, 2, 'two matches parsed');
assertEq(humParsed?.matches[0].title, 'Für Elise', 'top match title parsed');
assertEq(humParsed?.matches[0].piece_id, 'beethoven-fur-elise', 'piece_id parsed');
assertEq(humParsed?.matches[0].composer, 'Ludwig van Beethoven', 'composer parsed');
assertEq(humParsed?.matches[0].confidence, 1, 'confidence parsed');
assertEq(humParsed?.contour_stats?.deltas, 7, 'contour deltas parsed');

// Tolerate missing optional fields
const lean = parseHumResponse({ success: true, matches: [{ piece_id: 'p1' }] });
assert(lean !== null, 'match with only piece_id parses');
assertEq(lean?.matches[0].title, 'p1', 'title falls back to piece_id');
assertEq(lean?.matches[0].composer, '', 'composer defaults to empty');
assertEq(lean?.contour_stats, undefined, 'contour_stats absent when not provided');

// Invalid / garbage payloads
assert(parseHumResponse(null) === null, 'null payload rejected');
assert(parseHumResponse('nope') === null, 'string payload rejected');
assert(parseHumResponse({ success: false, error: 'x' }) === null, 'failure payload rejected');
assert(parseHumResponse({ success: true, matches: 'not-an-array' }) === null, 'non-array matches rejected');
assert(parseHumResponse({ success: true, matches: [{ title: 'no-id' }] }) !== null, 'match without id is dropped, not fatal');

console.log('\n— hum match vs no-match decision —');
const matched = humOutcome(humParsed!);
assert(matched.ok === true, 'confident hum returns ok');
assertEq(matched.topMatch?.piece_id, 'beethoven-fur-elise', 'top match surfaced');
assertEq(matched.matches.length, 2, 'all matches returned');

const emptyResp = parseHumResponse({
  success: true,
  matches: [],
  no_confident_match_reason: 'hum a longer phrase',
});
const noMatch = humOutcome(emptyResp!);
assert(noMatch.ok === false, 'empty matches is an honest no-match');
assertEq(noMatch.matches.length, 0, 'no matches returned');
assert (/longer phrase/.test(noMatch.reason ?? ''), 'server reason preserved');

const noReason = humOutcome(parseHumResponse({ success: true, matches: [] })!);
assert(/longer/.test(noReason.reason ?? ''), 'default reason used when absent');

console.log('\n— hum short-phrase hint —');
assert(
  humPhraseHint(parseHumResponse({ success: true, matches: [], contour_stats: { notes: 2, deltas: 1, voiced_frames: 5, total_frames: 10 } })!) !== undefined,
  'short contour yields a hint',
);
assert(
  humPhraseHint(parseHumResponse({ success: true, matches: [], contour_stats: { notes: 20, deltas: 18, voiced_frames: 50, total_frames: 60 } })!) === undefined,
  'long contour yields no hint',
);
assert(humPhraseHint(parseHumResponse({ success: true, matches: [] })!) === undefined, 'no contour yields no hint');

console.log('\n— /api/recognize-modern response parsing —');
const modRaw = {
  success: true,
  recognized: 'modern',
  source: 'audd',
  query_duration_ms: 900,
  modern: {
    song: 'Let It Be',
    artist: 'The Beatles',
    album: 'Let It Be',
    isrc: 'GBAYE0601499',
    albumArtUrl: 'https://example.com/art.jpg',
    composer: 'Lennon/McCartney',
    matchConfidence: 0.95,
    source: 'audd',
    retailerUrl: 'https://www.sheetmusicdirect.com/en-US/se/ID_No/Product.aspx?p=123',
  },
};
const modParsed = parseModernResponse(modRaw);
assert(modParsed?.recognized === 'modern', 'recognized=modern parsed');
assertEq(modParsed?.modern?.song, 'Let It Be', 'song parsed');
assertEq(modParsed?.modern?.artist, 'The Beatles', 'artist parsed');
assertEq(modParsed?.modern?.album, 'Let It Be', 'album parsed');
assertEq(modParsed?.modern?.isrc, 'GBAYE0601499', 'isrc parsed');
assertEq(modParsed?.modern?.composer, 'Lennon/McCartney', 'composer parsed');
assertEq(modParsed?.modern?.matchConfidence, 0.95, 'matchConfidence parsed');
assert(/sheetmusicdirect/.test(modParsed?.modern?.retailerUrl ?? ''), 'retailer URL parsed');

const noneRaw = parseModernResponse({ success: true, recognized: 'none', source: 'audd' });
assert((noneRaw as { recognized?: string })?.recognized === 'none', 'recognized=none parsed');
assert(noneRaw?.modern === null, 'modern null when not recognized');

assert(parseModernResponse(null) === null, 'null modern payload rejected');
assert(parseModernResponse({ success: true, recognized: 'other' }) === null, 'unknown recognized value rejected');
assert(parseModernResponse({ success: false }) === null, 'modern failure payload rejected');
assert(
  parseModernResponse({ success: true, recognized: 'modern', modern: { artist: 'no song' } })?.modern === null,
  'modern match without song string is dropped',
);

console.log('\n— modern match vs no-match decision —');
const mOut = modernOutcome(modParsed!);
assert(mOut.recognized === true, 'recognized modern song -> recognized true');
assertEq(mOut.match?.song, 'Let It Be', 'match surfaced');
const nOut = modernOutcome(noneRaw!);
assert(nOut.recognized === false, 'none -> not recognized');
assert(nOut.match === undefined, 'no match for none');

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
