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
 * copy constants from here so its `findAnySongChipWired()` guard can compare the
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
  HERO_TITLE,
  HUM_SECONDARY_CTA,
} from './frontDoor';

// ─────────────────── the "Find any song" chip (bundle B) ───────────────────

/**
 * The chip that sits BESIDE the hum row on the front door (owner sign-off (b):
 * a low-weight "Find any song" chip beside the hum row). It is the compact way
 * into the find-a-song search, which is the door's own money path: a real text
 * field, the internal free catalog, and the "Official sheet music" retailer
 * cards in EVERY query state (PR #142).
 *
 * HONEST LIMIT (spec §B.1): this chip opens the TITLE/ARTIST SEARCH, not the
 * recording door (`ModernSearchScreen`, which has its own recorder). It must
 * therefore never claim to identify a recording — that sentence belongs to
 * HUM_TO_MODERN_BLURB / the modern door. `chipDoesNotClaimRecordingRecognition()`
 * freezes that, with the blurb itself as the negative fixture.
 */
export const FIND_ANY_SONG_CHIP_LABEL = '🔎 Find any song';
/** The supporting line inside the chip: what the search actually holds. */
export const FIND_ANY_SONG_CHIP_HINT =
  'Search by title or artist — free scores, or the official sheet music';
/** What a screen reader hears for the chip (identity + real destination). */
export const FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL =
  'Find any song — search by title or artist for free scores or the official sheet music';

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

/** The three bands, in the order they render (A → B → C). */
export type BandId = 'identify' | 'today' | 'browse';

/** A stable id per band — the source-scan guard finds the containers by it. */
export const BAND_TEST_IDS: Record<BandId, string> = {
  identify: 'band-identify',
  today: 'band-today',
  browse: 'band-browse',
};

/**
 * The visible band headings. Band A carries NONE on purpose: the hero card is
 * self-evident and the owner's rule is that band A renders exactly as it does
 * today ("nothing in this band is re-ordered").
 */
export const BAND_TITLES: Record<BandId, string | null> = {
  identify: null,
  today: 'Today',
  browse: 'Browse & keep going',
};

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

/** Band C: the row that IS the search entry (the field is one tap away).
 *
 *  It reads the front door's OWN search wording (`frontDoor.FIND_PIECE_ENTRY_HINT`)
 *  through a function rather than a top-level constant: frontDoor.ts imports this
 *  module's chip copy, so a top-level initialiser that read back across the cycle
 *  would evaluate to `undefined` depending on load order. */
export function searchRowLabel(): string {
  return FIND_PIECE_ENTRY_HINT;
}
/** Band C: the free library row. */
export const BROWSE_LIBRARY_LABEL = 'Browse the free library';
/** …and the one honest line about what is behind it. */
export const BROWSE_LIBRARY_HINT =
  'Public-domain scores you can open and practice right now';
/** What a screen reader hears for the free-library row. */
export const BROWSE_LIBRARY_ACCESSIBILITY_LABEL =
  'Browse the free library — public-domain scores you can open and practice right now';

/** Band C's retention chips (state + the two real destinations).
 *  `MEDALS_CHIP_LABEL` is the chip's job name; the screen renders the medal
 *  summary line itself from medals.ts (ACHIEVEMENTS_ENTRY_LABEL / _HINT), which is
 *  the same entry the quiet-achievements contract in src/services/medals.ts
 *  asserts — one entry, so it is not retyped here. */
export const MEDALS_CHIP_LABEL = '🏅 Achievements';
export const WEEK_CHIP_LABEL = '📋 This Week';
/** What a screen reader hears for the This-Week chip. */
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

// ──────────────── the retention chips (band B card + band C row) ───────────

export interface RetentionState {
  currentDays?: number | null;
  weekCurrent?: number | null;
  weekTarget?: number | null;
  weekComplete?: boolean;
}

