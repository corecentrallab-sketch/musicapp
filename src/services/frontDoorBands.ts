/**
 * frontDoorBands.ts — the front door's BAND MODEL and the "Find any song" chip's
 * one source of copy (re-flow bundles B + D, owner build-go 10-02).
 *
 * WHY THIS MODULE EXISTS. The owner-approved audit found the front door showing
 * a pile of overlapping "practice" targets under an otherwise excellent one-tap
 * hero: a streak card whose tap meant two different things (0 days → practice
 * today, ≥1 day → the week view), a "⏱️ Practice today" card, a "📋 This Week"
 * card, a "🌟 Today's Featured Piece" card and a "🎯 For You" card that promised
 * personalisation and opened a generic search. Five targets, one meaning each at
 * best. The re-flow re-draws the door as THREE bands with one meaning per entry:
 *
 *   A — identify : the hero card exactly as it was (emoji, title, support, the
 *                  ONE button, the hum row, the new "Find any song" chip, the
 *                  honest beta note). Nothing here is re-ordered.
 *   B — today    : ONE card, one destination every day, with the streak and week
 *                  STATE kept as small chips inside it.
 *   C — browse + keep going : the honest search row (one tap from a real field),
 *                  facet chips that are each backed by content that exists, the
 *                  "Browse the free library" row, then the small chips
 *                  (streak state / medals / This week).
 *
 * The module is PURE (no react / react-native / fs / path imports) so the tier1
 * gate can assert band ORDER, ONE-MEANING and NO-PROMISE without an emulator —
 * see scripts/frontDoorBands.test.ts. It models the door's tappable ENTRIES (not
 * the JSX): the screens render from these names, and the source-scan guards in
 * scripts/frontDoorBands.test.ts check the real HomeScreen against them.
 *
 * IMPORT/EXPORT NOTE (no cycle at load time): frontDoor.ts imports the chip's
 * copy constants from here so its `findASongBarWired()` guard can compare the
 * screen against the ONE label, and this module imports the front door's existing
 * hero/hum/search strings from there so the band model reads them rather than
 * retyping them. Every one of those imports is used INSIDE a function, never in a
 * top-level initialiser, so the CommonJS cycle resolves on first call.
 */
import {
  maskComments,
} from './modalBackContract';
import {
  FIND_PIECE_CTA,
  OPEN_FEATURED_CTA,
  featuredPieceCta,
  practiceTodayDestination,
  weekProgressCopy,
  type PracticeTodayChallenge,
} from './homeCards';
import {
  FIND_PIECE_ENTRY_HINT,
  FIND_PIECE_ENTRY_LABEL,
  HOME_SPLIT_HUM_A11Y,
  HOME_SPLIT_HUM_TITLE,
  HOME_SPLIT_LISTEN_A11Y,
  HOME_SPLIT_LISTEN_TITLE,
} from './frontDoor';

// ─────────────── the "Find a song" search bar (bundle B → v45) ───────────────

/**
 * The SEARCH BAR in the Discover band on the front door. It began as the v33
 * "chip" (owner sign-off (b): a low-weight "Find any song" chip beside the hum
 * row) and the owner's v45 call (10-26) turned it into the single, full-width
 * bar labelled `Find a song` — one search entry on Home, and Discover's door.
 * It is the compact way into the find-a-song search, which is the door's own
 * money path: a real text field, the internal free catalog, and the "Official
 * sheet music" retailer cards in EVERY query state (PR #142).
 *
 * HONEST LIMIT (spec §B.1): this chip opens the TITLE/ARTIST SEARCH, not the
 * recording door (`ModernSearchScreen`, which has its own recorder). It must
 * therefore never claim to identify a recording — that sentence belongs to
 * HUM_TO_MODERN_BLURB / the modern door. `chipDoesNotClaimRecordingRecognition()`
 * freezes that, with the blurb itself as the negative fixture.
 */
export const FIND_ANY_SONG_CHIP_LABEL = 'Find a song';
/** The supporting line inside the chip: what the search actually holds. */
export const FIND_ANY_SONG_CHIP_HINT =
  'Search by title or artist — free scores, or the official sheet music';
/** What a screen reader hears for the chip (identity + real destination). */
export const FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL =
  'Find a song — search by title or artist for free scores or the official sheet music';

/** The screens the chip/rows may open. `find-piece` = FindPieceScreen. */
export type FindAnySongDestination = 'find-piece';

/**
 * ONE constant for the chip's destination (spec §B.2): the chip, the band-C
 * search row and the facets all resolve to the SAME screen, so there is no
 * second search implementation and no second box. Q3 (owner, ratified 10-02):
 * the search, not the recorder.
 */
export const FIND_ANY_SONG_DESTINATION: FindAnySongDestination = 'find-piece';
/** The screen that constant names — the contract's human-readable half. */
export const FIND_ANY_SONG_DESTINATION_SCREEN = 'FindPieceScreen';

// ───────────────────────────── the band model ─────────────────────────────

/**
 * The THREE bands, in the order they render (A → Discover → Today).
 *
 * v45 slice 2 (owner 10-26, designer notes rev 2 §6 "DIES"): band C —
 * "Browse & keep going" — is GONE as a band. Its heading dies, its rows move
 * INTO the Discover band (facet chips + the free-library row; its duplicate
 * search row is dropped because the slice-1 "Find a song" bar is already the one
 * search entry), and its retention chips move into Settings. Nothing that was
 * reachable became unreachable: that is what `RETIRED_BAND_*` and
 * `bandOrderIsIdentifyDiscoverToday` below actually check.
 */
