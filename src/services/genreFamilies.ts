/**
 * genreFamilies.ts — THE FIVE STYLE FAMILIES (v45 slice 3b, owner-ratified
 * all-genres scope 2026-10-26).
 *
 * The owner's scope, in their words: "the app is for music enthusiasts, and we
 * use the public domain" — so the Discover surface shows FIVE style families,
 * never a classical-only grid:
 *
 *   1. Classical                  · Renaissance → Modern, in the free library
 *   2. Early Jazz & Blues         · early blues, ragtime, dixieland
 *   3. Folk & Traditional         · ballads, sea shanties, spirituals, regional tunes
 *   4. Patriotic & Holiday        · carols, historical hymns, patriotic anthems
 *   5. Vaudeville, Opera & Parlor · early vaudeville, opera, parlor songs
 *
 * The SIX CATALOGUE ERAS (Renaissance · Baroque · Classical · Romantic ·
 * Impressionist · Modern) are NOT peers of the families. They are chips INSIDE
 * the Classical tile: `pieces.genre` holds era granularity (the backend's 3a
 * slice shipped it that way), and the family taxonomy lives here, client-side.
 * An era is depth, never a top-level tile.
 *
 * ZERO DEAD ENDS. Four of the five families hold no in-library scores today, so
 * their tiles carry no count, are never greyed out, and are never a no-op: each
 * one opens a real family screen whose FIRST row is the official-editions
 * money path (Sheet Music Direct, the app's own affiliate URL builder), with the
 * free library one row below it. Every family resolves to something that
 * exists; nothing is a toast and nothing is retired.
 *
 * COUNTS ARE DATA, NEVER COPY. A count is rendered only when it was derived from
 * real catalog rows: `eraCountsFromPieces()` returns null unless it was handed a
 * COMPLETE page of rows that actually carry a genre, and the tile/era-chip
 * formatters then omit the number rather than print a guess. A live backend
 * that does not yet serve `genre` therefore renders names without counts — the
 * honest answer — instead of a hardcoded 536.
 *
 * Pure by design (no react / react-native / expo / fs imports) so the tier1 gate
 * compiles and runs it under plain Node; the React surfaces are
 * components/DiscoverStyles.tsx (the tiles) and components/FamilyScreen.tsx
 * (the family screen), and `familyTilesAreBackedByRealContent()` in this module
 * is the source-scan guard that keeps those two wired to this table.
 */
import { sheetMusicDirectSearchUrl } from './searchExternal';

// ─────────────────────────── the five families ─────────────────────────────

/** The five style families. Stable ids: they are the tap payload and test ids. */
export type FamilyId =
  | 'classical'
  | 'early-jazz-blues'
  | 'folk-traditional'
  | 'patriotic-holiday'
  | 'vaudeville-opera-parlor';

/** The six catalogue eras — chips INSIDE Classical, never top-level tiles. */
export type EraId =
  | 'Renaissance'
  | 'Baroque'
  | 'Classical'
  | 'Romantic'
  | 'Impressionist'
  | 'Modern';

/** Where a family's tap lands. Every family opens the family screen; there is
 *  no second kind of destination, and no tile may be a no-op. */
export type FamilyDestination = 'family-screen';

/**
 * What backs a family TODAY.
 *   'library' — real free scores in the catalog (Classical, the only one);
 *   'none'    — no free scores yet; the tile resolves through `q` to the live
 *               official-editions search instead (a revenue surface, not a gap).
 */
export type FamilyContent = 'library' | 'none';

export interface GenreFamily {
  id: FamilyId;
  /** The tile label, verbatim from the owner-ratified copy. */
  name: string;
  /** The family screen's honest one-line subtitle. */
  subtitle: string;
  /**
   * The style phrase this family's official editions are searched with. Never
   * empty: it is the money path's whole input, and the guard refuses a family
   * with no phrase.
   */
  q: string;
  /** WHAT actually exists behind this tile, in words (the honesty claim). */
  backedBy: string;
  destination: FamilyDestination;
  content: FamilyContent;
}

/**
 * THE TABLE (copy deck: v45-design/07, verbatim `name` fields; `q` values are
 * the four style searches live-probed 2026-10-26 — ragtime / sea shanty /
 * christmas carol / vaudeville — plus classical for the populated family).
 */
