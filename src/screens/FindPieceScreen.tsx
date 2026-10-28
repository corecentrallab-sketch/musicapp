/**
 * FindPieceScreen — "Find a piece": search the NoteSnap catalog by title or
 * composer, straight from the live catalog endpoint `GET /api/pieces?q=`.
 *
 * Why this screen exists: recognition (audio + hum) needs the user to already
 * have the music in the room or in their head. A learner who simply knows the
 * name of a piece — "Für Elise", "Beethoven" — had no way in. This is that way
 * in, and it is also how the sheet-music-ready part of the catalog gets
 * discovered (real curated scores → the piece page → practice).
 *
 * THE SEARCH BOX NOW RESOLVES TO A MONEY PATH (owner direction 10-01): "the front
 * page search box should show results for everything in both internal results of
 * search and external affiliate results for search from notesnap". So while a
 * non-empty query is active the screen shows TWO result sets:
 *   • our own public-domain / classical catalog (the free, in-app offer), and
 *   • an "Official sheet music" section — the licensed retailers, deep-linked
 *     with the query the user typed (Sheet Music Direct with the affiliate id,
 *     plus the UX-only Musicnotes CTA), opened in the shared in-app browser shell
 *     on an explicit tap only.
 * The section is gated on the QUERY, never on our own results: a song our library
 * does not hold at all ("Fields of Gold") is exactly the case the money path
 * exists for, so the zero-match state points straight at it instead of stopping
 * at "no match" (plan 09-28: "any search in NoteSnap should not be a dead end").
 *
 * Behaviour:
 *   • empty query → the catalog's own first page (the browse state), no external
 *     section (nothing to search for);
 *   • ~300 ms debounce per settled query, newest response wins (a slow request
 *     for "fur" can never overwrite the results for "für elise");
 *   • no match  → "No pieces match — try another title or composer" PLUS the
 *     retailer section with the honest "not in our free library" hint — but only
 *     after the TYPO LADDER has been tried (v33 §F3): the user's own words first,
 *     then the model's variants of them, re-run through this same catalog search;
 *     when a variant is what matched, `retryNoticeLine` says so above the list and
 *     the honesty of the empty state is preserved when nothing matched;
 *   • failure   → honest error with a Retry button (never an empty list);
 *   • sheet badge → "🎼 Sheet music" only when the catalog really has a
 *     curated score, otherwise "Coming soon" (no invented links);
 *   • tapping a row opens PieceDetailScreen in place, exactly like History and
 *     the hum flow do, and best-effort fills in the catalog's coach data;
 *   • tapping a retailer card opens that retailer's OWN search page (previews +
 *     checkout live there) inside our app shell — we host and cache nothing.
 *
 * The logic (parsing, sorting, URL building, row → detail mapping, and the
 * external-section decision) lives in services/catalogSearch.ts and
 * services/searchExternal.ts and is unit-tested; this screen is a thin caller.
 * The wiring itself is guarded by services/searchExternalContract.ts.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { fetchPieceById, searchPieces } from '../services/api';
import {
  CATALOG_SEARCH_DEBOUNCE_MS,
  NO_MATCH_MESSAGE,
  SEARCH_ERROR_MESSAGE,
  catalogPieceToDetail,
  normalizeQuery,
  resultsHeaderText,
  sheetBadgeLabel,
  sortPiecesForDisplay,
} from '../services/catalogSearch';
// Typo tolerance (v33 §F3, owner 10-04: "Toccata & Fugue does not surface, even
// when typed as a common misspelling like 'toccatta and fugue'"). The ladder and
// the honest notice come from the model — this screen may not invent either.
import { queryVariants, rankFuzzyMatches, retryNoticeLine, SUBSTITUTE_MIN_SCORE } from '../services/fuzzySearch';
import {
  EXTERNAL_NO_MATCH_HINT,
  externalSearchSection,
  sheetMusicDirectSearchUrl,
} from '../services/searchExternal';
import { SearchExternalSection } from '../components/SearchExternalSection';
// ── v46 CORRECTIVE: THIS SCREEN **IS** DISCOVER ──────────────────────────────
// The ratified v45 design puts the genre surface HERE, not on Home: "Home
// (minimal) → Discover (five families + money rows) → family screen", and
// V45-HOME-NOTES.md:199 spells Discover out as "FindPieceScreen, extended" —
// title row, search field, BROWSE BY STYLE, the five family tiles, then the money
// rows ("Any song — official sheet music", "Browse the free library").
//
// v45 slice 3b shipped that block inside HomeScreen's ScrollView instead, so the
// owner's device pass read the door as "home and discover are on one page". It
// moved here in v46, handlers, real counts and family-screen mount included.
// Everything rendered below still comes from services/genreFamilies.ts (pure,
// tier1-tested) — this screen wires it and invents no copy, no count and no URL.
// The hosting is guarded in BOTH directions by services/v46DiscoverHosting.ts:
// the gate fails if these markers come back to HomeScreen, AND it fails if this
// screen loses the grid, the money chips or the family-screen mount.
import { DiscoverStyles } from '../components/DiscoverStyles';
import { FamilyScreen } from '../components/FamilyScreen';
import { DISCOVER_LAYOUT, type EraCounts, type FamilyId } from '../services/genreFamilies';
import { loadGenreCounts } from '../services/genreCountsStore';
import {
  BROWSE_LIBRARY_ACCESSIBILITY_LABEL,
  BROWSE_LIBRARY_HINT,
  BROWSE_LIBRARY_LABEL,
  FRONT_DOOR_BETA_NOTE,
  bandFacets,
  FRONT_DOOR_FACET_FLAGS,
} from '../services/frontDoorBands';
// v43 ITEM C4 — THE CAMERA DOOR IS GONE FROM THIS SCREEN (owner decision 10-20).
// The app has ONE way to photograph a score: Library "+" → Add Music → Scan
// score, which saves the pages to the library AND resolves a cover's title. The
// "📷 Scan a cover" row, its modal mount, its handlers and its label were
// removed here, so there is no second camera surface and no second search path.
import { PurchaseWebView } from '../components/PurchaseWebView';
import { mergeCatalogIntoDetail } from '../services/historyPiece';
import { PieceDetailScreen } from './PieceDetailScreen';
import { useHardwareBack } from '../hooks/useHardwareBack';
import {
  OCR_PREFILL_EMPTY_NOTE,
  OCR_PREFILL_SEARCH_CTA,
  OCR_PREFILL_WAITING_LINE,
  canConfirmOcrPrefill,
  initialOcrPrefillState,
  ocrPrefillNote,
} from '../services/ocrPrefill';
import type { CatalogPiece, DailyChallengePiece } from '../types';

type Status = 'prefill' | 'loading' | 'ready' | 'empty' | 'error';

interface FindPieceScreenProps {
  onClose: () => void;
  /**
   * ADDITIVE (v39 fix 1b): the words a scanned page produced, when the caller is
   * the scan flow. Optional, so every existing door is unchanged; a caller that
   * passes nothing gets the same empty search box it always had.
   */
  initialQuery?: string;
  /**
   * ADDITIVE (v45 slice 4, owner 2026-10-26 — "scan → OCR → auto-search"). The
   * scan flow's lookup: when the classifier proved this photo is a COVER, the read
   * is good, and it named a piece we hold, the words below are a CONFIRMED title
   * rather than a proposal, so this screen searches them straight away.
   *
   * It is never silent. The plan carries the headline ("Looking up “X” for you")
   * and the dismiss label, both printed above the results, and the dismiss puts the
   * user back on the camera with the resolve page still open. Nothing here touches
   * a retailer: a store is only ever reached by tapping a result row, which is the
   * 08-24 no-auto-redirect rule.
   */
  autoSearchNotice?: { headline: string; dismissLabel: string } | null;
  /** The way out of a lookup the app started: back to the scan, in control. */
  onDismissAutoSearch?: () => void;
  /**
   * v46 DEFECT FIX (owner 10-28) — "Browse what is free now" STAYS IN DISCOVER.
   *
   * The row lives on this screen (the Discover surface) and used to be handed a
   * caller-owned handler that closed the search and ran `navigation.navigate(
   * 'Library')` — so asking for the free public-domain scores landed the user in
   * their own saved library, a screen holding none of them. The destination is
   * this screen's OWN browse state (an empty query, which loads the catalog's
   * first page = the free scores), so the row now needs no injected handler at
   * all: `handleBrowseFreeScores` clears the family/query and scrolls that list
   * into view. There is deliberately NO `onBrowseLibrary` prop any more — a caller
   * cannot re-point the free-scores lever at a non-free-scores surface.
   *
   * ── v46 CORRECTIVE — whether this mount is a DISCOVER surface at all ──
   *
   * Default TRUE (omit it): the Home door's hand-off, where the design says
   * Discover = this screen. Pass FALSE to get the plain search screen.
   *
   * The scan / OCR flows do not need to pass anything and are not disturbed:
   * they hand in a query (`initialQuery` and, when the app started the lookup,
   * `autoSearchNotice`), and the Discover block only renders on an EMPTY query —
   * the browse state. A query means the user is searching, so the results (and
   * the retailer section that always accompanies them) get the screen.
   */
  showDiscover?: boolean;
}

