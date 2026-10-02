/**
 * purchaseCta.ts — the app's money path: which retailer URL a purchase CTA opens.
 *
 * Why this module exists (link audit, 09-23): the backend's purchase-URL map for a
 * non-public-domain recognition has TWO approved retailers, in priority order —
 * `sheetmusicdirect` (Sheet Music Direct, affiliate ID 67650, owner-approved
 * PRIMARY since 09-14) and `musicnotes` (Musicnotes, the BACKUP). The website fix
 * (backend PR #120) made the map emit the primary; the APP was still reading the
 * backup by name:
 *
 *     purchase_url?.musicnotes ?? response.purchase_url!.musicnotes
 *
 * Every in-app "Get Official Sheet Music" tap therefore sent the user — and the
 * commission — to the backup retailer, and would have kept doing so no matter
 * what the backend emitted. The URL tests all passed, because the link was live;
 * it was just the wrong (and less valuable) retailer. Same defect class as the
 * site's demo CTA, which the backend's `primaryPurchaseUrl()` fixed.
 *
 * So the rule is the same one the site follows: a CTA resolves through
 * `primaryPurchaseUrl()` — the first APPROVED key present — and never names a
 * retailer key itself. `scanSourcesForHardwiredRetailerKey` is the guard: it reads
 * the app's own source and fails the gate if any surface dereferences a retailer
 * key directly or hardcodes a retailer hostname (the dev demo used to hardcode
 * both Musicnotes and the DROPPED Sheet Music Plus).
 *
 * The keys below MUST stay in step with the backend's
 * `src/services/generate-purchase-urls.ts` (PRIMARY_PURCHASE_URL_KEY /
 * BACKUP_PURCHASE_URL_KEY). The modern-song route does not use this map at all:
 * the backend already returns `modern.retailerUrl` (primary) and
 * `modern.musicnotesUrl` (backup), and the app opens exactly those strings.
 *
 * Copyright position: nothing here builds, caches or hosts a score — these are
 * outbound links to licensed retailers, opened on an explicit tap only.
 *
 * Pure by design (no react / react-native / fs) so the tier1 gate compiles it with
 * node_modules absent (see tsconfig.tier1.json).
 */
import type { ModernMatch, PurchaseUrls } from '../types';
import { maskComments, readModalTag } from './modalBackContract';
// The delimiter matcher is the scanner utility the source contracts share
// (`matchDelimiter(a, i)` → the index of the closing bracket) — it lives in
// inAppBrowserContract.ts and is reused here so a `)` inside a string in a
// purchase tap cannot end the call early. Same convention as the other contracts.
import { matchDelimiter } from './inAppBrowserContract';

/** This module's own repo-relative path (allowed in the scan — it names the
 *  retailers inside the patterns below, exactly as the backend's scanner allows
 *  itself). */
export const PURCHASE_CTA_MODULE_PATH = 'src/services/purchaseCta.ts';
/**
 * The ONE other module allowed to spell a retailer hostname (owner 10-01).
 *
 * Every PURCHASE url the app opens is built by the backend and resolved through
 * `primaryPurchaseUrl()` — this scanner keeps that true. The Find-a-Piece SEARCH
 * BOX is the single exception: the backend has no free-text search endpoint (only
 * `/api/recognize-modern`, which needs audio), so the box builds its own SMD /
 * Musicnotes *search* links from what the user typed. One module, one attribution
 * path (tid/affiliateId 67650), pinned by src/services/searchExternalContract.ts —
 * not a licence to hand-write URLs in screens.
 */
export const RETAILER_URL_BUILDER_ALLOWLIST: readonly string[] = [
  PURCHASE_CTA_MODULE_PATH,
  'src/services/searchExternal.ts',
];

// ─── Retailer registry (mirrors the backend's approved set) ─────

/** Map key carrying the PRIMARY retailer link (Sheet Music Direct, ID 67650). */
export const PRIMARY_PURCHASE_URL_KEY = 'sheetmusicdirect';