export type BandId = 'identify' | 'discover' | 'today';

/** A stable id per band — the source-scan guard finds the containers by it. */
export const BAND_TEST_IDS: Record<BandId, string> = {
  identify: 'band-identify',
  discover: 'band-discover',
  today: 'band-today',
};

/**
 * The retired band C, by the two markers the removed container carried. A guard
 * that only counted three bands would miss a FOURTH container added back beside
 * them (an unknown marker is invisible to `bandOrderFromSource`), so the order
 * contract scans for these two strings explicitly: re-adding the browse band —
 * container marker or heading — fails it.
 */
export const RETIRED_BAND_MARKER = 'BAND_TEST_IDS.browse';
export const RETIRED_BAND_TITLE = 'Browse & keep going';

/**
 * The visible band headings. Band A carries NONE on purpose: the hero card is
 * self-evident and the owner's rule is that band A renders exactly as it does
 * today ("nothing in this band is re-ordered").
 */
export const BAND_TITLES: Record<BandId, string | null> = {
  identify: null,
  discover: 'Discover',
  today: 'Today',
};

/**
 * The DISCOVER band (v33 §E/§F3b, owner 10-04). The "Find any song" search entry
 * used to sit INSIDE band A, beside the hum row — the owner's device note was
 * that the search field "does not fit the flow there". It now has its own band
 * directly under the Listen/Hum pair, so search is reachable without entering
 * the hum flow and the hum block contains only the two listening doors.
 */
export const DISCOVER_BAND_NOTE =
  'Know the name? Search the library and the official sheet music.';


/** The container style every band's `<View>` uses (the source guard's marker). */
export const BAND_CONTAINER_STYLE = 'styles.band';
/** The small caption style for a band heading. */
export const BAND_TITLE_STYLE = 'styles.bandTitle';
/** The wrapping chip row inside a band. */
export const BAND_CHIP_ROW_STYLE = 'styles.bandChipRow';

/**
 * Everything a band entry can land on. These are (screen, entry-point) pairs, not
 * raw screen names: two entries that open the same screen from different jobs are
 * still one destination each, which is what makes "one meaning per entry"
 * checkable.
 */
export type DestinationId =
  | 'identify' // the ONE hero button — runs the hybrid pipeline
  | 'hum-search' // HumSearchScreen
  | 'find-piece' // FindPieceScreen (title/artist search + retailer section)
  | 'today-sheet' // the score reader for today's curated score
  | 'today-piece' // today's piece page (where the coach lives)
  | 'library' // the Library tab
  | 'medals' // AchievementsScreen
  | 'practice-week'; // PracticeWeekScreen

/** The entry's shape in the model. */
export type BandItemKind = 'hero' | 'row' | 'chip' | 'card' | 'note';

/**
 * The JOB an entry does. Two entries may share a destination only inside one
 * group (see `oneMeaningPerCard`): the search group deliberately offers the same
 * screen as a compact chip, a full row and facet chips.
 */
export type EntryGroup =
  | 'identify'
  | 'hum'
  | 'search'
  | 'today'
  | 'library'
  | 'retention';

export interface BandItem {
  /** Stable id — two entries never share one. */
  id: string;
  kind: BandItemKind;
  label: string;
  accessibilityLabel: string;
  /** Where a tap lands; `null` for a heading/state chip (nothing to promise). */
  destination: DestinationId | null;
  entryGroup: EntryGroup;
  /** The band's own primary action (only band A's hero sets this). */
  primary?: boolean;
}

export interface FrontDoorBand {
  id: BandId;
  title: string | null;
  items: BandItem[];
}

/**
 * A destination that MORE THAN ONE entry may carry, with the reason. Everything
 * else in the model must be claimed exactly once: that is the audit's "one
 * meaning each" rule made checkable.
 *
 * `find-piece` is the door's single free search entry, deliberately reachable
 * from the compact chip beside the hum row (band A), the full search row and the
 * facet chips (band C), and — honestly — from band B's card when the catalog did
 * not load. Every such entry declares the `search` job group.
 */
export const SHARED_DESTINATIONS: readonly DestinationId[] = ['find-piece'];

// ────────────────────── the chip / band copy constants ─────────────────────

/** The honest library note under band A (the recognition library IS small). */
export const FRONT_DOOR_BETA_NOTE =
  'Beta: our recognition library is still growing — well-known classical melodies match best; not every song will match yet.';

/** Band B's ONE card: the title, exactly as the audit worded it. */
export const TODAY_CARD_TITLE = "Today's piece — practice it";
/** Band B's CTA when today's piece loaded (its destination decides the tap). */
export const TODAY_CARD_CTA = "Open today's piece →";
/** The honest line when the catalog did not load — never an empty band. */
export const TODAY_CARD_UNAVAILABLE_BODY =
  "Couldn't reach today's piece — check your connection. The search below works either way.";

/** The Discover band's free-library row.
 *
 *  v45 slice 2 (owner 10-26): this row was band C's, and it MOVED into Discover
 *  with the rest of band C's non-search content. Nothing was deleted: the row,
 *  its hint, its accessibility label and the honest beta note under it all render
 *  exactly as before — one band higher up the door. */
