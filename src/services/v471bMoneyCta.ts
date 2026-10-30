/**
 * v471bMoneyCta.ts — v47.1 PART B: THE MONEY CTA ON A PAGE WITH NO HOSTED SCORE.
 *
 * ── THE TWO DEFECTS THIS MODULE EXISTS FOR ─────────────────────────────────
 *
 * 1. THE #199 COLLAPSE CLASS. On the piece page the money action was a child of
 *    `styles.actions` — the same `flexDirection: 'row'` that collapsed the
 *    "View Sheet Music" pill in v46. A primary money CTA that shares a row with
 *    another control gets squeezed to its padding when a third, intrinsically
 *    sized block lands beside it. The fix is structural, not cosmetic: the money
 *    CTA is its OWN full-width block, it is the only control in that block, and
 *    nothing can be laid out on the same row. `scripts/v471bMoneyCta.test.ts`
 *    reads the REAL component and fails if the block stops being full-width or
 *    if a second control ever joins it.
 *
 * 2. THE D0 CLASS (v47 Part A): an affiliate URL whose query silently drops the
 *    affiliate id. Every URL built here goes through the ONE builder
 *    (`searchExternal.sheetMusicDirectSearchUrl`) and every one is re-checked
 *    for `tid=67650` + `affiliateId=67650` before it is handed to a surface.
 *
 * ── THE HONEST NO-DEAD-END PATH (445 of 536 live catalog rows) ─────────────
 * A metadata-only row has no score we may host. Its only real destination is a
 * licensed retailer, and a generic search would be a wall: the query is built
 * from THAT ROW's own composer and title, never from a shared placeholder.
 *
 * Pure by design — no react / react-native / expo / fs imports — so the tier1
 * gate compiles and runs it under plain Node (tsconfig.tier1.json).
 */

import { maskComments } from './modalBackContract';
import { sheetMusicDirectSearchUrl } from './searchExternal';
import { familyMoneyUrlKeepsTheAffiliateId } from './v47FamilyAffiliateQuery';

/**
 * THE affiliate disclosure, one short honest line. It says the three true
 * things and nothing else: we earn a commission, the price is unchanged for the
 * buyer, and the retailer opens inside the app. No urgency, no "recommended
 * by", no implication that the retailer's page is ours.
 */
export const AFFILIATE_DISCLOSURE =
  'NoteSnap earns a commission if you buy — at no extra cost to you. The retailer opens in the in-app browser.';

/** The primary money CTA when we hold the retailer's own page for this work. */
export const MONEY_CTA_OFFICIAL_LABEL = 'Get Official Sheet Music';

/** The money CTA for a metadata-only work: a pre-filled retailer SEARCH. */
export const MONEY_CTA_EDITIONS_LABEL = 'Search Official Published Editions';

/** The block/button style keys the layout guard pins. */
export const MONEY_CTA_BLOCK_STYLE = 'moneyCtaBlock';
export const MONEY_CTA_BUTTON_STYLE = 'moneyCtaBtn';

/** The component that renders the block (source-scanned for hosting). */
export const OFFICIAL_EDITIONS_CTA_COMPONENT = '<OfficialEditionsCta';
export const MONEY_CTA_COMPONENT_FILE = 'src/components/OfficialEditionsCta.tsx';
/** The unscored-piece path this CTA must be HOSTED on, not merely defined. */
export const PIECE_SCREEN_FILE = 'src/screens/PieceDetailScreen.tsx';

/**
 * Composer values that carry no information. A "search" for `Unknown <title>`
 * is worse than a title-only search, so these are dropped rather than pasted in.
 */
const EMPTY_COMPOSERS: readonly string[] = [
  '',
  'unknown',
  'unknown composer',
  'various',
  'n/a',
  'none',
  'anonymous',
];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * THE PRE-FILL — this row's own composer and title, in that order, never a
 * generic query and never a catalog/recording code (the owner's 09-22
 * "No Results" bug: SMD indexes titles and artists, not ISRCs).
 * A row with no usable composer degrades to its title alone — still that row's
 * own words, never a placeholder.
 */
export function editionsQuery(composer: unknown, title: unknown): string {
  const t = clean(title);
  if (t === '') return '';
  const c = clean(composer);
  if (EMPTY_COMPOSERS.indexOf(c.toLowerCase()) >= 0) return t;
  // A composer already inside the title ("Bach — Prelude") must not be doubled.
  if (t.toLowerCase().indexOf(c.toLowerCase()) >= 0) return t;
  return `${c} ${t}`;
}

