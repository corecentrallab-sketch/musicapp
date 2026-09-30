/**
 * sheetLicenseGate — the ONE gate every free (non-affiliate) score must pass before it can
 * become a catalog row. Owner standing rule: only clearly-licensed public-domain / CC
 * content may be hosted; a restrictive or silent licence is EXCLUDED, never "coming soon"-ed
 * into the product as if it were free, and never hosted.
 *
 * Provenance: the rule set is the classtab.org licence gate from PR #126
 * (`src/services/classtab-crawler.ts`, commit 4d8aa2d0 — merged on the site branch, which is
 * where the ingestion scripts live). This module is the SOURCE-AGNOSTIC version used by the
 * free guitar/keyboard batch (Mutopia typeset editions); the classtab gate stays as-is for
 * the TAB crawler. Verdicts, the "a restriction always beats a grant" ordering and the
 * "silence is not a licence" rule are identical on purpose, so one mental model covers both.
 *
 * The five inclusion rules (all mandatory, see gateGuitarSheet):
 *   1. the source page states a permissive licence (PD or a commercial-use CC licence);
 *   2. the composer is unambiguously public domain (death year known, <= baseline);
 *   3. the score is PROVEN TYPESET (a LilyPond/engraving source exists on the same page) —
 *      a scan cannot satisfy our readability bar, so scans are refused;
 *   4. the score is guitar-accessible (guitar / lute / vihuela instrumentation);
 *   5. the hosted copy's integrity record is complete (64-hex sha256, real byte size, >= 1 page).
 *
 * Pure module: no network, no database, no environment (compiled by tsconfig.tier1.json and
 * exercised offline by scripts/pdGuitarCatalog.test.ts).
 */
import type { GuitarPdPiece } from "./pdGuitarCatalog";

// ---------------------------------------------------------------------------
// Where a hosted score is served from
// ---------------------------------------------------------------------------

/** The one deployment that serves public score PDFs (see site sheet-handler.ts). */
export const SHEET_URL_BASE = "https://site-notesnap.vercel.app";

/** R2 object key for a hosted score — keyed by the PIECE id, as the site route requires. */
export const R2_SHEET_KEY_PREFIX = "sheets/";

/** UUID shape the site's /api/sheets/<id>.pdf route accepts. */
export const PIECE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** R2 object key for a piece's hosted score (`sheets/<piece-id>.pdf`). */
export function sheetObjectKey(pieceId: string): string {
  if (!PIECE_ID_RE.test(String(pieceId ?? ""))) {
    throw new Error(`sheetObjectKey: not a piece id (uuid): ${String(pieceId)}`);
  }
  return `${R2_SHEET_KEY_PREFIX}${pieceId}.pdf`;
}

/**
 * The public, in-app-openable URL for a piece's score. Built in ONE place so a piece can
 * never be pointed at a raw R2 URL (401 for anonymous GET), at a source-site page that needs
 * a session, or at another piece's score.
 */
export function sheetUrlForPieceId(pieceId: string): string {
  if (!PIECE_ID_RE.test(String(pieceId ?? ""))) {
    throw new Error(`sheetUrlForPieceId: not a piece id (uuid): ${String(pieceId)}`);
  }
  return `${SHEET_URL_BASE}/api/sheets/${pieceId}.pdf`;
}

