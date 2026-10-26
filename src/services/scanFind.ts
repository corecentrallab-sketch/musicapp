/**
 * scanFind.ts — THE SCANNED SCORE'S WAY INTO THE ONE SEARCH (v39 fix 1b, owner
 * 10-11; backlog: CAMERA SCAN-TO-LIBRARY FLOW).
 *
 * WHAT THIS IS FOR. A user photographs a page of sheet music into their Library.
 * The owner's expectation is that the photo can reach the SAME purchase path a
 * "Find a song → camera" cover scan reaches (read the printed words on device →
 * the one catalog search → the licensed retailers). This module is the pure
 * half of that: the copy, and the honest decision about what a read produced.
 *
 * WHAT IT IS NOT. This reads WORDS. It is not OMR, there is no pitch reading, no
 * note extraction, no edition claim, and no second search surface: the confirmed
 * text goes to the host, which hands it to the app's ONE search (the find-a-piece
 * screen, the same one a typed title uses). The photo is the user's own capture
 * and never leaves the device — it is read for a title, nothing else.
 *
 * HONESTY RULES (shared with services/coverScan.ts, whose `coverQueryFromScan`
 * owns the decision — this module never invents a word for it):
 *   • nothing read      → the reader's own "no text" line, empty field, no search;
 *   • the read failed   → its own failure line, empty field, no search;
 *   • text read         → the field carries EXACTLY what was read, editable, so
 *                         the search the user sees is the search that runs.
 *
 * PURE: no react, no react-native, no camera, no fs — provable before a build.
 */
import {
  COVER_SCAN_GARBLED_LINE,
  COVER_SCAN_NO_TEXT_LINE,
  COVER_SCAN_OCR_AVAILABLE,
  coverQueryFromScan,
} from './coverScan';
import {
  readTitleCandidates,
  type OcrImageSize,
  type OcrBlock,
  type OcrTitleCandidate,
  type OcrTitleCorpusEntry,
  type OcrTitleQuality,
  type OcrTitleReason,
} from './ocrTitleCandidates';
import { OCR_TITLE_CORPUS } from './ocrTitleCorpus';

/** The scan screen's own line about durability (v39 fix 1a). */
export const SCAN_SAVED_AS_YOU_GO_LINE =
  'Each page is saved to your Library the moment you take it, so leaving this screen cannot lose a page you have already captured.';

/** Where an unfinished scan is picked up again (v39 fix 1a). */
export const SCAN_SESSION_RESUMED_PREFIX = 'Unfinished scan picked up — ';
export const SCAN_SESSION_KEPT_LINE =
  'pages are already in your Library; carry on, or finish when you are ready.';

/** The finish action's label, from the real page count. */
export function scanFinishCta(pageCount: number): string {
  const count = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 0;
  return count > 0 ? `Done (${count} ${count === 1 ? 'page' : 'pages'})` : 'Done';
}

/** The line that tells the user an unfinished scan is still on this device. */
export function scanSessionResumedLine(pageCount: number): string | null {
  const count = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 0;
  if (count === 0) return null;
  return `${SCAN_SESSION_RESUMED_PREFIX}${count} ${count === 1 ? 'page' : 'pages'} — ${SCAN_SESSION_KEPT_LINE}`;
}

/** The on-disk name of a scan's page (1-based, zero-padded — the store's own). */
export function scanPageFileLabel(index0: number): string {
  const safe = Number.isFinite(index0) && index0 > 0 ? Math.floor(index0) : 0;
  return `page-${String(safe + 1).padStart(3, '0')}.jpg`;
}

/** The title a scan session is registered under, from the device's own date. */
export function scanSessionTitle(dateLabel: string): string {
  const label = typeof dateLabel === 'string' ? dateLabel.trim() : '';
  return label ? `Scanned score ${label}` : 'Scanned score';
}

// ─── THE MONEY PATH'S OWN COPY ────────────────────────────────

