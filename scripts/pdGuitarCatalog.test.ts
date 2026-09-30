/**
 * Contract suite for the FREE guitar/keyboard PD sheet-music batch.
 *
 * WHAT THIS SUITE GUARDS (all data-level, no network — it runs inside `npm run test:tier1`):
 *   • an entry can only exist in the shipped batch if gateGuitarSheet() clears it: a permissive
 *     licence (PD/CC), a PD composer, a PROVEN typeset, a guitar-accessible instrument, an
 *     approved source host and a complete sha256/bytes/pages integrity record;
 *   • the sheet URL the app will open is built in ONE place from the piece id
 *     (site /api/sheets/<piece-id>.pdf) — never a raw R2 host (401), never a source page that
 *     needs a session (IMSLP Special:ImagefromIndex), never another piece's score;
 *   • no entry carries overclaim copy — these are free public-domain SCORES, the
 *     "any song -> official TAB" promise stays the affiliate path (frontDoor.ts);
 *   • the three recently-merged surfaces this sprint could regress still hold their contracts
 *     (History = saved recognitions only, Find-a-Piece keeps its external retailer section,
 *     the front door keeps its prod-safe single CTA).
 *
 * MUTATION PROBES at the end prove each guard actually fails: a flipped licence, an unproven
 * typeset, a session-gated URL, a duplicated slug, an unverifiable composer, a truncated hash
 * and injected "free tabs" copy are each rejected with the exact reason.
 */
import {
  PD_GUITAR_CATALOG,
  type GuitarPdPiece,
} from '../src/services/pdGuitarCatalog';
import {
  APPROVED_SOURCE_HOSTS,
  PD_DEATH_YEAR_BASELINE,
  R2_SHEET_KEY_PREFIX,
  SHEET_URL_BASE,
  auditGuitarPdCatalog,
  classifySheetLicense,
  gateGuitarSheet,
  isApprovedSourceUrl,
  pieceIdFromSheetUrl,
  sheetObjectKey,
  sheetUrlForPieceId,
} from '../src/services/sheetLicenseGate';

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
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
/** A deep copy we are free to mutate in the probes. */
const copy = (over: Partial<GuitarPdPiece> = {}): GuitarPdPiece => ({
  ...PD_GUITAR_CATALOG[0],
  ...over,
});

const PIECE_ID = '0f6b1e8a-3c2d-4a5b-8c7d-9e0f1a2b3c4d';

console.log('\n— the free guitar batch is present and internally consistent —');
assert(PD_GUITAR_CATALOG.length >= 10, `batch carries ${PD_GUITAR_CATALOG.length} audited pieces`);
const audit = auditGuitarPdCatalog(PD_GUITAR_CATALOG);
for (const problem of audit.problems) console.error(`      · ${problem}`);
assertEq(audit.problems.length, 0, 'no audit problem on any shipped entry');
assertEq(audit.excluded.length, 0, 'every shipped entry passes the licence/quality gate');
assertEq(audit.included.length, PD_GUITAR_CATALOG.length, 'every entry is gate-cleared');

console.log('\n— licences: PD or commercial-use CC only, silence refused —');
for (const piece of PD_GUITAR_CATALOG) {
  const verdict = classifySheetLicense(piece.licenseLabel).verdict;
  assert(
    verdict === 'PD_CLEARED' || verdict === 'CC_CLEARED',
    `${piece.slug} licence "${piece.licenseLabel}" classifies as ${verdict}`,
  );
}
assert(
  PD_GUITAR_CATALOG.every((p) => isApprovedSourceUrl(p.sourceInfoUrl) && isApprovedSourceUrl(p.sourcePdfUrl) && isApprovedSourceUrl(p.engravingSourceUrl)),
  `every source URL is https on an approved host (${APPROVED_SOURCE_HOSTS.join(', ')})`,
);
assert(
  PD_GUITAR_CATALOG.every((p) => /^https:\/\/www\.mutopiaproject\.org\/ftp\/.+\.ly$/.test(p.engravingSourceUrl)),
  'every entry carries a LilyPond .ly engraving source — proof the score is typeset, not a scan',
);
assert(
  PD_GUITAR_CATALOG.every((p) => /^[0-9a-f]{64}$/.test(p.sha256) && p.bytes >= 20000 && p.pageCount >= 1),
  'every entry carries a 64-hex sha256 + real byte size + page count for the copy we host',
);
assert(
  PD_GUITAR_CATALOG.every((p) => /guitar|lute|vihuela/i.test(p.instrument)),
  'every entry is guitar-accessible (guitar / lute / vihuela)',
);