export const BROWSE_LIBRARY_LABEL = 'Browse the free library';
/** …and the one honest line about what is behind it. */
export const BROWSE_LIBRARY_HINT =
  'Public-domain scores you can open and practice right now';
/** What a screen reader hears for the free-library row. */
export const BROWSE_LIBRARY_ACCESSIBILITY_LABEL =
  'Browse the free library — public-domain scores you can open and practice right now';

/**
 * BAND C's DUPLICATE SEARCH ROW — retired by the v45 fold.
 *
 * Band C used to lead with a "Search by title or composer" row (label read from
 * `frontDoor.FIND_PIECE_ENTRY_HINT`) that opened the very screen the slice-1
 * "Find a song" bar already opens. Two search entries on one Home screen is the
 * defect the owner's one-search-bar call removes, so the ROW is dropped and the
 * BAR is kept: `FIND_PIECE_ENTRY_HINT` itself is unchanged and still the search
 * wording the bar/FindPiece surface use.
 */

/** The retention entries' labels (owner 10-26: they now live in SETTINGS).
 *  `MEDALS_CHIP_LABEL` is the entry's job name; the surface renders the medal
 *  summary line itself from medals.ts (ACHIEVEMENTS_ENTRY_LABEL / _HINT), which is
 *  the same entry the quiet-achievements contract in src/services/medals.ts
 *  asserts — one entry, so it is not retyped here. */
export const MEDALS_CHIP_LABEL = '🏅 Achievements';
export const WEEK_CHIP_LABEL = '📋 This Week';
/** What a screen reader hears for the This-Week entry. */
export const WEEK_CHIP_ACCESSIBILITY_LABEL =
  'This week — see the days you practised';

/** The streak chip's state text: the true number, or the invitation to start. */
export function streakChipCopy(currentDays: number | null | undefined): string {
  return typeof currentDays === 'number' &&
    Number.isFinite(currentDays) &&
    currentDays > 0
    ? `🔥 ${Math.round(currentDays)}-day streak`
    : 'Start your streak today!';
}

/** The week chip's state text — the same wording the week surface uses. */
export function weekChipCopy(
  current: number | null | undefined,
  target: number | null | undefined,
  complete: boolean | undefined,
): string {
  const cur = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const tgt = typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : 5;
  return `${weekProgressCopy(cur, tgt)}${complete ? ' 🎉' : ''}`;
}

// ──────────────────── the facets inside band C (breadth) ───────────────────

export interface BandFacetInput {
  /** A screen surfaces the free guitar/keyboard public-domain batch. */
  guitarContentAvailable: boolean;
  /** The retailer/search route exists (FindPieceScreen + searchExternal). */
  searchAvailable: boolean;
  /** The free catalog exists (the Library tab + FindPieceScreen's browse). */
  libraryAvailable: boolean;
}

export interface BandFacet {
  id: 'free-classical' | 'guitar-keyboard' | 'any-song';
  label: string;
  /** What real content backs this facet — the honesty claim, in words. */
  backedBy: string;
  /** The flag that must be true for the facet to render. */
  flag: keyof BandFacetInput;
  destination: DestinationId;
}

/**
 * Whether the free GUITAR/KEYBOARD public-domain batch may be shown on the door.
 *
 * FALSE TODAY, and the reason is NOT "we have not built it": the batch EXISTS —
 * `PD_GUITAR_CATALOG` + `gateGuitarSheet()` (audited, gate-cleared) — but NO
 * screen surfaces it (only scripts/pdGuitarCatalog.test.ts imports it; verified
 * 10-02). Rendering a facet before its content is wired is exactly the "coming
 * soon" promise the re-flow deletes, and the plan's standing rule is that
 * "guitar tabs claims stay gated on real sources".
 *
 * Wiring the batch later is this constant plus the guard:
 * `bandFacetsAreBackedByRealContent()` refuses the guitar facet until a real
 * screen source imports the catalog, so a bare flip of this constant fails the
 * gate instead of shipping a promise.
 */
export const guitarContentAvailable = false;

/** Band C's facet chips, in render order. Each names the content behind it. */
export const BAND_FACETS: readonly BandFacet[] = [
  {
    id: 'free-classical',
    label: '🎼 Free classical & public-domain',
    backedBy: 'the catalog browse (/api/pieces, FindPieceScreen)',
    flag: 'libraryAvailable',
    destination: 'find-piece',
  },
  {
    id: 'guitar-keyboard',
    label: '🎸 Guitar & keyboard',
    backedBy: 'PD_GUITAR_CATALOG + gateGuitarSheet() — gated until a screen surfaces it',
    flag: 'guitarContentAvailable',
    destination: 'find-piece',
  },
  {
    id: 'any-song',
    label: '🛒 Any song → official sheet music',
    backedBy: 'the search external section (SMD affiliate 67650) + the chip',
    flag: 'searchAvailable',
    destination: 'find-piece',
  },
];

/** The flags the door ships with: the guitar facet is OFF (its content is unwired). */
export const FRONT_DOOR_FACET_FLAGS: BandFacetInput = {
  guitarContentAvailable,
  searchAvailable: true,
  libraryAvailable: true,
};