/** Map key carrying the owner-approved BACKUP retailer link (Musicnotes). */
export const BACKUP_PURCHASE_URL_KEY = 'musicnotes';

/**
 * The ONLY retailers an emitted purchase-URL map may contain, in priority order.
 * A CTA resolves to the FIRST key present, so the primary can never be skipped
 * for the backup. (Sheet Music Plus was dropped by the owner — sign-in loop —
 * and JW Pepper is not approved and has no affiliate ID, so neither appears.)
 */
export const APPROVED_PURCHASE_URL_KEYS: readonly string[] = [
  PRIMARY_PURCHASE_URL_KEY,
  BACKUP_PURCHASE_URL_KEY,
];

/** True when `key` names an owner-approved retailer. */
export function isApprovedPurchaseUrlKey(key: string): boolean {
  return APPROVED_PURCHASE_URL_KEYS.includes(key);
}

/** A purchase-URL map as the backend returns it in `purchase_url`. */
export type PurchaseUrlMap = Record<string, string | undefined> | null | undefined;

function usable(url: string | undefined | null): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The link a purchase CTA must use: the first APPROVED entry present — the
 * primary retailer, falling back to the backup only when the primary is absent
 * (or empty). Returns undefined when there is nothing safe to open, which the UI
 * renders as an honest "not linked yet" card rather than a dead button.
 */
export function primaryPurchaseUrl(urls: PurchaseUrlMap): string | undefined {
  if (!urls) return undefined;
  for (const key of APPROVED_PURCHASE_URL_KEYS) {
    const url = usable(urls[key]);
    if (url) return url;
  }
  return undefined;
}

/**
 * The SECONDARY retailer link for a map — the first approved entry that is not
 * the primary one — or undefined when there is none, or when the only link
 * present IS the primary (already the CTA in front of the user).
 *
 * This is what lets a surface offer a small "Try Musicnotes" line (owner-approved
 * UX-only secondary CTA) WITHOUT naming a retailer key: the rule "a secondary
 * appears only when it differs from what the primary CTA already opens" lives
 * here, once, instead of in each screen. A map with only the backup link returns
 * undefined — that link is already the primary CTA, and a duplicate row would be
 * a second button to the same page.
 */
export function secondaryPurchaseUrl(urls: PurchaseUrlMap): string | undefined {
  if (!urls) return undefined;
  const primary = primaryPurchaseUrl(urls);
  for (const key of APPROVED_PURCHASE_URL_KEYS) {
    const url = usable(urls[key]);
    if (url && url !== primary) return url;
  }
  return undefined;
}

/**
 * The affiliate CTA for a classical recognition result: the top match's own map
 * first, then the response-level fallback map (the backend may only fill one).
 * Both go through the approved-key order, so the primary wins whenever it exists.
 */
export function recognitionPurchaseUrl(
  matchPurchaseUrls: PurchaseUrlMap,
  responsePurchaseUrls: PurchaseUrlMap,
): string | undefined {
  return (
    primaryPurchaseUrl(matchPurchaseUrls) ??
    primaryPurchaseUrl(responsePurchaseUrls)
  );
}

/** The SMD (primary) retailer URL the backend returned for a modern match. */
export function modernPrimaryRetailerUrl(match: ModernMatch | null): string | undefined {
  return usable(match?.retailerUrl);
}

/** The Musicnotes (secondary CTA) retailer URL the backend returned. */
export function modernBackupRetailerUrl(match: ModernMatch | null): string | undefined {
  return usable(match?.musicnotesUrl);
}

/**
 * The SECONDARY retailer link for a modern match — the backend's backup URL, and
 * only when it is a DIFFERENT page from the primary one.
 *
 * The dedupe rule already lives in `secondaryPurchaseUrl()` for the map shape; a
 * modern match carries its two links as flat fields instead, so the same rule
 * needs the same home. It is not cosmetic: a secondary button that resolves to the
 * SAME string as the primary is a second tap to the page the user is already on —
 * one purchase action became two, which is exactly what the owner's "one CTA per
 * page" rule forbids. A match whose only link is the backup therefore shows no
 * secondary line (that link IS the primary CTA).
 */
