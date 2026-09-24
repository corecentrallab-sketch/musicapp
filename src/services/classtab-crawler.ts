/**
 * classtab.org guitar-TAB crawler + LICENSE GATE (owner 09-24: the site promises
 * "guitar tabs" but the catalog has zero guitar sources; crawl classtab for PD
 * pieces already in the catalog — or soften the copy, never overclaim).
 *
 * HARD RULE (owner standing, 08-24): only clearly-licensed public-domain content
 * may become a sheet_music_sources row. Ambiguous or unverifiable -> EXCLUDE.
 * Never host, cache or redistribute a copyrighted file.
 *
 * WHY THE GATE IS THIS STRICT — measured on the full archive (2026-09-24, the
 * site's own 13MB `zip/classtab.zip`, 3,955 `.txt` tab files, all scanned):
 *   - 240 files carry the OLGA-era notice "This file is the author's own work …
 *     You may only use this file for private study, scholarship, or research."
 *     That is a RESTRICTIVE licence: no redistribution, no commercial use — our
 *     product is a commercial app with affiliate CTAs, so those files are out.
 *   - 215 files match the restriction patterns (subset above; some are phrased
 *     differently, e.g. "all rights reserved").
 *   - only 6 of 3,955 files contain ANY permissive phrase, and 4 of those are
 *     about fingerings ("feel free to use your own fingering"), not rights.
 *   - 2 files contain a real rights grant (see PD_GRANTS below): Sor's Grand
 *     Solo Op. 14 (`sor_op14_grand_solo_in_d.txt`) and Robert Dowland's Almain
 *     (`dowland_robert_almande.txt`).
 *   - ~3,700 files say NOTHING about rights at all. Silence is not a licence:
 *     a transcription of a PD work is itself a protected derivative, so "no
 *     statement" is EXCLUDED, not assumed free.
 *   - the archive is not a PD-only source: its own index notes that Concierto de
 *     Aranjuez was removed after legal action by the Spanish copyright agency on
 *     behalf of Rodrigo's family, and it hosts many in-copyright 20th-century
 *     works (Barrios, Ponce, Villa-Lobos, Brouwer…).
 *   - classtab.org publishes no licence page (credits/tabsheet/tabbing/readme were
 *     all checked), so there is no site-level grant to fall back on.
 *
 * The module is pure: no network, no database, no environment. Fetching and
 * writing live in `scripts/classtab-ingest.ts`, so the gate itself is testable
 * offline and can be re-run against a cached index/tab dump.
 */

/** Live index of every tab (composer sections + `.txt`/`.mid` links). */
export const CLASSTAB_INDEX_URL = "https://www.classtab.org/index_old.htm";
/** Tab file base URL — entries in the index are relative hrefs. */
export const CLASSTAB_BASE_URL = "https://www.classtab.org/";
/**
 * Composer death year at or below which a piece is treated as public domain for
 * the US (published before 1930) plus the life+70 rule used in the EU/UK. Sor
 * (1839), Dowland (1641) and Tárrega (1909) clear it comfortably; anything later
 * needs a rights statement that the archive does not provide.
 */
export const PD_DEATH_YEAR_BASELINE = 1929;

// ---------------------------------------------------------------------------
// Text normalisation (titles/composers: diacritics, opus numbers, punctuation)
// ---------------------------------------------------------------------------