export const SCAN_FIND_CTA = 'Find this music';
export const SCAN_FIND_HINT =
  'Reads the words printed on the page you photographed — on this device — and takes them to the same search a typed title opens, including the official sheet music from licensed retailers.';
export const SCAN_FIND_READING_LINE = 'Reading the words on your photo, on this device…';
export const SCAN_FIND_NO_PAGE_LINE =
  'Photograph a page first — there is nothing to read yet.';
export const SCAN_FIND_CONFIRM_LABEL = 'Search for';
export const SCAN_FIND_CONFIRM_HINT = 'Check this, fix anything wrong, then search.';
export const SCAN_FIND_SEARCH_CTA = 'Search this title';
export const SCAN_FIND_RAW_QUERY_NOTE =
  'This reads the printed words on your photo to search for the piece. NoteSnap does not read the printed notes into a score, and no particular edition is claimed — the search and the licensed retailers are the way in.';

// ─── v43 ITEM C — ONE RESOLVE PAGE, AND THE FRAMING NOTICE ──────────────────
//
// THE OWNER'S TRIPLE-EMPHASISED REQUIREMENT (10-20): something must be ON the
// camera screen telling the user how to frame the shot — fit the TITLE, not the
// whole piece — or the photo cannot be matched. `SCAN_COVER_ONLY_HINT` is that
// sentence, and `src/screens/ScanScoreScreen.tsx` renders it over the viewfinder
// from the moment the scanner opens (a source scan asserts it, see
// services/scanOneDoorContract.ts).
//
// The rest of the block is the resolve page's copy: three suggestions, the words
// that were read (a proposal, never a query), the user's own typed title, and —
// for a page of music rather than a cover — the honest line instead of a search.

/**
 * WHAT THE CAMERA SCREEN SAYS, ALWAYS, BEFORE THE FIRST PHOTO.
 *
 * v44 #60 (owner, v43 checklist — backlog 33732422: "wrong and cut in half"). The
 * old sentence was the instruction AND the durability note AND the why, all in one
 * parenthesis — "…(Every page you take still saves to your Library.)" — and the
 * panel was capped, so its last line was sliced through the middle. It is now TWO
 * named lines rendered as two texts: this one (the instruction, the only thing the
 * framing needs) and `SCAN_TAKE_SAVES_LINE` below it, in the owner's exact words.
 * The why ("the title at the top of the page is what gets matched") is not lost —
 * it is `SCAN_FIND_COVER_ONLY_LINE`, one tap away in the resolve panel, which keeps
 * this box short enough to sit out of the framing area.
 */
export const SCAN_COVER_ONLY_HINT =
  'Fit the TITLE at the top of the score into the frame — not the whole page.';

/** The durability note under it — the owner's own string (v44 #60), verbatim. */
export const SCAN_TAKE_SAVES_LINE = 'Your Take still saves to the library';

/** The same rule, short, inside the resolve panel. */
export const SCAN_FIND_COVER_ONLY_LINE =
  'Best on a cover: the title at the top of the page is what gets matched.';

/** A page of printed music is not a cover — said plainly, never searched. */
export const SCAN_FIND_NOTATION_LINE =
  'This looks like a page of music, not a cover — type the title you see and we will search for it.';

/**
 * THE PAGE-OF-MUSIC LINE FOR A SCANNED PAGE (v44 #59, owner v43 checklist —
 * backlog ce3a2282). The owner scanned a page of Bohemian Rhapsody and the
 * "Search for…" box came back holding the recogniser's debris ("Auio - Metal"):
 * an uncorroborated read off a page of MUSIC presented as if it were a title.
 * A page of music can never BE a title page, so on this door an uncorroborated
 * read is not offered as a query at all — this line is what the user gets, and the
 * ways forward are the typed title and the retake.
 */
export const SCAN_FIND_PAGE_OF_MUSIC_LINE =
  'This looks like a page of music — a cover or title page helps find the piece.';

