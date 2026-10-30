/**
 * v47FamilyAffiliateQuery.ts — THE FAMILY MONEY ROW MUST ACTUALLY PAY US.
 * (v47 audit defect D0, the round-4 release-gate FAIL.)
 *
 * ── THE DEFECT THIS GUARD EXISTS FOR ────────────────────────────────────────
 * Each of the five style families on the all-genres front door carries ONE
 * money row: `familyAffiliateUrl(family)` → `sheetMusicDirectSearchUrl(family.q)`
 * → `https://www.sheetmusicdirect.com/en-US/Search.aspx?query=<q>&tid=67650&affiliateId=67650`.
 *
 * Sheet Music Direct canonicalises a query that EXACTLY matches one of its own
 * taxonomy terms: it 30x-redirects `/Search.aspx?query=ragtime&tid=…` to
 * `/genre/ragtime` and **drops both `tid` and `affiliateId`**. The landing page
 * renders real results, so:
 *   • a status probe sees HTTP 200 and calls it healthy;
 *   • a device walk-through sees a working retailer page and calls it healthy;
 *   • the commission is zero.
 * Three of the five family rows shipped that way (`ragtime`, `sea shanty`,
 * `christmas carol`). Only `classical piano` and `vaudeville` kept the id.
 *
 * ── WHAT IS GUARDED HERE (pure, string/data in, boolean out) ────────────────
 *   1. the five queries are the EXACT strings the audit live-probed healthy —
 *      so an innocent-looking copy edit ("ragtime" reads nicer) cannot silently
 *      re-break attribution;
 *   2. no query is a bare SMD taxonomy term — the defect CLASS, not just the
 *      three instances, so the next family added cannot reintroduce D0. A single
 *      word is refused unless it is on the short VERIFIED list below (a word
 *      that was actually probed and kept the id);
 *   3. every family URL really carries `tid=67650` AND `affiliateId=67650` and
 *      stays on the search route (never a `/genre/` or `/artist/` page);
 *   4. the ONE builder still appends both parameters — source-scanned, because a
 *      builder edit would zero out EVERY commission in the app at once.
 *
 * WHAT THIS CANNOT PROVE, stated honestly: the guard cannot perform the SMD
 * redirect. It pins the URL shape and the query strings that were LIVE-PROBED on
 * 2026-10-28 (curl -L -w url_effective, evidence recorded per query below). If
 * SMD changes its canonicalisation rules, the strings are what a human re-probes
 * — `scripts/v47FamilyAffiliateQuery.test.ts` records the measured result counts
 * so the next probe has a baseline.
 */

import { GENRE_FAMILIES, familyAffiliateUrl } from './genreFamilies';
import {
  SMD_AFFILIATE_ID,
  SMD_SEARCH_ORIGIN,
  SMD_SEARCH_PATH,
  sheetMusicDirectSearchUrl,
} from './searchExternal';

/** The one file that builds every retailer URL the app emits. */
export const SMD_BUILDER_FILE = 'src/services/searchExternal.ts';

/** The family table whose `q` values become money rows. */
export const FAMILY_TABLE_FILE = 'src/services/genreFamilies.ts';

/**
 * THE EXACT QUERIES, per family id — the post-D0 table, every one of them
 * live-probed on 2026-10-28 (`curl -s -o /dev/null -L -w '%{url_effective}'` on
 * the real builder URL, mobile Chrome UA). `results` is SMD's own result count
 * on that page, recorded so the next probe has a baseline to compare against.
 */
export const VERIFIED_FAMILY_QUERIES: Readonly<
  Record<string, { q: string; results: number; note: string }>
> = {
  classical: {
    q: 'classical piano',
    results: 0,
    note: 'unchanged — already kept tid+affiliateId (no count recorded in the audit)',
  },
  'early-jazz-blues': {
    q: 'ragtime sheet music',
    results: 222,
    note: 'was `ragtime` → /genre/ragtime, no params. Disambiguated in v47.',
  },
  'folk-traditional': {
    q: 'sea shanty song',
    results: 94,
    note: 'was `sea shanty` → /artist/sea-shanty, no params. Disambiguated in v47.',
  },
  'patriotic-holiday': {
    q: 'christmas carol sheet music',
    results: 630,
    note: 'was `christmas carol` → /artist/christmas-carol, no params. Disambiguated in v47.',
  },
  'vaudeville-opera-parlor': {
    q: 'vaudeville',
    results: 0,
    note: 'unchanged — single word, but live-probed and it KEEPS tid+affiliateId',
  },
};

/**
 * Terms PROVEN to be canonicalised by SMD, i.e. the exact strings that dropped
 * both affiliate parameters. Never allowed as a family query, whatever the copy
 * deck says. Add a term here only with a `curl -L -w url_effective` result that
 * shows the parameters gone.
 */
export const SMD_CANONICALISED_TERMS: readonly string[] = [
  'ragtime',
  'sea shanty',
  'christmas carol',
];

/**
 * Single words that were LIVE-PROBED and KEPT `tid` + `affiliateId` on
 * `/Search.aspx`. A blanket "no single word" rule would fail these, so the
 * exemption is explicit, dated and evidence-backed rather than assumed:
 * `vaudeville` → `…/Search.aspx?query=vaudeville&tid=67650&affiliateId=67650`
 * (2026-10-28). Anything NOT on this list and not multi-word is refused as
 * unproven.
 */
