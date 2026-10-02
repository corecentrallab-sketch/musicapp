/**
 * resultSurface.ts — the ONE result surface's decisions (bundle A, owner 10-02).
 *
 * WHY THIS MODULE EXISTS. The recognition result reached the user through three
 * separate cards: the front door's `RecognitionResultView` (ambient + modern),
 * the hum screen's own `stage === 'result'` card, and the modern interstitial. The
 * re-flow folds them onto ONE surface — the recognition result card — so a match
 * is handled the same way however it was found, and the hosted score is rendered
 * INLINE in that card (owner sign-off item (a): "PD/hum result shows the sheet
 * inline in the result surface").
 *
 * This module owns every decision that card makes, so the tier1 gate can assert
 * them with no emulator (the house recipe: pure logic + source contracts, see
 * scripts/resultSurface.test.ts):
 *
 *   • WHICH KIND of result it is (`resultKindFor`): a hum match, a library/PD
 *     match, or a modern (copyrighted) match. The three kinds are what the card's
 *     copy and its money path branch on — nothing else.
 *   • WHAT the sheet slot does (`sheetSurfaceDecision`): the hosted score renders
 *     INLINE (`'inline'`), behind the reader (`'open-full'`), or not at all — and
 *     in that case the card routes to the one purchase action (`'purchase'`) or
 *     says honestly that it holds nothing (`'none'`).
 *   • WHERE the score came from (`resultSheetSource`): the backend/catalog
 *     (`'hosted'`), a licensed retailer (`'purchase'`), or nowhere (`'none'`).
 *     A fourth value, `'user-capture'`, is RESERVED for the melody-capture build
 *     (backlog 27): the surface would render the sheet from the user's OWN take.
 *     Nothing here implements it — it is a comment, not a branch, because the
 *     capture work is out of scope for the re-flow (spec §11.3).
 *   • Every word the card says (`RESULT_KICKER_*`, `MODERN_COPYRIGHT_NOTE`,
 *     `NO_HOSTED_SCORE_LINE`, …), so the copy the user reads and the copy the gate
 *     asserts cannot drift apart.
 *
 * THE HONESTY RULES BAKED IN (bundle A / §A.4, §E):
 *   1. A hosted score URL is only ever one the BACKEND or the CATALOG returned.
 *      This module never builds one — `sheetUrlForPieceId()` is a key builder for
 *      ingesting gated batch content, not a promise that a score exists, so the
 *      contract suite rejects any surface that calls it.
 *   2. `sheet_music_available === false` beats a URL that is present: the flag is
 *      the backend's quality gate, and we trust it (the card says it holds no
 *      score rather than opening one the backend declined to serve).
 *   3. A MODERN (copyrighted) match NEVER renders notation — no score, no ABC, no
 *      chords. We host no copyrighted music; the card's only money path is the
 *      in-shell licensed-retailer offer.
 *   4. A public-domain work never gets a primary purchase claim: `/api/recognize`
 *      and the PD cross-check both send `purchase_url: null` for one, and this
 *      module keeps the affiliate *search* for a printed arrangement secondary.
 *
 * Pure by design — no react / react-native / fs / path imports, and no money-path
 * imports either: the caller resolves URLs through `purchaseCta.ts` (the module
 * that owns which retailer is primary) and hands the resolved strings in. This
 * module only decides what to DO with them.
 */
import type { RecognitionResponse } from '../types';

// ─────────────────────── the three kinds of result ───────────────────────

/**
 * What a result IS — the one decision the card branches on.
 *
 * `'library'` — a match in our public-domain catalog (the ambient landmark pass,
 * or the backend's PD cross-check on a recording of a PD work). The free hosted
 * score is the offer.
 * `'hum'` — the same library, reached by humming/whistling/singing the melody.
 * Its provenance is a fact the response carries (`result_provenance`), not a
 * guess: the kicker under the title changes, and the take it came from can be
 * exported as MIDI.
 * `'modern'` — a copyrighted work. Identity + a licensed-retailer offer, and
 * never any notation.
 *
 * `'original'` (the melody-capture build, backlog 27) is the named extension
 * point: an unmatched take of the user's OWN melody would be a fourth kind. It is
 * deliberately NOT in the union and has no branch — the re-flow must not scope
 * that work (spec §11.1).
 */
