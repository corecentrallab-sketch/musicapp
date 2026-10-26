/**
 * scanClassify.ts — WHAT THE PHOTO IS, AND WHETHER THE APP MAY LOOK IT UP FOR YOU
 * (v45 slice 4, owner-ratified 2026-10-26).
 *
 * THE OWNER'S HEADLINE FOR v45: "scan → OCR → auto-search". A user photographs a
 * score's cover and the app should go straight to the piece — one tap from the
 * official sheet music — instead of making them open a panel and press a second
 * button. That is only honest when the app is SURE what it read, so this module
 * answers two questions in one place:
 *
 *   1. WHAT IS THIS PHOTO?  verdict `'cover'` (a title page: one big title) or
 *      `'score-page'` (notation) — plus `quality` ('good' | 'weak' | 'garbage'),
 *      the recogniser's own `reason`, and a 0…1 `confidence` measured from the
 *      evidence (a title block's layout score, or the share of symbol-only blocks).
 *   2. MAY THE APP SEARCH IT WITHOUT BEING ASKED?  `autoSearch.fire` — and it is
 *      TRUE only when EVERY one of these holds:
 *        • the read did not fail;
 *        • the verdict is 'cover' (a page of music is never looked up);
 *        • `quality === 'good'` (the v41 defect doc's constraint: a weak or debris
 *          read must never become an invisible query);
 *        • at least one title candidate exists — the read answers a piece we can
 *          actually name, which is evidence, not a guess.
 *      Anything else keeps the user in full manual control with an honest line
 *      saying why nothing was looked up.
 *
 * IT REUSES THE OCR THAT ALREADY SHIPPED. `readTitleCandidates` makes the title /
 * notation decision (v43 item C2), `scoreTitleBlock` and `isNotationRead` are its
 * evidence, and the copy comes from services/scanFind / services/coverScan. This
 * module invents no reading of its own — there is no OMR here, no note reading, and
 * no edition claimed.
 *
 * NEVER A REDIRECT. The plan carries a QUERY for the app's ONE in-app search
 * surface (`FindPieceScreen`) and nothing else: no URL, no retailer, no store. A
 * retailer is only ever reached by the user's own tap on a result row, which is
 * the 08-24 no-auto-redirect rule. `scanPlanCarriesNoRetailerUrl` proves it.
 *
 * PURE: no react, no react-native, no fs, no network. Compiled by
 * tsconfig.tier1.json and asserted by scripts/scanBatch.test.ts.
 */
import {
  COVER_SCAN_GARBLED_LINE,
  COVER_SCAN_NO_TEXT_LINE,
  ocrLetterShare,
} from './coverScan';
import {
  OCR_GOOD_TITLE_SCORE,
  OCR_SYMBOL_BLOCK_SHARE,
  blockMedianElementHeight,
  isNotationRead,
  isBrokenOcrLine,
  readTitleCandidates,
  scoreTitleBlock,
  type OcrBlock,
  type OcrImageSize,
  type OcrTitleCandidate,
  type OcrTitleCorpusEntry,
  type OcrTitleQuality,
  type OcrTitleReason,
} from './ocrTitleCandidates';
import { OCR_TITLE_CORPUS } from './ocrTitleCorpus';
import { SCAN_FIND_PAGE_OF_MUSIC_LINE, SCAN_FIND_WEAK_LINE, type ScanFindRead } from './scanFind';

// ─── copy ───────────────────────────────────────────────────────────────────

/** The headline a fired auto-search carries: "Looking up “X” for you". */
export const SCAN_AUTO_SEARCH_PREFIX = 'Looking up';
export const SCAN_AUTO_SEARCH_SUFFIX = 'for you';

/** The one control that cancels it — the user is never trapped in a lookup. */
export const SCAN_AUTO_SEARCH_DISMISS = 'Not now';

