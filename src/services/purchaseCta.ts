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
import type { ModernMatch } from '../types';
import { maskComments } from './modalBackContract';

/** This module's own repo-relative path (allowed in the scan — it names the
 *  retailers inside the patterns below, exactly as the backend's scanner allows
 *  itself). */
export const PURCHASE_CTA_MODULE_PATH = 'src/services/purchaseCta.ts';

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
  allow: readonly string[] = [PURCHASE_CTA_MODULE_PATH],
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
