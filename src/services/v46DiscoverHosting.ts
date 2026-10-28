/**
 * WHERE THE DISCOVER SURFACE LIVES (v46 corrective — the hosting guard).
 *
 * THE BUG THIS CLOSES. The owner reported, on device, that "home and discover are
 * on one page". They were right: v45 slice 3b mounted the whole browse block — the
 * five-family tile grid, the facet chips, the free-library row and the honest
 * library note — INSIDE HomeScreen's Discover band, so Home was simultaneously the
 * minimal door AND the browse surface. The ratified design (design sheet §4,
 * V45-HOME-NOTES.md:64 and :199) is three surfaces in a stack:
 *
 *     Home (minimal, Variant A)  →  Discover (five families + the money rows)
 *                                →  family screen (money row first)
 *
 * with "Discover = FindPieceScreen, extended". So the browse block belongs in
 * src/screens/FindPieceScreen.tsx and MUST NOT be on the door again.
 *
 * WHY A SEPARATE GUARD. Every existing family guard asks "is the wiring present
 * SOMEWHERE" — `familyTilesAreBackedByRealContent` scans the file it is handed,
 * `bandChipsAreBackedByRealContent` is handed Home+FindPiece concatenated. None of
 * them can see a file TWO files are supposed to disagree about: `someSource`
 * containing `<DiscoverStyles` passes whether the grid is on Discover or back on
 * the door. This module is the only place the hosting itself is asserted, and it
 * asserts both halves — the content is ON the Discover surface, and it is NOT on
 * Home — because either half alone is a passing build with the bug present.
 *
 * MASKING. Both predicates read comment-MASKED source (`maskSource` from
 * services/genreFamilies). Home legitimately explains in comments that "the grid,
 * the chips and the family table moved to FindPieceScreen" (three such comments
 * survive in HomeScreen.tsx today); documentation is not the bug, code is. Masking
 * means a commented-out block cannot satisfy the Discover half either — a grid
 * commented out is a grid missing.
 *
 * NOT COVERED HERE (deliberately — one guard, one job):
 *   • the row ORDER inside the family screen, and the money-first rule →
 *     services/genreFamilies.ts (`familyTilesAreBackedByRealContent`);
 *   • the door's band order and the one-search-entry rule →
 *     services/frontDoorBands.ts (`bandOrderIsIdentifyDiscoverToday`);
 *   • the search entry's own band → services/v33UiContract.ts.
 */

import { maskSource } from './genreFamilies';

/** The file the browse block must live in. Same value as
 *  `genreFamilies.DISCOVER_SOURCE_FILE`, restated here so this guard can be read
 *  on its own; the suite asserts the two agree, so they cannot drift. */
export const DISCOVER_HOST_FILE = 'src/screens/FindPieceScreen.tsx';

/** The minimal door (Home, Variant A) — where the browse block must NOT be. */
export const HOME_FILE = 'src/screens/HomeScreen.tsx';

/**
 * THE BROWSE BLOCK. Every marker below is CODE the user can see: the tile grid
 * mount, its one handler, the family-screen mount, the facet chip row with a real
 * per-chip destination, and the free-library row with the honest note under it.
 * The two money-path markers at the end are what make the block worth moving at
 * all — the any-song facet resolves to the licensed SMD search, not a dead chip.
 */
export const DISCOVER_CONTENT_MARKERS: readonly string[] = [
  // the five-family tile grid, from the table (never a classical-only grid)
  '<DiscoverStyles',
  'onOpenFamily={handleOpenFamily}',
  'handleOpenFamily',
  'selectedFamily',
  '<FamilyScreen',
  // the facet chips the band-C fold moved, each with a real destination
  'facets.map(',
  'styles.bandChip',
  'handleFacetChip(',
  // the free-library row + the honest library note travelling with it
  'styles.browseLibraryRow',
  'onPress={handleBrowseLibrary}',
  '{FRONT_DOOR_BETA_NOTE}',
  // the money facet's arm: the licensed search, built by the affiliate builder
  'sheetMusicDirectSearchUrl(',
  'handleOpenRetailer(',
];

