/**
 * Tests for the front door's BAND MODEL and the "Find any song" chip —
 * src/services/frontDoorBands.ts, plus the REAL src/screens/HomeScreen.tsx it
 * renders from (re-flow bundles D + B, owner build-go 10-02).
 *
 * The bug classes these guard, with no emulator available:
 *   • the door drifting back into a pile of overlapping practice cards (the
 *     audit found FIVE targets where there should be one meaning each);
 *   • a band whose content does not exist being rendered anyway (the guitar
 *     facet before the PD batch is surfaced — the "coming soon" promise);
 *   • a destination claimed by two bands at once, so the user cannot tell two
 *     entries apart;
 *   • band copy that promises something (personalisation, "coming soon") instead
 *     of doing something;
 *   • the search row quietly losing its landing on the real field.
 *
 * Layout, like scripts/frontDoor.test.ts:
 *   1. COPY + MODEL — the bands the door renders from, and every string.
 *   2. PRE-FIX FIXTURES — the pre-re-flow shapes must FAIL these contracts.
 *   3. LIVE SCAN — the real HomeScreen off disk, with floors so a broken walk
 *      cannot pass vacuously, and INLINE mutation probes on that real source.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  BAND_CONTAINER_STYLE,
  BAND_FACETS,
  BAND_TITLES,
  BANNED_BAND_PROMISES,
  BROWSE_LIBRARY_LABEL,
  FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL,
  FIND_ANY_SONG_CHIP_HINT,
  FIND_ANY_SONG_CHIP_LABEL,
  FIND_ANY_SONG_DESTINATION,
  FIND_ANY_SONG_DESTINATION_SCREEN,
  FRONT_DOOR_BETA_NOTE,
  FRONT_DOOR_FACET_FLAGS,
  MEDALS_CHIP_LABEL,
  SHARED_DESTINATIONS,
  TODAY_CARD_TITLE,
  TODAY_CARD_UNAVAILABLE_BODY,
  WEEK_CHIP_LABEL,
  bandBandsFor,
  bandFacets,
  bandFacetsAreBackedByRealContent,
  bandOrderFromSource,
  bandOrderIsIdentifyTodayBrowse,
  bandRegion,
  guitarCatalogIsSurfaced,
  guitarContentAvailable,
  noPromiseChips,
  oneMeaningPerCard,
  retentionChips,
  streakChipCopy,
  todayCardAccessibilityLabel,
  todayCardBandDestination,
  todayCardCta,
  todayCardDestination,
  weekChipCopy,
  type BandItem,
  type FrontDoorBand,
} from '../src/services/frontDoorBands';
import {
  chipDoesNotClaimRecordingRecognition,
  findAnySongChipWired,
  findPieceEntryIsSearchRow,
} from '../src/services/frontDoor';
import { HUM_TO_MODERN_BLURB } from '../src/services/humBridge';
import { practiceTodayDestination } from '../src/services/homeCards';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

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
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
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

function itemsOf(bands: readonly FrontDoorBand[], id: string): BandItem[] {
  const band = bands.find((b) => b.id === id);
  return band ? band.items : [];
}

const WITH_SCORE = { title: 'Für Elise', sheetMusicUrl: 'https://cdn/x.pdf' };
const WITHOUT_SCORE = { title: 'Für Elise', sheetMusicUrl: null };

// ─── 1. the chip's copy (bundle B) ──────────────────────────────

function chipCopyTests(): void {
  console.log('\nthe "Find any song" chip says what it opens');

  assert(
    FIND_ANY_SONG_CHIP_LABEL.indexOf('Find any song') >= 0,
    'the chip is the owner-approved "Find any song" affordance',
  );
  assert(
    /title or artist/i.test(FIND_ANY_SONG_CHIP_HINT),
    'the hint says what you type (a title or an artist)',
  );
  assert(
    /search/i.test(FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL),
    'the accessibility label names the SEARCH, not a promise of a match',
  );
  assertEq(
    FIND_ANY_SONG_DESTINATION,
    'find-piece',
    'the chip opens the find-a-song search (Q3: search, not the recorder)',
  );
  assertEq(
    FIND_ANY_SONG_DESTINATION_SCREEN,
    'FindPieceScreen',
    'the destination constant names the screen that exists',
  );
  assert(
    FIND_ANY_SONG_CHIP_LABEL.length < 30,
    'the chip label is short enough to sit beside the hum row on a phone',
  );

  // The honest limit (§B.1): the chip opens the search, so it must not claim to
  // identify a recording — that sentence belongs to the modern door.
  for (const claim of ['identify the recording', 'play the song out loud']) {
    assert(
      FIND_ANY_SONG_CHIP_LABEL.indexOf(claim) < 0 &&
        FIND_ANY_SONG_CHIP_HINT.indexOf(claim) < 0 &&
        FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL.indexOf(claim) < 0,
      `the chip copy does not claim "${claim}"`,
    );
  }
  assert(
    HUM_TO_MODERN_BLURB.length > 40,
    'the modern door still owns the recording-identification sentence',
  );
}

// ─── 2. the band model (bundle D) ───────────────────────────────

function bandModelTests(): void {
  console.log('\nthree bands, one meaning each');

  const bands = bandBandsFor({
    challenge: WITH_SCORE,
    retention: { currentDays: 3, weekCurrent: 2, weekTarget: 5 },
  });
  assertEq(bands.length, 3, 'the door has exactly three bands');
  assertEq(
    bands.map((b) => b.id).join('|'),
    'identify|today|browse',
    'the bands are ordered A → B → C',
  );
  assertEq(BAND_TITLES.identify, null, 'band A carries no heading (the hero is self-evident)');
  assertEq(BAND_TITLES.today, 'Today', 'band B is "Today"');
  assertEq(BAND_TITLES.browse, 'Browse & keep going', 'band C is "browse + keep going"');
  assertEq(BAND_CONTAINER_STYLE, 'styles.band', 'the containers share one style marker');

  // ── band A ──
  const a = itemsOf(bands, 'identify');
  const aIds = a.map((i) => i.id).join('|');
  assertEq(
    aIds,
    'hero-identify|hum-entry|find-any-song|beta-note',
    'band A is the hero, the hum row, the chip, the beta note — in that order',
  );
  const primaries = a.filter((i) => i.primary === true);
  assertEq(primaries.length, 1, 'band A has exactly ONE primary action');
  assertEq(primaries[0]?.id, 'hero-identify', 'the hero is that primary action');
  assertEq(
    a.filter((i) => i.kind === 'card').length,
    0,
    'band A carries no card at all (nothing competes with the hero)',
  );
  const chip = a.find((i) => i.id === 'find-any-song');
  assertEq(chip?.destination, 'find-piece', 'the chip lands on the search');
  assertEq(chip?.label, FIND_ANY_SONG_CHIP_LABEL, 'the chip renders the module label');
  assertEq(
    a[2]?.id,
    'find-any-song',
    'the chip renders AFTER the hum row (the door\'s priority order is unchanged)',
  );
  const beta = a.find((i) => i.id === 'beta-note');
  assertEq(beta?.destination, null, 'the beta note is a note: it promises nothing');
  assert(beta?.label === FRONT_DOOR_BETA_NOTE, 'the beta note is the honest library line');

  // ── band B ──
  const b = itemsOf(bands, 'today');
  assertEq(b.length, 1, 'band B is EXACTLY one entry');
  assertEq(b[0]?.kind, 'card', 'and that entry is a card');
  assertEq(b[0]?.label, TODAY_CARD_TITLE, 'the card is titled "Today\'s piece — practice it"');
  assertEq(b[0]?.destination, 'today-sheet', 'with a curated score the card opens the reader');
  assertEq(
    b[0]?.entryGroup,
    'today',
    'the card is the one practice job on the door',
  );

  // ── band C ──
  const c = itemsOf(bands, 'browse');
  assertEq(c[0]?.id, 'search-row', 'band C leads with the search row');
  assertEq(c[0]?.destination, 'find-piece', 'the search row opens the real search');
  assert(
    c.some((i) => i.destination === 'library'),
    'band C has the "browse the free library" row',
  );
  assert(
    c.some((i) => i.destination === 'medals'),
    'band C keeps the medals entry (as a chip)',
  );
  assert(
    c.some((i) => i.destination === 'practice-week'),
    'band C keeps "This Week" (as a chip)',
  );
  assertEq(
    c.filter((i) => i.destination === null).length,
    1,
    'the only destination-less band-C chip is the streak STATE',
  );

  // Every entry that has a destination carries an accessibility label; every
  // entry that has none says so in words (no silent, unlabelled chip).
  for (const band of bands) {
    for (const item of band.items) {
      assert(
        item.accessibilityLabel.trim().length > 0,
        `${item.id} carries an accessibility label`,
      );
    }
  }
}

// ─── 3. today's ONE destination ─────────────────────────────────

function todayDestinationTests(): void {
  console.log('\nband B lands through ONE pure function');

  assertEq(
    todayCardDestination(WITH_SCORE),
    practiceTodayDestination(WITH_SCORE),
    'todayCardDestination delegates to homeCards.practiceTodayDestination',
  );
  assertEq(
    todayCardDestination(WITHOUT_SCORE),
    practiceTodayDestination(WITHOUT_SCORE),
    'the no-score case delegates too (no second mapping)',
  );
  assertEq(
    todayCardDestination(null),
    practiceTodayDestination(null),
    'the no-catalog case delegates too',
  );
  assertEq(todayCardDestination(WITH_SCORE), 'sheet', 'a curated score opens the reader');
  assertEq(todayCardDestination(WITHOUT_SCORE), 'piece', 'otherwise the piece page (the coach)');
  assertEq(todayCardDestination(null), 'find-piece', 'with no catalog it opens the search');
  assertEq(
    todayCardDestination({ sheetMusicUrl: '   ' }),
    'piece',
    'a blank sheet URL is NOT a sheet (the honesty rule)',
  );

  assertEq(todayCardBandDestination(WITH_SCORE), 'today-sheet', 'band-B id for the reader');
  assertEq(todayCardBandDestination(WITHOUT_SCORE), 'today-piece', 'band-B id for the piece page');
  assertEq(todayCardBandDestination(null), 'find-piece', 'band-B id for the fallback');

  assertEq(todayCardCta(null), 'Find a piece to practice →', 'the empty card names the real tap');
  assertEq(todayCardCta(WITH_SCORE), "Open today's piece →", 'the loaded card keeps the CTA');
  assertEq(todayCardCta(WITHOUT_SCORE), "Open today's piece →", 'the CTA follows the destination');

  assertEq(
    todayCardAccessibilityLabel(WITH_SCORE),
    'Today’s piece — practice Für Elise',
    'screen readers are told the piece AND that it opens',
  );
  assert(
    todayCardAccessibilityLabel(null).toLowerCase().indexOf('piece') >= 0,
    'with no catalog the label still says what the card is for',
  );
  assert(
    TODAY_CARD_UNAVAILABLE_BODY.length > 20 &&
      !/coming soon/i.test(TODAY_CARD_UNAVAILABLE_BODY),
    'the no-catalog line is honest copy, not a "coming soon" promise',
  );
}

// ─── 4. the retention chips + the facets ────────────────────────

function chipAndFacetTests(): void {
  console.log('\nthe retention chips show STATE, the facets show real content');

  assertEq(streakChipCopy(4), '🔥 4-day streak', 'a live streak renders its number');
  assertEq(streakChipCopy(0), 'Start your streak today!', '0 days invites a start');
  assertEq(streakChipCopy(null), 'Start your streak today!', 'a missing streak is not invented');
  assertEq(weekChipCopy(3, 5, false), '3/5 days practiced', 'the week chip is the x/5 line');
  assertEq(weekChipCopy(3, 5, true), '3/5 days practiced 🎉', 'a complete week celebrates');
  assertEq(weekChipCopy(null, null, false), '0/5 days practiced', 'junk input reads as 0/5');

  const chips = retentionChips({ currentDays: 9, weekCurrent: 1, weekTarget: 5 });
  const sameCard = chips.filter((c) => c.where === 'today-card');
  assertEq(sameCard.length, 2, 'band B\'s card carries the streak and week chips');
  for (const chip of sameCard) {
    assertEq(chip.destination, null, `${chip.id} is STATE — it promises nothing`);
  }
  const browse = chips.filter((c) => c.where === 'browse');
  assertEq(browse.length, 3, 'band C has three small chips');
  assertEq(
    browse.filter((c) => c.destination === null).length,
    1,
    'only the streak chip is state in band C',
  );
  assert(
    browse.some((c) => c.label === MEDALS_CHIP_LABEL),
    'the medals chip keeps its label',
  );
  assert(
    browse.some((c) => c.label === WEEK_CHIP_LABEL),
    'the This Week chip keeps its label',
  );

  console.log('\nthe guitar facet is gated on real content');

  assertEq(
    guitarContentAvailable,
    false,
    'guitarContentAvailable is false — the batch has no screen yet',
  );
  const facets = bandFacets(FRONT_DOOR_FACET_FLAGS);
  const ids = facets.map((f) => f.id).join('|');
  assertEq(
    ids,
    'free-classical|any-song',
    'the door renders the two facets whose content exists today',
  );
  assert(
    !facets.some((f) => f.id === 'guitar-keyboard'),
    'NO guitar chip renders while its content is unwired',
  );
  assertEq(
    bandFacets({ guitarContentAvailable: false, searchAvailable: true, libraryAvailable: true })
      .length,
    2,
    'with the flag off, the guitar facet is simply absent',
  );
  assert(
    BAND_FACETS.every((f) => f.backedBy.trim().length > 0),
    'every facet names the content behind it',
  );
  for (const facet of bandFacets({
    guitarContentAvailable: false,
    searchAvailable: true,
    libraryAvailable: true,
  })) {
    assert(
      facet.destination === 'find-piece',
      `${facet.id} lands on the search surface, not on a promise`,
    );
  }
  assert(
    !/coming soon/i.test(
      BAND_FACETS.map((f) => f.label + f.backedBy).join(' '),
    ),
    'no facet is labelled "coming soon"',
  );
  assert(
    BROWSE_LIBRARY_LABEL.indexOf('free library') >= 0,
    'the free-library row says what it opens',
  );
}

// ─── 5. pre-fix fixtures (the old door must FAIL) ───────────────

/** The pre-re-flow door: four practice cards, each with its own destination. */
const PREFIX_BANDS: FrontDoorBand[] = [
  {
    id: 'identify',
    title: null,
    items: [
      { id: 'hero-identify', kind: 'hero', label: 'Identify any song', accessibilityLabel: 'x', destination: 'identify', entryGroup: 'identify', primary: true },
    ],
  },
  {
    id: 'today',
    title: 'Today',
    items: [
      { id: 'streak-card', kind: 'card', label: '🔥 3-day streak', accessibilityLabel: 'x', destination: 'practice-week', entryGroup: 'retention' },
      { id: 'practice-today', kind: 'card', label: '⏱️ Practice today', accessibilityLabel: 'x', destination: 'today-piece', entryGroup: 'today' },
      { id: 'this-week', kind: 'card', label: '📋 This Week', accessibilityLabel: 'x', destination: 'practice-week', entryGroup: 'retention' },
      { id: 'featured', kind: 'card', label: "🌟 Today's Featured Piece", accessibilityLabel: 'x', destination: 'today-sheet', entryGroup: 'today' },
    ],
  },
  {
    id: 'browse',
    title: 'Browse & keep going',
    items: [
      { id: 'search-row', kind: 'row', label: 'Search by title or composer', accessibilityLabel: 'x', destination: 'find-piece', entryGroup: 'search' },
    ],
  },
];