export function modernSecondaryRetailerUrl(
  match: ModernMatch | null,
): string | undefined {
  const primary = modernPrimaryRetailerUrl(match);
  const backup = modernBackupRetailerUrl(match);
  if (!backup || backup === primary) return undefined;
  return backup;
}

/**
 * The purchase-URL map to SAVE with a modern-song recognition (History dead-end
 * sprint, owner 10-01).
 *
 * A modern match arrives carrying its retailer links (`retailerUrl` primary,
 * `musicnotesUrl` backup). The History row used to save identity only, so those
 * links were dropped and the saved row could never reach the sheet music again —
 * the owner's dead-end report. `SavedPiece.purchaseUrls` is written from HERE, so
 * the map on the row is built from exactly the URLs the backend supplied:
 *
 *   • no URL at all → `null`, never an empty-but-present map (the row then keeps
 *     today's behaviour: the honest "sheet music coming soon" state);
 *   • the keys are the approved registry above, so a saved row resolves through
 *     the same `primaryPurchaseUrl()` order as every other CTA — the primary
 *     retailer is never skipped for the backup.
 *
 * Pure: it only reads the match it is handed. It builds no URL, caches nothing and
 * knows no hostname.
 */
export function modernPurchaseUrls(match: ModernMatch | null): PurchaseUrls | null {
  const primary = modernPrimaryRetailerUrl(match);
  const backup = modernBackupRetailerUrl(match);
  if (!primary && !backup) return null;
  const urls: PurchaseUrls = {};
  if (primary) urls[PRIMARY_PURCHASE_URL_KEY] = primary;
  if (backup) urls[BACKUP_PURCHASE_URL_KEY] = backup;
  return urls;
}

// ─── Source-contract scanner ────────────────────────────────────

/**
 * A `purchase_url` map dereferenced by a LITERAL retailer key — the defect this
 * module exists to prevent (`purchase_url.musicnotes`, `purchase_url['musicnotes']`,
 * `purchase_url?.musicnotes`). The trailing `\b` is deliberate: `musicnotesUrl` is
 * the backend's own field name and is not a key dereference.
 */