/** The facet chips that render for these flags, in order. */
export function bandFacets(input: BandFacetInput): BandFacet[] {
  return BAND_FACETS.filter((facet) => input[facet.flag] === true);
}

/** True when a SURFACE's source imports the guitar catalog (a test file does not
 *  count — a surfacing claim needs a UI behind it). The caller passes the app's
 *  screen/component sources; the walk is comment-masked. */
export function guitarCatalogIsSurfaced(appSource: string): boolean {
  const masked = maskComments(appSource);
  return (
    /from\s+'[^']*pdGuitarCatalog'/.test(masked) ||
    /\bPD_GUITAR_CATALOG\b/.test(masked)
  );
}

/**
 * Every facet the door renders must be backed by content that exists.
 *
 * The guitar facet is the one whose backing content is NOT wired yet, so it may
 * render ONLY when the app source proves a screen imports the catalog. With no
 * source supplied the honest answer is "cannot prove it", so a guitar facet in
 * the input fails — which is precisely the mutation this guard exists for
 * (flip `guitarContentAvailable` alone → the gate goes red).
 */
export function bandFacetsAreBackedByRealContent(
  input: BandFacetInput,
  appSource?: string,
): boolean {
  const rendered = bandFacets(input);
  for (const facet of rendered) {
    if (facet.destination === null || facet.backedBy.trim().length === 0) return false;
  }
  const guitar = rendered.some((facet) => facet.id === 'guitar-keyboard');
  if (!guitar) return true;
  if (typeof appSource !== 'string' || appSource.length === 0) return false;
  return guitarCatalogIsSurfaced(appSource);
}

// ───────────────────── band B: today's ONE destination ─────────────────────

/** Band B's card destination, through the ONE mapping (homeCards). */
export function todayCardDestination(
  challenge: PracticeTodayChallenge | null | undefined,
): 'sheet' | 'piece' | 'find-piece' {
  return practiceTodayDestination(challenge);
}

/** …mapped onto the band model's destination ids. */
export function todayCardBandDestination(
  challenge: PracticeTodayChallenge | null | undefined,
): DestinationId {
  switch (todayCardDestination(challenge)) {
    case 'sheet':
      return 'today-sheet';
    case 'piece':
      return 'today-piece';
    default:
      return 'find-piece';
  }
}

/** The card's CTA line — it can never promise a reader the tap would not open. */
export function todayCardCta(
  challenge: PracticeTodayChallenge | null | undefined,
): string {
  return todayCardDestination(challenge) === 'find-piece'
    ? featuredPieceCta(challenge) || FIND_PIECE_CTA
    : TODAY_CARD_CTA;
}

/** What a screen reader hears for band B's card: the piece AND the destination. */
export function todayCardAccessibilityLabel(
  challenge: PracticeTodayChallenge | null | undefined,
): string {
  const title =
    typeof challenge?.title === 'string' ? challenge.title.trim() : '';
  if (!title) return 'Today’s piece — find a piece to practice today';
  return `Today’s piece — practice ${title}`;
}

// ──────────────── the retention entries (band B card + Settings) ───────────

export interface RetentionState {
  currentDays?: number | null;
  weekCurrent?: number | null;
  weekTarget?: number | null;
  weekComplete?: boolean;
}

/**
 * Which surface a retention entry belongs to.
 *
 * v45 slice 2 (OWNER CALL 10-26): the three chips that used to close band C —
 * the streak STATE, 🏅 Achievements and 📋 This Week — are OFF the front door and
 * into SETTINGS (`retentionChipsAreInSettings` enforces it on the real sources).
 * The band B card keeps its streak/week STATE, which is why `today-card` stays.
 */
export type RetentionWhere = 'today-card' | 'settings';

export interface RetentionChip {
  id: 'streak-state' | 'week-state' | 'achievements' | 'practice-week';
  where: RetentionWhere;
  label: string;
  accessibilityLabel: string;
  /** `null` = pure state, not a tap. A state chip promises nothing. */
  destination: DestinationId | null;
  entryGroup: EntryGroup;
}

/**
 * Every retention entry, for both surfaces, from ONE state object:
 *   • inside band B's card — the streak and week STATE, so retention stays
 *     visible without competing (they are state, so they have no destination);
 *   • in Settings — the same streak state (visible, never a tap) beside the two
 *     real destinations (medals, the practice week), each of which Settings
 *     renders as a row that opens its screen.
 */
export function retentionChips(state: RetentionState = {}): RetentionChip[] {
  const streak = streakChipCopy(state.currentDays);
  const week = weekChipCopy(state.weekCurrent, state.weekTarget, state.weekComplete);
  return [
    {
      id: 'streak-state',
      where: 'today-card',
      label: streak,
      accessibilityLabel: streak,
      destination: null,
      entryGroup: 'retention',
    },
    {
      id: 'week-state',
      where: 'today-card',
      label: week,
      accessibilityLabel: week,
      destination: null,
      entryGroup: 'retention',
    },
    {
      id: 'streak-state',
      where: 'settings',
      label: streak,
      accessibilityLabel: streak,
      destination: null,
      entryGroup: 'retention',
    },
    {
      id: 'achievements',
      where: 'settings',
      label: MEDALS_CHIP_LABEL,
      accessibilityLabel: 'Open your achievements and medals',
      destination: 'medals',
      entryGroup: 'retention',
    },
    {
      id: 'practice-week',
      where: 'settings',
      label: WEEK_CHIP_LABEL,
      accessibilityLabel: WEEK_CHIP_ACCESSIBILITY_LABEL,
      destination: 'practice-week',
      entryGroup: 'retention',
    },
  ];
}