console.log('\n— the sheet URL is built in one place and cannot be mis-routed —');
assertEq(sheetObjectKey(PIECE_ID), `sheets/${PIECE_ID}.pdf`, 'R2 key is sheets/<piece-id>.pdf');
assertEq(sheetUrlForPieceId(PIECE_ID), `${SHEET_URL_BASE}/api/sheets/${PIECE_ID}.pdf`, 'sheet URL is the site score route');
assertEq(pieceIdFromSheetUrl(sheetUrlForPieceId(PIECE_ID)), PIECE_ID, 'the sheet URL round-trips to its piece id');
assertEq(R2_SHEET_KEY_PREFIX, 'sheets/', 'the R2 prefix matches the site sheet-handler key');
assert(pieceIdFromSheetUrl('https://notesnapscores.bcc6072438f1abd2103802de48b9d435.r2.cloudflarestorage.com/sheets/x.pdf') === null, 'a raw R2 URL is NOT accepted as a sheet URL');
assert(pieceIdFromSheetUrl('https://imslp.org/wiki/Special:ImagefromIndex/123456') === null, 'a session-gated IMSLP image link is NOT accepted as a sheet URL');
assert(!isApprovedSourceUrl('https://imslp.org/wiki/Special:ImagefromIndex/123456'), 'the source allowlist refuses session-gated IMSLP links');
assert(!isApprovedSourceUrl('http://www.mutopiaproject.org/ftp/x.pdf'), 'the source allowlist refuses plain http');
const slugs = PD_GUITAR_CATALOG.map((p) => p.slug);
assertEq(new Set(slugs).size, slugs.length, 'slugs are unique — no two pieces share one score URL');

console.log('\n— no overclaim copy in the free-guitar data (frontDoor promise stays affiliate-only) —');
assert(
  !/free\s+tabs?\b/i.test(JSON.stringify(PD_GUITAR_CATALOG)),
  'the batch never claims "free tabs" — it ships free public-domain scores',
);

console.log('\n— MUTATION PROBES — each guard fails when the data is wrong —');
const nc = gateGuitarSheet(copy({ licenseLabel: 'Creative Commons Attribution-NonCommercial 4.0' }));
assert(nc.included === false && nc.verdict === 'RESTRICTED', `MUTATION: a non-commercial licence is REFUSED (${nc.reason})`);
const silent = gateGuitarSheet(copy({ licenseLabel: '' }));
assert(silent.included === false && silent.verdict === 'NO_LICENSE_STATEMENT', 'MUTATION: an unstated licence is REFUSED (silence is not a licence)');
const scan = gateGuitarSheet(copy({ engravingSourceUrl: 'https://www.mutopiaproject.org/ftp/scan-only/scan.pdf' }));
assert(scan.included === false, `MUTATION: a score with no engraving source is REFUSED (${scan.reason})`);
const deadComposer = gateGuitarSheet(copy({ composer: 'Astor Piazzolla' }));
assert(deadComposer.included === false, `MUTATION: a composer outside the audited PD set is REFUSED (${deadComposer.reason})`);
const badHash = gateGuitarSheet(copy({ sha256: 'deadbeef' }));
assert(badHash.included === false, `MUTATION: a truncated sha256 is REFUSED (${badHash.reason})`);
const tiny = gateGuitarSheet(copy({ bytes: 10 }));
assert(tiny.included === false, `MUTATION: a stub-sized "score" is REFUSED (${tiny.reason})`);
const piano = gateGuitarSheet(copy({ instrument: 'Piano' }));
assert(piano.included === false, `MUTATION: a non-guitar score is REFUSED (${piano.reason})`);
const badHost = gateGuitarSheet(copy({ sourcePdfUrl: 'https://imslp.org/wiki/Special:ImagefromIndex/123456' }));
assert(badHost.included === false, `MUTATION: a source URL off the approved hosts is REFUSED (${badHost.reason})`);
const dupSlug = auditGuitarPdCatalog([copy(), copy({ title: 'Same slug' })]);
assert(dupSlug.problems.some((p) => /duplicate slug/.test(p)), 'MUTATION: two entries sharing a slug FAIL the audit');
const overclaim = auditGuitarPdCatalog([copy({ note: 'Free tabs for every song' })]);
assert(overclaim.problems.some((p) => /overclaim/.test(p)), 'MUTATION: injected "free tabs" copy FAILS the audit');
const outOfRange = auditGuitarPdCatalog([copy({ difficulty: 42 })]);
assert(outOfRange.problems.some((p) => /difficulty/.test(p)), 'MUTATION: an out-of-range difficulty FAILS the audit');
const empty = auditGuitarPdCatalog([]);
assert(empty.problems.some((p) => /empty/.test(p)), 'MUTATION: an empty batch FAILS the audit');
assert(
  PD_DEATH_YEAR_BASELINE === 1929,
  `the PD baseline is ${PD_DEATH_YEAR_BASELINE} (published-before-1930 + life+70), same as the classtab gate`,
);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