export const GENRE_FAMILIES: readonly GenreFamily[] = [
  {
    id: 'classical',
    name: 'Classical',
    subtitle: 'Orchestral, piano and chamber music — Renaissance to modern',
    q: 'classical piano',
    backedBy: 'the free library (/api/pieces, the catalog browse)',
    destination: 'family-screen',
    content: 'library',
  },
  {
    id: 'early-jazz-blues',
    name: 'Early Jazz & Blues',
    subtitle: 'Early blues, ragtime and dixieland jazz',
    q: 'ragtime',
    backedBy: 'the official-editions search (Sheet Music Direct affiliate link)',
    destination: 'family-screen',
    content: 'none',
  },
  {
    id: 'folk-traditional',
    name: 'Folk & Traditional',
    subtitle: 'Ballads, sea shanties, spirituals and regional folk tunes',
    q: 'sea shanty',
    backedBy: 'the official-editions search (Sheet Music Direct affiliate link)',
    destination: 'family-screen',
    content: 'none',
  },
  {
    id: 'patriotic-holiday',
    name: 'Patriotic & Holiday',
    subtitle: 'Carols, historical hymns and patriotic anthems',
    q: 'christmas carol',
    backedBy: 'the official-editions search (Sheet Music Direct affiliate link)',
    destination: 'family-screen',
    content: 'none',
  },
  {
    id: 'vaudeville-opera-parlor',
    name: 'Vaudeville, Opera & Parlor',
    subtitle: 'Early vaudeville, opera and parlor songs',
    q: 'vaudeville',
    backedBy: 'the official-editions search (Sheet Music Direct affiliate link)',
    destination: 'family-screen',
    content: 'none',
  },
];

/** The six era chips, in render order (Renaissance → Modern). */
export const ERA_CHIPS: readonly { id: EraId; label: string }[] = [
  { id: 'Renaissance', label: 'Renaissance' },
  { id: 'Baroque', label: 'Baroque' },
  { id: 'Classical', label: 'Classical' },
  { id: 'Romantic', label: 'Romantic' },
  { id: 'Impressionist', label: 'Impressionist' },
  { id: 'Modern', label: 'Modern' },
];

/** Bucket type for derived counts. A record (not a class) so it serialises. */
export type EraCounts = Record<EraId, number>;

/** The empty bucket set — the honest starting point for a count. */
export function emptyEraCounts(): EraCounts {
  return {
    Renaissance: 0,
    Baroque: 0,
    Classical: 0,
    Romantic: 0,
    Impressionist: 0,
    Modern: 0,
  };
}

export function familyById(id: FamilyId): GenreFamily | undefined {
  return GENRE_FAMILIES.find((family) => family.id === id);
}

/** The families with real in-library free scores today. */
export function familiesWithFreeScores(
  families: readonly GenreFamily[] = GENRE_FAMILIES,
): GenreFamily[] {
  return families.filter((family) => family.content === 'library');
}

/** The families that resolve through the official-editions money path. */
export function familiesOnMoneyPath(
  families: readonly GenreFamily[] = GENRE_FAMILIES,
): GenreFamily[] {
  return families.filter((family) => family.content === 'none');
}

// ──────────────────────────────── the copy ─────────────────────────────────

/** The tile's second line for a family with no free scores (never "0 pieces"). */
export const FAMILY_OFFICIAL_LINE = 'Official sheet music';

/** The family screen's state-card eyebrow. */
export const FAMILY_STATE_EYEBROW = 'FREE LIBRARY';

/** Honest state title when a family holds no free scores yet. */
export const FAMILY_EMPTY_STATE_TITLE = 'No free scores in this style yet';

/** Honest state body — growth framing, no date, no queue, no promise. */
export const FAMILY_EMPTY_STATE_BODY =
  'The free library grows one style at a time, and this one has not landed yet. ' +
  'Official editions are ready now.';

/** The money row's label (the family screen's primary when the family is empty). */
export const FAMILY_MONEY_ROW_LABEL = 'Official sheet music';

/** The free-library row's label — the way out for someone who came for scores. */
export const FAMILY_FREE_ROW_LABEL = 'Browse what is free now';