// ───────────────────────── the bands themselves ────────────────────────────

export interface FrontDoorBandInput {
  challenge?: PracticeTodayChallenge | null;
  retention?: RetentionState;
  facets?: BandFacetInput;
}

/** Band A — identify. The equal-split hero pair, in its existing order. */
function identifyItems(): BandItem[] {
  return [
    {
      id: 'hero-identify',
      kind: 'hero',
      // v44 (owner 10-22): the hero is the LEFT panel of the equal split.
      label: HOME_SPLIT_LISTEN_TITLE,
      accessibilityLabel: HOME_SPLIT_LISTEN_A11Y,
      destination: 'identify',
      entryGroup: 'identify',
      primary: true,
    },
    {
      id: 'hum-entry',
      // v44 equal split (owner 10-22): hum is the RIGHT panel — a true PEER of
      // Listen (same box, same fill weight, same affordance), not the navy
      // sibling card under the hero, and not the quiet text row before that.
      kind: 'card',
      label: HOME_SPLIT_HUM_TITLE,
      accessibilityLabel: HOME_SPLIT_HUM_A11Y,
      destination: 'hum-search',
      entryGroup: 'hum',
    },
    {
      id: 'beta-note',
      kind: 'note',
      label: FRONT_DOOR_BETA_NOTE,
      accessibilityLabel: FRONT_DOOR_BETA_NOTE,
      destination: null,
      entryGroup: 'identify',
    },
  ];
}

/**
 * The DISCOVER band — the search entry, out of the Listen/Hum block (v33 §E § —
 * owner 10-04: the search bar under hum/whistle "does not fit the flow there").
 *
 * v45 slice 2 (owner 10-26): Discover is now the door's ONE browse surface as
 * well as its one search entry. The free-library row, the facet chips and the
 * money facet ("🛒 Any song → official sheet music") moved up here from the
 * retired band C, so the model mirrors the screen: ONE search entry (the bar),
 * then the rows a browser wants. The ONE entry the fold DROPPED is band C's own
 * "Search by title or composer" row — it opened the same screen this bar opens,
 * and two search entries on one door is the defect the fold removes.
 */
function discoverItems(input: FrontDoorBandInput): BandItem[] {
  const flags = input.facets ?? FRONT_DOOR_FACET_FLAGS;
  const items: BandItem[] = [
    {
      id: 'find-any-song',
      kind: 'row',
      label: FIND_ANY_SONG_CHIP_LABEL,
      accessibilityLabel: FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL,
      destination: FIND_ANY_SONG_DESTINATION,
      entryGroup: 'search',
    },
  ];
  // Breadth, honestly — only the facets whose content exists today. Each opens
  // the same FindPieceScreen the bar opens (the money facet included).
  for (const facet of bandFacets(flags)) {
    items.push({
      id: `facet-${facet.id}`,
      kind: 'chip',
      label: facet.label,
      accessibilityLabel: facet.label,
      destination: facet.destination,
      entryGroup: 'search',
    });
  }
  // The free library (moved up from band C, owner 10-26).
  items.push({
    id: 'browse-library',
    kind: 'row',
    label: BROWSE_LIBRARY_LABEL,
    accessibilityLabel: `${BROWSE_LIBRARY_LABEL} — ${BROWSE_LIBRARY_HINT}`,
    destination: 'library',
    entryGroup: 'library',
  });
  return items;
}

/** Band B — today: EXACTLY one card, one destination. */
function todayItems(input: FrontDoorBandInput): BandItem[] {
  const destination = todayCardBandDestination(input.challenge);
  return [
    {
      id: 'today-piece',
      kind: 'card',
      label: TODAY_CARD_TITLE,
      accessibilityLabel: todayCardAccessibilityLabel(input.challenge),
      destination,
      // With no catalog the card IS the search entry (that is where the ONE
      // destination function sends it), so it declares the search job group.
      entryGroup: destination === 'find-piece' ? 'search' : 'today',
    },
  ];
}

/**
 * The three bands, A → Discover → Today, with their items resolved for this
 * state. Band C ("Browse & keep going") is not a band any more (v45 slice 2,
 * owner 10-26): its rows live inside Discover and its retention chips live in
 * Settings.
 */
export function bandBandsFor(input: FrontDoorBandInput = {}): FrontDoorBand[] {
  return [
    { id: 'identify', title: BAND_TITLES.identify, items: identifyItems() },
    { id: 'discover', title: BAND_TITLES.discover, items: discoverItems(input) },
    { id: 'today', title: BAND_TITLES.today, items: todayItems(input) },
  ];
}

// ─────────────────────────── the band contracts ────────────────────────────

function allItems(bands: readonly FrontDoorBand[]): BandItem[] {
  const out: BandItem[] = [];
  for (const band of bands) out.push(...band.items);
  return out;
}