export const VERIFIED_AFFILIATE_SAFE_TERMS: readonly string[] = ['vaudeville'];

/** Case/space-normalised query, the form SMD matches on. */
function normalise(query: unknown): string {
  if (typeof query !== 'string') return '';
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * PREDICATE 1 — is this query a bare taxonomy term, i.e. a term SMD is likely to
 * canonicalise (and thereby drop our affiliate id)?
 *
 * Order matters: a term proven to drop the id is refused first, then a term
 * proven to keep it is allowed, then any other single word is refused as
 * unproven. Empty is refused (an empty money query is not a money row).
 */
export function isBareTaxonomyTerm(query: unknown): boolean {
  const q = normalise(query);
  if (q === '') return true;
  if (SMD_CANONICALISED_TERMS.indexOf(q) >= 0) return true;
  if (VERIFIED_AFFILIATE_SAFE_TERMS.indexOf(q) >= 0) return false;
  // No space ⇒ one token ⇒ a term SMD may own outright. Multi-word phrases are
  // real searches (the shipped `classical piano`, `ragtime sheet music`, …).
  return q.indexOf(' ') < 0;
}

/**
 * PREDICATE 2 — does a built URL still address a SEARCH (not a canonical page)
 * and carry BOTH affiliate parameters? This is the shape the audit measured on
 * the healthy queries; the redirect itself cannot be reproduced offline.
 */
export function familyMoneyUrlKeepsTheAffiliateId(url: unknown): boolean {
  if (typeof url !== 'string' || url === '') return false;
  // The host comes from the ONE builder's own constant — this module must never
  // name a retailer (purchaseCta.ts guards that app-wide, and rightly so).
  if (url.indexOf(SMD_SEARCH_ORIGIN) !== 0) return false;
  // A canonical page is exactly what loses the id — refuse it by shape.
  if (/\/genre\/|\/artist\//.test(url)) return false;
  if (url.indexOf(SMD_SEARCH_PATH) < 0) return false;
  if (url.indexOf('?') < 0) return false;
  const hasTid = /[?&]tid=67650(&|$)/.test(url);
  const hasAffiliate = /[?&]affiliateId=67650(&|$)/.test(url);
  return hasTid && hasAffiliate;
}

/**
 * PREDICATE 3a — a family TABLE (the shipped one, or a candidate copy) holds the
 * verified queries and no bare taxonomy term. Takes the list so a test can feed
 * a mutated table (`ragtime` restored, a new bare-word family added) and prove
 * the rule bites on the real data shape rather than on a hand-written string.
 */
export function familyTableKeepsTheAffiliateId(
  families: readonly { id: string; q: string }[],
): boolean {
  if (families.length !== 5) return false;
  for (const family of families) {
    const expected = VERIFIED_FAMILY_QUERIES[family.id];
    if (!expected) return false; // an unknown family id has no probe behind it
    if (family.q !== expected.q) return false;
    if (isBareTaxonomyTerm(family.q)) return false;
  }
  return true;
}

/**
 * PREDICATE 3b — the whole shipped family table: every family's query is the
 * verified string, none is a bare taxonomy term, and every family's built URL
 * keeps both affiliate parameters AND searches the family's own phrase.
 */
export function familyMoneyRowsKeepTheAffiliateId(): boolean {
  if (!familyTableKeepsTheAffiliateId(GENRE_FAMILIES)) return false;
  for (const family of GENRE_FAMILIES) {
    const url = familyAffiliateUrl(family);
    if (!url) return false;
    if (!familyMoneyUrlKeepsTheAffiliateId(url)) return false;
    // The row must search THIS family's phrase — never a shared generic one.
    if (url.indexOf(`query=${encodeURIComponent(family.q)}`) < 0) return false;
  }
  return true;
}

/**
 * PREDICATE 4 — the ONE builder still appends both parameters and still points
 * at the search route. Source-scanned: an edit here breaks every commission in
 * the app at once (title queries, family rows, the scan fallback, the backend's
 * mirror), which is why it is pinned rather than trusted.
 */
export function smdBuilderCarriesBothAffiliateParams(source: string): boolean {
  if (typeof source !== 'string') return false;
  if (source.length < 2000) return false;
  if (source.indexOf(`export const SMD_AFFILIATE_ID = '${SMD_AFFILIATE_ID}';`) < 0) return false;
  if (source.indexOf(`export const SMD_SEARCH_PATH = '${SMD_SEARCH_PATH}';`) < 0) return false;
  if (source.indexOf('export function sheetMusicDirectSearchUrl(') < 0) return false;
  // The two parameters, appended by the builder itself (not by a caller).
  if (source.indexOf('&tid=${SMD_AFFILIATE_ID}') < 0) return false;
  if (source.indexOf('&affiliateId=${SMD_AFFILIATE_ID}') < 0) return false;
  return true;
}

/** The five effective URLs, for the report / PR body (built, never hand-written). */
export function familyMoneyUrls(): { id: string; q: string; url: string | undefined }[] {
  return GENRE_FAMILIES.map((family) => ({
    id: family.id,
    q: family.q,
    url: familyAffiliateUrl(family),
  }));
}

/** Convenience for tests: the builder's own output for an arbitrary query. */
export function builtUrlFor(query: string): string | undefined {
  return sheetMusicDirectSearchUrl(query);
}