/** The Discover section label above the tiles. */
export const DISCOVER_STYLE_LABEL = 'BROWSE BY STYLE';

/** Words for the small integers the copy needs (derived, never typed). */
const COUNT_WORDS: readonly string[] = ['none', 'one', 'two', 'three', 'four', 'five'];

/** "four" for four others — derived so "the other four styles" cannot drift from
 *  the table if a sixth family is ever added. */
export function countWord(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'no';
  const i = Math.floor(n);
  return i < COUNT_WORDS.length ? COUNT_WORDS[i] : String(i);
}

/**
 * The honest line under BROWSE BY STYLE. The count is printed ONLY when it came
 * from real catalog data; with no count the sentence still states which family
 * the free scores are in and where the rest resolve.
 */
export function discoverStyleNote(freeCount: number | null | undefined): string {
  const populated = familiesWithFreeScores()[0];
  const populatedName = populated ? populated.name : 'Classical';
  const others = Math.max(GENRE_FAMILIES.length - familiesWithFreeScores().length, 0);
  const otherWord = countWord(others);
  const n =
    typeof freeCount === 'number' && Number.isFinite(freeCount) && freeCount > 0
      ? Math.floor(freeCount)
      : null;
  if (n === null) {
    return `Free scores today are all in ${populatedName}. The ${otherWord} other styles open official editions.`;
  }
  return `${n} free scores today, all in ${populatedName}. The ${otherWord} other styles open official editions.`;
}

/** How many style families hold free scores, stated as the footer line. */
export function familyFooterLine(
  families: readonly GenreFamily[] = GENRE_FAMILIES,
): string {
  return `Free scores today: ${familiesWithFreeScores(families).length} of ${families.length} style families`;
}

/**
 * A family tile's second line.
 *   • no free scores  → "Official sheet music" (a live door, never a 0 count);
 *   • a real count    → "<N> pieces";
 *   • no count at all → '' (the tile renders name only — omitted, never faked).
 */
export function familyTileSecondLine(
  family: GenreFamily,
  freeCount: number | null | undefined,
): string {
  if (family.content === 'none') return FAMILY_OFFICIAL_LINE;
  if (typeof freeCount === 'number' && Number.isFinite(freeCount) && freeCount > 0) {
    return `${Math.floor(freeCount)} pieces`;
  }
  return '';
}

// ─────────────────────────────── the money path ────────────────────────────

/**
 * The official-editions URL for a family — the app's OWN builder, unchanged
 * (Sheet Music Direct search, affiliate id carried by the builder). Undefined
 * only for a family with no phrase, which the guard refuses to ship.
 */
export function familyAffiliateUrl(family: GenreFamily): string | undefined {
  return sheetMusicDirectSearchUrl(family.q);
}

/** The money row's hint: the exact style phrase that will be searched. */
export function familyMoneyRowHint(family: GenreFamily): string {
  return `Search “${family.q}” and this style's editions`;
}

/** The free row's hint, naming the one family that has free scores. */
export function familyFreeRowHint(freeCount: number | null | undefined): string {
  const populated = familiesWithFreeScores()[0];
  const populatedName = populated ? populated.name : 'Classical';
  const n =
    typeof freeCount === 'number' && Number.isFinite(freeCount) && freeCount > 0
      ? Math.floor(freeCount)
      : null;
  return n === null
    ? `Public-domain pieces · ${populatedName}`
    : `${n} public-domain pieces · ${populatedName}`;
}

// ────────────────────── derived counts (never hardcoded) ───────────────────
/** The shape a catalog row must have for a count to be derived from it. */
export interface CatalogGenreRow {
  genre?: string | null;
  [key: string]: unknown;
}

/**
 * An era id from a catalog `genre` value, or null when the value is not an era.
 * Legacy `Classical/Romantic` (the pre-cleanup merged tag) resolves to its
 * actual era; junk title fragments resolve to null and are simply not counted.
 */
export function normalizeEra(raw: unknown): EraId | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value === 'Classical/Romantic') return 'Classical';
  const hit = ERA_CHIPS.find((era) => era.id.toLowerCase() === value.toLowerCase());
  return hit ? hit.id : null;
}