/**
 * THE LABEL FOR A READ THE APP CANNOT VOUCH FOR (v44 #59, the cover door). When
 * the words were read off a photo but answer no piece we know, they are still a
 * way into the search (a real title we simply do not hold looks exactly like this)
 * — but they are NOT "Search for": that label claimed a confidence the app does
 * not have. They sit under this label instead, editable, with the words themselves
 * printed in the control that will search them.
 */
export const SCAN_FIND_WHAT_WE_READ_LABEL = 'What we read on the photo';

/** The read-search control: it shows the words it will actually search. */
export const SCAN_FIND_SEARCH_WORDS_CTA = 'Search these words';

/** …and when the read produced no words, the honest empty state beside it. */
export const SCAN_FIND_NO_WORDS_LINE =
  'We read no words on that photo to search with — type the title you can see instead.';

/** A read that came back, but too thin to trust as a title. */
export const SCAN_FIND_WEAK_LINE =
  'We could only partly read that photo — check the words below, or type the title yourself.';

/** The suggestions' heading. */
export const SCAN_FIND_CANDIDATES_LABEL = 'We think this is';
export const SCAN_FIND_CANDIDATE_HINT =
  'Tap a piece to open it — the official sheet music is on its page.';
/** A suggestion we do not hold a score for: the money path, never a fake piece. */
export const SCAN_FIND_MODERN_HINT =
  'We do not hold a score for this song — its page offers the official sheet music from licensed retailers.';

/** The field for the user's OWN words, used when the read is not a title. */
export const SCAN_FIND_TYPED_LABEL = 'Type the title';
export const SCAN_FIND_TYPED_SEARCH_CTA = 'Search the title I type';
/**
 * THE ONE FIELD'S HINT WHEN IT HOLDS NOTHING READABLE (v45 slice 4). The read's
 * words and the user's own title share the same editable field now, so this is the
 * hint under it on the garbage / page-of-music path — the state where the app has
 * nothing of its own to offer and the user types what they can see.
 */
export const SCAN_FIND_TYPED_HINT =
  'Type the title (or the composer) you can see, then search — the official sheet music is on the result page.';
/** The way out of every state — take the photo again. */
export const SCAN_FIND_RETAKE_CTA = 'Retake photo';

export interface ScanFindRead {
  /** What the on-device recogniser returned, exactly. */
  text?: string | null;
  /** True when the READ failed (never when the page was simply wordless). */
  failed?: boolean;
  /** The recogniser's own block geometry (v43 item C1). */
  blocks?: OcrBlock[] | null;
  /** The photo's pixel size, so a block's position on the page is known. */
  imageSize?: OcrImageSize | null;
  /**
   * WHAT WAS PHOTOGRAPHED (v44 #59). 'cover' (the default) is the title-page door:
   * a read we cannot corroborate may still be a real title we do not hold, so it
   * stays searchable — under an honest label, never as "Search for". 'page' is a
   * page of a scanned score (the saved-scan viewer, an extra page in the scanner):
   * a page of MUSIC can never be a title page, so an uncorroborated read there is
   * offered no query at all — the owner's "Auio - Metal" case.
   */
  photoKind?: 'cover' | 'page';
}

export interface ScanFindView {
  /** The recogniser's own status, straight from `coverQueryFromScan`. */
  status: 'idle' | 'ready' | 'no-text' | 'no-ocr' | 'ocr-failed';
  /** How much the read looks like a cover title (v43 item C2). */
  quality: OcrTitleQuality | null;
  /** Why it landed there — 'notation' is the page-of-music case. */
  reason: OcrTitleReason | null;
  /** The query the user may confirm — empty unless real words were read. */
  query: string;
  /** The cleaned read, for the editable field ('' when the read is garbage). */
  cleanedRead: string;
  /** At most three suggestions, best first. */
  candidates: OcrTitleCandidate[];
  /** The honest line for this state, or null before any read. */
  line: string | null;
  /** True only when there is a real query to search with. */
  canSearch: boolean;
  /**
   * THE WORDS ARE NOT VOUCHED FOR (v44 #59): a query exists, but it answers
   * nothing the app knows. The surface must label it as what was read, never as
   * "Search for", and must print the words in the control that searches them.
   */
  uncorroborated: boolean;
}