/** Lowercase, strip diacritics, drop opus/catalog tokens and punctuation. */
export function normalizeTitle(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(op|bwv|k|kv|hwv|woo|anh|l|d|s|bb|rv|twv)\.?\s*\d+[a-z]?\b/g, " ")
    .replace(/\bno\.?\s*\d+\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that carry the title's identity (drop stop-words and short tokens). */
export function titleTokens(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}
const STOP_WORDS = new Set([
  "major",
  "minor",
  "flat",
  "sharp",
  "sonata",
  "suite",
  "study",
  "etude",
  "arrangement",
  "arranged",
  "version",
  "theme",
]);

/** Surname slug used by classtab filenames: "Fernando Sor" -> "sor". */
export function composerSlug(composer: string): string {
  const cleaned = String(composer ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  // "johann sebastian bach" -> "bach"; "claude debussy" -> "debussy".
  return cleaned[cleaned.length - 1];
}

// ---------------------------------------------------------------------------
// Index parsing
// ---------------------------------------------------------------------------

export interface ClasstabEntry {
  /** Relative href exactly as it appears in the index (`anon_greensleeves.txt`). */
  href: string;
  label: string;
  /** Absolute URL for the source row / the crawl. */
  url: string;
  /** MIDI href when the index advertises one, else null. */
  midiHref: string | null;
  /** Filename prefix before the first underscore (`bach`, `sor`, `anon`). */
  filePrefix: string;
}

/** Parse classtab's flat index into entries (one per tab file link). */
export function parseClasstabIndex(html: string): ClasstabEntry[] {
  const entries: ClasstabEntry[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\s+href="([^"]+\.txt)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const label = decodeEntities(m[2])
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label) continue;
    const midiHref = /\.mid\b/i.test(html.slice(m.index, m.index + 400))
      ? href.replace(/\.txt$/i, ".mid")
      : null;
    entries.push({
      href,
      label,
      url: `${CLASSTAB_BASE_URL}${href}`,
      midiHref,
      filePrefix: href.split("_")[0].toLowerCase(),
    });
  }
  return entries;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&(?:ntilde|Ntilde);/g, (x) => (x === "&ntilde;" ? "ñ" : "Ñ"))
    .replace(/&(?:eacute|Eacute);/g, (x) => (x === "&eacute;" ? "é" : "É"))
    .replace(/&(?:egrave|agrave|ograve|igrave);/g, (x) =>
      ({ "&egrave;": "è", "&agrave;": "à", "&ograve;": "ò", "&igrave;": "ì" })[x] ?? x,
    )
    .replace(/&(?:aacute|iacute|oacute|uacute);/g, (x) =>
      ({ "&aacute;": "á", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú" })[x] ?? x,
    )
    .replace(/&auml;|&ouml;|&uuml;/g, (x) =>
      ({ "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü" })[x] ?? x,
    )
    .replace(/&ccedil;/g, "ç");
}

// ---------------------------------------------------------------------------
// Catalog <-> classtab matching
// ---------------------------------------------------------------------------

export interface CatalogPieceInput {
  id: string;
  title: string;
  composer: string | null;
  catalog?: string | null;
}

export interface ClasstabMatch {
  pieceId: string;
  pieceTitle: string;
  composer: string | null;
  entry: ClasstabEntry;
  score: number;
  /** Why we believe this is the same piece — shown in the audit ledger. */
  reason: string;
}

/**
 * Match catalog pieces to classtab entries. Conservative on purpose: a wrong
 * match would attach the wrong tab to a piece page, which is worse than no TAB.
 */
export function matchCatalogToClasstab(
  pieces: CatalogPieceInput[],
  entries: ClasstabEntry[],
  minScore = 0.6,
): ClasstabMatch[] {
  const prepared = entries.map((e) => ({
    entry: e,
    norm: normalizeTitle(e.label),
    tokens: new Set(titleTokens(normalizeTitle(e.label))),
  }));
  const matches: ClasstabMatch[] = [];
  for (const p of pieces) {
    const title = normalizeTitle(p.title);
    if (title.length < 4) continue;
    const tokens = new Set(titleTokens(title));
    const slug = composerSlug(p.composer ?? "");
    for (const cand of prepared) {
      if (!cand.norm) continue;
      let score = 0;
      let reason = "";
      if (cand.norm === title) {
        score = 1;
        reason = "exact title";
      } else if (cand.norm.includes(title) || title.includes(cand.norm)) {
        score = 0.85;
        reason = "title contained in index label";
      } else if (tokens.size && cand.tokens.size) {
        let shared = 0;
        for (const t of tokens) if (cand.tokens.has(t)) shared++;
        score = (shared / Math.max(tokens.size, cand.tokens.size)) * 0.8;
        reason = shared ? `shared title tokens: ${shared}` : "";
        if (shared === 0) continue;
      }
      // The filename prefix is the composer slug in this archive — a mismatch is
      // a different composer's piece, whatever the title says.
      if (slug.length > 3 && cand.entry.filePrefix !== slug) {
        if (!slug.startsWith(cand.entry.filePrefix.slice(0, 3))) score *= 0.4;
      }
      if (score >= minScore) {
        matches.push({
          pieceId: p.id,
          pieceTitle: p.title,
          composer: p.composer,
          entry: cand.entry,
          score: Number(score.toFixed(3)),
          reason,
        });
      }
    }
  }
  matches.sort((a, b) => b.score - a.score || a.pieceTitle.localeCompare(b.pieceTitle));
  return matches;
}

// ---------------------------------------------------------------------------
// LICENSE GATE
// ---------------------------------------------------------------------------

export type LicenseVerdict =
  | "PD_CLEARED"
  | "RESTRICTED"
  | "NO_LICENSE_STATEMENT";

export interface LicenseAssessment {
  verdict: LicenseVerdict;
  /** Rights-granting lines found in the tab file (evidence, not paraphrase). */
  grants: string[];
  /** Restrictive lines found in the tab file (evidence). */
  restrictions: string[];
  /** One-line why, safe to paste into the PR report / curation_log. */
  reason: string;
  /** Composer death year parsed from the file header, when the file states it. */
  composerDied: number | null;
}

/** Lines that grant rights over the file's content (permissive). */
export const PD_GRANT_PATTERNS: RegExp[] = [
  /public domain/i,
  /free of rights/i,
  /no rights reserved/i,
  /\bCC0\b/,
  /creative commons/i,
  /\bCC[ -]?BY\b/i,
  /share[- ]alike/i,
  /permission to (?:use|copy|distribute|publish)/i,
  /may be (?:freely|used|distributed|copied|reproduced)/i,
  // "feel free to use IT/THIS" grants use of the work; "feel free to use your
  // own fingering" does not — hence the explicit object.
  /feel free to use (?:it|this|the (?:tab|tablature|piece|music))/i,
  /free to use (?:it|this|the (?:tab|tablature|piece|music))/i,
  /(?:use|reproduce|distribute) (?:it|this) for any purpose/i,
];

/** Lines that restrict use — these always win over a grant. */
export const RESTRICTION_PATTERNS: RegExp[] = [
  /may only use/i,
  /private study/i,
  /author'?s own work/i,
  /all rights reserved/i,
  /not for (?:sale|resale|profit)/i,
  /do not (?:copy|distribute|sell|redistribute)/i,
  /unauthori[sz]ed (?:copying|distribution)/i,
];

const MAX_HEADER_LINES = 120;

/**
 * Classify the licence of a tab file from its own text.
 *
 * Order matters: an explicit restriction beats any grant (the archive's OLGA-era
 * header sits in files that also invite fingering suggestions), and a file that
 * says nothing about rights is NOT public domain — it is EXCLUDED as ambiguous.
 */
export function classifyTabLicense(tabText: string): LicenseAssessment {
  const lines = String(tabText ?? "")
    .split(/\r?\n/)
    .slice(0, MAX_HEADER_LINES);
  const grants = lines
    .filter((l) => PD_GRANT_PATTERNS.some((p) => p.test(l)))
    .map((l) => l.replace(/^[#*\s]+/, "").replace(/[#*\s]+$/, "").trim())
    .slice(0, 4);
  const restrictions = lines
    .filter((l) => RESTRICTION_PATTERNS.some((p) => p.test(l)))
    .map((l) => l.replace(/^[#*\s]+/, "").replace(/[#*\s]+$/, "").trim())
    .slice(0, 4);
  const composerDied = extractComposerDeathYear(tabText);
  if (restrictions.length > 0) {
    return {
      verdict: "RESTRICTED",
      grants,
      restrictions,
      reason: `restrictive notice in tab file: "${restrictions[0]}"`,
      composerDied,
    };
  }
  if (grants.length > 0) {
    return {
      verdict: "PD_CLEARED",
      grants,
      restrictions,
      reason: `explicit rights grant in tab file: "${grants[0]}"`,
      composerDied,
    };
  }
  return {
    verdict: "NO_LICENSE_STATEMENT",
    grants,
    restrictions,
    reason: "tab file states no licence at all — silence is not a grant",
    composerDied,
  };
}

/** Composer death year, from a header like "Francisco Tarrega (1852-1909)". */
export function extractComposerDeathYear(tabText: string): number | null {
  const head = String(tabText ?? "")
    .split(/\r?\n/)
    .slice(0, MAX_HEADER_LINES)
    .join("\n");
  const range = head.match(/\(\s*(1\d{3})\s*[-–—]\s*(1\d{3})\s*\)/);
  if (range) return Number(range[2]);
  const died = head.match(/d(?:ied|\.)\s*:?\s*(1\d{3})/i);
  return died ? Number(died[1]) : null;
}

/** True when the composer is unambiguously public domain (see baseline above). */
export function isPublicDomainComposer(
  diedYear: number | null,
  baseline = PD_DEATH_YEAR_BASELINE,
): boolean {
  return diedYear !== null && diedYear <= baseline;
}

// ---------------------------------------------------------------------------
// Tab content extraction + row building
// ---------------------------------------------------------------------------

export interface TabContent {
  /** First non-empty line — the tab's own title banner. */
  headline: string;
  /** Named transcriber when the file states one. */
  tabulator: string | null;
  /** Tuning string when the file states one. */
  tuning: string | null;
  /** ASCII tab staff lines (6-string frames) actually found in the file. */
  tabLineCount: number;
  totalLines: number;
  /** True when there is real tablature to read, not just a stub/error page. */
  hasTablature: boolean;
}

/**
 * A six-string tab frame: the string letter, then bars/measures of fret numbers.
 * Kept deliberately loose — real files write "E|--0--|", "e  |--0--|" and
 * "E  -0|---|" — so the test is "starts with a string letter, carries at least
 * three bar lines, and is mostly tab characters".
 */
const TAB_STAFF_RE = /^[eEbBgGdDaA][^a-zA-Z]{9,}$/;
const hasTabStaff = (line: string): boolean => {
  const t = line.trim();
  if (!TAB_STAFF_RE.test(t)) return false;
  return (t.match(/\|/g) ?? []).length >= 3;
};

/** Extract the useful shape of a tab file without copying its body around. */
export function parseTabContent(tabText: string): TabContent {
  const raw = String(tabText ?? "");
  const lines = raw.split(/\r?\n/);
  const headline = lines.find((l) => l.trim().length > 0)?.trim().slice(0, 200) ?? "";
  const tabulator =
    raw.match(/^\s*(?:Tablature by|Transcribed by|Tab(?:bed)? by|TablEdited by)\s*:?\s*(.+)$/im)?.[1]?.trim() ??
    null;
  const tuning = raw.match(/tuning\s*:?\s*([^\n]{3,40})/i)?.[1]?.trim() ?? null;
  const tabLineCount = lines.filter((l) => hasTabStaff(l)).length;
  return {
    headline,
    tabulator,
    tuning,
    tabLineCount,
    totalLines: lines.length,
    hasTablature: tabLineCount >= 6,
  };
}

export interface SourceRowPayload {
  pieceId: string;
  sourcePlatform: "classtab";
  sourceUrl: string;
  format: "text_tab";
  arrangementType: "guitar";
  rating: number;
  voteCount: number;
  downloadCount: number;
  sourceTrust: number;
  curationScore: number;
  isPrimary: boolean;
  isFlagged: boolean;
}

/** trust/score values consistent with the curated Mutopia rows (0.9 / 0.85). */
export const CLASSTAB_SOURCE_TRUST = 0.7; // schema-endorsed (002_sheet_music_sources.sql)
export const CLASSTAB_CURATION_SCORE = 0.6;

export interface GateDecision {
  pieceId: string;
  pieceTitle: string;
  composer: string | null;
  sourceUrl: string;
  included: boolean;
  /** Machine-readable reason, recorded for every exclusion. */
  reason: string;
  verdict: LicenseVerdict;
  composerDied: number | null;
  licenseEvidence: string[];
  tab: TabContent | null;
  row: SourceRowPayload | null;
}

/**
 * The one place that decides whether a crawled tab may become a catalog row.
 * Anything that is not `PD_CLEARED` with a PD composer is excluded, with the
 * reason kept for the report.
 */
export function gateTabForCatalog(
  match: ClasstabMatch,
  tabText: string | null,
  opts: { now?: number; pdBaseline?: number } = {},
): GateDecision {
  const baseline = opts.pdBaseline ?? PD_DEATH_YEAR_BASELINE;
  const base = {
    pieceId: match.pieceId,
    pieceTitle: match.pieceTitle,
    composer: match.composer,
    sourceUrl: match.entry.url,
  };
  if (!tabText) {
    return {
      ...base,
      included: false,
      verdict: "NO_LICENSE_STATEMENT",
      composerDied: null,
      licenseEvidence: [],
      tab: null,
      reason: "tab file could not be fetched (or 404 page) — nothing to license",
      row: null,
    };
  }
  const assessment = classifyTabLicense(tabText);
  const tab = parseTabContent(tabText);
  const evidence = [...assessment.restrictions, ...assessment.grants];
  if (!tab.hasTablature) {
    return {
      ...base,
      included: false,
      verdict: assessment.verdict,
      composerDied: assessment.composerDied,
      licenseEvidence: evidence,
      tab,
      reason: "fetched file is not tablature (stub/404 page)",
      row: null,
    };
  }
  if (assessment.verdict !== "PD_CLEARED") {
    return {
      ...base,
      included: false,
      verdict: assessment.verdict,
      composerDied: assessment.composerDied,
      licenseEvidence: evidence,
      tab,
      reason: assessment.reason,
      row: null,
    };
  }
  if (!isPublicDomainComposer(assessment.composerDied, baseline)) {
    return {
      ...base,
      included: false,
      verdict: assessment.verdict,
      composerDied: assessment.composerDied,
      licenseEvidence: evidence,
      tab,
      reason:
        assessment.composerDied === null
          ? "composer death year not stated in the tab file — PD status unverifiable"
          : `composer died ${assessment.composerDied} (after ${baseline}) — not clearly PD`,
      row: null,
    };
  }
  return {
    ...base,
    included: true,
    verdict: assessment.verdict,
    composerDied: assessment.composerDied,
    licenseEvidence: evidence,
    tab,
    reason: `PD-cleared: ${assessment.reason}; composer died ${assessment.composerDied}`,
    row: {
      pieceId: match.pieceId,
      sourcePlatform: "classtab",
      sourceUrl: match.entry.url,
      format: "text_tab",
      arrangementType: "guitar",
      rating: 0,
      voteCount: 0,
      downloadCount: 0,
      sourceTrust: CLASSTAB_SOURCE_TRUST,
      curationScore: CLASSTAB_CURATION_SCORE,
      isPrimary: false,
      isFlagged: false,
    },
  };
}