/** A fired lookup says what it is doing, in the user's own words. */
export function scanAutoSearchHeadline(title: string): string {
  const words = typeof title === 'string' ? title.trim() : '';
  if (words.length === 0) return '';
  return `${SCAN_AUTO_SEARCH_PREFIX} “${words}” ${SCAN_AUTO_SEARCH_SUFFIX}`;
}

/** The read itself did not work (module missing / recogniser rejected the image). */
export const SCAN_CLASSIFY_READ_FAILED_LINE =
  'We could not read that photo. Type the title you can see and we will search for it.';

/** A good-looking title that answers no piece we hold — honest, and still a way in. */
export const SCAN_CLASSIFY_NO_CANDIDATE_LINE =
  'We read a title but could not match it to a piece we hold — check the words below, or type the title yourself.';

/** What the screen says about a photo that is notation rather than a cover. */
export const SCAN_CLASSIFY_SCORE_PAGE_LINE = SCAN_FIND_PAGE_OF_MUSIC_LINE;

// ─── the tuple ──────────────────────────────────────────────────────────────

export type ScanPhotoVerdict = 'cover' | 'score-page';

/** What a scan may do next, decided ONCE, here. */
export interface ScanAutoSearchPlan {
  /** THE HONEST GATE. True only for a good cover read that names a piece. */
  fire: boolean;
  /** The query the in-app search runs ('' unless `fire`). Never a URL. */
  query: string;
  /** The candidate's own title ('' unless `fire`). */
  title: string;
  /** "Looking up “X” for you" ('' unless `fire`). */
  headline: string;
  /** The one control that cancels the lookup. */
  dismissLabel: string;
  /** Why nothing was looked up — the honest line, always present when !fire. */
  holdLine: string | null;
}

export interface ScanPhotoClassification {
  verdict: ScanPhotoVerdict;
  quality: OcrTitleQuality;
  reason: OcrTitleReason | null;
  /** 0…1, measured from the evidence this read produced (never a constant). */
  confidence: number;
  /** At most three, best first — evidence, never an invention. */
  candidates: OcrTitleCandidate[];
  best: OcrTitleCandidate | null;
  /** The words a manual search may offer (null when the read produced none). */
  query: string | null;
  autoSearch: ScanAutoSearchPlan;
}

/** A title block is "fully" confident at this layout score (1.5 × the good bar). */
export const SCAN_COVER_CONFIDENCE_FULL_SCORE = OCR_GOOD_TITLE_SCORE * 1.5;

/** A read the model called WEAK can never report more confidence than this. */
export const SCAN_WEAK_CONFIDENCE_CEILING = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : Math.round(value * 100) / 100;
}

/**
 * HOW SURE THE READ IS THAT THIS IS A COVER WITH A PRINTED TITLE, from the best
 * block's own layout score (`scoreTitleBlock`): biggest thing near the top, with
 * real letters and title-shaped words. 0 at nothing, 1 at 1.5× the good bar.
 */
export function coverReadConfidence(bestTitleScore: number): number {
  if (!Number.isFinite(bestTitleScore) || bestTitleScore <= 0) return 0;
  return clamp01(bestTitleScore / SCAN_COVER_CONFIDENCE_FULL_SCORE);
}

/**
 * HOW SURE THE READ IS THAT THIS IS A PAGE OF MUSIC: the share of symbol-only
 * blocks on the page (a title page has words everywhere). 0 with no blocks.
 */
export function scorePageConfidence(blocks: readonly OcrBlock[] | null | undefined): number {
  const list = Array.isArray(blocks)
    ? blocks.filter((block) => (block?.text ?? '').trim().length > 0)
    : [];
  if (list.length === 0) return 0;
  const symbolBlocks = list.filter(
    (block) => ocrLetterShare((block.text ?? '').replace(/\s+/g, ' ').trim()) < OCR_SYMBOL_BLOCK_SHARE,
  ).length;
  return clamp01(symbolBlocks / list.length);
}