export type ResultKind = 'library' | 'hum' | 'modern';

/** The provenance marker a hum pass stamps on the response it builds. */
export const HUM_PROVENANCE = 'hum';

/**
 * The kind of result a success payload is.
 *
 * The hum pass is identified by the marker `humMatchToResultResponse()` writes
 * (frontDoor.ts) — a hum match and an ambient match of the same PD piece are
 * otherwise indistinguishable, and the card must not guess. Everything else is
 * decided by the one fact the backend is authoritative about: whether the work is
 * public domain.
 */
export function resultKindFor(response: RecognitionResponse): ResultKind {
  if (response.result_provenance === HUM_PROVENANCE) return 'hum';
  const top = response.matches[0];
  if (top && top.is_public_domain === false) return 'modern';
  return 'library';
}

/** True for the two kinds that come from our own public-domain library. */
export function isLibraryKind(kind: ResultKind): boolean {
  return kind === 'library' || kind === 'hum';
}

// ─────────────────────── the sheet slot's decision ───────────────────────

/**
 * Where the score in the result card came from.
 *  • `'hosted'`   — our own hosted score (the backend/catalog's URL).
 *  • `'purchase'` — no hosted score; the money path is the licensed retailer.
 *  • `'none'`     — neither: the card says so in words.
 * RESERVED (not implemented here): `'user-capture'` — the score is built from the
 * user's own recorded take (melody capture, backlog 27).
 */
export type ResultSheetSource = 'hosted' | 'purchase' | 'none';

/**
 * What the card does with the sheet slot:
 *  • `'inline'`    — render the hosted score in the card, at a bounded height.
 *  • `'open-full'` — part of the contract for a surface that must not embed the
 *                    document: the hosted score is reachable behind the one chip
 *                    that opens the reader. The card passes `inlineSheetAllowed:
 *                    false` to ask for it.
 *  • `'purchase'`  — no hosted score: the offer is the licensed retailer.
 *  • `'none'`      — nothing to render; the honest line says so.
 */
export type SheetSurfaceDecision = 'inline' | 'open-full' | 'purchase' | 'none';

/** Everything the sheet decision reads. All of it comes from the API/caller. */
export interface ResultSheetInput {
  kind: ResultKind;
  /**
   * The hosted score URL the backend or the catalog returned (`sheet_music_url`,
   * `fetchPieceById().sheetMusicUrl`). NEVER synthesised in the surface.
   */
  hostedSheetUrl?: string | null;
  /**
   * The backend's quality gate for that score. `false` wins over a URL: the card
   * then says it holds no score instead of opening one that was declined.
   */
  sheetMusicAvailable?: boolean;
  /** The resolved PRIMARY purchase URL (through `primaryPurchaseUrl()`), or null. */
  purchaseUrl?: string | null;
  /**
   * May the card embed the score (`source={{ html }}`)? Defaults to true; only a
   * surface that must not embed the document passes false.
   */
  inlineSheetAllowed?: boolean;
}