/** Which surface a retention chip belongs to. */
export type RetentionWhere = 'today-card' | 'browse';

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
 * Every retention chip, for both surfaces, from ONE state object:
 *   • inside band B's card — the streak and week STATE, so retention stays
 *     visible without competing (they are state, so they have no destination);
 *   • in band C's chip row — the same streak state beside the two real
 *     destinations (medals, the practice week).
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
      where: 'browse',
      label: streak,
      accessibilityLabel: streak,
      destination: null,
      entryGroup: 'retention',
    },
    {
      id: 'achievements',
      where: 'browse',
      label: MEDALS_CHIP_LABEL,
      accessibilityLabel: 'Open your achievements and medals',
      destination: 'medals',
      entryGroup: 'retention',
    },
    {
      id: 'practice-week',
      where: 'browse',
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

/** Band A — identify. The hero card's entries, in their existing order. */
function identifyItems(): BandItem[] {
  return [
    {
      id: 'hero-identify',
      kind: 'hero',
      label: HERO_TITLE,
      accessibilityLabel: 'Identify the music playing around you',
      destination: 'identify',
      entryGroup: 'identify',
      primary: true,
    },
    {
      id: 'hum-entry',
      kind: 'row',
      label: HUM_SECONDARY_CTA,
      accessibilityLabel: HUM_SECONDARY_CTA,
      destination: 'hum-search',
      entryGroup: 'hum',
    },
    {
      id: 'find-any-song',
      kind: 'chip',
      label: FIND_ANY_SONG_CHIP_LABEL,
      accessibilityLabel: FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL,
      destination: FIND_ANY_SONG_DESTINATION,
      entryGroup: 'search',
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

/** Band C — browse + keep going. */
function browseItems(input: FrontDoorBandInput): BandItem[] {
  const flags = input.facets ?? FRONT_DOOR_FACET_FLAGS;
  const items: BandItem[] = [
    {
      id: 'search-row',
      kind: 'row',
      label: searchRowLabel(),
      accessibilityLabel: FIND_PIECE_ENTRY_LABEL,
      destination: 'find-piece',
      entryGroup: 'search',
    },
  ];
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
  items.push({
    id: 'browse-library',
    kind: 'row',
    label: BROWSE_LIBRARY_LABEL,
    accessibilityLabel: `${BROWSE_LIBRARY_LABEL} — ${BROWSE_LIBRARY_HINT}`,
    destination: 'library',
    entryGroup: 'library',
  });
  for (const chip of retentionChips(input.retention).filter(
    (c) => c.where === 'browse',
  )) {
    items.push({
      id: `chip-${chip.id}`,
      kind: 'chip',
      label: chip.label,
      accessibilityLabel: chip.accessibilityLabel,
      destination: chip.destination,
      entryGroup: chip.entryGroup,
    });
  }
  return items;
}

/** The three bands, A → B → C, with their items resolved for this state. */
export function bandBandsFor(input: FrontDoorBandInput = {}): FrontDoorBand[] {
  return [
    { id: 'identify', title: BAND_TITLES.identify, items: identifyItems() },
    { id: 'today', title: BAND_TITLES.today, items: todayItems(input) },
    { id: 'browse', title: BAND_TITLES.browse, items: browseItems(input) },
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
  for (const id of ['identify', 'today', 'browse'] as const) {
    const at = masked.indexOf(bandMarker(id));
    if (at >= 0) found.push({ id, at });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.id);
}

/** The source slice of one band's container ('' when the band is absent). */
export function bandRegion(source: string, id: BandId): string {
  const masked = maskComments(source);
  const start = masked.indexOf(bandMarker(id));
  if (start < 0) return '';
  const nextIds: BandId[] =
    id === 'identify'
      ? ['today', 'browse']
      : id === 'today'
        ? ['browse']
        : [];
  let end = masked.length;
  for (const next of nextIds) {
    const at = masked.indexOf(bandMarker(next), start + 1);
    if (at > start && at < end) end = at;
  }
  return masked.slice(start, end);
}

/**
 * BAND ORDER, on the REAL screen source: the three band containers render in the
 * order A → B → C, band A holds the one hero button and nothing else primary (no
 * card of the five the re-flow retires), band B really carries its one card, and
 * band C really carries a search row and the free-library row. A band shell that
 * renders nothing is not a band.
 */
export function bandOrderIsIdentifyTodayBrowse(source: string): boolean {
  const order = bandOrderFromSource(source);
  if (order.length !== 3) return false;
  if (order.join('|') !== 'identify|today|browse') return false;

  const a = bandRegion(source, 'identify');
  if (!a) return false;
  // The hero button lives in band A …
  if (a.indexOf('styles.recognitionBtn') < 0) return false;
  if (a.indexOf('onPress={handleHeroTap}') < 0) return false;
  // … and band A is nothing but the hero card + its two secondary entries.
  const retiredStyles = RETIRED_DOOR_CARD_STYLES;
  for (const style of retiredStyles) {
    if (a.indexOf(style) >= 0) return false;
  }
  // Band A's secondary entries really are there (hum row + the new chip).
  if (a.indexOf('styles.humEntryBtn') < 0) return false;
  if (a.indexOf('styles.findAnySongChip') < 0) return false;

  // Band B: one card, one tap.
  const b = bandRegion(source, 'today');
  if (b.length < 40) return false;
  if (b.indexOf('styles.todayCard') < 0) return false;

  // Band C: the search row and the free-library row.
  const c = bandRegion(source, 'browse');
  if (c.length < 40) return false;
  if (c.indexOf('styles.findPieceBtn') < 0) return false;
  if (c.indexOf('styles.browseLibraryRow') < 0) return false;
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