/** The result of nothing at all — used for the idle and failed states. */
function viewOf(
  status: ScanFindView['status'],
  extra: Partial<ScanFindView> = {},
): ScanFindView {
  return {
    status,
    quality: null,
    reason: null,
    query: '',
    cleanedRead: '',
    candidates: [],
    line: null,
    canSearch: false,
    uncorroborated: false,
    ...extra,
  };
}

/**
 * What a read produced. The decision itself is `coverQueryFromScan`'s — the SAME
 * one the cover scan uses — so a wordless page, a failed read and a missing
 * recogniser each keep their own honest line here, and an empty query can never
 * run a search. `null` (nothing read yet) is its own state, not a failure.
 *
 * v43 ITEM C: when the recogniser handed back BLOCK GEOMETRY, the decision is
 * `readTitleCandidates`' instead — it can tell a printed title from a page of
 * music, which text alone cannot. A read with no geometry keeps the v39 behaviour
 * exactly, so nothing that worked before changes.
 *
 * v44 #59 — THE PAGE-OF-MUSIC GATE (`read.photoKind === 'page'`). Geometry alone
 * was not enough: a page of music can return one tidy-looking line ("Auio -
 * Metal"), and with nothing to compare it against the model called it a title and
 * filled the search box. On a page door that is the wrong claim to make, so an
 * uncorroborated read — a query, but no piece in the corpus answering it — is
 * refused a query entirely and replaced with `SCAN_FIND_PAGE_OF_MUSIC_LINE`: the
 * honest line, no pre-filled box, and the typed title and retake as the ways
 * forward. A read that DOES answer a piece keeps its suggestions (that is the money
 * path, and it is evidence, not a guess). On the cover door the same uncorroborated
 * read stays searchable but is flagged `uncorroborated`, so its surface labels it
 * "What we read on the photo" instead of "Search for".
 */
export function scanFindView(
  read: ScanFindRead | null | undefined,
  corpus?: ReadonlyArray<OcrTitleCorpusEntry> | null,
): ScanFindView {
  const photoKind: 'cover' | 'page' = read?.photoKind === 'page' ? 'page' : 'cover';
  if (!read) return viewOf('idle');
  if (read.failed === true) {
    const outcome = coverQueryFromScan({ ocrFailed: true, ocrAvailable: COVER_SCAN_OCR_AVAILABLE });
    return viewOf(outcome.status, { line: outcome.line });
  }
  const blocks = Array.isArray(read.blocks) ? read.blocks : [];
  if (blocks.length > 0) {
    const result = readTitleCandidates({
      blocks,
      imageSize: read.imageSize ?? null,
      corpus: Array.isArray(corpus) && corpus.length > 0 ? corpus : OCR_TITLE_CORPUS,
    });
    if (result.quality === 'garbage') {
      // NOTHING READABLE: the honest line for WHY, and no query at all — the
      // structural guarantee lives in `readTitleCandidates` (query === null).
      const line =
        result.reason === 'notation'
          ? SCAN_FIND_NOTATION_LINE
          : result.reason === 'garbled'
            ? COVER_SCAN_GARBLED_LINE
            : COVER_SCAN_NO_TEXT_LINE;
      return viewOf('no-text', { quality: 'garbage', reason: result.reason, line });
    }
    const query = typeof result.query === 'string' ? result.query.trim() : '';
    const corroborated = result.candidates.length > 0;
    if (photoKind === 'page' && query.length > 0 && !corroborated) {
      // THE OWNER'S CASE (v44 #59): words off a page of music, answering nothing
      // we know. No query, no pre-filled box — the honest line instead.
      return pageOfMusicView();
    }
    return viewOf('ready', {
      quality: result.quality,
      reason: result.reason,
      query,
      cleanedRead: result.cleanedRead,
      candidates: result.candidates,
      line: result.quality === 'good' ? SCAN_FIND_CONFIRM_HINT : SCAN_FIND_WEAK_LINE,
      canSearch: query.length > 0,
      uncorroborated: query.length > 0 && !corroborated,
    });
  }
  const outcome = coverQueryFromScan({
    ocrText: read.text ?? '',
    // `read.failed === true` returned above, so the read did not fail here.
    ocrFailed: false,
    ocrAvailable: COVER_SCAN_OCR_AVAILABLE,
  });
  const query = typeof outcome.query === 'string' ? outcome.query.trim() : '';
  if (photoKind === 'page' && query.length > 0) {
    // No geometry on a page door: there is nothing to corroborate the words
    // against, so they are not offered as a query.
    return pageOfMusicView();
  }
  return viewOf(outcome.status, {
    // Without geometry the read is either words we can search or nothing we can
    // use: the v39 behaviour, labelled with the same vocabulary.
    quality: outcome.status === 'ready' ? 'good' : outcome.status === 'no-text' ? 'garbage' : null,
    query,
    cleanedRead: query,
    line: outcome.line,
    canSearch: query.length > 0,
    uncorroborated: query.length > 0,
  });
}