/** The best `scoreTitleBlock` score on the page (0 when there is nothing to score). */
export function bestTitleScore(
  blocks: readonly OcrBlock[] | null | undefined,
  imageSize: OcrImageSize | null | undefined,
): number {
  const list = Array.isArray(blocks)
    ? blocks.filter(
        (b) =>
          (b?.text ?? '').trim().length > 0 &&
          // A BROKEN LINE IS NOT EVIDENCE OF A TITLE — the same rule
          // `readTitleCandidates` applies before it ranks anything, so a page of
          // debris cannot report a confident cover read here.
          !isBrokenOcrLine(b.text),
      )
    : [];
  if (list.length === 0) return 0;
  const tallest = list.reduce((best, block) => Math.max(best, blockMedianElementHeight(block)), 0);
  let best = 0;
  for (const block of list) {
    const score = scoreTitleBlock(block, imageSize ?? null, tallest);
    if (Number.isFinite(score) && score > best) best = score;
  }
  return best;
}

// ─── the decision ───────────────────────────────────────────────────────────

function holdPlan(line: string | null): ScanAutoSearchPlan {
  return {
    fire: false,
    query: '',
    title: '',
    headline: '',
    dismissLabel: SCAN_AUTO_SEARCH_DISMISS,
    holdLine: line,
  };
}

/**
 * WHAT THIS PHOTO IS, and whether the app may search it for the user.
 *
 * `read` is exactly the object `services/coverScanOcr.readCoverText` returns plus
 * the door the photo came through (`photoKind`), and `corpus` is whatever titles
 * the caller knows (the live catalog) — the same inputs the resolve page uses, so
 * the two surfaces can never disagree about the same photo.
 *
 * DEGENERATE INPUT IS NOT A LOOKUP. A null/blank/failed read, a page with no
 * geometry, a page of notation and a debris read all come back with
 * `autoSearch.fire === false` and an honest `holdLine`. A read with no block
 * geometry can reach quality 'weak' at best: the evidence that a read is a TITLE
 * is geometry, so nothing without it may fire a lookup on the user's behalf.
 */
