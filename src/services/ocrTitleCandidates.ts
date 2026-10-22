/**
 * ocrTitleCandidates.ts — WHAT A COVER PHOTO'S TEXT RECOGNISER ACTUALLY RETURNED,
 * turned into at most three title suggestions — or an honest "that is a page of
 * music, not a cover" (v43 item C2, owner decisions 10-20).
 *
 * THE OWNER'S CASE. A score was photographed and the app read
 * "4ox 2Apx ors white Freddie Mer" / "a-thy,Be-cause I'm Freddie Mercury" and then
 * SEARCHED IT, landed on "No Match", and left the user holding a result for words
 * they never typed. The v42 fix made those words a PROPOSAL rather than an
 * auto-query (services/ocrPrefill.ts) — this module goes one step further and
 * decides, before any surface sees a string, whether the read is even a title.
 *
 * WHAT IT DECIDES (all deterministic, all unit-testable):
 *   1. NOTATION, NOT A COVER — a page of printed music is not a title page. When
 *      every block is symbol debris (or the page is mostly symbol-only blocks) the
 *      read is `garbage` with reason `notation`, and the surface says so instead
 *      of searching anything.
 *   2. WHICH BLOCK IS THE TITLE — the recogniser's own GEOMETRY is the evidence:
 *      the block with the tallest median element height, in the top band of the
 *      page, with a high letter share, a short token count, and not a line of
 *      cover furniture ("PIANO SOLO", "HAL LEONARD") wins.
 *   3. BROKEN TOKENS NEVER COUNT — `isGarbledOcrToken` / `hasGluedInnerPunctuation`
 *      (services/coverScan.ts) plus the digit-glued rule below.
 *   4. THE CORPUS — the cleaned read is ranked against whatever titles the caller
 *      knows (the live catalog) plus the bundled alias list (services/ocrTitleCorpus),
 *      with `rankFuzzyMatches`' own substitute floor.
 *
 * THE STRUCTURAL GUARANTEE (the point of the whole item): `query` is null whenever
 * `quality === 'garbage'`. A garbage read cannot reach a search box, a search, or a
 * licensed-retailer link — not because a surface remembers to check, but because
 * there is no string to pass on.
 *
 * HONEST SCOPE. This reads the WORDS printed on a page. It is not OMR, it never
 * reads the notes, it produces no note data, and no edition is claimed.
 *
 * PURE: no react, no react-native, no fs, no network. Compiled by
 * tsconfig.tier1.json and asserted by scripts/ocrTitleCandidates.test.ts.
 */
import {
  SUBSTITUTE_MIN_SCORE,
  normalizeSearchText,
  rankFuzzyMatches,
  searchTokens,
} from './fuzzySearch';
import {
  coverTitleScore,
  hasGluedInnerPunctuation,
  isCoverFurnitureLine,
  isGarbledOcrToken,
  isGarbageOcrLine,
  isLikelyComposerLine,
  ocrLetterShare,
} from './coverScan';

// ─── the geometry the recogniser already gives us (no new dependency) ────────

/** A rectangle in IMAGE PIXELS (ML Kit's own frame). */
export interface OcrFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrElement {
  text: string;
  frame: OcrFrame | null;
}

export interface OcrLine {
  text: string;
  frame: OcrFrame | null;
  elements: OcrElement[];
}

export interface OcrBlock {
  text: string;
  frame: OcrFrame | null;
  lines: OcrLine[];
}

/** The photo's pixel size — frames are in these units, not in screen points. */
export interface OcrImageSize {
  width: number;
  height: number;
}

// ─── the corpus shape ───────────────────────────────────────────────────────

export interface OcrTitleCorpusEntry {
  /** The piece id when the caller knows it (the live catalog's own row). */
  id?: string | null;
  title: string;
  composer?: string | null;
  /** 'catalog' = a piece we hold; 'modern' = a song we route to a retailer. */
  source?: 'catalog' | 'modern';
}