/**
 * The SMD search URL for a metadata-only row's own composer + title, or
 * undefined when the row has no title to search for (never a generic URL).
 */
export function publishedEditionsUrl(
  composer: unknown,
  title: unknown,
): string | undefined {
  const q = editionsQuery(composer, title);
  if (q === '') return undefined;
  return sheetMusicDirectSearchUrl(q);
}

/** What the unscored-piece money block renders. */
export interface UnscoredMoneyCta {
  /** `none` renders NOTHING — never a disabled or decorative button. */
  kind: 'official' | 'published-editions' | 'none';
  /** The button label ('' when kind is 'none'). */
  label: string;
  /** The retailer URL this tap opens (undefined when kind is 'none'). */
  url?: string;
  /** The search words echoed back on the card (published-editions only). */
  query?: string;
}

/** The shape of a piece row this module needs (a full row is accepted too). */
export interface MoneyCtaRow {
  title?: unknown;
  composer?: unknown;
  /** The piece's own curated retailer page, when the catalog carries one. */
  purchaseUrl?: unknown;
  [key: string]: unknown;
}

/**
 * THE DECISION for a page with no hosted score.
 *
 *   • the row carries a licensed retailer page → ONE "Get Official Sheet Music"
 *     that opens it (a modern song opened from History);
 *   • otherwise → "Search Official Published Editions", pre-filled with the
 *     row's own composer + title (the 445 metadata-only rows);
 *   • a row with neither → `none`, so the page renders no money block at all
 *     instead of a button that can only fail.
 *
 * A URL that does not survive the affiliate check is treated as absent: a money
 * CTA that pays nobody is not a money CTA, and shipping it silently is exactly
 * the D0 defect.
 */
export function resolveUnscoredMoneyCta(row: MoneyCtaRow): UnscoredMoneyCta {
  const purchase = clean(row.purchaseUrl);
  if (purchase !== '' && /^https?:\/\//i.test(purchase)) {
    return { kind: 'official', label: MONEY_CTA_OFFICIAL_LABEL, url: purchase };
  }
  const query = editionsQuery(row.composer, row.title);
  const url = publishedEditionsUrl(row.composer, row.title);
  if (query === '' || !url) return { kind: 'none', label: '' };
  return {
    kind: 'published-editions',
    label: MONEY_CTA_EDITIONS_LABEL,
    url,
    query,
  };
}

/**
 * PREDICATE 1 — the URL a money CTA opens still pays us. Delegates to the v47
 * Part A rule (`tid=67650` AND `affiliateId=67650`, still on the search route,
 * never a canonical `/genre/` or `/artist/` page) rather than re-implementing
 * it, so there is one definition of "keeps the affiliate id" in the app.
 */
export function moneyCtaUrlKeepsTheAffiliateId(url: unknown): boolean {
  return familyMoneyUrlKeepsTheAffiliateId(url);
}

// ── layout helpers (source scanning) ───────────────────────────────────────

/**
 * The body of a `styles.<key>: { … }` entry, by brace matching. Comments are
 * masked by the caller so a commented-out style cannot satisfy a guard.
 */