/**
 * THE MINIMAL DOOR. Markers of the browse block, as they appeared on Home in v45:
 * the grid and the family-screen mount, the chips and their handlers, the library
 * row and its copy, and the genre-count state that fed the tiles. Any of these in
 * Home's CODE is the one-page door coming back.
 *
 * Not banned, because they are legitimately Home's: `<FindPieceScreen` (the mount
 * of the surface, one tap away), `onBrowseLibrary={...}` (the prop Home hands it),
 * `styles.findASongBar` + `handleFindAnySong` (the door's one search entry) and
 * the `handleBrowseLibraryFromDiscover` / `handleSearchForItFromModern` handlers
 * that OPEN or FEED Discover. Moving the block never meant unplugging the door.
 */
export const HOME_BANNED_MARKERS: readonly string[] = [
  '<DiscoverStyles',
  'onOpenFamily={',
  'handleOpenFamily',
  'selectedFamily',
  '<FamilyScreen',
  'facets.map(',
  'handleFacetChip(',
  'styles.bandChip',
  'styles.browseLibraryRow',
  'styles.browseLibraryTitle',
  'styles.browseLibraryBetaNote',
  '{FRONT_DOOR_BETA_NOTE}',
  'BROWSE_LIBRARY_LABEL',
  'sheetMusicDirectSearchUrl(',
  // the genre-count state the tiles are fed from (it moved with the grid)
  'familyCounts',
  'loadGenreCounts(',
  // the band heading the fold's rows used to sit under
  'BAND_TITLES.discover',
  'DISCOVER_BAND_NOTE',
];

/**
 * HOME IS THE MINIMAL DOOR (Variant A) — predicate (a).
 *
 * FAILS when any `HOME_BANNED_MARKERS` string survives comment-masking in the
 * Home source, i.e. when the browse block is rendered there again.
 *
 * PASSES only on a real door: the source must be Home-sized, carry its Discover
 * band container and its one search entry, so an empty or truncated read fails
 * instead of passing vacuously.
 *
 * @param homeSource src/screens/HomeScreen.tsx
 */
export function homeIsMinimalVariantA(homeSource: string): boolean {
  const masked = maskSource(homeSource);
  if (masked.length < 20000) return false;
  // The door really is the door: its Discover band container is still mounted …
  if (masked.indexOf('BAND_TEST_IDS.discover') < 0) return false;
  // … and it still carries the ONE search entry that opens Discover.
  if (masked.indexOf('style={styles.findASongBar}') < 0) return false;
  if (masked.indexOf('onPress={handleFindAnySong}') < 0) return false;
  for (const marker of HOME_BANNED_MARKERS) {
    if (masked.indexOf(marker) >= 0) return false;
  }
  return true;
}

/**
 * THE DISCOVER SURFACE CARRIES THE FAMILIES — predicate (b).
 *
 * FAILS when any `DISCOVER_CONTENT_MARKERS` string is missing from the
 * comment-masked FindPieceScreen source: the grid unmounted, a chip rendered with
 * no destination, the library row dropped, the honest note lost, or the money
 * facet no longer reaching the licensed search.
 *
 * @param findPieceSource src/screens/FindPieceScreen.tsx
 */
export function discoverSurfaceCarriesTheFamilies(findPieceSource: string): boolean {
  const masked = maskSource(findPieceSource);
  // A broken/empty read must not pass: this screen is >4000 chars and it owns the
  // search field the whole surface hangs off.
  if (masked.length < 4000) return false;
  if (masked.indexOf('<TextInput') < 0) return false;
  for (const marker of DISCOVER_CONTENT_MARKERS) {
    if (masked.indexOf(marker) < 0) return false;
  }
  return true;
}

/**
 * THE TWO HALVES TOGETHER — one call for the release gates and for any future
 * slice that needs "is the hosting still right" rather than one half of it.
 */
export function discoverHostingIsSplit(homeSource: string, findPieceSource: string): boolean {
  return homeIsMinimalVariantA(homeSource) && discoverSurfaceCarriesTheFamilies(findPieceSource);
}