/**
 * Per-era counts from REAL catalog rows — or null.
 *
 * Null (→ omit every count) when:
 *   • there are no rows at all;
 *   • the page is INCOMPLETE (`rows.length < total`), so counting it would
 *     describe a slice as if it were the library;
 *   • no row carries a genre (a backend that has not shipped the field yet).
 * A count therefore always means "this many real rows", never a default.
 *
 * The row type is GENERIC over any row object, NOT the exported
 * `CatalogGenreRow`: that interface carries an index signature
 * (`[key: string]: unknown`), and a concrete interface — such as the app's
 * `CatalogPiece` — is NOT assignable to a type with an index signature, which is
 * a hard compile error at the real call site (`genreCountsStore.loadGenreCounts`
 * hands in `CatalogPiece[]` straight from `/api/pieces`). Rows here are
 * unvalidated wire objects and `genre` is the ONLY field ever read, so the
 * parameter accepts any row object and reads `genre` defensively.
 */
export function eraCountsFromPieces<Row extends object>(
  rows: readonly Row[],
  total: number,
): EraCounts | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  if (rows.length < Math.floor(total)) return null;
  const counts = emptyEraCounts();
  let tagged = 0;
  for (const row of rows) {
    const genre = row ? (row as { genre?: string | null }).genre : null;
    const era = normalizeEra(genre);
    if (!era) continue;
    tagged++;
    counts[era] += 1;
  }
  if (tagged === 0) return null;
  return counts;
}

/** How many rows the derived counts describe. */
export function eraCountsTotal(counts: EraCounts | null | undefined): number {
  if (!counts) return 0;
  return ERA_CHIPS.reduce((sum, era) => sum + (counts[era.id] ?? 0), 0);
}

/**
 * An era chip's label: "Baroque 154" when the count was derived from real rows,
 * plain "Baroque" when it was not, and NEVER "Baroque 0" — a zero count is a
 * dead end in typography (design sheet 7), so the number is dropped instead.
 */
export function eraChipLabel(eraId: EraId, counts: EraCounts | null | undefined): string {
  const era = ERA_CHIPS.find((entry) => entry.id === eraId);
  const label = era ? era.label : String(eraId);
  const n = counts ? counts[eraId] : undefined;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return `${label} ${Math.floor(n)}`;
  return label;
}

// ──────────────────────────── the two Discover layouts ─────────────────────

/**
 * THE LAYOUT FLAG (owner pick pending on-device; 'hero-classical' is the
 * designer's recommendation because it is the only layout where the era fold is
 * visible rather than implied). Both layouts render all five families; the flag
 * only decides hierarchy and where the era chips live.
 */
export type DiscoverLayout = 'hero-classical' | 'equal';

/** The shipped default. Flip this one constant to change the surface. */
export const DISCOVER_LAYOUT: DiscoverLayout = 'hero-classical';

export interface FamilyRow {
  /** 'hero' = full width, 'tile' = half of a 2×2 grid, 'wide' = full-width tile. */
  kind: 'hero' | 'tile' | 'wide';
  family: GenreFamily;
}

/**
 * The rows a Discover layout renders, in order. Never fewer than five entries
 * and never fewer than the whole table — the surface cannot be classical-only
 * by construction, in either layout.
 */
export function discoverFamilyRows(
  layout: DiscoverLayout = DISCOVER_LAYOUT,
  families: readonly GenreFamily[] = GENRE_FAMILIES,
): FamilyRow[] {
  if (families.length === 0) return [];
  if (layout === 'hero-classical') {
    const [first, ...rest] = families;
    return [{ kind: 'hero', family: first }, ...rest.map((family) => ({ kind: 'tile' as const, family }))];
  }
  const last = families[families.length - 1];
  return families.map((family) =>
    family === last ? { kind: 'wide' as const, family } : { kind: 'tile' as const, family },
  );
}

/** True when the era chips render INSIDE the Classical tile (hero layout). In
 *  the equal layout they move one level deeper: into Classical's family screen. */
export function eraChipsRenderInTile(layout: DiscoverLayout = DISCOVER_LAYOUT): boolean {
  return layout === 'hero-classical';
}

// ─────────────────────────── the family screen model ───────────────────────