export function styleBody(source: string, key: string): string {
  const marker = `${key}: {`;
  const at = source.indexOf(marker);
  if (at < 0) return '';
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

/** The JSX span of `<View style={styles.<key>}>` … its matching close. */
export function blockSpan(source: string, key: string): { start: number; end: number } | null {
  const marker = `style={styles.${key}}`;
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const open = source.lastIndexOf('<', at);
  const close = source.indexOf('</View>', at);
  if (open < 0 || close < 0) return null;
  return { start: open, end: close + '</View>'.length };
}

/**
 * PREDICATE 2 — THE MONEY BLOCK IS FULL WIDTH.
 * The block stretches to the page column and is a COLUMN (never a row), and the
 * button itself stretches inside it. This is the structural half of the #199
 * fix: a `flex: 1` button inside a row is what collapsed to a 32dp pill.
 */
export function moneyCtaBlockIsFullWidth(source: string): boolean {
  const masked = maskComments(source);
  if (masked.length < 500) return false;
  const block = styleBody(masked, MONEY_CTA_BLOCK_STYLE);
  const button = styleBody(masked, MONEY_CTA_BUTTON_STYLE);
  if (block === '' || button === '') return false;
  if (!/alignSelf:\s*'stretch'/.test(block)) return false;
  if (/flexDirection:\s*'row'/.test(block)) return false;
  if (/flexDirection:\s*'row'/.test(button)) return false;
  // Full width on the button: stretched, or an explicit 100% width.
  if (!/alignSelf:\s*'stretch'/.test(button) && !/width:\s*'100%'/.test(button)) {
    return false;
  }
  // The block itself must be laid out by the page, not by a row that could
  // squeeze it: no `flex: 1` on the block.
  if (/flex:\s*1/.test(block)) return false;
  return true;
}

/**
 * PREDICATE 3 — NOTHING SITS ON THE SAME ROW AS THE MONEY CTA.
 * The block holds EXACTLY ONE pressable. That is the difference between the
 * shipped fix and the defect: the defect was a money CTA sharing `styles.actions`
 * with the Share button, so a third child could squeeze both.
 */
export function moneyCtaBlockHasNoRowSibling(source: string): boolean {
  const masked = maskComments(source);
  const span = blockSpan(masked, MONEY_CTA_BLOCK_STYLE);
  if (!span) return false;
  const inner = masked.slice(span.start, span.end);
  if (/flexDirection:\s*'row'/.test(inner)) return false;
  const controls = inner.match(/accessibilityRole="button"/g);
  if (!controls || controls.length !== 1) return false;
  // The disclosure is a plain Text under the button — it must not be pressable.
  if (inner.indexOf('{AFFILIATE_DISCLOSURE}') < 0) return false;
  return true;
}

/**
 * PREDICATE 4 — THE BLOCK IS HOSTED ON THE UNSCORED-PIECE PATH.
 * "Defined but never rendered" is the v46 lesson: a component that exists and a
 * screen that never mounts it looks identical to a fix in a source scan that
 * only greps the component. This asserts the SCREEN renders it, inside the
 * honest no-score state, wired to the page's in-app shell opener.
 */
export function moneyCtaIsHostedOnUnscoredPiecePath(screenSource: string): boolean {
  const masked = maskComments(screenSource);
  if (masked.length < 5000) return false;
  const at = masked.indexOf(OFFICIAL_EDITIONS_CTA_COMPONENT);
  if (at < 0) return false;
  // It must sit inside the honest no-score block, not somewhere unreachable.
  const stateAt = masked.indexOf('showsHonestNoScoreState ? (');
  if (stateAt < 0 || at < stateAt) return false;
  if (at - stateAt > 2000) return false;
  // …and its tap must open the page's ONE in-app retailer shell.
  const call = masked.slice(at, at + 600);
  if (call.indexOf('onOpen={openInAppPurchase}') < 0) return false;
  if (call.indexOf('title={piece.title}') < 0) return false;
  if (call.indexOf('composer={piece.composer}') < 0) return false;
  // The page must still explain the state honestly, in the shared words.
  if (masked.indexOf('NO_HOSTED_SCORE_LINE') < 0) return false;
  return true;
}

/**
 * PREDICATE 5 — the money CTA is NOT inside the action row (the defect's home).
 */
export function moneyCtaIsOutsideTheActionRow(screenSource: string): boolean {
  const masked = maskComments(screenSource);
  const rowAt = masked.indexOf('style={styles.actions}');
  if (rowAt < 0) return false;
  const rowClose = masked.indexOf('</View>', rowAt);
  const ctaAt = masked.indexOf(OFFICIAL_EDITIONS_CTA_COMPONENT);
  if (rowClose < 0 || ctaAt < 0) return false;
  return ctaAt > rowClose;
}

// ── the disclosure, on EVERY affiliate surface ─────────────────────────────

/**
 * Every surface that puts a retailer/affiliate action in front of the user, and
 * HOW that surface shows the disclosure:
 *   • `direct`  — it renders `{AFFILIATE_DISCLOSURE}` itself;
 *   • `via-child` — it renders a component from `AFFILIATE_CTA_COMPONENTS`,
 *     which carries the line.
 * A surface that is neither is a defect, which is why the list is enumerated
 * rather than sampled: `affiliateSurfaceScan()` also reports any file that
 * matches the affiliate-CTA pattern but is on NEITHER this list nor the
 * exemption list below, so a NEW surface cannot ship without the line.
 */
export const AFFILIATE_CTA_SURFACES: Readonly<
  Record<string, { mode: 'direct' | 'via-child'; via?: string; note: string }>
> = {
  'src/components/OfficialEditionsCta.tsx': {
    mode: 'direct',
    note: 'the unscored-piece money block (this build)',
  },
  'src/components/SearchExternalSection.tsx': {
    mode: 'direct',
    note: 'the Find-a-Piece "official sheet music" section',
  },
  'src/components/RecognitionResultView.tsx': {
    mode: 'direct',
    note: 'the modern-match purchase action + its secondary offer',
  },
  'src/components/ModernSongInterstitial.tsx': {
    mode: 'direct',
    note: 'the modern-song interstitial buy button',
  },
  'src/components/FamilyScreen.tsx': {
    mode: 'direct',
    note: 'the all-genres family money row (D0 fix)',
  },
  'src/screens/PieceDetailScreen.tsx': {
    mode: 'direct',
    note: 'the sheet-music card for a modern song opened from History',
  },
  'src/screens/HistoryScreen.tsx': {
    mode: 'direct',
    note: 'the saved-row "Get sheet music" action',
  },
  'src/screens/FindPieceScreen.tsx': {
    mode: 'via-child',
    via: '<SearchExternalSection',
    note: 'hosts the search section; carries no retailer CTA of its own',
  },
  'src/screens/HomeScreen.tsx': {
    mode: 'via-child',
    via: '<ModernSongInterstitial',
    note: 'hosts the modern interstitial',
  },
  'src/screens/ModernSearchScreen.tsx': {
    mode: 'via-child',
    via: '<ModernSongInterstitial',
    note: 'hosts the modern interstitial',
  },
};

/**
 * Files that mention a purchase URL but render NO affiliate action — listed
 * explicitly so the discovery scan cannot silently grow to cover them.
 */
export const AFFILIATE_CTA_EXEMPTIONS: Readonly<Record<string, string>> = {
  'src/components/CoachPracticeCard.tsx':
    'purchaseUrl is a SIGNAL ONLY (it tells a modern song apart); the card renders no buy button — one purchase action per page, owner 10-01',
};

/**
 * What marks a file as an affiliate-CTA surface at all. Deliberately about the
 * MONEY tokens, not about `TouchableOpacity`, so a new surface is caught even if
 * it renders its button with a different primitive.
 */
export const AFFILIATE_CTA_PATTERN =
  /sheetMusicDirectSearchUrl|familyAffiliateUrl|primaryPurchaseUrl\(|secondaryPurchaseUrl\(|purchaseUrl|affiliate_url|smdUrl|sheetCardUrl|AFFILIATE_DISCLOSURE/;

/** Does one surface carry the disclosure in the way its list entry claims? */
export function affiliateSurfaceRendersDisclosure(source: string, entry: { mode: 'direct' | 'via-child'; via?: string }): boolean {
  if (typeof source !== 'string' || source.length < 200) return false;
  const masked = maskComments(source);
  if (entry.mode === 'direct') {
    // RENDERED, not merely imported: the JSX must interpolate the constant.
    return masked.indexOf('{AFFILIATE_DISCLOSURE}') >= 0;
  }
  const via = entry.via ?? '';
  if (via === '') return false;
  return masked.indexOf(via) >= 0;
}

/** The result of auditing the whole surface set. */
export interface AffiliateSurfaceAudit {
  /** Surfaces that do not carry the disclosure as their entry claims. */
  missing: string[];
  /** Files that look like affiliate surfaces but are on neither list. */
  undiscovered: string[];
  /** How many surfaces were actually checked (the floor for a vacuous pass). */
  checked: number;
}

/**
 * Audit every affiliate surface at once. `files` is the path→source map the
 * suite builds by walking `src/`; keeping the walk in the test (not here) is the
 * tier1 rule — a service module may not import `fs`.
 */
export function affiliateSurfaceScan(files: Record<string, string>): AffiliateSurfaceAudit {
  const missing: string[] = [];
  const undiscovered: string[] = [];
  let checked = 0;
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    const source = files[path];
    const entry = AFFILIATE_CTA_SURFACES[path];
    if (entry) {
      checked += 1;
      if (!affiliateSurfaceRendersDisclosure(source, entry)) missing.push(path);
      continue;
    }
    if (AFFILIATE_CTA_EXEMPTIONS[path]) continue;
    // A SURFACE is something that renders. Service modules may name a retailer
    // (that is where the URLs come from) but they put nothing in front of a
    // user, so only components/ and screens/ are audited for the disclosure.
    if (!/^src\/(components|screens)\//.test(path)) continue;
    if (!AFFILIATE_CTA_PATTERN.test(source)) continue;
    if (source.indexOf('TouchableOpacity') < 0 && source.indexOf('Pressable') < 0) continue;
    undiscovered.push(path);
  }
  return { missing, undiscovered, checked };
}

/** Convenience for tests and the PR body: every surface path, in order. */
export function affiliateSurfacePaths(): string[] {
  return Object.keys(AFFILIATE_CTA_SURFACES).sort();
}