/** Result of reversing a hosted sheet URL back to its piece id (null when it is not ours). */
export function pieceIdFromSheetUrl(url: string): string | null {
  const m = String(url ?? "").match(/^https:\/\/site-notesnap\.vercel\.app\/api\/sheets\/([0-9a-fA-F-]{36})\.pdf$/);
  if (!m) return null;
  return PIECE_ID_RE.test(m[1]) ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Licence classification
// ---------------------------------------------------------------------------

/** A licence verdict, mirroring the classtab gate's vocabulary. */
export type SheetLicenseVerdict = "PD_CLEARED" | "CC_CLEARED" | "RESTRICTED" | "NO_LICENSE_STATEMENT";

export interface SheetLicenseAssessment {
  verdict: SheetLicenseVerdict;
  /** Rights-granting text found on the source page (evidence, not paraphrase). */
  grants: string[];
  /** Restrictive text found on the source page (evidence). */
  restrictions: string[];
  /** One-line why, safe to paste into the PR report / curation log. */
  reason: string;
}

/** Text that grants public-domain status. */
export const PD_GRANT_PATTERNS: RegExp[] = [
  /public domain/i,
  /publicdomain/i,
  /\bCC0\b/,
  /no rights reserved/i,
];

/** Text that grants a Creative Commons licence usable commercially. */
export const CC_GRANT_PATTERNS: RegExp[] = [
  /creative commons/i,
  /\bCC[ -]?BY\b/i,
  /attribution-sha?realike/i,
  /attribution[ -]share ?alike/i,
];

/**
 * Text that restricts use. A restriction ALWAYS beats a grant (same ordering as the classtab
 * gate): "Public Domain in the US; not for commercial use" is not a licence we can host under.
 */
export const LICENSE_RESTRICTION_PATTERNS: RegExp[] = [
  /non-?commercial/i,
  /\bNC\b/,
  /no derivative/i,
  /\bND\b/,
  /all rights reserved/i,
  /may only use/i,
  /private study/i,
  /not for (?:sale|resale|profit|commercial)/i,
  /permission (?:is )?required/i,
  /by permission/i,
  /performance restricted/i,
  /IMSLP license/i,
  /non-?pd/i,
  /unauthori[sz]ed (?:copying|distribution)/i,
];

/** Classify the copyright line a source page prints (order matters: restriction wins). */
export function classifySheetLicense(labelText: string): SheetLicenseAssessment {
  const text = String(labelText ?? "").trim();
  const grants = [] as string[];
  const restrictions = [] as string[];
  if (PD_GRANT_PATTERNS.some((p) => p.test(text))) grants.push(text);
  if (CC_GRANT_PATTERNS.some((p) => p.test(text))) grants.push(text);
  if (LICENSE_RESTRICTION_PATTERNS.some((p) => p.test(text))) restrictions.push(text);
  if (restrictions.length > 0) {
    return {
      verdict: "RESTRICTED",
      grants,
      restrictions,
      reason: `restrictive licence text: "${restrictions[0]}"`,
    };
  }
  if (PD_GRANT_PATTERNS.some((p) => p.test(text))) {
    return { verdict: "PD_CLEARED", grants, restrictions, reason: `public-domain grant: "${text}"` };
  }
  if (CC_GRANT_PATTERNS.some((p) => p.test(text))) {
    return { verdict: "CC_CLEARED", grants, restrictions, reason: `Creative Commons grant: "${text}"` };
  }
  return {
    verdict: "NO_LICENSE_STATEMENT",
    grants,
    restrictions,
    reason: `no licence stated ("${text}") — silence is not a licence`,
  };
}

// ---------------------------------------------------------------------------
// Public-domain composers
// ---------------------------------------------------------------------------

/**
 * Death year at or below which a work is treated as public domain for the US (published
 * before 1930) plus the life+70 rule used in the EU/UK — the same baseline the classtab gate
 * uses. Every composer in the free guitar batch clears it comfortably (latest: Tárrega 1909).
 */
export const PD_DEATH_YEAR_BASELINE = 1929;

/** Death years of the composers this batch is allowed to carry (no guessing: named set). */
export const COMPOSER_DEATH_YEARS: Record<string, number> = {
  "johann sebastian bach": 1750,
  "francisco tárrega": 1909,
  "francisco tarrega": 1909,
  "matteo carcassi": 1853,
  "luis de milán": 1561,
  "luis de milan": 1561,
  "gaspar sanz": 1710,
  "fernando sor": 1839,
};

/** True when the composer is unambiguously public domain (known death year <= baseline). */
export function isPublicDomainComposer(
  composer: string,
  years: Record<string, number> = COMPOSER_DEATH_YEARS,
  baseline = PD_DEATH_YEAR_BASELINE,
): boolean {
  const died = years[String(composer ?? "").trim().toLowerCase()];
  return typeof died === "number" && died <= baseline;
}

/** The composer's death year when we know it (else null). */
export function composerDeathYear(
  composer: string,
  years: Record<string, number> = COMPOSER_DEATH_YEARS,
): number | null {
  const died = years[String(composer ?? "").trim().toLowerCase()];
  return typeof died === "number" ? died : null;
}

// ---------------------------------------------------------------------------
// Quality + integrity rules
// ---------------------------------------------------------------------------

/** Instruments this free batch may carry: guitar-family scores a learner can actually play. */
export const GUITAR_ACCESSIBLE_RE = /guitar|lute|vihuela/i;

/** A score must be provably typeset: an engraving source (LilyPond `.ly`) next to the PDF. */
export const ENGRAVING_SOURCE_RE = /^https:\/\/www\.mutopiaproject\.org\/ftp\/.+\.ly$/;

/** Sources we have audited and will accept files from (nothing else, no session-gated hosts). */
export const APPROVED_SOURCE_HOSTS: string[] = ["www.mutopiaproject.org"];

/** sha256 of a hosted PDF — 64 lowercase hex characters. */
export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Quality floor: below this the PDF is a stub/one-liner, not a readable score. */
export const MIN_SCORE_BYTES = 20000;

/** Every URL here must be https on an approved source host. */
export function isApprovedSourceUrl(url: string): boolean {
  try {
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "https:") return false;
    if (!APPROVED_SOURCE_HOSTS.includes(u.hostname)) return false;
    // IMSLP's image links are session-gated and 404 for anonymous clients — refuse outright.
    if (/Special:ImagefromIndex|Special:ReverseLookup/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface GuitarSheetGateDecision {
  slug: string;
  title: string;
  composer: string;
  included: boolean;
  verdict: SheetLicenseVerdict;
  composerDied: number | null;
  /** Evidence lines recorded in curation_log for every decision, included or not. */
  licenseEvidence: string[];
  reason: string;
}

/**
 * The ONE function that decides whether a free sheet may become a catalog row. Anything that
 * is not a cleared licence + a PD composer + a proven typeset + a guitar-accessible
 * instrument + a complete integrity record is EXCLUDED with its reason kept for the report.
 */
export function gateGuitarSheet(piece: GuitarPdPiece): GuitarSheetGateDecision {
  const base = {
    slug: piece?.slug ?? "",
    title: piece?.title ?? "",
    composer: piece?.composer ?? "",
  };
  const assessment = classifySheetLicense(piece?.licenseLabel ?? "");
  const died = composerDeathYear(base.composer);
  const evidence = [
    `license: ${piece?.licenseLabel ?? "(none)"}`,
    `license_page: ${piece?.licenseHref ?? "(none)"}`,
    `source_info: ${piece?.sourceInfoUrl ?? "(none)"}`,
    `typeset: ${piece?.typesetWith ?? "(unknown)"}`,
  ];

  const fail = (verdict: SheetLicenseVerdict, reason: string): GuitarSheetGateDecision => ({
    ...base,
    included: false,
    verdict,
    composerDied: died,
    licenseEvidence: evidence,
    reason,
  });

  if (assessment.verdict === "RESTRICTED") return fail("RESTRICTED", assessment.reason);
  if (assessment.verdict === "NO_LICENSE_STATEMENT") {
    return fail("NO_LICENSE_STATEMENT", assessment.reason);
  }
  if (!isPublicDomainComposer(base.composer)) {
    return fail(
      assessment.verdict,
      died === null
        ? `composer "${base.composer}" is not in the audited PD set — status unverifiable`
        : `composer died ${died} (after ${PD_DEATH_YEAR_BASELINE}) — not clearly PD`,
    );
  }
  if (!ENGRAVING_SOURCE_RE.test(String(piece?.engravingSourceUrl ?? ""))) {
    return fail(
      assessment.verdict,
      "no LilyPond/engraving source next to the PDF — a scan cannot prove our readability bar",
    );
  }
  if (!GUITAR_ACCESSIBLE_RE.test(String(piece?.instrument ?? ""))) {
    return fail(assessment.verdict, `instrument "${piece?.instrument ?? ""}" is not guitar-accessible`);
  }
  for (const url of [piece?.sourceInfoUrl, piece?.sourcePdfUrl, piece?.engravingSourceUrl, piece?.midiUrl]) {
    if (!isApprovedSourceUrl(String(url ?? ""))) {
      return fail(assessment.verdict, `source URL not on an approved host: ${String(url)}`);
    }
  }
  if (!SHA256_RE.test(String(piece?.sha256 ?? ""))) {
    return fail(assessment.verdict, "hosted copy has no sha256 — the audited bytes are unprovable");
  }
  if (!(typeof piece?.bytes === "number" && piece.bytes >= MIN_SCORE_BYTES)) {
    return fail(assessment.verdict, `score is ${String(piece?.bytes)} bytes — too small to be a real score`);
  }
  if (!(typeof piece?.pageCount === "number" && piece.pageCount >= 1)) {
    return fail(assessment.verdict, "score page count is unknown");
  }
  return {
    ...base,
    included: true,
    verdict: assessment.verdict,
    composerDied: died,
    licenseEvidence: evidence,
    reason: `${assessment.reason}; composer died ${died}; typeset ${piece.typesetWith}; ${piece.pageCount} page(s)`,
  };
}

// ---------------------------------------------------------------------------
// Catalog audit (used by the contract test; the same checks guard the ingest script)
// ---------------------------------------------------------------------------

/** Claim strings that would overclaim what we host — free SCORES, never "free tabs". */
export const OVERCLAIM_PATTERNS: RegExp[] = [
  /free\s+tabs?\b/i,
  /free\s+tablature/i,
  /free\s+guitar\s+tabs?/i,
];

export interface CatalogAudit {
  problems: string[];
  included: GuitarPdPiece[];
  excluded: GuitarSheetGateDecision[];
}

/**
 * Audit the whole batch: the gate on every entry, plus the URL/routing checks a test can see
 * offline (unique slugs -> no two pieces sharing one score URL, https-only, no raw R2 host, no
 * overclaim copy in the data we ship).
 */
export function auditGuitarPdCatalog(pieces: GuitarPdPiece[]): CatalogAudit {
  const problems: string[] = [];
  const included: GuitarPdPiece[] = [];
  const excluded: GuitarSheetGateDecision[] = [];
  const slugs = new Set<string>();

  for (const piece of pieces) {
    const decision = gateGuitarSheet(piece);
    if (decision.included) included.push(piece);
    else {
      excluded.push(decision);
      problems.push(`gate refused ${decision.slug || decision.title}: ${decision.reason}`);
    }
    if (slugs.has(piece.slug)) problems.push(`duplicate slug "${piece.slug}" — two pieces would share a sheet URL`);
    slugs.add(piece.slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(piece.slug)) {
      problems.push(`slug "${piece.slug}" is not lowercase-hyphenated`);
    }
    if (typeof piece.difficulty !== "number" || piece.difficulty < 1 || piece.difficulty > 10) {
      problems.push(`${piece.slug}: difficulty ${String(piece.difficulty)} is outside the 1-10 catalog grade`);
    }
    const blob = JSON.stringify(piece);
    for (const re of OVERCLAIM_PATTERNS) {
      if (re.test(blob)) problems.push(`${piece.slug}: overclaim copy ${String(re)} — free scores, never "free tabs"`);
    }
  }
  if (pieces.length === 0) problems.push("the free guitar batch is empty");
  return { problems, included, excluded };
}