/** The shape the door ships: band B collapsed to one card. */
const FIXED_BANDS: FrontDoorBand[] = [
  PREFIX_BANDS[0] as FrontDoorBand,
  {
    id: 'today',
    title: 'Today',
    items: [
      { id: 'today-piece', kind: 'card', label: TODAY_CARD_TITLE, accessibilityLabel: 'x', destination: 'today-sheet', entryGroup: 'today' },
    ],
  },
  PREFIX_BANDS[2] as FrontDoorBand,
];

function fixtureTests(): void {
  console.log('\nthe pre-fix door must FAIL these contracts');

  assertEq(
    oneMeaningPerCard(PREFIX_BANDS),
    false,
    'PRE-FIX: four practice cards in band B fail oneMeaningPerCard',
  );
  assertEq(
    oneMeaningPerCard(FIXED_BANDS),
    true,
    'the one-card shape passes (the fixture pair is real)',
  );

  // A second practice card re-added beside the one card.
  const secondCard: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'today'
      ? {
          ...band,
          items: [
            ...band.items,
            { id: 'practice-today', kind: 'card', label: '⏱️ Practice today', accessibilityLabel: 'x', destination: 'today-piece', entryGroup: 'today' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(secondCard),
    false,
    'PRE-FIX: a second practice card in band B fails again',
  );

  // Two CARDS on one destination (the audit's "one card, two meanings"): band B
  // keeps its single card, and a second card in band C claims the same landing.
  const twoWays: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'browse'
      ? {
          ...band,
          items: [
            ...band.items,
            { id: 'second-practice-card', kind: 'card', label: 'practice again', accessibilityLabel: 'x', destination: 'today-sheet', entryGroup: 'retention' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(twoWays),
    false,
    'two cards claiming one destination fail oneMeaningPerCard',
  );

  // An undeclared destination repeat ACROSS bands (only the search may repeat).
  const crossBand: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'identify' || band.id === 'browse'
      ? {
          ...band,
          items: [
            ...band.items,
            { id: 'library-again', kind: 'row', label: 'library', accessibilityLabel: 'x', destination: 'library', entryGroup: 'library' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(crossBand),
    false,
    'the same destination in two bands fails (except the declared search)',
  );
  assertEq(
    SHARED_DESTINATIONS.join('|'),
    'find-piece',
    'exactly ONE destination is allowed to repeat: the search',
  );

  // The shared destination must still keep to ONE job group: the chip (search
  // job) and a card that fell back to the search (today job) may not both claim it.
  const sharedTwoJobs: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'today'
      ? {
          ...band,
          items: [
            { id: 'today-piece', kind: 'card', label: 'today', accessibilityLabel: 'x', destination: 'find-piece', entryGroup: 'today' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(sharedTwoJobs),
    false,
    'the shared search destination in two job groups fails (that is two meanings)',
  );
  // …while the honest no-catalog shape (band B's card declaring the search job)
  // passes: that IS the search entry, not a second meaning.
  const honestFallback: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'today'
      ? {
          ...band,
          items: [
            { id: 'today-piece', kind: 'card', label: 'today', accessibilityLabel: 'x', destination: 'find-piece', entryGroup: 'search' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(honestFallback),
    true,
    'band B falling back to the search (declaring the search job) still passes',
  );

  // A card with no destination at all is a promise with no action.
  const noDestination: FrontDoorBand[] = FIXED_BANDS.map((band) =>
    band.id === 'today'
      ? {
          ...band,
          items: [
            { id: 'today-piece', kind: 'card', label: 'x', accessibilityLabel: 'x', destination: null, entryGroup: 'today' } as BandItem,
          ],
        }
      : band,
  );
  assertEq(
    oneMeaningPerCard(noDestination),
    false,
    'a card with no destination fails (nothing to tap)',
  );
}

// ─── 6. the zero-promise scan ───────────────────────────────────

const PREFIX_PROMISE_FIXTURES = [
  '<View style={styles.promiseBox}><Text>🎼 Sheet music coming soon</Text></View>',
  '<Text style={styles.sectionTitle}>🎯 For You</Text>',
  '<Text>`Piano picks for beginners`</Text>',
  "<Text>We're still curating this one — check back soon.</Text>",
];

function promiseTests(): void {
  console.log('\nno band copy promises anything');

  for (const fixture of PREFIX_PROMISE_FIXTURES) {
    assertEq(
      noPromiseChips(fixture),
      false,
      `PRE-FIX fixture fails the scan: ${fixture.slice(0, 34)}…`,
    );
  }
  assert(
    BANNED_BAND_PROMISES.length >= 5,
    'the banned list covers the §E patterns (coming soon / curation / For You)',
  );

  const clean =
    '<Text>{BAND_TITLES.browse}</Text><Text>{TODAY_CARD_TITLE}</Text><Text>{BROWSE_LIBRARY_LABEL}</Text>';
  assertEq(noPromiseChips(clean), true, 'real band copy passes the scan');
  // Comments are masked: documentation may discuss the ban itself.
  assertEq(
    noPromiseChips('// no "coming soon" box here\n<Text>{TODAY_CARD_TITLE}</Text>'),
    true,
    'a comment that documents the ban is not an offence',
  );
}

// ─── 7. live scan of the real door + mutation probes ────────────

function liveScanTests(): void {
  console.log('\nlive scan of the real front door');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const findPiece = readAppFile('src/screens/FindPieceScreen.tsx');
  assert(home.length > 20000, `read HomeScreen.tsx (${home.length} chars)`);
  assert(findPiece.length > 4000, `read FindPieceScreen.tsx (${findPiece.length} chars)`);

  assertEq(
    bandOrderFromSource(home).join('|'),
    'identify|today|browse',
    'the real Home renders the three band containers in A → B → C order',
  );
  assertEq(
    bandOrderIsIdentifyTodayBrowse(home),
    true,
    'band A holds the hero (and the hum row + chip), band B its one card, band C its rows',
  );
  assertEq(
    oneMeaningPerCard(home),
    true,
    'the real door keeps ONE meaning per card (no retired practice card is back)',
  );
  assert(
    bandRegion(home, 'today').indexOf('styles.todayCard') >= 0,
    'band B renders its card from the model',
  );
  assertEq(
    noPromiseChips(home),
    true,
    'no band copy on the real screen promises anything',
  );
  assertEq(
    noPromiseChips(readAppFile('src/services/frontDoorBands.ts')),
    true,
    'the band COPY module itself carries no promise',
  );

  console.log('\nthe chip is wired to the real search (bundle B)');

  assertEq(
    findAnySongChipWired(home),
    true,
    'the real chip renders after the hum row, from the module copy, and opens the search',
  );
  assertEq(
    chipDoesNotClaimRecordingRecognition(home),
    true,
    "the real chip's copy does not claim to identify a recording",
  );
  assertEq(
    chipDoesNotClaimRecordingRecognition(readAppFile('src/services/frontDoorBands.ts')),
    true,
    'the chip COPY module does not claim it either',
  );
  assertEq(
    findPieceEntryIsSearchRow(home),
    true,
    'band C\'s search row reads as a search entry and opens the real field',
  );
  assert(
    findPiece.indexOf('<TextInput') >= 0 || findPiece.indexOf('TextInput') >= 0,
    'FindPieceScreen really renders a text field (one tap from the row)',
  );
  assertEq(
    bandFacetsAreBackedByRealContent(FRONT_DOOR_FACET_FLAGS, home + findPiece),
    true,
    'every facet the door renders is backed by content that exists',
  );

  // ── MUTATION 1: the chip loses its press handler (the dead-CTA class) ──
  const chipDead = home.replace('onPress={handleFindAnySong}', 'onPress={undefined}');
  assert(chipDead !== home, 'the chip mutation changed the real source');
  assertEq(
    findAnySongChipWired(chipDead),
    false,
    'MUTATION: a chip that renders but is not wired FAILS findAnySongChipWired',
  );

  // ── MUTATION 2: the chip is promoted to the hero handler (a second hero) ──
  const chipHero = home.replace(
    'onPress={handleFindAnySong}',
    'onPress={handleHeroTap}',
  );
  assert(chipHero !== home, 'the promotion mutation changed the real source');
  assertEq(
    findAnySongChipWired(chipHero),
    false,
    'MUTATION: a chip wired to the hero handler FAILS (the chip must not be a hero)',
  );

  // ── MUTATION 3: the chip claims the recording door's sentence ──
  const chipClaims = home.replace(
    '{FIND_ANY_SONG_CHIP_LABEL}',
    "{'identify the recording out loud'}",
  );
  assert(chipClaims !== home, 'the claim mutation changed the real source');
  assertEq(
    chipDoesNotClaimRecordingRecognition(chipClaims),
    false,
    'MUTATION: a chip label claiming recording identification FAILS',
  );
  // …and the same defect at the copy module's own level: the modern door's blurb
  // pasted in as the chip's copy.
  const blurbAsChipCopy = readAppFile('src/services/frontDoorBands.ts').replace(
    "export const FIND_ANY_SONG_CHIP_HINT =\n  'Search by title or artist — free scores, or the official sheet music';",
    `export const FIND_ANY_SONG_CHIP_HINT =\n  '${HUM_TO_MODERN_BLURB}';`,
  );
  assert(blurbAsChipCopy !== readAppFile('src/services/frontDoorBands.ts'),
    'the blurb fixture changed the real copy module');
  assertEq(
    chipDoesNotClaimRecordingRecognition(blurbAsChipCopy),
    false,
    'MUTATION: HUM_TO_MODERN_BLURB as the chip hint FAILS the claim contract',
  );

  // ── MUTATION 4: the band-B card is deleted ──
  const cardStart = home.indexOf('style={styles.todayCard}');
  assert(cardStart > 0, 'band B\'s card is in the real source');
  const cardOpen = home.lastIndexOf('<TouchableOpacity', cardStart);
  const cardClose = home.indexOf('</TouchableOpacity>', cardStart);
  const cardRemoved =
    home.slice(0, cardOpen) + home.slice(cardClose + '</TouchableOpacity>'.length);
  assert(cardRemoved !== home, 'the card-deletion mutation changed the real source');
  assertEq(
    oneMeaningPerCard(cardRemoved),
    false,
    'MUTATION: deleting band B\'s card FAILS oneMeaningPerCard (band B has no card)',
  );

  // ── MUTATION 5: a second practice card comes back ──
  const secondCard = home.replace(
    '<View style={styles.band} testID={BAND_TEST_IDS.today}>',
    '<View style={styles.band} testID={BAND_TEST_IDS.today}>\n' +
      '          <TouchableOpacity style={styles.practiceCard} onPress={handlePracticeTodayTap}>' +
      '<Text>⏱️ Practice today</Text></TouchableOpacity>',
  );
  assert(secondCard !== home, 'the second-card mutation changed the real source');
  assertEq(
    oneMeaningPerCard(secondCard),
    false,
    'MUTATION: a second practice card in band B FAILS oneMeaningPerCard',
  );

  // ── MUTATION 6: the band containers are re-ordered ──
  const lostBand = home.replace('testID={BAND_TEST_IDS.browse}', 'testID={undefined}');
  assert(lostBand !== home, 'the band-order mutation changed the real source');
  assertEq(
    bandOrderIsIdentifyTodayBrowse(lostBand),
    false,
    'MUTATION: a missing band container FAILS the order contract',
  );

  // ── MUTATION 7: the guitar facet is switched on while its content is unwired ──
  const guitarOn = {
    guitarContentAvailable: true,
    searchAvailable: true,
    libraryAvailable: true,
  };
  assertEq(
    bandFacetsAreBackedByRealContent(guitarOn, home + findPiece),
    false,
    'MUTATION: flipping guitarContentAvailable alone FAILS (no screen surfaces the batch)',
  );
  assertEq(
    bandFacets(guitarOn).some((f) => f.id === 'guitar-keyboard'),
    true,
    'the flipped flag really would render the guitar chip (so the guard is not vacuous)',
  );
  assertEq(
    bandFacetsAreBackedByRealContent(
      guitarOn,
      "import { PD_GUITAR_CATALOG } from '../services/pdGuitarCatalog';",
    ),
    true,
    'the guard only passes once a SURFACE imports the catalog (the wiring step)',
  );
  assertEq(
    guitarCatalogIsSurfaced(home + findPiece),
    false,
    'no screen surfaces the PD guitar batch today',
  );

  // ── MUTATION 8: band C's search row loses its landing ──
  const rowDead = home.replace(
    /const handleOpenFindPiece = useCallback\(\(\) => \{\n\s*setShowFindPiece\(true\);\n\s*\}, \[\]\);/,
    'const handleOpenFindPiece = useCallback(() => {}, []);',
  );
  assert(rowDead !== home, 'the search-row mutation changed the real handler');
  assertEq(
    findPieceEntryIsSearchRow(rowDead),
    false,
    'MUTATION: a search row whose handler never opens the screen FAILS (a dead row)',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== the front door in THREE BANDS + the find-any-song chip (B + D) ===');
  chipCopyTests();
  bandModelTests();
  todayDestinationTests();
  chipAndFacetTests();
  fixtureTests();
  promiseTests();
  liveScanTests();
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