/**
 * The five overlapping "practice" cards the audit found on the door and this
 * re-flow retires: the standing streak card, "⏱️ Practice today", "📋 This Week",
 * "🌟 Today's Featured Piece" and "🎯 For You". Their styles are gone from
 * HomeScreen entirely, so re-adding any one of them — the card AND its style —
 * is caught by scanning the real source for these markers.
 */
export const RETIRED_DOOR_CARD_STYLES: readonly string[] = [
  'styles.streakCard',
  'styles.practiceCard',
  'styles.goalCard',
  'styles.challengeCard',
  'styles.forYouCard',
];

/**
 * ONE MEANING PER CARD — the audit's core complaint.
 *
 * It accepts either the band MODEL (`FrontDoorBand[]`) or the real SCREEN SOURCE
 * (a string), because the defect it guards was half model and half JSX: the
 * model half is "band B is exactly one card and no destination is claimed twice",
 * the source half is "the container really holds one tap and none of the five
 * retired cards came back". The mutation probes in
 * scripts/frontDoorBands.test.ts exercise both halves on the REAL HomeScreen.
 */
export function oneMeaningPerCard(
  input: readonly FrontDoorBand[] | string,
): boolean {
  return typeof input === 'string'
    ? oneMeaningPerCardSource(input)
    : oneMeaningPerCardModel(input);
}

function oneMeaningPerCardModel(bands: readonly FrontDoorBand[]): boolean {
  const today = bands.find((band) => band.id === 'today');
  if (!today) return false;
  const todayCards = today.items.filter((item) => item.kind === 'card');
  if (todayCards.length !== 1) return false;
  if (today.items.length !== 1) return false;

  const cards = allItems(bands).filter((item) => item.kind === 'card');
  for (const card of cards) {
    if (card.destination === null) return false;
  }
  // No two cards anywhere claim the same destination.
  const cardDestinations = new Set<string>();
  for (const card of cards) {
    const key = String(card.destination);
    if (cardDestinations.has(key)) return false;
    cardDestinations.add(key);
  }

  // Anything crossing a band boundary must either be unique or be a declared
  // shared destination that keeps to a single job group.
  const groupsByDestination = new Map<string, Set<string>>();
  const bandsByDestination = new Map<string, Set<BandId>>();
  for (const band of bands) {
    for (const item of band.items) {
      if (item.destination === null) continue;
      const key = String(item.destination);
      const groups = groupsByDestination.get(key) ?? new Set<string>();
      groups.add(item.entryGroup);
      groupsByDestination.set(key, groups);
      const seenBands = bandsByDestination.get(key) ?? new Set<BandId>();
      seenBands.add(band.id);
      bandsByDestination.set(key, seenBands);
    }
  }
  for (const [destination, seenBands] of bandsByDestination) {
    if (seenBands.size <= 1) continue;
    if (!SHARED_DESTINATIONS.includes(destination as DestinationId)) return false;
    const groups = groupsByDestination.get(destination);
    if (!groups || groups.size !== 1) return false;
  }
  return true;
}