function usable(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The hosted score URL the card may render — null when there is none to render.
 *
 * Two rules, both hard:
 *   1. a MODERN (copyrighted) match has no hosted score, ever — we do not host
 *      copyrighted music, and the card must not render notation for one even if a
 *      stale payload carried a URL;
 *   2. the backend's `sheet_music_available` gate wins over the URL.
 */
export function hostedSheetUrl(input: ResultSheetInput): string | null {
  if (input.kind === 'modern') return null;
  const url = usable(input.hostedSheetUrl);
  if (!url) return null;
  if (input.sheetMusicAvailable === false) return null;
  return url;
}

/** What the card does with its sheet slot. Total, and derived from the two facts
 *  above — it never invents an offer. */
export function sheetSurfaceDecision(input: ResultSheetInput): SheetSurfaceDecision {
  if (hostedSheetUrl(input)) {
    return input.inlineSheetAllowed === false ? 'open-full' : 'inline';
  }
  if (usable(input.purchaseUrl)) return 'purchase';
  return 'none';
}

/** Where the card's score came from — the sheet-slot decision, named as data. */
export function resultSheetSource(input: ResultSheetInput): ResultSheetSource {
  const decision = sheetSurfaceDecision(input);
  if (decision === 'inline' || decision === 'open-full') return 'hosted';
  if (decision === 'purchase') return 'purchase';
  return 'none';
}

/** True when the card renders notation (the inline score, or the reader's sheet). */
export function rendersNotation(input: ResultSheetInput): boolean {
  const decision = sheetSurfaceDecision(input);
  return decision === 'inline' || decision === 'open-full';
}

/** True when the card offers the "⛶ Full screen" chip (only with an inline sheet:
 *  without one there is nothing to expand, and a chip that opens nothing is the
 *  dead control this re-flow removes). */
export function showsFullScreenChip(input: ResultSheetInput): boolean {
  return sheetSurfaceDecision(input) === 'inline';
}

// ─────────────────────── the card's words ───────────────────────

/** The provenance kicker for an ambient/library result. */
export const RESULT_KICKER_LIBRARY = '🎼 Recognized';
/**
 * The provenance kicker for a hum/whistle/sing match (spec A.2): the user did not
 * play the audio — they sang it — and the card says so instead of pretending it
 * heard the music.
 */
export const RESULT_KICKER_HUM = 'You hummed it — here it is';
/** The provenance kicker for a copyrighted (modern) match. */
export const RESULT_KICKER_MODERN = '🎼 Recognized';

/** The kicker line for a result kind. */
export function resultKicker(kind: ResultKind): string {
  if (kind === 'hum') return RESULT_KICKER_HUM;
  if (kind === 'modern') return RESULT_KICKER_MODERN;
  return RESULT_KICKER_LIBRARY;
}

/**
 * The copyright position, in the card, for a modern match (owner + melody-brief
 * rule: we point at licensed retailers, we host nothing). It is also the reason a
 * modern card shows no notation — the sentence and the predicate say the same
 * thing.
 */
export const MODERN_COPYRIGHT_NOTE =
  'NoteSnap never hosts or distributes copyrighted sheet music — we only point you to licensed retailers.';

/**
 * The honest line for a public-domain/library or hum result we hold NO hosted
 * score for. It replaces the retired dashed "🎼 Sheet music coming soon — we're
 * still curating…" box (audit D13, §E zero-promise): a box that promises a score
 * we do not hold is a dead end, so the card states what it has and nothing more.
 * The card's real next steps (the printed-arrangement search when the backend
 * gave us one, and/or the hum way in) sit with it.
 */
export const NO_HOSTED_SCORE_LINE =
  "We don't hold a score for this one yet — no sheet music for it in the app.";

/**
 * The honest line for a modern match with no licensed link at all. Never a static
 * "isn't linked yet" box: the card's retention levers (hum it / browse the free
 * library) are the real next steps underneath it (§E.2).
 */
export const MODERN_NO_LINK_LINE =
  "We identified this song, but there's no licensed sheet-music link for it yet.";

/**
 * The SECONDARY action on a library/PD (and hum) result (owner Q2/Q7, ratified
 * 10-02: explicitly ALLOWED when a URL exists): the affiliate SEARCH for this
 * work's printed arrangement, opened in the app's own retailer shell. It is never
 * a primary purchase claim — the free hosted score stays the offer, and
 * `purchase_url` stays null for a public-domain work.
 */
export const PRINTED_ARRANGEMENT_CTA = '🎼 Get a printed arrangement';

/**
 * The SECONDARY action's label on a MODERN match: the backend's backup retailer
 * (owner-approved 09-23, deduped 10-02 — `resultSecondaryOfferUrl()` renders it
 * only when it is a different page from the primary CTA's target). UX-only: no
 * affiliate programme on that page, and the money path stays the primary CTA.
 */
export const TRY_MUSICNOTES_LABEL = '🎼 Try Musicnotes';

/**
 * The label of the SECONDARY offer for a result kind. A library/PD (or hum)
 * result offers the affiliate SEARCH for a printed arrangement — never a purchase
 * claim, because the free hosted score is the offer (owner Q2/Q7). A modern match
 * offers the deduped backup retailer.
 */
export function resultSecondaryOfferLabel(kind: ResultKind): string {
  return isLibraryKind(kind) ? PRINTED_ARRANGEMENT_CTA : TRY_MUSICNOTES_LABEL;
}

/** True when the secondary offer on a kind is the printed-arrangement SEARCH
 *  (a library/PD or hum result) rather than a second retailer page. */
export function secondaryOfferIsPrintedArrangement(kind: ResultKind): boolean {
  return isLibraryKind(kind);
}

/** The chip that expands the inline score into the app's full-screen reader. */
export const SHEET_FULL_SCREEN_CHIP = '⛶ Full screen';
/** The label above the inline score block, so the block is not an anonymous box. */
export const SHEET_BLOCK_LABEL = 'Sheet music';

/**
 * The inline score's error text. The viewer DOCUMENT already renders its own
 * error overlay (sheetViewerHtml.ts) — this is the card's own line for the case
 * where the WebView itself failed (no network, bad byte-range), so a broken score
 * never becomes a silently blank box. The "Full screen" chip stays live, because
 * the reader retries the document on its own.
 */
export const SHEET_BLOCK_ERROR_LINE =
  "The score didn't load. Tap Full screen to try again.";

/** The bounded height of the inline score block (a card, not a reader: the reader
 *  is one chip away, and the card must stay scrollable so its CTA is never
 *  trapped off-screen on a small phone). */
export const INLINE_SHEET_HEIGHT = 320;

/** A screen-reader description of the inline score block. */
export function resultSheetAccessibilityLabel(title: string): string {
  return `Sheet music for ${title}, shown in the result card. Tap Full screen to open the reader.`;
}

/** A screen-reader description of the full-screen chip. */
export function fullScreenChipAccessibilityLabel(title: string): string {
  return `Open the full-screen sheet music for ${title}`;
}

// ─────────────────── the caller's MIDI-export contract ───────────────────

/**
 * The hum take's "Export MIDI", as the CALLER hands it to the surface (bundle A).
 *
 * The take belongs to the caller: the hum screen recorded it, holds its URI, runs
 * the export and owns the outcome. The surface renders the affordance from this
 * contract — which is why the button can never point at audio the user did not
 * just play, and why the outcome sentence is never swallowed (midiExportContract.ts
 * pins both halves).
 */
export interface ResultMidiExport {
  /** The recorded take. Null/absent = no take = the block is not rendered. */
  takeUri: string | null;
  /** True while the export runs (the label shows the busy state — never a dead tap). */
  exporting: boolean;
  /** The outcome sentence (success or failure), or null. A failure is NEVER hidden. */
  note: string | null;
  /** The take's detected key, e.g. "Key: C major" — null when there is none, and
   *  then no key line is shown at all (never a placeholder key). */
  keyLine: string | null;
  /** Runs the export for the take above. */
  onExport: () => void;
}

// ─────────────────── the modern card's retention levers ───────────────────

/**
 * The two levers that keep a modern result from being a dead end (§E.2): the
 * melody way in (the hum pass — the feature no sheet-music competitor has) and the
 * free library we actually serve. Both are free-tier actions: a purchase the user
 * declines must land them on something to do, not on a cold screen.
 */
export const HUM_IT_LEVER_LABEL = '🎤 Hum it instead';
export const HUM_IT_LEVER_HINT =
  "Whistle or sing the melody and we'll find it for you.";
export const BROWSE_LIBRARY_LEVER_LABEL = '🎼 Browse the free library';
export const BROWSE_LIBRARY_LEVER_HINT =
  'Public-domain scores you can open and play right now.';

/**
 * The result surface's fallback ACTION for a MODERN match with no licensed link
 * (bundle E, §E.2): the find-a-song search, opened as the app's own search surface
 * — a real path to the sheet music of a song we could not link, never a fake
 * button and never a promise. (The piece page's version of the same move is the
 * retailer SEARCH for a printed edition, `FIND_A_PIECE_LEVER_*` below.)
 */
export const SEARCH_FOR_IT_CTA = '🔎 Search for it';

/**
 * The PIECE PAGE's "find a piece" lever (bundle E, §E.2): the catalog search by
 * title/composer, for a learner who knows the piece's name and nothing else. It
 * renders only when the host wired the handler — a lever with no destination is
 * not a lever (§E.1.1).
 */
export const FIND_A_PIECE_LEVER_LABEL = '\ud83d\udd0e Find a piece';
export const FIND_A_PIECE_LEVER_HINT =
  'Search our free public-domain library by title or composer.';