export type OcrTitleQuality = 'good' | 'weak' | 'garbage';

/** Why the read landed where it did — the surface turns this into one line. */
export type OcrTitleReason = 'title' | 'weak' | 'notation' | 'garbled' | 'empty';

export interface OcrTitleCandidate {
  title: string;
  composer: string | null;
  /** The fuzzy rank score (0…1) against the cleaned read. */
  score: number;
  source: 'catalog' | 'modern';
  /** The piece id, when the corpus entry carries one. */
  id: string | null;
  /** The words to search with if the host cannot open the piece itself. */
  query: string;
}

export interface OcrTitleResult {
  /** At most three, best first. Empty when nothing in the corpus answers the read. */
  candidates: OcrTitleCandidate[];
  quality: OcrTitleQuality;
  reason: OcrTitleReason;
  /**
   * The words a surface may offer to search — NULL whenever the read is garbage.
   * This is the structural guarantee: a garbage read has no query at all.
   */
  query: string | null;
  /** The cleaned title (and composer) line, for the editable field. */
  cleanedRead: string;
  titleLine: string | null;
  composerLine: string | null;
}

// ─── the numbers ────────────────────────────────────────────────────────────

/** Below this letter share a block is symbols, not words (notation page). */
export const OCR_MIN_BLOCK_LETTER_SHARE = 0.55;
/** A block this thin on letters is a symbol-only block. */
export const OCR_SYMBOL_BLOCK_SHARE = 0.35;
/** This many symbol-only blocks on one page is a page of music. */
export const OCR_MAX_SYMBOL_BLOCKS = 3;
/** The top band of the page, where a printed title lives. */
export const OCR_TITLE_BAND = 0.45;
/** More significant tokens than this is a line of cover furniture, not a title. */
export const OCR_MAX_TITLE_TOKENS = 6;
/** At or above this score the block is confidently the title. */
export const OCR_GOOD_TITLE_SCORE = 2.4;
/** How many suggestions a cover read may offer. */
export const OCR_TITLE_LIMIT = 3;
/** The field's own limit (shared with services/coverScan). */
export const OCR_QUERY_MAX = 80;

/** Words that legitimately glue a digit to a letter ("BWV1068", "Op.27"). */
const CATALOG_PREFIXES: readonly string[] = [
  'bwv', 'buxwv', 'kv', 'k', 'op', 'opus', 'woo', 'hob', 'rv', 'sww', 'd', 'hh', 'no', 'b',
];

// ─── small, deterministic helpers ───────────────────────────────────────────