/** The source half of `oneMeaningPerCard`. */
function oneMeaningPerCardSource(source: string): boolean {
  const masked = maskComments(source);
  // None of the retired practice cards is back, anywhere on the screen (with its
  // style gone from the stylesheet too, a re-added card cannot hide).
  for (const style of RETIRED_DOOR_CARD_STYLES) {
    if (masked.indexOf(style) >= 0) return false;
  }
  // Band B is ONE card: exactly one tap inside the container, carrying the
  // band-B card style.
  const b = bandRegion(source, 'today');
  if (!b) return false;
  if (b.indexOf('styles.todayCard') < 0) return false;
  const taps = b.match(/onPress=\{/g) ?? [];
  if (taps.length !== 1) return false;
  return true;
}

/** The band containers, in the order the real screen renders them. The screen
 *  tags each container with `testID={BAND_TEST_IDS.<id>}`, so the marker is the
 *  REFERENCE (a typo in the id fails type-check, not silently the scan). */
export function bandMarker(id: BandId): string {
  return `BAND_TEST_IDS.${id}`;
}

export function bandOrderFromSource(source: string): BandId[] {
  const masked = maskComments(source);
  const found: { id: BandId; at: number }[] = [];
  for (const id of BAND_ORDER as readonly BandId[]) {
    const at = masked.indexOf(bandMarker(id));
    if (at >= 0) found.push({ id, at });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.id);
}

/**
 * The band order the door must render, in ONE place: band A (the two listening
 * doors), the Discover band (search + the browse rows), Today (practice).
 *
 * v45 slice 2 (owner 10-26): THREE bands. Band C came out of this list with the
 * fold; `RETIRED_BAND_MARKER` is what keeps it from creeping back.
 */
export const BAND_ORDER: readonly BandId[] = ['identify', 'discover', 'today'];

/** The marker that CLOSES the last band's region: everything after it is the
 *  door's footer, not the band. Without it, "band B holds one tap" would be
 *  asserting over the whole rest of the file. */
export const BAND_TRAILER_MARKER = 'styles.bottomSpacer';

/** The source slice of one band's container ('' when the band is absent). */
export function bandRegion(source: string, id: BandId): string {
  const masked = maskComments(source);
  const start = masked.indexOf(bandMarker(id));
  if (start < 0) return '';
  const nextIds: BandId[] = BAND_ORDER.slice(BAND_ORDER.indexOf(id) + 1);
  let end = masked.length;
  for (const next of nextIds) {
    const at = masked.indexOf(bandMarker(next), start + 1);
    if (at > start && at < end) end = at;
  }
  // The footer ends the LAST band; so would a re-added (retired) band C.
  const trailer = masked.indexOf(BAND_TRAILER_MARKER, start + 1);
  if (trailer > start && trailer < end) end = trailer;
  const retired = masked.indexOf(RETIRED_BAND_MARKER, start + 1);
  if (retired > start && retired < end) end = retired;
  return masked.slice(start, end);
}

/**
 * BAND ORDER + BAND IDENTITY, on the REAL screen source (v45 slice 2 rewrite,
 * re-pointed for v46).
 *
 * Three band containers render on the DOOR in the order A → Discover → Today,
 * and nothing else renders as a band:
 *   • band A holds the one hero button and the hum SIBLING CARD, and NOT the
 *     search entry — the search field is not inside the Listen/Hum block;
 *   • the Discover band on the door holds the door's ONE search entry (the
 *     "Find a song" bar) and NOTHING ELSE — v46 moved the folded browse block
 *     off the door onto the Discover surface (src/screens/FindPieceScreen.tsx),
 *     which is what "Home and Discover are one page" was about;
 *   • band B ("Today") holds its one card.
 *
 * The fold's rows are NOT deleted, they MOVED, so this guard now reads BOTH
 * files: `homeSource` for the door's bands, `discoverSource` (FindPieceScreen)
 * for the facet chips (free classical / any song → official sheet music), the
 * free-library row (→ the Library tab) and the honest beta note under that row.
 * A row that vanished from both is still a failure — that half survives intact.
 *
 * The two negative halves are the point of the rewrite: NO retired band C (no
 * `BAND_TEST_IDS.browse` container, no "Browse & keep going" heading, no
 * `styles.findPieceBtn` row) and NO second search entry anywhere on the door
 * (the bar is the only one), plus — v46 — NO browse block back on the door
 * itself (the door's Discover region may not carry the chips or the row).
 */
export function bandOrderIsIdentifyDiscoverToday(
  homeSource: string,
  discoverSource: string,
): boolean {
  const masked = maskComments(homeSource);
  const order = bandOrderFromSource(homeSource);
  if (order.length !== BAND_ORDER.length) return false;
  if (order.join('|') !== BAND_ORDER.join('|')) return false;

  // ── the retired band C is really gone (marker, heading and its row style) ──
  if (masked.indexOf(RETIRED_BAND_MARKER) >= 0) return false;
  if (masked.indexOf(RETIRED_BAND_TITLE) >= 0) return false;
  if (masked.indexOf('styles.findPieceBtn') >= 0) return false;

  // ── band A ──
  const a = bandRegion(homeSource, 'identify');
  if (!a) return false;
  // The hero button lives in band A …
  if (a.indexOf('styles.recognitionBtn') < 0) return false;
  if (a.indexOf('onPress={handleHeroTap}') < 0) return false;
  // … and band A is nothing but the hero card + the hum sibling card + the note.
  const retiredStyles = RETIRED_DOOR_CARD_STYLES;
  for (const style of retiredStyles) {
    if (a.indexOf(style) >= 0) return false;
  }
  // The hum SIBLING CARD is in band A, after the hero …
  if (a.indexOf('styles.humEntryBtn') < 0) return false;
  if (a.indexOf('onPress={handleHumEntry}') < a.indexOf('onPress={handleHeroTap}')) return false;
  // … and the SEARCH entry is NOT: it lives in the Discover band (owner 10-04).
  if (a.indexOf('styles.findASongBar') >= 0) return false;

  // ── the Discover band ON THE DOOR: the ONE search entry, and nothing else ──
  const d = bandRegion(homeSource, 'discover');
  if (d.length < 40) return false;
  if (d.indexOf('styles.findASongBar') < 0) return false;
  if (d.indexOf('onPress={handleFindAnySong}') < 0) return false;
  // v46: the folded browse block is NOT on the door any more — the chips and the
  // free-library row belong to the Discover surface (asserted below), so a band
  // that carries them again is the one-page door coming back.
  if (d.indexOf('styles.bandChip') >= 0) return false;
  if (d.indexOf('facets.map(') >= 0) return false;
  if (d.indexOf('styles.browseLibraryRow') >= 0) return false;
  if (d.indexOf('{FRONT_DOOR_BETA_NOTE}') >= 0) return false;

  // ── …and the rows the fold moved are STILL WIRED, on their new host ──
  // The host must be the real Discover surface, not any file that happens to
  // carry the strings: the hosting half is guarded by v46DiscoverHosting.
  const discover = maskComments(discoverSource);
  if (discover.length < 4000) return false;
  // The facet chips (the money facet included) — every chip has a destination.
  if (discover.indexOf('styles.bandChip') < 0) return false;
  if (discover.indexOf('facets.map(') < 0) return false;
  if (discover.indexOf('onPress={() => handleFacetChip(facet.id)}') < 0) return false;
  // The free-library row …
  if (discover.indexOf('styles.browseLibraryRow') < 0) return false;
  if (discover.indexOf('onPress={handleBrowseLibrary}') < 0) return false;
  // … carrying the honest library note WITH it (it left band A in v45 slice 1 and
  // may not be dropped on the way into Discover).
  if (discover.indexOf('{FRONT_DOOR_BETA_NOTE}') < 0) return false;

  // ── one search entry on the whole door, never two ──
  const barOpenings = (masked.match(/style=\{styles\.findASongBar\}/g) ?? []).length;
  if (barOpenings !== 1) return false;

  // ── band B: one card, one tap ──
  const b = bandRegion(homeSource, 'today');
  if (b.length < 40) return false;
  if (b.indexOf('styles.todayCard') < 0) return false;
  return true;
}

/**
 * THE RETENTION CHIPS LIVE IN SETTINGS (owner call 10-26).
 *
 * The three chips that used to close band C — the streak STATE (never a tap),
 * 🏅 Achievements and 📋 This Week — are off the front door. The owner's call
 * moved them rather than deleting them, so this asserts BOTH halves on the real
 * sources:
 *   • Home no longer renders any of them (no `styles.achievementsCard` chip, no
 *     `styles.bandChipButton` This-Week chip, none of the three labels);
 *   • Settings renders all three — the streak as a visible STATE line and the
 *     other two as rows whose labels come from this module — and each of the two
 *     real entries OPENS its screen (a row that opens nothing is the dead end
 *     the brief forbids).
 *
 * `settingsSource` is src/screens/SettingsScreen.tsx; `homeSource` is
 * src/screens/HomeScreen.tsx.
 */
export function retentionChipsAreInSettings(
  settingsSource: string,
  homeSource: string,
): boolean {
  const settings = maskComments(settingsSource);
  const home = maskComments(homeSource);
  if (settings.length < 4000) return false;
  if (home.length < 5000) return false;

  // ── Home: none of the three chips is on the front door any more ──
  if (home.indexOf('styles.achievementsCard') >= 0) return false;
  if (home.indexOf('styles.bandChipButton') >= 0) return false;
  if (home.indexOf('MEDALS_CHIP_LABEL') >= 0) return false;
  if (home.indexOf('WEEK_CHIP_LABEL') >= 0) return false;

  // ── Settings: the labels come from this module (one source of copy) ──
  if (settings.indexOf('MEDALS_CHIP_LABEL') < 0) return false;
  if (settings.indexOf('WEEK_CHIP_LABEL') < 0) return false;
  // The streak is VISIBLE as state, from the same copy function the door used.
  if (settings.indexOf('streakChipCopy(') < 0) return false;
  // Both real entries are rows in one card, and each one opens its screen.
  if (settings.indexOf('styles.retentionCard') < 0) return false;
  if (settings.indexOf('onPress={handleOpenAchievements}') < 0) return false;
  if (settings.indexOf('onPress={handleOpenPracticeWeek}') < 0) return false;
  if (settings.indexOf('setShowAchievements(true)') < 0) return false;
  if (settings.indexOf('setShowPracticeWeek(true)') < 0) return false;
  // …and the screens are really mounted behind those flags (BACK included).
  if (!/if \(showAchievements\)/.test(settings)) return false;
  if (!/if \(showPracticeWeek\)/.test(settings)) return false;
  if (!/<AchievementsScreen[\s\S]{0,300}?onClose=\{\s*\(\)\s*=>\s*setShowAchievements\(false\)/.test(settings)) {
    return false;
  }
  if (!/<PracticeWeekScreen[\s\S]{0,400}?onClose=\{\s*\(\)\s*=>\s*setShowPracticeWeek\(false\)/.test(settings)) {
    return false;
  }
  return true;
}

// ─────────────────────────── zero-promise scan ─────────────────────────────

/**
 * The §E banned list, as it applies to BAND copy. A band entry either does
 * something or it is not there: no passive "coming soon" box, no "check back
 * soon", no "we're still curating", and no personalisation claim (the removed
 * "🎯 For You" card's whole promise).
 */
export const BANNED_BAND_PROMISES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /coming soon/i, why: 'the passive "coming soon" box (§E.3)' },
  { pattern: /check back soon/i, why: 'a promise to return, with no action' },
  { pattern: /\bsoon\b/i, why: 'the word "soon" as a substitute for content' },
  { pattern: /still curating/i, why: 'a promise of curation that has not happened' },
  { pattern: /we'?re still/i, why: 'an apology in place of an action' },
  { pattern: /\bfor you\b/i, why: 'the retired "For You" personalisation claim' },
  { pattern: /picks for/i, why: 'a personalised-picks claim the door cannot honour' },
  { pattern: /personali[sz]ed/i, why: 'personalisation the door does not do' },
];

/** The declaration block of the banned list, removed before a scan so the module
 *  that DECLARES the banned words is not its own offender. Nothing else is
 *  exempt: the band copy is scanned in full. */
function withoutBannedDeclaration(masked: string): string {
  const marker = 'export const BANNED_BAND_PROMISES';
  const start = masked.indexOf(marker);
  if (start < 0) return masked;
  const end = masked.indexOf('];', start);
  return masked.slice(0, start) + masked.slice(end < 0 ? masked.length : end + 2);
}

/** Zero-promise scan for band copy (comments masked, so documentation is free). */
export function noPromiseChips(source: string): boolean {
  const masked = withoutBannedDeclaration(maskComments(source));
  return BANNED_BAND_PROMISES.every((banned) => !banned.pattern.test(masked));
}