export interface FamilyScreenRow {
  kind: 'money' | 'library';
  label: string;
  hint: string;
  /** The retailer URL — present on every 'money' row, absent otherwise. */
  url?: string;
}

export interface FamilyScreenModel {
  id: FamilyId;
  title: string;
  subtitle: string;
  stateEyebrow: string;
  stateTitle: string;
  stateBody: string;
  /** Ordered: the MONEY row comes FIRST for a family with no free scores. */
  rows: FamilyScreenRow[];
  /** The honest footer line ("Free scores today: 1 of 5 style families"). */
  footer: string;
  /** The era chips this screen renders (Classical only). */
  eraChips: readonly { id: EraId; label: string }[];
  /** True when this screen's first row is the money path. */
  moneyFirst: boolean;
}

/**
 * The state-card title for a family that HAS free scores: the real count when it
 * was derived from catalog data, else the honest generic line (never a number
 * the app cannot stand behind).
 */
export function familyFreeStateTitle(freeCount: number | null | undefined): string {
  const n =
    typeof freeCount === 'number' && Number.isFinite(freeCount) && freeCount > 0
      ? Math.floor(freeCount)
      : null;
  return n === null ? 'Free scores ready to play' : `${n} free scores ready to play`;
}

/**
 * The ONE decision the family screen renders from. Pure, so the ordering rules
 * (money first for an empty family, free content first for the populated one)
 * are testable without a renderer — and so a family can never resolve to a
 * screen with no live row.
 */
export function familyScreenModel(
  family: GenreFamily,
  opts: { freeCount?: number | null; eraCounts?: EraCounts | null } = {},
): FamilyScreenModel {
  const freeCount = opts.freeCount ?? null;
  const moneyRow: FamilyScreenRow = {
    kind: 'money',
    label: FAMILY_MONEY_ROW_LABEL,
    hint: familyMoneyRowHint(family),
    url: familyAffiliateUrl(family),
  };
  const freeRow: FamilyScreenRow = {
    kind: 'library',
    label: FAMILY_FREE_ROW_LABEL,
    hint: familyFreeRowHint(freeCount),
  };
  const hasFree = family.content === 'library';
  const rows: FamilyScreenRow[] = hasFree ? [freeRow, moneyRow] : [moneyRow, freeRow];
  return {
    id: family.id,
    title: family.name,
    subtitle: family.subtitle,
    stateEyebrow: FAMILY_STATE_EYEBROW,
    stateTitle: hasFree ? familyFreeStateTitle(freeCount) : FAMILY_EMPTY_STATE_TITLE,
    stateBody: hasFree
      ? 'Every free score in this style opens straight into the reader.'
      : FAMILY_EMPTY_STATE_BODY,
    rows,
    footer: familyFooterLine(),
    eraChips: hasFree ? ERA_CHIPS : [],
    moneyFirst: rows[0]?.kind === 'money',
  };
}

// ───────────────────── the wiring guard (source scan) ──────────────────────

/** The sources the guard reads: the Discover surface and the family screen. */
export interface DiscoverSourceBundle {
  /** HomeScreen.tsx — the Discover band that renders the tiles. */
  discover: string;
  /** components/FamilyScreen.tsx — the pushed family screen. */
  familyScreen: string;
  /** components/DiscoverStyles.tsx — the tile grid itself. */
  tiles?: string;
}

/** Markers the Discover surface must render — the tiles, the tap, the screen. */
export const DISCOVER_WIRING_MARKERS: readonly string[] = [
  'DiscoverStyles',
  'onOpenFamily={handleOpenFamily}',
  '<FamilyScreen',
  'selectedFamily',
  'handleOpenFamily',
];

/** Markers the family screen must carry — the model, the money row, the exit. */
export const FAMILY_SCREEN_MARKERS: readonly string[] = [
  'familyScreenModel(',
  'family-money-row',
  'family-free-row',
  'handleOpenRetailer(',
  'PurchaseWebView',
  'FAMILY_FOOTER_TEST_ID',
];