/**
 * THE HONEST PAGE-OF-MUSIC STATE (v44 #59): the line, no words, no query, and the
 * two ways forward the actions model already gives a garbage read (type the title,
 * take the photo again) — the 09-28 no-dead-end rule.
 */
function pageOfMusicView(): ScanFindView {
  return viewOf('no-text', {
    quality: 'garbage',
    reason: 'notation',
    line: SCAN_FIND_PAGE_OF_MUSIC_LINE,
  });
}


/** The words to actually search with, or null when there is nothing to run. */
export function scanFindQuery(read: ScanFindRead | null | undefined): string | null {
  const view = scanFindView(read);
  return view.canSearch ? view.query : null;
}

export interface ScanFindActions {
  /** The read's words go in the field (only when they could be a title). */
  showReadWords: boolean;
  /**
   * "Search these words" — the read, as a search. FALSE for every garbage read:
   * this is the one flag the surface consults, and the pure model is what decides
   * it, so no screen can search a broken read by forgetting a check.
   */
  offerReadSearch: boolean;
  /** The user's OWN typed title — the way out that always exists. */
  offerTypedSearch: boolean;
  /** Take the photo again. */
  offerRetake: boolean;
  /** The suggestion list (never for a garbage read). */
  offerCandidates: boolean;
}

/**
 * WHAT THE ONE RESOLVE PAGE OFFERS, from the read alone. Every state has a way
 * forward (the 09-28 no-dead-end rule) and a garbage read never gets a search of
 * the words it produced — it gets the honest line, a field for the user's own
 * title, and a retake.
 */
export function scanFindActions(view: ScanFindView | null | undefined): ScanFindActions {
  const nothing: ScanFindActions = {
    showReadWords: false,
    offerReadSearch: false,
    offerTypedSearch: false,
    offerRetake: false,
    offerCandidates: false,
  };
  if (!view) return nothing;
  if (view.status === 'idle') return nothing;
  if (view.quality === 'garbage') {
    return { ...nothing, offerTypedSearch: true, offerRetake: true };
  }
  const hasQuery = typeof view.query === 'string' && view.query.trim().length > 0;
  return {
    showReadWords: hasQuery,
    // THE STRUCTURAL RULE: a garbage read has no query (and returned above), and
    // this flag is false for it — a surface cannot offer a search of words the
    // model refused.
    offerReadSearch: hasQuery,
    offerTypedSearch: true,
    offerRetake: true,
    offerCandidates: view.candidates.length > 0,
  };
}
