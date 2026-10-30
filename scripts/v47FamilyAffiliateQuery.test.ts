/**
 * Tests for THE v47 FAMILY MONEY-ROW GUARD — src/services/v47FamilyAffiliateQuery.ts
 * (v47 audit defect D0: three of the five family money rows lost the affiliate id
 * inside Sheet Music Direct's own taxonomy redirect).
 *
 * WHAT IT PROVES:
 *   • the five family queries are the EXACT strings live-probed healthy on
 *     2026-10-28 — so a "tidier" copy edit cannot silently zero the commission;
 *   • no query is a bare SMD taxonomy term, including the defect CLASS (a future
 *     family added as `jazz` fails), with `vaudeville` as the one dated,
 *     evidence-backed exception (it keeps both parameters);
 *   • every family's built URL still carries `tid=67650` AND `affiliateId=67650`
 *     and stays on the search route — and a `/genre/…` or `/artist/…` page is
 *     refused by shape, because that is exactly what SMD redirects to;
 *   • the ONE builder still appends both parameters (source-scanned: an edit
 *     there breaks every commission in the app at once).
 * Mutation probes restore each defect on the real bytes and show the guard fail.
 *
 * The redirect itself cannot be reproduced offline. The strings + the recorded
 * SMD result counts are the baseline for the next live re-probe.
 *
 * Plain Node, no react-native, no network. Run with: `npm run test:tier1`.
 */
import {
  FAMILY_TABLE_FILE,
  SMD_BUILDER_FILE,
  SMD_CANONICALISED_TERMS,
  VERIFIED_AFFILIATE_SAFE_TERMS,
  VERIFIED_FAMILY_QUERIES,
  builtUrlFor,
  familyMoneyRowsKeepTheAffiliateId,
  familyMoneyUrlKeepsTheAffiliateId,
  familyMoneyUrls,
  familyTableKeepsTheAffiliateId,
  isBareTaxonomyTerm,
  smdBuilderCarriesBothAffiliateParams,
} from '../src/services/v47FamilyAffiliateQuery';
import { GENRE_FAMILIES } from '../src/services/genreFamilies';

let passes = 0;
let failures = 0;

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };

function assert(ok: boolean, label: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

// ─── helpers ────────────────────────────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

// ─── 1. the file map + the verified table ──────────────────────

function fileMapTests(): void {
  console.log('\nthe guard names the real files and the verified queries');
  assertEq(SMD_BUILDER_FILE, 'src/services/searchExternal.ts', 'the ONE retailer URL builder');
  assertEq(FAMILY_TABLE_FILE, 'src/services/genreFamilies.ts', 'the family table whose q values are money rows');
  assertEq(GENRE_FAMILIES.length, 5, 'five style families (the all-genres front door)');
  assertEq(
    VERIFIED_FAMILY_QUERIES['early-jazz-blues'].q,
    'ragtime sheet music',
    'Early Jazz & Blues searches `ragtime sheet music` (222 results, affiliate kept)',
  );
  assertEq(
    VERIFIED_FAMILY_QUERIES['folk-traditional'].q,
    'sea shanty song',
    'Folk & Traditional searches `sea shanty song` (94 results, affiliate kept)',
  );
  assertEq(
    VERIFIED_FAMILY_QUERIES['patriotic-holiday'].q,
    'christmas carol sheet music',
    'Patriotic & Holiday searches `christmas carol sheet music` (630 results, affiliate kept)',
  );
  assertEq(
    VERIFIED_FAMILY_QUERIES.classical.q,
    'classical piano',
    'Classical keeps `classical piano` (already healthy — do not touch)',
  );
  assertEq(
    VERIFIED_FAMILY_QUERIES['vaudeville-opera-parlor'].q,
    'vaudeville',
    'Vaudeville keeps `vaudeville` (single word, but live-probed and it keeps the id)',
  );
}

// ─── 2. the defect class: bare taxonomy terms ─────────────────

function taxonomyTests(): void {
  console.log('\nTHE DEFECT CLASS — a bare taxonomy term loses the affiliate id');
  for (const term of SMD_CANONICALISED_TERMS) {
    assertEq(isBareTaxonomyTerm(term), true, `\`${term}\` is refused (proven to drop tid + affiliateId)`);
  }
  // The shipped, fixed queries are real searches, not taxonomy terms.
  assertEq(isBareTaxonomyTerm('ragtime sheet music'), false, '`ragtime sheet music` is a real search');
  assertEq(isBareTaxonomyTerm('sea shanty song'), false, '`sea shanty song` is a real search');
  assertEq(isBareTaxonomyTerm('christmas carol sheet music'), false, '`christmas carol sheet music` is a real search');
  assertEq(isBareTaxonomyTerm('classical piano'), false, '`classical piano` is a real search');
  // The one dated exception, and only because it was probed.
  assertEq(isBareTaxonomyTerm('vaudeville'), false, '`vaudeville` is allowed — live-probed, keeps both params');
  assertEq(VERIFIED_AFFILIATE_SAFE_TERMS.indexOf('vaudeville') >= 0, true, '…and the exception is explicit in the guard');
  // The CLASS rule: any other single word is unproven and therefore refused.
  assertEq(isBareTaxonomyTerm('jazz'), true, 'a new single-word family query (`jazz`) is refused');
  assertEq(isBareTaxonomyTerm('opera'), true, 'a new single-word family query (`opera`) is refused');
  assertEq(isBareTaxonomyTerm('  Ragtime  '), true, 'case/space-insensitive: `  Ragtime  ` is still refused');
  assertEq(isBareTaxonomyTerm(''), true, 'an empty money query is refused');
  assertEq(isBareTaxonomyTerm(null), true, 'a non-string money query is refused');
}

// ─── 3. the URLs: both parameters, on the search route ────────

function urlTests(): void {
  console.log('\nTHE MONEY URL — tid=67650 AND affiliateId=67650 on /Search.aspx');
  const rows = familyMoneyUrls();
  assertEq(rows.length, 5, 'five family money rows');
  for (const row of rows) {
    assert(!!row.url, `${row.id}: resolves to a retailer URL`);
    if (!row.url) continue;
    assert(row.url.indexOf('tid=67650') >= 0, `${row.id}: carries tid=67650`);
    assert(row.url.indexOf('affiliateId=67650') >= 0, `${row.id}: carries affiliateId=67650`);
    assert(row.url.indexOf('/Search.aspx') >= 0, `${row.id}: stays on the search route`);
    assert(row.url.indexOf(encodeURIComponent(row.q)) >= 0, `${row.id}: searches its own phrase (${row.q})`);
    assertEq(familyMoneyUrlKeepsTheAffiliateId(row.url), true, `${row.id}: passes the URL guard`);
  }
  assertEq(familyMoneyRowsKeepTheAffiliateId(), true, 'THE WHOLE TABLE: all five family rows keep the affiliate id');
  assertEq(
    familyTableKeepsTheAffiliateId(GENRE_FAMILIES),
    true,
    'the shipped family table holds exactly the verified queries',
  );

  // A canonical page is refused BY SHAPE — that is what SMD redirects to.
  assertEq(
    familyMoneyUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/genre/ragtime'),
    false,
    'a /genre/ page (the D0 landing page) is refused',
  );
  assertEq(
    familyMoneyUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/artist/sea-shanty'),
    false,
    'an /artist/ page is refused',
  );
  assertEq(
    familyMoneyUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/Search.aspx?query=ragtime&tid=67650'),
    false,
    'a search URL missing affiliateId=67650 is refused',
  );
  assertEq(
    familyMoneyUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/Search.aspx?query=ragtime'),
    false,
    'a search URL with no affiliate parameters is refused',
  );
  assertEq(familyMoneyUrlKeepsTheAffiliateId(''), false, 'an empty URL is refused');
  assertEq(familyMoneyUrlKeepsTheAffiliateId('https://www.musicnotes.com/search?w=ragtime'), false, 'a non-SMD host is refused');
}

// ─── 4. the ONE builder, source-scanned ───────────────────────

function builderTests(): void {
  console.log('\nTHE BUILDER — source-scanned, because an edit here breaks every commission');
  const builder = readAppFile(SMD_BUILDER_FILE);
  assertEq(smdBuilderCarriesBothAffiliateParams(builder), true, 'the shipped builder appends tid AND affiliateId (67650)');
  assertEq(smdBuilderCarriesBothAffiliateParams(''), false, 'an empty builder source fails');
  assertEq(smdBuilderCarriesBothAffiliateParams('x'.repeat(3000)), false, 'a long source with no builder fails');

  // The builder's real output for each family query, printed for the report.
  console.log('\n  effective URLs (built by the app’s own builder):');
  for (const row of familyMoneyUrls()) {
    console.log(`    ${row.id.padEnd(24)} ${row.url}`);
  }
}

// ─── 5. mutation probes on the REAL bytes ─────────────────────

function mutationProbes(): void {
  console.log('\nmutation probes — each guard fails on the real bytes it protects');

  // (1) REVERT ONE QUERY TO THE BARE TAXONOMY TERM — the shipped D0 defect.
  const reverted = GENRE_FAMILIES.map((family) =>
    family.id === 'early-jazz-blues' ? { id: family.id, q: 'ragtime' } : { id: family.id, q: family.q },
  );
  assertEq(
    familyTableKeepsTheAffiliateId(reverted),
    false,
    'PROBE 1: `ragtime` restored on Early Jazz & Blues → the table guard FAILS',
  );
  assertEq(isBareTaxonomyTerm('ragtime'), true, 'PROBE 1: …because `ragtime` is a proven taxonomy term');
  // The rest of the table is untouched, so this is the query and not the table.
  assertEq(
    familyTableKeepsTheAffiliateId(
      GENRE_FAMILIES.map((family) => ({ id: family.id, q: family.q })),
    ),
    true,
    'PROBE 1 (control): the same table with the fixed query passes',
  );

  // (2) REVERT THE OTHER TWO.
  for (const [id, q] of [
    ['folk-traditional', 'sea shanty'],
    ['patriotic-holiday', 'christmas carol'],
  ] as [string, string][]) {
    const broken = GENRE_FAMILIES.map((family) =>
      family.id === id ? { id: family.id, q } : { id: family.id, q: family.q },
    );
    assertEq(familyTableKeepsTheAffiliateId(broken), false, `PROBE 2: \`${q}\` restored on ${id} → FAILS`);
  }

  // (3) A NEW FAMILY WITH A BARE WORD — the "next family reintroduces D0" case.
  const plusOne = [
    ...GENRE_FAMILIES.map((family) => ({ id: family.id, q: family.q })),
    { id: 'jazz', q: 'jazz' },
  ];
  assertEq(familyTableKeepsTheAffiliateId(plusOne), false, 'PROBE 3: a sixth family with the bare word `jazz` → FAILS');
  assertEq(familyTableKeepsTheAffiliateId([...plusOne.slice(0, 4)]), false, 'PROBE 3: a truncated table → FAILS');

  // (4) THE BUILDER LOSES ONE PARAMETER.
  const builder = readAppFile(SMD_BUILDER_FILE);
  assertEq(
    smdBuilderCarriesBothAffiliateParams(builder.replace('&affiliateId=${SMD_AFFILIATE_ID}', '')),
    false,
    'PROBE 4: the builder stops appending affiliateId → FAILS',
  );
  assertEq(
    smdBuilderCarriesBothAffiliateParams(builder.replace("export const SMD_AFFILIATE_ID = '67650';", "export const SMD_AFFILIATE_ID = '';")),
    false,
    'PROBE 4: the affiliate id constant emptied → FAILS',
  );
  assertEq(
    smdBuilderCarriesBothAffiliateParams(builder.replace("'/en-US/Search.aspx'", "'/genre/'")),
    false,
    'PROBE 4: the route pointed at a canonical page → FAILS',
  );

  // (5) A FAMILY ROW THAT SEARCHES SOMEBODY ELSE'S PHRASE.
  const wrongPhrase = GENRE_FAMILIES.map((family) => ({ id: family.id, q: family.q }));
  assertEq(
    familyTableKeepsTheAffiliateId(wrongPhrase.map((f, i) => (i === 0 ? { id: f.id, q: 'sheet music' } : f))),
    false,
    'PROBE 5: a family query swapped for a generic phrase → FAILS',
  );

  // …and the real table + builder still pass after every probe.
  assertEq(familyMoneyRowsKeepTheAffiliateId(), true, 'the real family rows still pass after every probe');
  assertEq(smdBuilderCarriesBothAffiliateParams(builder), true, 'the real builder still passes after every probe');
  assert(!!builtUrlFor('classical piano'), 'the builder still returns a URL for a real query');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v47 — the five family money rows must keep the affiliate id (audit D0)');
  fileMapTests();
  taxonomyTests();
  urlTests();
  builderTests();
  mutationProbes();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