/** The line's text with its whitespace collapsed (never rewritten otherwise). */
export function cleanOcrLine(text: string | null | undefined): string {
  return (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
}

function median(values: readonly number[]): number {
  const sorted = [...values].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The typical printed height of the letters in this block (0 when unknown). */
export function blockMedianElementHeight(block: OcrBlock | null | undefined): number {
  if (!block || !Array.isArray(block.lines)) return 0;
  const heights: number[] = [];
  for (const line of block.lines) {
    const elements = Array.isArray(line?.elements) ? line.elements : [];
    for (const element of elements) {
      const height = element?.frame?.height;
      if (typeof height === 'number' && height > 0) heights.push(height);
    }
    const lineHeight = line?.frame?.height;
    if (heights.length === 0 && typeof lineHeight === 'number' && lineHeight > 0) {
      heights.push(lineHeight);
    }
  }
  return median(heights);
}

/** Is this block's vertical centre in the top band of the photo? */
export function isInTitleBand(frame: OcrFrame | null, imageSize: OcrImageSize | null): boolean {
  if (!frame || !imageSize || imageSize.height <= 0) return false;
  const centre = frame.y + frame.height / 2;
  return centre <= imageSize.height * OCR_TITLE_BAND;
}

/**
 * IS THIS ONE TOKEN A BROKEN READ? The v40 rules (services/coverScan) plus the
 * rule this item needed: a DIGIT GLUED INTO a word ("4ox", "2Apx") is debris,
 * while a real catalogue number ("BWV1068", "Op.27") is not.
 */
export function isBrokenOcrToken(token: string | null | undefined): boolean {
  const raw = (typeof token === 'string' ? token : '').trim();
  if (raw.length === 0) return false;
  if (isGarbledOcrToken(raw)) return true;
  if (hasGluedInnerPunctuation(raw)) return true;
  const letters = raw.replace(/[^\p{L}]/gu, '');
  const digits = raw.replace(/[^\p{N}]/gu, '');
  if (digits.length === 0 || letters.length === 0) return false;
  // A digit touching a letter, with no space or mark between them.
  if (!/[A-Za-z]\d|\d[A-Za-z]/.test(raw)) return false;
  // …unless the letters are a catalogue prefix ("BWV1068", "KV331").
  return !CATALOG_PREFIXES.includes(letters.toLowerCase());
}

/**
 * Is this line debris? The v40 line rules, plus: TWO tokens with a digit glued
 * into them is the recogniser mis-firing on the same page twice — the owner's
 * "4ox 2Apx ors white Freddie Mer".
 */
export function isBrokenOcrLine(line: string | null | undefined): boolean {
  const text = cleanOcrLine(line);
  if (text.length === 0) return true;
  if (isGarbageOcrLine(text)) return true;
  const tokens = text.split(' ').filter((token) => token.length > 0);
  const broken = tokens.filter((token) => isBrokenOcrToken(token)).length;
  return broken >= 2;
}

/** A page of printed music: no block with real words, or mostly symbol blocks. */
export function isNotationRead(blocks: readonly OcrBlock[] | null | undefined): boolean {
  const list = Array.isArray(blocks) ? blocks.filter((block) => cleanOcrLine(block?.text).length > 0) : [];
  if (list.length === 0) return false;
  const letterShares = list.map((block) => ocrLetterShare(cleanOcrLine(block.text)));
  const readable = letterShares.filter((share) => share >= OCR_MIN_BLOCK_LETTER_SHARE).length;
  if (readable === 0) return true;
  const symbolBlocks = letterShares.filter((share) => share < OCR_SYMBOL_BLOCK_SHARE).length;
  return symbolBlocks >= OCR_MAX_SYMBOL_BLOCKS && symbolBlocks > readable;
}

/**
 * How much this block looks like the printed TITLE: geometry first (the title is
 * printed biggest, near the top), then letter share and title-shaped words, minus
 * a penalty for a long line of furniture.
 */
export function scoreTitleBlock(
  block: OcrBlock,
  imageSize: OcrImageSize | null,
  tallestHeight: number,
): number {
  const text = cleanOcrLine(block?.text);
  if (text.length === 0) return 0;
  // A line of nothing but cover furniture is never the title.
  if (isCoverFurnitureLine(text)) return 0;
  const tokens = searchTokens(text);
  if (tokens.length === 0) return 0;
  const height = blockMedianElementHeight(block);
  const heightPart = tallestHeight > 0 ? Math.min(1, height / tallestHeight) : 0;
  const topPart = isInTitleBand(block.frame, imageSize) ? 1 : 0;
  const letterPart = ocrLetterShare(text);
  const formPart = Math.min(1, coverTitleScore(text) / 4);
  const tokenPenalty =
    tokens.length > OCR_MAX_TITLE_TOKENS ? (tokens.length - OCR_MAX_TITLE_TOKENS) * 0.5 : 0;
  return heightPart * 3 + topPart * 1.5 + letterPart * 1 + formPart * 1 - tokenPenalty;
}

function capQuery(text: string): string {
  const cleaned = cleanOcrLine(text);
  return cleaned.length > OCR_QUERY_MAX ? cleaned.slice(0, OCR_QUERY_MAX).trim() : cleaned;
}

function toCandidate(
  entry: OcrTitleCorpusEntry,
  score: number,
): OcrTitleCandidate {
  const title = cleanOcrLine(entry?.title);
  const composer = cleanOcrLine(entry?.composer ?? '') || null;
  return {
    title,
    composer,
    score,
    source: entry?.source === 'modern' ? 'modern' : 'catalog',
    id: typeof entry?.id === 'string' && entry.id.length > 0 ? entry.id : null,
    query: capQuery(composer ? `${title} ${composer}` : title),
  };
}

/**
 * Rank the cleaned read against the corpus. Three ladders, in order, and the
 * first one that answers wins: the title line alone, the composer line alone, then
 * the two together. Nothing is invented — each rung is text the recogniser read.
 */
function rankRead(
  titleLine: string,
  composerLine: string | null,
  corpus: ReadonlyArray<OcrTitleCorpusEntry>,
): { candidates: OcrTitleCandidate[]; matchedWith: string } {
  const rungs = [titleLine];
  if (composerLine) {
    rungs.push(composerLine);
    rungs.push(`${titleLine} ${composerLine}`);
  }
  for (const rung of rungs) {
    const query = normalizeSearchText(rung);
    if (query.length === 0) continue;
    const ranked = rankFuzzyMatches(query, corpus, {
      limit: OCR_TITLE_LIMIT,
      minScore: SUBSTITUTE_MIN_SCORE,
    });
    if (ranked.length > 0) {
      return {
        candidates: ranked.map((entry) => toCandidate(entry.item, entry.score)),
        matchedWith: rung,
      };
    }
  }
  return { candidates: [], matchedWith: titleLine };
}

// ─── THE DECISION ───────────────────────────────────────────────────────────

/**
 * What the read is. Never throws, never invents a word: an empty/garbage input is
 * the honest `garbage` result with no query at all.
 */
export function readTitleCandidates(input?: {
  blocks?: ReadonlyArray<OcrBlock> | null;
  imageSize?: OcrImageSize | null;
  corpus?: ReadonlyArray<OcrTitleCorpusEntry> | null;
} | null): OcrTitleResult {
  const blocks = Array.isArray(input?.blocks) ? (input!.blocks as OcrBlock[]) : [];
  const imageSize = input?.imageSize ?? null;
  const corpus = Array.isArray(input?.corpus) ? (input!.corpus as OcrTitleCorpusEntry[]) : [];

  const garbage = (reason: OcrTitleReason): OcrTitleResult => ({
    candidates: [],
    quality: 'garbage',
    reason,
    // THE GUARANTEE: a garbage read has no query.
    query: null,
    cleanedRead: '',
    titleLine: null,
    composerLine: null,
  });

  const readable = blocks.filter((block) => cleanOcrLine(block?.text).length > 0);
  if (readable.length === 0) return garbage('empty');
  if (isNotationRead(readable)) return garbage('notation');

  const tallest = readable.reduce(
    (best, block) => Math.max(best, blockMedianElementHeight(block)),
    0,
  );
  const scored = readable
    .map((block, index) => ({
      text: cleanOcrLine(block.text),
      index,
      score: scoreTitleBlock(block, imageSize, tallest),
    }))
    .filter((entry) => entry.score > 0 && !isBrokenOcrLine(entry.text))
    .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));

  if (scored.length === 0) return garbage('garbled');

  const best = scored[0]!;
  const composerEntry = scored.find(
    (entry) => entry.index !== best.index && isLikelyComposerLine(entry.text),
  );
  const titleLine = best.text;
  const composerLine = composerEntry ? composerEntry.text : null;
  const quality: OcrTitleQuality = best.score >= OCR_GOOD_TITLE_SCORE ? 'good' : 'weak';
  const ranked = rankRead(titleLine, composerLine, corpus);

  return {
    candidates: ranked.candidates,
    quality,
    reason: quality === 'good' ? 'title' : 'weak',
    query: capQuery(composerLine ? `${titleLine} ${composerLine}` : titleLine),
    cleanedRead: capQuery(composerLine ? `${titleLine} — ${composerLine}` : titleLine),
    titleLine,
    composerLine,
  };
}