/** Every family in the table must have a real, non-empty resolution. */
export function everyFamilyResolves(families: readonly GenreFamily[] = GENRE_FAMILIES): boolean {
  for (const family of families) {
    if (family.name.trim() === '') return false;
    if (family.subtitle.trim() === '') return false;
    if (family.backedBy.trim() === '') return false;
    if (family.destination !== 'family-screen') return false;
    // THE MONEY PATH IS MANDATORY: an empty family's ONLY resolution is its
    // official-editions search, so a missing phrase is a dead tile.
    if (family.content === 'none' && family.q.trim() === '') return false;
    if (family.content === 'none') {
      const url = familyAffiliateUrl(family);
      if (!url || url.indexOf('67650') < 0) return false;
    }
    const model = familyScreenModel(family, { freeCount: 0 });
    if (model.rows.length < 2) return false;
    if (family.content === 'none' && !model.moneyFirst) return false;
    if (family.content === 'none' && !model.rows[0].url) return false;
  }
  return true;
}

/**
 * FAMILY TILES ARE BACKED BY REAL CONTENT — the guard for this surface.
 *
 * The rule the owner set (10-26) is "never a classical-only grid, and never a
 * dead tile", and both halves are invisible in a passing build: a tile row can
 * be dropped from the JSX and every counter-diff still looks fine.
 *
 * It fails when:
 *   • the table lost a family, or a family's resolution is empty (see
 *     `everyFamilyResolves`) — incl. the mutation "set one family's `q` to ''";
 *   • every layout stops rendering all five families;
 *   • the Discover surface stops rendering the tile grid, the tap handler or
 *     the family screen mount;
 *   • the family screen stops rendering the money row from the model, mounts no
 *     purchase shell, or renders the free row ABOVE the money row.
 *
 * @param bundle the REAL screen sources (comment-masked inside, so a
 *               commented-out tile can never satisfy the guard).
 */
export function familyTilesAreBackedByRealContent(bundle: DiscoverSourceBundle): boolean {
  if (!everyFamilyResolves()) return false;
  const layouts: DiscoverLayout[] = ['hero-classical', 'equal'];
  for (const layout of layouts) {
    const rows = discoverFamilyRows(layout);
    if (rows.length !== GENRE_FAMILIES.length) return false;
    if (new Set(rows.map((row) => row.family.id)).size !== GENRE_FAMILIES.length) return false;
  }
  const discover = maskSource(bundle.discover);
  for (const marker of DISCOVER_WIRING_MARKERS) {
    if (discover.indexOf(marker) < 0) return false;
  }
  if (typeof bundle.tiles === 'string') {
    const tiles = maskSource(bundle.tiles);
    if (tiles.indexOf('discoverFamilyRows') < 0) return false;
    // The tap must carry the family id — a tile that opens a generic screen is
    // not wired to a real family destination.
    if (tiles.indexOf('onOpenFamily(family.id)') < 0) return false;
  }
  const familyScreen = maskSource(bundle.familyScreen);
  for (const marker of FAMILY_SCREEN_MARKERS) {
    if (familyScreen.indexOf(marker) < 0) return false;
  }
  // THE ORDER RULE, read from the real source: the money row is rendered before
  // the free row, so the sale is the first thing on an empty family's screen.
  const moneyAt = familyScreen.indexOf('family-money-row');
  const freeAt = familyScreen.indexOf('family-free-row');
  if (moneyAt < 0 || freeAt < 0 || moneyAt > freeAt) return false;
  return true;
}

/**
 * Blank `//` and `/* *\/` comments (offsets preserved) so a commented-out tile
 * cannot satisfy a wiring scan. Kept local (a 20-line duplicate of
 * modalBackContract.maskComments) so this module stays dependency-free.
 */
export function maskSource(source: string): string {
  if (typeof source !== 'string' || source === '') return '';
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") mode = 'single';
      else if (ch === '"') mode = 'double';
      else if (ch === '`') mode = 'template';
      out += ch;
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += ch;
      } else out += ' ';
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // inside a string literal
    if (ch === '\\') {
      out += ch + (next === undefined ? '' : next);
      i += 2;
      continue;
    }
    if (
      (mode === 'single' && ch === "'") ||
      (mode === 'double' && ch === '"') ||
      (mode === 'template' && ch === '`')
    ) {
      mode = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The footer line's stable test id (read by the guard and the screen). */
export const FAMILY_FOOTER_TEST_ID = 'family-footer';