export const FindPieceScreen: React.FC<FindPieceScreenProps> = ({
  onClose,
  initialQuery,
  autoSearchNotice,
  onDismissAutoSearch,
  showDiscover = true,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  /**
   * A query handed in by the caller (v39 fix 1b: a scanned page's own words).
   *
   * IT IS A PROPOSAL, NOT A QUERY (v42 fix D — owner, v41 device pass 10-20: a
   * photographed Bohemian Rhapsody score prefilled the box with
   * "a-thy,Be-cause I'm Freddie Mercury" and the screen searched it immediately,
   * landing on "No Match" for words the user never typed). `prefillPending` is
   * TRUE while the field holds words the app read off a photo: the debounced
   * search below refuses to run in that state, an honest line says where the
   * words came from, and the one control (`OCR_PREFILL_SEARCH_CTA`) turns them
   * into a search — after the user has had a chance to SEE and EDIT them.
   *
   * A caller that passes nothing (every other door: the Home search, the library,
   * the cover-scan confirm on a typed flow) starts with `pending: false` and gets
   * exactly the type-ahead screen it always had.
   */
  const [query, setQuery] = useState(() => initialOcrPrefillState(initialQuery).query);
  /**
   * v45 SLICE 4 — THE ONE EXCEPTION TO THE PROPOSAL STEP, and it is not silent.
   * A prefilled read starts PENDING (v42 fix D) so a photo's words never become an
   * invisible query. The scan flow may hand in an `autoSearchNotice` only when
   * services/scanClassify's gate fired — the photo is a COVER, the read is 'good',
   * AND it named a piece we hold — so the words are a confirmed title, not a
   * proposal: this starts unpending and the lookup runs. The notice above the
   * results says so and cancels it.
   */
  const [prefillPending, setPrefillPending] = useState(() =>
    autoSearchNotice ? false : initialOcrPrefillState(initialQuery).pending,
  );
  const [pieces, setPieces] = useState<CatalogPiece[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  // The honest "which query actually found these" line (v33 §F3). Set ONLY when
  // the user's own words found nothing and a variant of them did — never on a
  // first-try hit, where there is nothing to explain.
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // Bumped by the Retry button to re-run the current query.
  const [reloadToken, setReloadToken] = useState(0);
  // Full-screen piece page for a tapped row (rendered in place, like History).
  const [showDetail, setShowDetail] = useState<DailyChallengePiece | null>(null);
  // The licensed retailer the user tapped (opened in the in-app shell). Never
  // set by anything but a tap — no auto-redirect (owner 08-24).
  const [retailerUrl, setRetailerUrl] = useState<string | null>(null);
  // v33 §H: the cover-photo flow (camera → confirm → THIS screen's search). It is
  // opened only by the affordance's own tap, and it adds no second search: the
  // confirmed text is written into `query`, the field the user types into.
  // Guards against a stale response replacing newer results.
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  // v46: the field's own ref, so a Discover money row can put the cursor in it
  // when there is nothing to search yet (no invented query, no store redirect).
  const searchInputRef = useRef<TextInput>(null);

  // ── v46 CORRECTIVE: the Discover surface's real numbers (moved from Home) ──
  // `familyCounts` starts null and stays null if the catalog cannot be read, so
  // every count on a tile is OPTIONAL by construction: no data → no numbers.
  const [familyCounts, setFamilyCounts] = useState<{
    total: number;
    eras: EraCounts | null;
  } | null>(null);
  // The family whose screen is open, or null. One in-place flow, one family.
  const [selectedFamily, setSelectedFamily] = useState<FamilyId | null>(null);
  // The facet chips whose backing content exists today (the guitar facet stays
  // OFF: frontDoorBands.guitarContentAvailable is false until a screen surfaces
  // the audited PD guitar batch — an absent facet beats a "coming soon" chip).
  const facets = bandFacets(FRONT_DOOR_FACET_FLAGS);

  // Debounced catalog search: one request per settled query.
  useEffect(() => {
    // THE OCR GATE (v42 fix D): words the app READ are never searched until the
    // user has acted on them. This is the one place a prefilled query could have
    // become an invisible auto-query — it returns before the request is even
    // scheduled, so nothing leaves the device for a proposal.
    if (prefillPending) {
      setStatus('prefill');
      return;
    }
    const trimmed = normalizeQuery(query);
    const typed = trimmed;
    const token = ++searchRequestRef.current;
    setStatus('loading');

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await searchPieces(trimmed);
          if (token !== searchRequestRef.current) return;
          const sorted = sortPiecesForDisplay(res.pieces);

          // ── The typo ladder (v33 §F3) ──
          // The user's own words are always tried FIRST (above). Only when they
          // find nothing does the screen re-run the SAME catalog search with the
          // model's variants, in the model's order, and rank what comes back. The
          // winner is what the user sees, and the notice names the query that
          // actually matched — no silent substitution, no invented results.
          //
          // v39 fix 1 (owner 10-11, the money path): the ranking is against THE
          // USER'S OWN WORDS and a substitute must clear `SUBSTITUTE_MIN_SCORE`.
          // Ranked against the variant, the single-token rung scored every row of
          // a common word 1.0 — so a cover scan whose read matched nothing could
          // come back holding a DIFFERENT piece, and that row is what carries the
          // retailer link. A substitute that answers only one of the user's words
          // is now no result at all: the honest empty state stands.
          if (sorted.length === 0 && typed.length > 0) {
            for (const variant of queryVariants(typed)) {
              if (variant === typed) continue;
              const retry = await searchPieces(variant);
              if (token !== searchRequestRef.current) return;
              const ranked = rankFuzzyMatches(typed, sortPiecesForDisplay(retry.pieces), {
                minScore: SUBSTITUTE_MIN_SCORE,
              });
              if (ranked.length > 0) {
                const matched = ranked.map((entry) => entry.item);
                setPieces(matched);
                setTotal(matched.length);
                setRetryNotice(retryNoticeLine(typed, variant));
                setStatus('ready');
                return;
              }
            }
            // Every variant came up empty too: the honest empty state stands, with
            // the retailers below it (the no-dead-end rule from 09-28).
            setPieces([]);
            setTotal(0);
            setRetryNotice(null);
            setStatus('empty');
            return;
          }

          setPieces(sorted);
          setTotal(res.total);
          setRetryNotice(null);
          setStatus(sorted.length === 0 ? 'empty' : 'ready');
        } catch {
          if (token !== searchRequestRef.current) return;
          setPieces([]);
          setTotal(0);
          setRetryNotice(null);
          setStatus('error');
        }
      })();
    }, CATALOG_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, reloadToken, prefillPending]);

  /**
   * Open a search result on the piece page. The row already carries the
   * catalog's identity, difficulty and curated sheet URL, so the page opens
   * instantly; the /api/pieces/:id lookup afterwards only fills in what the
   * search row does not carry (the coach's ABC reference melody). A failed
   * lookup leaves the page as it is — never an error, never a blocked tap.
   */
  const handleOpenPiece = useCallback((piece: CatalogPiece) => {
    const token = ++detailRequestRef.current;
    setShowDetail(catalogPieceToDetail(piece));
    void fetchPieceById(piece.id).then((info) => {
      if (!info || token !== detailRequestRef.current) return;
      setShowDetail((current) =>
        current && current.id === piece.id
          ? mergeCatalogIntoDetail(current, info)
          : current,
      );
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    detailRequestRef.current++;
    setShowDetail(null);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    // Clearing the field also ends the proposal: an empty box is a normal empty
    // search box, not a read that is waiting to be agreed to (v42 fix D).
    setPrefillPending(false);
  }, []);

  /**
   * THE USER AGREED TO THE READ WORDS (v42 fix D). Their tap (or the keyboard's
   * search key) is the ONLY thing that turns a prefilled read into a query; the
   * token bump makes it a fresh request even when the text itself did not change.
   * From here the screen is the ordinary type-ahead search it always was.
   */
  const handleSubmitPrefill = useCallback(() => {
    setPrefillPending(false);
    setReloadToken((n) => n + 1);
  }, []);

  /**
   * Open a retailer card in the in-app browser shell. Tap-driven only: this is
   * the ONLY writer of `retailerUrl`, so no code path can redirect the user to a
   * store on its own (the owner's 08-24 no-auto-redirect rule).
   */
  const handleOpenRetailer = useCallback((url: string) => {
    setRetailerUrl(url);
  }, []);

  const handleCloseRetailer = useCallback(() => {
    setRetailerUrl(null);
  }, []);

  // ── v46 CORRECTIVE: the Discover style surface's REAL numbers ──
  // One fire-and-forget walk of the catalog, cached for the session by
  // services/genreCountsStore. It NEVER blocks the screen and never fails loudly:
  // no data means the tiles and the era chips render their names without counts,
  // which is exactly what a backend that has not shipped `genre` yet produces.
  useEffect(() => {
    let alive = true;
    void loadGenreCounts().then((counts) => {
      if (!alive || !counts) return;
      setFamilyCounts({ total: counts.total, eras: counts.eras });
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── v46 CORRECTIVE: every family tile opens its family screen ──
  // ONE handler for all five tiles, carrying the family id from the table — a
  // tile is never a no-op and never opens something generic. The screen decides
  // what an empty family resolves to (money path first, free library under it),
  // so this handler cannot disagree with the design.
  const handleOpenFamily = useCallback((id: FamilyId) => {
    setSelectedFamily(id);
  }, []);

  // ── THE FREE-SCORES LANDING (v46 defect fix, owner 10-28) ──
  // The catalog list inside the one results scroller. Its laid-out y is the
  // landing point for "Browse what is free now": on the browse state the
  // Discover block (tiles, chips, money rows) sits ABOVE it, so scrolling to the
  // top would leave the user looking at the same tiles they just left. The y is
  // MEASURED (onLayout) rather than computed from style constants, so it stays
  // right on every screen size.
  const resultsScrollRef = useRef<ScrollView>(null);
  const freeListYRef = useRef(0);
  const pendingFreeListScrollRef = useRef(false);
  const scrollToFreeList = useCallback(() => {
    resultsScrollRef.current?.scrollTo({
      y: Math.max(0, freeListYRef.current - 8),
      animated: true,
    });
  }, []);
  // The list's own layout: remember where it starts, and consume a pending
  // free-scores jump (the family screen's row sets it, because the list is
  // unmounted while that screen is open and re-lays-out when it closes).
  const handleFreeListLayout = useCallback(
    (event: { nativeEvent: { layout: { y: number } } }) => {
      freeListYRef.current = event.nativeEvent.layout.y;
      if (pendingFreeListScrollRef.current) {
        pendingFreeListScrollRef.current = false;
        scrollToFreeList();
      }
    },
    [scrollToFreeList],
  );

  // "Browse what is free now" — THE FREE SCORES, IN PLACE (v46 defect fix,
  // owner 10-28). The two lever sites (the Discover free-library row and the
  // family screen's free row) both land on the catalog's own browse state: this
  // screen with NO family open and NO query, which is the free public-domain
  // list, scrolled into view.
  //
  // What it must never do again: call a caller-injected handler. In v46 that
  // handler was HomeScreen's `navigation.navigate('Library')`, so the row
  // promised free scores and delivered the user's personal library. There is no
  // prop that can restore that — the destination is decided here, once.
  const handleBrowseFreeScores = useCallback(() => {
    pendingFreeListScrollRef.current = true;
    setSelectedFamily(null);
    handleClearQuery();
    // Already on the browse state (the Discover row, with no family open): the
    // list is laid out, so go there now. When the family screen is what called
    // us the list is not mounted yet; its own onLayout consumes the pending flag
    // and scrolls the moment it is laid out (no timer, no guessing).
    scrollToFreeList();
  }, [handleClearQuery, scrollToFreeList]);

  /**
   * THE MONEY FACET ON THE DISCOVER SURFACE (v46).
   *
   * "🛒 Any song → official sheet music" used to be a chip that opened THIS
   * screen from Home. The screen hosts it now, so the chip does the job the
   * door's tap used to do — put the user one tap from the licensed search:
   *   • a query is typed → the retailer's OWN search for those words opens in the
   *     in-app shell, built by services/searchExternal's affiliate builder (SMD,
   *     67650) — the same URL the results-section card carries, never a
   *     hand-written one, and never with a recording/ISRC code;
   *   • nothing is typed yet → no invented query and no store redirect: the cursor
   *     goes in the field, and typing anything produces the retailer section.
   */
  const handleOpenAnySongOfficial = useCallback(() => {
    const url = sheetMusicDirectSearchUrl(query);
    if (!url) {
      searchInputRef.current?.focus();
      return;
    }
    handleOpenRetailer(url);
  }, [query, handleOpenRetailer]);

  /** The free facet: back to the free public-domain browse (clears the query). */
  const handleBrowseFreeCatalog = useCallback(() => {
    handleClearQuery();
    searchInputRef.current?.focus();
  }, [handleClearQuery]);

  /**
   * ONE dispatch for the chip row, so every chip has a real destination: the
   * money facet runs the licensed search, every other facet returns to the free
   * catalog browse. No chip is decorative and none is a no-op.
   */
  const handleFacetChip = useCallback(
    (id: string) => {
      if (id === 'any-song') {
        handleOpenAnySongOfficial();
        return;
      }
      handleBrowseFreeCatalog();
    },
    [handleOpenAnySongOfficial, handleBrowseFreeCatalog],
  );

  /**
   * The external half of the results — a licensed-retailer search for whatever
   * the user typed. SIMPLE dependency on the query (and the internal match count,
   * which only changes the honest subtitle): no request, no debounce, nothing
   * that can fail, so it is present even when our own catalog timed out or
   * matched nothing. Empty query → `visible: false` → the section renders nothing.
   */
  const external = externalSearchSection(query, pieces.length);

  const renderItem = ({ item }: { item: CatalogPiece }) => {
    const meta = [item.composer, item.catalog].filter(
      (part): part is string => !!part && part.length > 0,
    );
    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => handleOpenPiece(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title} by ${item.composer}`}
      >
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {meta.length > 0 ? (
            <Text style={styles.itemComposer} numberOfLines={1}>
              {meta.join(' · ')}
            </Text>
          ) : null}
          {item.difficultyLabel ? (
            <Text style={styles.itemDifficulty}>{item.difficultyLabel}</Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.badge,
            item.sheetMusicAvailable ? styles.badgeReady : styles.badgeSoon,
          ]}
          numberOfLines={1}
        >
          {sheetBadgeLabel(item.sheetMusicAvailable)}
        </Text>
      </TouchableOpacity>
    );
  };

  // Android hardware BACK (in-place flow — owner bug class 09-23). Find-a-Piece
  // replaces its host tab's whole body, so nothing else consumes the BACK press:
  // without this it reaches React Navigation, which has no route to pop and
  // finishes the activity (the app "exits"). Unwind ONE level: out of the opened
  // piece first, then back to whoever opened the search. Guarded by
  // src/services/backExitContract.ts.
  useHardwareBack(() => {
    if (showDetail) {
      handleCloseDetail();
      return true;
    }
    onClose();
    return true;
  });
  // Full-screen piece page for a tapped row (same in-place pattern as History).
  if (showDetail) {
    return <PieceDetailScreen piece={showDetail} onBack={handleCloseDetail} />;
  }

  // ── v46 CORRECTIVE: THE FAMILY SCREEN (one of the five style families) ──
  // Moved here from HomeScreen with the tiles that open it. It is the destination
  // of EVERY Discover style tile, rendered in place exactly like the piece page
  // above, and it owns its own BACK handling (FamilyScreen → useHardwareBack) so
  // a hardware BACK returns to this search screen, never out of the app. Its
  // first row is the money path for a family with no free scores; the free
  // library is always the row beneath it.
  if (selectedFamily) {
    return (
      <FamilyScreen
        family={selectedFamily}
        freeCount={familyCounts ? familyCounts.total : null}
        eraCounts={familyCounts ? familyCounts.eras : null}
        onClose={() => setSelectedFamily(null)}
        onBrowseFreeScores={handleBrowseFreeScores}
      />
    );
  }

  const header = resultsHeaderText(total, query, pieces.length);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          hitSlop={8}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find a piece</Text>
      </View>

      {/* ── THE LOOKUP THE APP STARTED FOR YOU (v45 slice 4) ────────────────────
          A scan whose read proved it was a cover, was good, and named a piece we
          hold opens this screen already searching that title. The app moved first,
          so it says so in words ("Looking up “X” for you"), in the same strip as
          the one control that undoes it — "Not now" returns the user to the camera
          with the resolve page still open. No retailer is opened by any of this:
          the money path is still the user's own tap on a result row. */}
      {autoSearchNotice ? (
        <View style={styles.autoSearchCard}>
          <Text style={styles.autoSearchHeadline}>{autoSearchNotice.headline}</Text>
          <TouchableOpacity
            style={styles.autoSearchDismiss}
            onPress={onDismissAutoSearch}
            accessibilityRole="button"
            accessibilityLabel={autoSearchNotice.dismissLabel}
            hitSlop={8}
          >
            <Text style={styles.autoSearchDismissText}>
              {autoSearchNotice.dismissLabel}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Query field — focused on open so the keyboard is ready for a title. */}
      <View style={styles.searchRow}>

        <Text style={styles.searchIcon}>🔎</Text>
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          value={query}
          // EDITING NEVER SEARCHES BY ITSELF WHILE A READ IS PENDING (v42 fix D):
          // the user is correcting what the app read, and the words only become a
          // query when they say so (the control below, or the search key here).
          onChangeText={setQuery}
          placeholder="Search by title or composer"
          placeholderTextColor={theme.subtext}
          autoFocus
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          onSubmitEditing={prefillPending ? handleSubmitPrefill : undefined}
          accessibilityLabel="Search the catalog by title or composer"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClearQuery}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>


      <Text style={styles.subtitle}>
        Free public-domain and classical pieces — search, then open the score.
      </Text>

      {/* ── WHAT THE APP READ OFF YOUR PHOTO (v42 fix D) ───────────────────────
          The recogniser's own words are in the field above and NOTHING has been
          searched. This strip says so, and its one control runs the search — the
          owner's rule from the v41 pass: the user must be able to see AND edit the
          read text before any query leaves the device. It disappears the moment
          the proposal is confirmed (the screen then behaves exactly as before). */}
      {prefillPending ? (
        <View style={styles.prefillCard}>
          <Text style={styles.prefillNote}>{ocrPrefillNote({ query, pending: true })}</Text>
          {/* v44 #59 — THE WORDS THE CONTROL WILL SEARCH, PRINTED IN BOLD. The
              owner's report: the "Search these words" box "showed nothing in
              bold" — the words lived only in the field above, so at the moment of
              tapping the user could not see what was about to be searched. They are
              printed here, from the SAME `query` the control submits, so the search
              shown is the search that runs. */}
          {canConfirmOcrPrefill({ query, pending: true }) ? (
            <Text style={styles.prefillWords} numberOfLines={3}>
              {query}
            </Text>
          ) : null}
          {canConfirmOcrPrefill({ query, pending: true }) ? (
            <TouchableOpacity
              style={styles.prefillCta}
              onPress={handleSubmitPrefill}
              accessibilityRole="button"
              accessibilityLabel={OCR_PREFILL_SEARCH_CTA}
            >
              {/* The ink is the palette's accentInk, read INLINE: white on the red
                  pill in BOTH modes. As a StyleSheet `#ffffff` it was repainted to
                  the light palette's near-black text token and vanished on the red
                  (v44 #59). */}
              <Text style={[styles.prefillCtaText, { color: theme.accentInk }]}>
                {OCR_PREFILL_SEARCH_CTA}
              </Text>
            </TouchableOpacity>
          ) : (
            /* The honest EMPTY state: no words were read, so there is nothing to
               search and nothing pretends otherwise. */
            <Text style={styles.prefillNote}>{OCR_PREFILL_EMPTY_NOTE}</Text>
          )}
        </View>
      ) : null}

      {/* What actually matched (v33 §F3): shown only when the user's own words
          found nothing and a variant of them did. It sits above the results so
          the list can never look like a first-try hit for a typo'd query. */}
      {retryNotice ? (
        <Text style={styles.retryNotice}>{retryNotice}</Text>
      ) : null}

      {/* ── THE ONE RESULTS SCROLLER (v41 item 3) ─────────────────────────────
          ONE scrollable column holds the internal state AND the licensed-retailer
          cards. Before this, the no-match block was a `flex: 1` sibling of a
          `flexGrow: 0, maxHeight: 340` retailer frame: on the no-match state the
          retailers were pushed below the bottom of a screen that could not
          scroll, so the money path was BUILT and INVISIBLE (owner 10-18: scanned
          the cover of "Every Time I Think of You" → "No Match", both retailer
          links live, neither reachable). Every block below is a natural-height
          child of this ONE scroller, so the retailer cards sit directly under the
          no-match sentence and are always one swipe away — on no-match, while the
          catalog loads, and on error alike. */}
      <ScrollView
        ref={resultsScrollRef}
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── v46 CORRECTIVE: THE DISCOVER SURFACE (BROWSE BY STYLE + money rows) ──
            This block lived inside HomeScreen's ScrollView in v45, which put the
            Discover surface on the door and is exactly what the owner saw on
            device ("home and discover are on one page"). The ratified design is
            "Home (minimal) → Discover (five families + money rows) → family
            screen", with Discover = THIS screen extended (V45-HOME-NOTES.md:64 and
            :199), so the block renders here, after the search field and BEFORE any
            result row, as the first child of the one results scroller.

            WHY THE SCROLLER AND NOT A FIXED BLOCK ABOVE IT: the tiles, the era
            chips and the two money rows are taller than the space left under the
            field on a 390 dp phone. Fixed above the scroller they would squeeze
            the results (and the retailer cards under them) into a sliver; here
            they scroll away naturally and the money path is never pushed off a
            screen that cannot scroll (the v41 rule that put the retailers in this
            same scroller).

            WHEN IT SHOWS: only on the BROWSE state (`showDiscover` and an empty
            query). A typed query means the user is searching, so the results and
            the retailer section get the screen — and the scan/OCR flows always
            hand in words, so their lookup flow is untouched. */}
        {showDiscover && !prefillPending && query.trim().length === 0 ? (
          <View style={styles.discoverBlock}>
            {/* BROWSE BY STYLE: the five style families, from the table in
                services/genreFamilies.ts — never a classical-only grid. Four
                families hold no free scores today; their tiles look exactly like a
                populated one, say "Official sheet music", and open a family screen
                whose first row is the live official-editions search (money path)
                with the free library one row below it. No toast, no grey-out, no
                no-op tile — every family resolves. Counts render only when
                genreCountsStore derived them from real rows. */}
            <DiscoverStyles
              layout={DISCOVER_LAYOUT}
              freeCount={familyCounts ? familyCounts.total : null}
              eraCounts={familyCounts ? familyCounts.eras : null}
              onOpenFamily={handleOpenFamily}
            />

            {/* The facet chips the band-C fold moved to Discover (v45 slice 2),
                money facet included. Two are live today; the guitar facet stays
                off until a screen surfaces the audited PD guitar batch. Each chip
                has a REAL destination (the money one runs the licensed search for
                the typed words, the rest return to the free catalog browse) — the
                S2 rule is that money rows survive, not that they merely render. */}
            {facets.length > 0 ? (
              <View style={styles.bandChipRow}>
                {facets.map((facet) => (
                  <TouchableOpacity
                    key={facet.id}
                    style={styles.bandChip}
                    onPress={() => handleFacetChip(facet.id)}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={facet.label}
                  >
                    <Text style={styles.bandChipText}>{facet.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* The free library — the hook (free content earns the trust the paid
                paths live on). Same destination the modern interstitial's own
                "browse the free library" lever uses. The honest library-size note
                travels WITH this row: it left the hero in v45 slice 1 and may not
                be dropped on the way into Discover. */}
            <TouchableOpacity
              style={styles.browseLibraryRow}
              onPress={handleBrowseFreeScores}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={BROWSE_LIBRARY_ACCESSIBILITY_LABEL}
            >
              <Text style={styles.browseLibraryEmoji}>📚</Text>
              <View style={styles.browseLibraryInfo}>
                <Text style={styles.browseLibraryTitle}>{BROWSE_LIBRARY_LABEL}</Text>
                <Text style={styles.browseLibraryHint}>{BROWSE_LIBRARY_HINT}</Text>
                <Text style={styles.browseLibraryBetaNote}>{FRONT_DOOR_BETA_NOTE}</Text>
              </View>
              <Text style={styles.browseLibraryChevron}>›</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {status === 'prefill' ? (
          <View style={styles.stateBlock}>
            <Text style={styles.emptyEmoji}>✍️</Text>
            <Text style={styles.emptyTitle}>Not searched yet</Text>
            <Text style={styles.emptyText}>{OCR_PREFILL_WAITING_LINE}</Text>
          </View>
        ) : null}

        {status === 'loading' && pieces.length === 0 ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.centerSubtext}>Searching the catalog...</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View style={styles.stateBlock}>
            <Text style={styles.emptyEmoji}>⚠️</Text>
            <Text style={styles.emptyTitle}>Couldn't load the catalog</Text>
            <Text style={styles.emptyText}>{SEARCH_ERROR_MESSAGE}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setReloadToken((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="Retry the catalog search"
            >
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {status === 'empty' ? (
          <View style={styles.stateBlock}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>No match</Text>
            <Text style={styles.emptyText}>{NO_MATCH_MESSAGE}</Text>
            {/* The no-dead-end line (owner 10-01): a song our free library does not
                hold still has a money path, and it is right below this text. */}
            {external.visible ? (
              <Text style={styles.emptyText}>{EXTERNAL_NO_MATCH_HINT}</Text>
            ) : null}
          </View>
        ) : null}

        {status === 'ready' ? (
          <View onLayout={handleFreeListLayout} testID="free-scores-list">
            {header.length > 0 ? (
              <Text style={styles.listHeader}>{header}</Text>
            ) : null}
            {pieces.map((item) => (
              <View key={item.id}>{renderItem({ item })}</View>
            ))}
          </View>
        ) : null}

        {/* ── EXTERNAL RESULTS — the licensed retailers (owner direction 10-01) ──
            Rendered whenever the QUERY is non-empty, deliberately OUTSIDE every
            internal-status branch (it is a sibling of the status blocks inside the
            shared scroller, never conditioned on `status`). That placement is the
            whole no-dead-end rule: "Fields of Gold" matches nothing in our
            public-domain library, and that zero-match case is exactly the one this
            section exists for — so it survives `empty`, and it stays available
            while our catalog is still loading or has failed outright. Since v41 it
            also shares the scroller, so it can never be laid out below the fold of
            a screen that does not scroll. Tap-through only (each card opens the
            retailer in the shell below); we host and cache nothing. */}
        {external.visible ? (
          <View style={styles.externalBlock}>
            <SearchExternalSection section={external} onOpen={handleOpenRetailer} />
          </View>
        ) : null}
      </ScrollView>

      {/* The retailer's own search page (previews + checkout), in the shared
          in-app shell: Modal root, BACK / "← Back to NoteSnap" return HERE, and
          it only ever opens from a tap. */}

      <PurchaseWebView
        url={retailerUrl}
        title={
          external.query
            ? `Official sheet music · ${external.query}`
            : 'Official sheet music'
        }
        onClose={handleCloseRetailer}
      />
    </View>
  );
};

const baseStyles = StyleSheet.create({
  // ── v46 CORRECTIVE: the Discover surface's styles ──
  // Carried over VERBATIM from HomeScreen's StyleSheet, where the block used to
  // render. Every colour is an existing palette literal, so the light-theme
  // remap repaints them with no new token.
  discoverBlock: {
    width: '100%',
  },
  // A wrapping row of small chips: the facet labels are long on purpose and must
  // reflow rather than clip on a 360 dp screen.
  bandChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  bandChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bandChipText: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '600',
  },
  // The free-library row — a row, not a chip: it is the hook the paid paths live
  // on, so it keeps the quiet card treatment.
  browseLibraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    minHeight: 56,
  },
  browseLibraryEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  browseLibraryInfo: {
    flex: 1,
  },
  browseLibraryTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  browseLibraryHint: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 2,
  },
  browseLibraryChevron: {
    color: '#4ecdc4',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  // The relocated beta note: small and quiet, under the row's own hint.
  browseLibraryBetaNote: {
    color: '#6a6a8a',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 4,
  },

  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  backBtn: {
    marginRight: 12,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },

  /* v45 SLICE 4 — THE LOOKUP THE APP STARTED, SAID OUT LOUD. One strip: what is
     being looked up, and the control that stops it. Palette literals for the same
     reason as the prefill card (v40 fix B): these colours must read in BOTH modes,
     and `#16213e` is the palette's own `surface` in each. */
  autoSearchCard: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  autoSearchHeadline: {
    flexShrink: 1,
    color: '#eaeaff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  autoSearchDismiss: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  autoSearchDismissText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
  },

  // THE READ-FROM-A-PHOTO STRIP (v42 fix D): the words are a proposal until the
  // user agrees, so the card is quiet — a note and ONE control, never a result.
  prefillCard: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
    gap: 10,
  },
  prefillNote: {
    color: '#cfe9ff',
    fontSize: 12,
    lineHeight: 17,
  },
  /* v44 #59 — the words this control will search, in bold, before the tap. */
  prefillWords: {
    color: '#eaeaff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 6,
  },
  prefillCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e94560',
  },
  prefillCtaText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },


  // The "what actually matched" line for a typo'd query (v33 §F3): quiet, above
  // the list, never a warning — it explains the results, it does not scold.
  retryNotice: {
    color: '#4ecdc4',
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: 20,
    marginTop: 10,
  },

  // Search field
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    paddingVertical: 12,
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  clearBtnText: {
    color: '#e94560',
    fontSize: 13,
    fontWeight: '700',
  },
  subtitle: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: 20,
    marginTop: 10,
  },

  // ── States (v41 item 3) ──────────────────────────────────────
  // The ONE results scroller. It was a FlatList + a bounded, non-scrolling
  // retailer frame; now every result block (state, list, retailers) is a child of
  // this single scroller, so the retailer CTAs can never be laid out below the
  // fold of a screen that does not scroll.
  resultsScroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  resultsContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  // A state block takes its NATURAL height and never `flex: 1`: a flexible block
  // is what used to push the retailer cards off the bottom of the screen.
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingTop: 20,
    paddingBottom: 8,
  },
  centerSubtext: {
    color: '#a0a0b8',
    marginTop: 12,
    fontSize: 14,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
  },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 18,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Results (inside resultsScroll now).
  listHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e94560',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  itemInfo: {
    flex: 1,
    marginRight: 10,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  itemComposer: {
    fontSize: 14,
    color: '#a0a0b8',
    marginTop: 2,
  },
  itemDifficulty: {
    fontSize: 12,
    color: '#4ecdc4',
    fontWeight: '600',
    marginTop: 6,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  badgeReady: {
    color: '#4ecdc4',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  badgeSoon: {
    color: '#8a8aa3',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },

  // External (licensed-retailer) results — the money path, now INSIDE the one
  // results scroller (v41 item 3). No bounded frame and no maxHeight: the cards
  // flow directly under the internal results / the no-match sentence and scroll
  // with them, which is what makes them reachable on a no-match.
  externalBlock: {
    paddingTop: 12,
    paddingBottom: 20,
  },
});