export function classifyScanPhoto(
  read?: ScanFindRead | null,
  corpus?: ReadonlyArray<OcrTitleCorpusEntry> | null,
): ScanPhotoClassification {
  const blocks: OcrBlock[] = Array.isArray(read?.blocks) ? (read!.blocks as OcrBlock[]) : [];
  const imageSize = read?.imageSize ?? null;
  const corpusList =
    Array.isArray(corpus) && corpus.length > 0 ? corpus : OCR_TITLE_CORPUS;

  // ── a read that failed is its own state, never a guess ──
  if (read?.failed === true) {
    return {
      verdict: 'cover',
      quality: 'garbage',
      reason: 'empty',
      confidence: 0,
      candidates: [],
      best: null,
      query: null,
      autoSearch: holdPlan(SCAN_CLASSIFY_READ_FAILED_LINE),
    };
  }

  // ── no geometry: the words may exist, but nothing proves they are a TITLE ──
  if (blocks.length === 0) {
    const words = typeof read?.text === 'string' ? read.text.trim() : '';
    const quality: OcrTitleQuality = words.length > 0 ? 'weak' : 'garbage';
    return {
      verdict: 'cover',
      quality,
      reason: quality === 'weak' ? 'weak' : 'empty',
      confidence: 0,
      candidates: [],
      best: null,
      query: words.length > 0 ? words : null,
      autoSearch: holdPlan(
        quality === 'weak' ? SCAN_FIND_WEAK_LINE : COVER_SCAN_NO_TEXT_LINE,
      ),
    };
  }

  const result = readTitleCandidates({ blocks, imageSize, corpus: corpusList });
  // THE VERDICT, from the read's own evidence: `isNotationRead` (mostly symbol
  // blocks / no words at all) IS the page-of-music case, and `readTitleCandidates`
  // reports it as reason 'notation'.
  const notation = result.reason === 'notation' || isNotationRead(blocks);
  const verdict: ScanPhotoVerdict = notation ? 'score-page' : 'cover';
  const best = result.candidates.length > 0 ? result.candidates[0]! : null;
  const query = typeof result.query === 'string' && result.query.trim().length > 0
    ? result.query.trim()
    : null;

  if (verdict === 'score-page') {
    // A PAGE OF MUSIC. It is never looked up, and the photo's own door becomes the
    // page door so the resolve surface refuses debris as a query (v44 #59).
    return {
      verdict,
      quality: 'garbage',
      reason: 'notation',
      confidence: scorePageConfidence(blocks),
      candidates: [],
      best: null,
      query: null,
      autoSearch: holdPlan(SCAN_CLASSIFY_SCORE_PAGE_LINE),
    };
  }

  const score = bestTitleScore(blocks, imageSize);
  // THE CONFIDENCE, from evidence and capped by the model's own verdict:
  //   • garbage → 0 (there is no title to be confident about);
  //   • weak    → at most the weak ceiling (the model already said it is not a
  //               title it would vouch for, so the number cannot claim otherwise);
  //   • good    → the layout score, normalised.
  const confidence =
    result.quality === 'garbage'
      ? 0
      : Math.min(
          coverReadConfidence(score),
          result.quality === 'good' ? 1 : SCAN_WEAK_CONFIDENCE_CEILING,
        );

  // ── THE HONEST GATE — every clause must hold, or nothing fires ──
  const fireGoodCover =
    verdict === 'cover' &&
    result.quality === 'good' &&
    result.candidates.length > 0 &&
    best !== null &&
    typeof best.query === 'string' &&
    best.query.trim().length > 0;

  const autoSearch: ScanAutoSearchPlan = fireGoodCover
    ? {
        fire: true,
        query: best!.query.trim(),
        title: best!.title,
        headline: scanAutoSearchHeadline(best!.title),
        dismissLabel: SCAN_AUTO_SEARCH_DISMISS,
        holdLine: null,
      }
    : holdPlan(
        result.quality === 'garbage'
          ? result.reason === 'garbled'
            ? COVER_SCAN_GARBLED_LINE
            : COVER_SCAN_NO_TEXT_LINE
          : result.candidates.length === 0
            ? SCAN_CLASSIFY_NO_CANDIDATE_LINE
            : SCAN_FIND_WEAK_LINE,
      );

  return {
    verdict: 'cover',
    quality: result.quality,
    reason: result.reason,
    confidence,
    candidates: result.candidates,
    best,
    query,
    autoSearch,
  };
}

/**
 * THE DOOR THE RESOLVE PAGE USES, from the classifier (v45 slice 4). The saved
 * scan viewer is always the page door (it shows a page of a scanned score); the
 * scanner asks the photo itself, falling back to the page-index rule only until a
 * read has happened (`fallback`).
 */
export function scanPhotoKindFor(
  classification: ScanPhotoClassification | null | undefined,
  fallback: 'cover' | 'page' = 'cover',
): 'cover' | 'page' {
  if (!classification) return fallback === 'page' ? 'page' : 'cover';
  return classification.verdict === 'score-page' ? 'page' : 'cover';
}

/**
 * THE PLAN CARRIES NO RETAILER AND NO LINK — it is a query for the app's own
 * search. True when nothing in the plan looks like a URL or a store.
 */
export function scanPlanCarriesNoRetailerUrl(plan: ScanAutoSearchPlan | null | undefined): boolean {
  if (!plan || typeof plan !== 'object') return true;
  const text = JSON.stringify(plan);
  if (/https?:/i.test(text)) return false;
  if (/sheetmusicdirect|musicnotes|sheetmusicplus/i.test(text)) return false;
  if (/\/search\/go/.test(text)) return false;
  return true;
}