export const RETAILER_KEY_DEREF_PATTERN =
  /\bpurchase[_A-Za-z]*\s*(?:\?\.|!\.|\.|\[\s*["'])(musicnotes|jwpepper|sheetmusicdirect|sheetmusicplus|virtualsheetmusic)\b/i;

/** A retailer hostname written into the app source instead of coming from the API. */
export const RETAILER_HOSTNAME_PATTERN =
  /\b(?:www\.)?(?:musicnotes\.com|sheetmusicdirect\.com|sheetmusicplus\.com|virtualsheetmusic\.com|jwpepper\.com)\b/i;

export type RetailerCtaOffenderKind = 'hardwired-key' | 'hardcoded-hostname';

export interface RetailerCtaOffender {
  path: string;
  /** 1-based line number. */
  line: number;
  kind: RetailerCtaOffenderKind;
  /** The matched retailer token (`musicnotes`, `sheetmusicdirect`, …). */
  retailer: string;
  text: string;
}

function retailerOf(line: string): string | null {
  const key = line.match(RETAILER_KEY_DEREF_PATTERN);
  if (key) return key[1].toLowerCase();
  const host = line.match(RETAILER_HOSTNAME_PATTERN);
  if (host) return host[0].toLowerCase().replace(/^www\./, '');
  return null;
}

/**
 * Pure source scanner (the team's source-contract pattern). `allow` takes
 * repo-relative paths: this module names the retailers in its own patterns, so
 * it allows itself — exactly as the backend's scanner does.
 */
export function scanSourcesForHardwiredRetailerKey(
  files: readonly { path: string; source: string }[],
  allow: readonly string[] = RETAILER_URL_BUILDER_ALLOWLIST,
): RetailerCtaOffender[] {
  const allowed = new Set(allow);
  const offenders: RetailerCtaOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    // Comments are blanked (length- and newline-preserving) before matching, so
    // a comment that DOCUMENTS the old bug — the way this file's own header and
    // RecognitionResultView's note do — can never fail the gate, while real code
    // (including a URL inside a string literal, which masking deliberately keeps)
    // still does.
    const lines = maskComments(file.source).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const retailer = retailerOf(text);
      if (!retailer) continue;
      offenders.push({
        path: file.path,
        line: i + 1,
        kind: RETAILER_KEY_DEREF_PATTERN.test(text) ? 'hardwired-key' : 'hardcoded-hostname',
        retailer,
        text: text.trim().slice(0, 160),
      });
    }
  }
  return offenders;
}

/** One-line report per offender, ready to print in a test failure. */
export function formatRetailerCtaOffenders(
  offenders: readonly RetailerCtaOffender[],
): string[] {
  return offenders.map(
    (o) =>
      `${o.path}:${o.line} — purchase CTA names the "${o.retailer}" retailer directly (${o.kind}); resolve it through primaryPurchaseUrl() instead: ${o.text}`,
  );
}

// ─── The in-app shell contract (bundle C, owner 10-02) ───────────
//
// Which retailer a CTA opens was already pinned above. WHERE it opens was not:
// the recognition result's "🛒 Get Official Sheet Music" tap called
// `Linking.openURL(url)`, so the ONE money path the app owns handed the user to
// the system browser and left NoteSnap entirely — no BACK into the app, no
// recognition card to return to, no route back to the piece it just identified
// (owner-reported, audit D5; it was the only purchase route in the app that left
// the app). Every other purchase surface already opens the retailer INSIDE our
// own full-screen Modal shell (`PurchaseWebView`, or the modern interstitial's own
// Modal-rooted WebView branch).
//
// So this section is the structural half of the money path: a purchase tap must
// hand a URL to a shell this app renders, and the whole tree is scanned to prove
// no purchase path can leave the app. The predicates are text predicates for the
// same reason every other contract here is: there is no emulator on this box, and
// a wiring defect (a tap that opens the browser) is invisible to a logic test.

/**
 * The ONE shared in-app retailer shell every purchase surface mounts
 * (`src/components/PurchaseWebView.tsx`: a full-screen Modal whose header and
 * `onRequestClose` both return the user to the surface that opened it).
 */
export const PURCHASE_SHELL_COMPONENT = 'PurchaseWebView';

/**
 * The names a purchase tap may use to hand its URL to the shell: the shell's own
 * URL state setter, or the per-surface opener helper that wraps it
 * (`openInAppPurchase()` in `PieceDetailScreen`). They are listed rather than
 * inferred so that a NEW surface has to name its entry point here — a deliberate
 * speed bump: the guard reads what it gets, and a fourth spelling would otherwise
 * make a purchase action invisible to it.
 */
export const PURCHASE_SHELL_OPENERS: readonly string[] = [
  'setPurchaseWebUrl',
  'setRetailerUrl',
  'openInAppPurchase',
];

/**
 * The pure resolvers that can yield a SECONDARY retailer link, each already
 * deduped against its primary (`secondaryPurchaseUrl()` for a purchase-URL map,
 * `modernSecondaryRetailerUrl()` for a modern match's flat fields). A surface that
 * renders a second purchase action must derive it from one of these, so a
 * secondary can never be a duplicate of the primary target.
 */
export const SECONDARY_RETAILER_RESOLVERS: readonly string[] = [
  'secondaryPurchaseUrl(',
  'modernSecondaryRetailerUrl(',
];

/** The runtime call that leaves the app: an OS browser open. */
export const LOCKING_OPEN_URL_CALL = 'Linking.openURL';
/**
 * The ONE external open a purchase-adjacent surface may make: the OS app-settings
 * page the microphone-permission prompts hand the user to
 * (`Linking.openSettings()` in `useAudioRecorder.ts:312` / `ScanScoreScreen.tsx:106`).
 * It opens a settings screen, never a retailer, so it is allowed BY NAME. The
 * allowance is also checked inside an `openURL(…)` argument list, because the
 * permission prompts use that two-step form on some Android versions
 * (`Linking.openURL(<openSettings() result>)`) — the name is what makes it safe,
 * not the call.
 */
export const EXTERNAL_OPEN_ALLOWANCE = 'openSettings(';

export const EXTERNAL_URL_OPEN_PATTERN = /\bLinking\s*\.\s*openURL\s*\(/g;

export interface ExternalUrlOpenOffender {
  path: string;
  /** 1-based line number of the `Linking.openURL(` call. */
  line: number;
  text: string;
}

/** 1-based line of `offset` (local copy: this module imports no other helper for it). */
function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Comment masking for the external-open scan — deliberately stricter than
 * `modalBackContract.maskComments`.
 *
 * Two leaks in the shared masker, both observed on THIS file, make it unusable for
 * a scan whose pattern is one that bug-documenting prose mentions on purpose:
 *   1. `'` is always taken as a string opener, so prose in a comment ("the piece
 *      page's own card") opens a string that never closes and un-masks everything
 *      after it;
 *   2. a REGEX literal containing a quote — `[\s*(?:\?\.|\[\s*["'])` in this
 *      module's own retailer-key pattern — opens a string the same way, from CODE.
 * A guard that fails on its own documentation is one the next reader learns to
 * ignore, so this walk adds the two rules that fix both: a `'` between two word
 * characters is prose rather than a quote opener (the rule
 * `inAppBrowserContract.isProseApostrophe` applies when it matches delimiters), and
 * a `/` in a regex position opens a regex literal whose body is skipped — quotes
 * inside it never start a string. Length and newlines are preserved, so reported
 * line numbers stay true.
 */
export function maskCommentsForCodeScan(source: string): string {
  const out = source.split('');
  const wordChar = /[A-Za-z0-9_]/;
  let quote = '';
  let inRegex = false;
  let inCharClass = false;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i++;
      continue;
    }
    if (inRegex) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inCharClass = true;
      else if (c === ']') inCharClass = false;
      else if (c === '/' && !inCharClass) {
        inRegex = false;
        i++;
        continue;
      } else if (c === '\n') {
        // A regex literal never spans lines: leaving the state here keeps a
        // mis-detected `/` from swallowing the rest of the file.
        inRegex = false;
      }
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < source.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === "'") {
      const prev = i > 0 ? source[i - 1] : '';
      const after = i + 1 < source.length ? source[i + 1] : '';
      if (!(wordChar.test(prev) && wordChar.test(after))) quote = c;
      i++;
      continue;
    }
    if (c === '/' && startsRegexLiteral(source, i)) {
      inRegex = true;
      inCharClass = false;
      i++;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Keywords after which a `/` opens a regex literal, not a division. */
const REGEX_PREFIX_KEYWORDS = [
  'return',
  'typeof',
  'instanceof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
];

/**
 * True when the `/` at `i` starts a regex literal: it follows an operator,
 * bracket, comma or regex-position keyword (the standard heuristic — a division
 * always follows a value, i.e. an identifier, `)`, `]` or a digit).
 */
function startsRegexLiteral(source: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return true;
  const prev = source[j];
  if ('=(,[:!&|?;{}+-*%<>~^'.indexOf(prev) >= 0) return true;
  if (wordCharAt(prev)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k--;
    return REGEX_PREFIX_KEYWORDS.includes(source.slice(k + 1, j + 1));
  }
  return false;
}

function wordCharAt(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

/**
 * Every `Linking.openURL(…)` in `files` that is NOT the allowed
 * `openSettings()` form. An empty result means no surface in the app can send the
 * user out of NoteSnap to a browser — the property the D5 fix restores.
 */
export function findExternalUrlOpens(
  files: readonly { path: string; source: string }[],
): ExternalUrlOpenOffender[] {
  const offenders: ExternalUrlOpenOffender[] = [];
  for (const file of files) {
    const masked = maskCommentsForCodeScan(file.source);
    EXTERNAL_URL_OPEN_PATTERN.lastIndex = 0;
    let match = EXTERNAL_URL_OPEN_PATTERN.exec(masked);
    while (match) {
      const open = match.index + match[0].length - 1; // the `(` itself
      const close = matchDelimiter(masked, open);
      const args = close < 0 ? masked.slice(open) : masked.slice(open, close);
      if (!args.includes(EXTERNAL_OPEN_ALLOWANCE)) {
        offenders.push({
          path: file.path,
          line: lineOf(masked, match.index),
          text: masked.slice(match.index, Math.min(masked.length, match.index + 160)).trim(),
        });
      }
      match = EXTERNAL_URL_OPEN_PATTERN.exec(masked);
    }
  }
  return offenders;
}

/**
 * The tree-wide thesis: NO purchase path leaves the app. Today's only offender was
 * `RecognitionResultView.tsx`'s purchase handler; the microphone-permission
 * `openSettings()` calls are allowed by name (they open the settings app, not a
 * retailer).
 */
export function noPurchaseActionLeavesTheApp(
  files: readonly { path: string; source: string }[],
): boolean {
  return findExternalUrlOpens(files).length === 0;
}

/** One-line report per external open, ready to print in a test failure. */
export function formatExternalUrlOpens(
  offenders: readonly ExternalUrlOpenOffender[],
): string[] {
  return offenders.map(
    (o) =>
      `${o.path}:${o.line} — a purchase path leaves the app through the system browser; ` +
      `open the retailer in the in-app shell (mount ${PURCHASE_SHELL_COMPONENT}): ${o.text}`,
  );
}

/** How many in-app retailer shells one file renders. */
export function purchaseShellMounts(source: string): number {
  const masked = maskCommentsForCodeScan(source);
  const components = (masked.match(/<PurchaseWebView(?=[\s/>])/g) ?? []).length;
  // A surface may also render the shell itself (the modern interstitial's
  // retailer branch, which predates the shared component) — but only when that
  // tree is Modal-rooted, which is the contract the browser scanner enforces.
  const ownWebViews =
    components === 0 ? (masked.match(/<WebView(?=[\s/>])/g) ?? []).length : 0;
  return components + ownWebViews;
}

/**
 * The URL state a file's shell is mounted with: `url={purchaseWebUrl}` (the shared
 * component) or `source={{ uri: retailerUrl }}` (a surface's own branch), where
 * that variable is declared by `useState` in the same file. Null when the file
 * mounts no shell, or when its shell is fed something that is not a state variable
 * (a constant or a literal — then nothing the user taps can change where it goes).
 */
export function purchaseShellUrlState(
  source: string,
): { url: string; setter: string } | null {
  const masked = maskCommentsForCodeScan(source);
  const component =
    /<PurchaseWebView\b[\s\S]{0,400}?url=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(masked);
  const own =
    /<WebView\b[\s\S]{0,600}?source=\{\{\s*uri:\s*([A-Za-z_$][\w$]*)\s*\}\}/.exec(masked);
  const match = component ?? own;
  if (!match) return null;
  const url = match[1];
  const binding = new RegExp(
    `const\\s*\\[\\s*${url}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*(?:React\\.)?useState`,
  ).exec(masked);
  if (!binding) return null;
  return { url, setter: binding[1] };
}

export interface PurchaseActionSite {
  /** The shell entry point the tap calls (`setPurchaseWebUrl`, `openInAppPurchase`, …). */
  opener: string;
  /** The reference handed to it (`sheetCardUrl`, `secondaryPurchaseLink`, …). */
  argument: string;
  /** 1-based line of the pressable element. */
  line: number;
}

/**
 * Every purchase ACTION in one file: a `<TouchableOpacity>` whose own opening tag
 * calls one of `PURCHASE_SHELL_OPENERS` from its `onPress`. Scoping the search to
 * the element's own tag is what makes the count honest — a card that contains a
 * nested secondary button is ONE action for the card plus one for the nested
 * button, never two for the card.
 */
export function purchaseActionSites(source: string): PurchaseActionSite[] {
  const masked = maskCommentsForCodeScan(source);
  const sites: PurchaseActionSite[] = [];
  const pattern = /<TouchableOpacity(?=[\s/>])/g;
  let match = pattern.exec(masked);
  while (match) {
    const tag = readModalTag(masked, match.index);
    if (tag !== null) {
      const onPress = /onPress\s*=\s*\{/.exec(tag);
      if (onPress) {
        const open = onPress.index + onPress[0].length - 1;
        const close = matchDelimiter(tag, open);
        const body = close < 0 ? tag.slice(open) : tag.slice(open, close);
        for (const opener of PURCHASE_SHELL_OPENERS) {
          const call = new RegExp(
            `\\b${opener}\\s*\\(\\s*([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`,
          ).exec(body);
          if (call) {
            sites.push({
              opener,
              argument: call[1],
              line: lineOf(masked, match.index),
            });
            break;
          }
        }
      }
    }
    pattern.lastIndex = match.index + 1;
    match = pattern.exec(masked);
  }
  return sites;
}

/**
 * A purchase surface's tap must open the in-app shell: at least one purchase
 * action, its URL handed to a shell this file mounts, and no `Linking.openURL`
 * anywhere in the file. False for a surface that opens the browser again, for one
 * whose shell is fed a constant (nothing the user taps could change it), and for
 * one that renders no action at all.
 */
export function purchaseActionIsInShell(source: string): boolean {
  const masked = maskCommentsForCodeScan(source);
  if (findExternalUrlOpens([{ path: PURCHASE_CTA_MODULE_PATH, source }]).length > 0) {
    return false;
  }
  if (purchaseShellMounts(masked) !== 1) return false;
  const shell = purchaseShellUrlState(masked);
  if (!shell) return false;
  const sites = purchaseActionSites(masked);
  if (sites.length === 0) return false;
  return sites.every((site) => {
    // Either the tap sets the shell's own state directly …
    if (site.opener === shell.setter) return true;
    // … or it calls a helper in the same file that sets it (the per-surface
    // opener: `openInAppPurchase()`).
    return new RegExp(
      `\\b${site.opener}\\b[\\s\\S]{0,500}?${shell.setter}\\s*\\(`,
    ).test(masked);
  });
}

/**
 * ONE purchase action per surface, and a secondary only when it is a DIFFERENT
 * page.
 *
 * A surface renders exactly one shell; it has at most two purchase actions (the
 * primary, and at most one secondary); and when a second exists, its URL must come
 * from a resolver that dedupes against the primary
 * (`SECONDARY_RETAILER_RESOLVERS`) and must be rendered conditionally — so an
 * interstitial or a piece page can never offer two taps to the same retailer page.
 * A third action (the owner's "duplicate CTA box" class) fails, whatever it opens.
 */
export function uniquePurchaseActionPerSurface(source: string): boolean {
  const masked = maskCommentsForCodeScan(source);
  if (purchaseShellMounts(masked) !== 1) return false;
  const sites = purchaseActionSites(masked);
  if (sites.length === 0 || sites.length > 2) return false;
  if (sites.length === 1) return true;
  const secondary = sites[1].argument;
  // The secondary must be a plain identifier resolved by a deduping resolver …
  if (secondary.indexOf('.') >= 0) return false;
  const resolver = SECONDARY_RETAILER_RESOLVERS.map((call) =>
    call.replace(/[()]/g, (c) => '\\' + c),
  ).join('|');
  const declared = new RegExp(
    `\\b${secondary}\\b[^=\\n]{0,60}=[\\s\\S]{0,200}?(?:${resolver})`,
  ).test(masked);
  if (!declared) return false;
  // … and it must be GATED on that resolution (undefined → no second action).
  return new RegExp(`\\{\\s*${secondary}\\s*\\?`).test(masked);
}

/** One-line report for a surface that breaks the one-CTA/in-shell rules. */
export const ONE_PURCHASE_ACTION_HINT =
  'the money path is one tap to one page, inside the app: a purchase action must hand its URL to the in-app shell ' +
  `(mount ${PURCHASE_SHELL_COMPONENT}), never to the system browser, and a second action may only be the ` +
  'deduped secondary retailer link.';

