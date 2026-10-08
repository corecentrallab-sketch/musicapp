/**
 * RecognitionResultView — modal overlay showing music recognition results.
 *
 * States handled:
 * - Loading (API call in progress)
 * - Match found (public domain + optional purchase link)
 * - No match
 * - Error
 *
 * v22: the 🔧 "Capture telemetry" readout (recorded dBFS / bytes / sample rate,
 * plus the server's echo) that used to sit in the error, no-match and success
 * modals was capture-path DEBUG tooling — an engineer's numeric readout, not
 * something a musician should ever see — so it is deleted rather than hidden.
 * The capture path still measures the same numbers for the on-device log.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
// THE INLINE HOSTED SCORE (bundle A, owner 10-02). The result card renders the
// piece's own score in the card instead of hiding it behind a tap: the WebView is
// fed the SAME document the full-screen reader uses (`buildSheetViewerHtml`), and
// because this file's returned tree is already rooted in `<Modal … onRequestClose>`
// the in-app-browser contract holds by construction — the score is embedded in the
// card, never a navigable browser surface of its own.
//   • it must NOT be extracted into its own component file: a plain `<View>` root
//     would become a NEW `not-in-modal` violation (spec §A.3);
//   • it carries `javaScriptEnabled` + `domStorageEnabled` (pdf.js + the
//     document's own storage) — the RC v26 retailer-JS lesson applies to every
//     WebView we render, and src/services/resultSurfaceContract.ts pins it here.
import { WebView } from 'react-native-webview';
import { buildSheetViewerHtml } from '../services/sheetViewerHtml';
import type { RecognitionMatch, RecognitionResponse } from '../types';
import type { CaptureDiagnostics } from '../services/captureTelemetry';
import { PieceDetailScreen } from '../screens/PieceDetailScreen';
import { ScoreViewer } from './ScoreViewer';
// The ONE in-app retailer shell (bundle C, owner 10-02): the purchase CTA opens
// the licensed retailer INSIDE NoteSnap, as a full-screen Modal this file mounts,
// so BACK and the shell's own "← Back to NoteSnap" header land the user back on
// THIS result card with its state intact. The card used to call
// `Linking.openURL`, which handed the user to the system browser and left the app
// entirely — the only purchase route in the app that did (audit D5).
import { PurchaseWebView } from './PurchaseWebView';
// The money path resolves through ONE helper: the first APPROVED retailer in the
// backend's purchase-URL map (Sheet Music Direct, affiliate ID 67650, PRIMARY),
// falling back to Musicnotes only when the primary is absent. Naming a retailer
// key here is what the app used to do (`.musicnotes`) — the defect
// src/services/purchaseCta.ts guards with a source scan. The SECONDARY offer is
// resolved by that module too (`resultSecondaryOfferUrl`), which dedupes against
// the page the primary CTA already opens, so this card can never render two taps
// to one page.
import { recognitionPurchaseUrl, resultSecondaryOfferUrl } from '../services/purchaseCta';
// The category a result card is allowed to claim. A match without a catalog
// number (every modern song) used to fall through to the literal "Classical" —
// and the catalog NUMBER was printed in the genre slot on a library piece.
// resultGenreLabel() owns that decision: modern → "Modern song", library →
// the catalog's genre, else the honest "Public domain".
import { resultGenreLabel } from '../services/resultGenre';
// THE ONE RESULT SURFACE's own decisions (bundle A, owner 10-02): which kind of
// result this is (library / hum / modern), what the sheet slot does (inline score,
// the full-screen reader, the purchase action, or nothing but honest words),
// where the score came from, and every string the card shows. The card and the
// tier1 gate read the SAME module, so the copy cannot drift.
import {
  BROWSE_LIBRARY_LEVER_HINT,
  BROWSE_LIBRARY_LEVER_LABEL,
  HUM_IT_LEVER_HINT,
  HUM_IT_LEVER_LABEL,
  INLINE_SHEET_HEIGHT,
  MODERN_COPYRIGHT_NOTE,
  MODERN_NO_LINK_LINE,
  NO_HOSTED_SCORE_LINE,
  SHEET_BLOCK_ERROR_LINE,
  SHEET_BLOCK_LABEL,
  SHEET_FULL_SCREEN_CHIP,
  TRY_MUSICNOTES_LABEL,
  fullScreenChipAccessibilityLabel,
  hostedSheetUrl,
  isLibraryKind,
  resultKicker,
  resultKindFor,
  resultSecondaryOfferLabel,
  resultSheetAccessibilityLabel,
  sheetSurfaceDecision,
  showsFullScreenChip,
  type ResultMidiExport,
} from '../services/resultSurface';
// "Export MIDI" (MIDI export Batch A) stays where the take is — the CALLER owns
// the recorded take and its export; this surface only renders the affordance from
// the caller's contract (`midiExport`), so a hum match can still write the user's
// own melody out as a .mid from the SAME take (v30 feature, bundle A).
import {
  MIDI_EXPORT_BUSY_LABEL,
  MIDI_EXPORT_HINT,
  MIDI_EXPORT_LABEL,
} from '../services/midiExport';
// The no-match card's two ways forward (owner-approved 09-24 front door + the
// 09-22 hum → modern bridge). The strings come from the modules that own them so
// the card, the screen and the tier1 gate read the SAME words.
import { HUM_FALLBACK_BUTTON, HUM_SECONDARY_CTA } from '../services/frontDoor';
import { HUM_TO_MODERN_BLURB, HUM_TO_MODERN_CTA } from '../services/humBridge';
// V26 honest capture feedback (owner 09-25): WHY this pass found nothing. A tiny
// capture says so and is retry-first; a real listen that is simply not in our
// library offers the hum/whistle way in. The small capture line (duration +
// level) makes a screenshot measurable without a debug build. The copy lives in
// the module the tier1 gate reads.
import { captureDiagnosticLine, noMatchCardCopy } from '../services/captureFeedback';

export type RecognitionPhase =
  | { type: 'loading' }
  | {
      type: 'success';
      response: RecognitionResponse;
      diagnostics?: CaptureDiagnostics;
    }
  | { type: 'no-match'; message?: string; diagnostics?: CaptureDiagnostics; server?: RecognitionResponse['received_audio'] }
  | { type: 'limit'; message: string; diagnostics?: CaptureDiagnostics }
  | { type: 'error'; message: string; diagnostics?: CaptureDiagnostics };

interface RecognitionResultViewProps {
  visible: boolean;
  phase: RecognitionPhase | null;
  onClose: () => void;
  onRetry: () => void;
  /** Opens the Pro upgrade path (Settings tab) from the quota-exhausted modal. */
  onUpgrade?: () => void;
  /**
   * The inline hum/whistle/sing fallback (the one-button front door, owner
   * 09-24): offered on the no-match card so an ambient miss hands the user
   * straight to humming — the SAME way in, not a rival button. Omitted when the
   * miss came from the hum pass itself.
   */
  onHumFallback?: () => void;
  /**
   * The hum → modern bridge (owner 09-22): a hum we don't hold is not a dead end
   * — identify the recording and link the official sheet music. Offered on the
   * no-match card of the hum pass.
   */
  onFindAnySong?: () => void;
  /**
   * The hum take's "Export MIDI" (bundle A, owner 10-02). The CALLER owns the
   * take — the hum screen recorded it and holds its URI, the export state and the
   * outcome sentence — so this surface only RENDERS the affordance from the
   * caller's contract. Omitted (or with no take) on every other result, and the
   * block is then not rendered at all: an "Export MIDI" button that can only fail
   * is the dead control this card exists to remove.
   */
  midiExport?: ResultMidiExport;
  /**
   * The retention levers of a MODERN result (owner 09-28: incentives →
   * familiarity → trust → sales; §E.2 "a retention lever, always"). A modern card
   * must not be a dead end when the retailer link is missing or the user declines
   * it: "hum it" hands the melody back to the hum pass, and "browse the free
   * library" opens the public-domain catalog this app actually serves. Each lever
   * renders only when its handler is supplied, so a lever is never decorative.
   */
  onHumIt?: () => void;
  onBrowseLibrary?: () => void;
}

/** Convert a RecognitionMatch to a shape the PieceDetailScreen can render. */
function matchToDailyChallenge(match: RecognitionMatch) {
  return {
    id: match.piece_id,
    title: match.title,
    composer: match.composer,
    genre: resultGenreLabel(match),
    difficulty: 'Intermediate' as const,
    description: `Recognized with ${Math.round(match.confidence * 100)}% confidence`,
    sheetMusicUrl: match.sheet_music_url ?? undefined,
  };
}

export const RecognitionResultView: React.FC<RecognitionResultViewProps> = ({
  visible,
  phase,
  onClose,
  onRetry,
  onUpgrade,
  onHumFallback,
  onFindAnySong,
  midiExport,
  onHumIt,
  onBrowseLibrary,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [showDetail, setShowDetail] = React.useState(false);
  const [showScoreViewer, setShowScoreViewer] = React.useState(false);
  const [selectedMatch, setSelectedMatch] = React.useState<RecognitionMatch | null>(null);
  // The inline score's OWN failure flag (bundle A). The viewer document renders
  // its own error overlay for a bad PDF; this is the card's line for the WebView
  // itself failing (no network, a bad byte-range), so a broken score is never a
  // silently blank box and the "⛶ Full screen" chip stays live beside it.
  const [inlineSheetFailed, setInlineSheetFailed] = React.useState(false);
  // The ONE retailer shell on this card. Null = closed; the purchase CTA sets it,
  // and the shell's own onClose (header + hardware BACK) clears it, so the card
  // underneath is revealed again with nothing re-mounted and no navigation.
  const [purchaseWebUrl, setPurchaseWebUrl] = React.useState<string | null>(null);

  // Reset views when modal opens with new results
  React.useEffect(() => {
    if (visible) {
      setShowDetail(false);
      setShowScoreViewer(false);
      setInlineSheetFailed(false);
      setPurchaseWebUrl(null);
    }
  }, [visible]);

  if (!visible || !phase) return null;

  // NOTE (owner-reported blank page, v22 → v24): the sheet-music viewer used to be
  // returned from HERE instead of this component's own card, i.e. the card was
  // replaced by the viewer and the sheet dialog swapped with the card dialog in the
  // same frame. The viewer is now an overlay INSIDE the card's own Modal (see the
  // sheet-music block in the success phase below), so the card stays mounted and
  // closing the sheet simply reveals it again. Guarded by
  // src/services/backExitContract.ts (the blank-return contract).

  // If viewing detail for a match (no sheet_music_url), show PieceDetailScreen
  if (showDetail && selectedMatch && phase.type === 'success') {
    const piece = matchToDailyChallenge(selectedMatch);
    return (
      <Modal
        visible={true}
        animationType="slide"
        onRequestClose={() => setShowDetail(false)}
      >
        <PieceDetailScreen piece={piece} onBack={() => setShowDetail(false)} />
      </Modal>
    );
  }

  const handleViewSheetMusic = (match: RecognitionMatch) => {
    setSelectedMatch(match);
    if (match.sheet_music_url) {
      setShowScoreViewer(true);
    } else {
      setShowDetail(true);
    }
  };

  // ── Loading Phase ──
  if (phase.type === 'loading') {
    return (
      <Modal
        visible={true}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.loadingText}>Identifying music...</Text>
            <Text style={styles.loadingSubtext}>
              Analyzing audio fingerprint
            </Text>
            {/* Cancel affordance so a stalled/hanging request can never trap
                the user on a full-screen spinner. Hardware back also closes
                via onRequestClose above. */}
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Limit (free-tier monthly quota exhausted) Phase ──
  // Honest, explicit "limit reached" state — NEVER rendered as "No Match Found".
  // No "Try Again" button: another attempt would only hit the same 429.
  if (phase.type === 'limit') {
    return (
      <Modal
        visible={true}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.limitEmoji}>🔒</Text>
            <Text style={styles.cardTitle}>Recognition limit reached</Text>
            <Text style={styles.limitText}>
              {phase.message}
              {'\n\n'}Upgrade to Pro for unlimited recognition, or try again
              next month when your free limit resets.
            </Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Not Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onUpgrade ?? onClose}
              >
                <Text style={styles.primaryBtnText}>View Pro Options</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Error Phase ──
  if (phase.type === 'error') {
    return (
      <Modal
        visible={true}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.errorEmoji}>⚠️</Text>
            <Text style={styles.cardTitle}>Something went wrong</Text>
            <Text style={styles.errorText}>{phase.message}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ── No-Match Phase ──
  if (phase.type === 'no-match') {
    // The REAL reason, from the capture numbers the recorder measured (V26,
    // owner 09-25). Two honest states: the microphone barely recorded anything
    // (<4KB / <0.5s) → say so, because retrying is the fix; otherwise we heard
    // the clip and do not hold the piece → offer the hum/whistle way in. The
    // card keeps BOTH ways forward below, so a miss is never a dead end.
    const copy = noMatchCardCopy(phase.diagnostics, phase.message);
    const captureLine = captureDiagnosticLine(phase.diagnostics);
    return (
      <Modal
        visible={true}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.noMatchEmoji}>🔍</Text>
            <Text style={styles.cardTitle}>{copy.title}</Text>
            <Text style={styles.noMatchText}>{copy.body}</Text>
            {captureLine ? <Text style={styles.captureLine}>{captureLine}</Text> : null}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>

            {/* THE next step, from the pass that missed — never a dead end.
                Ambient miss → the inline hum fallback (the one-button front
                door: humming is the SAME way in, one tap away).
                Hum miss → the hum → modern bridge, which identifies the actual
                recording and links the official sheet music. */}
            {onHumFallback ? (
              <Text style={styles.humSecondaryLabel}>{HUM_SECONDARY_CTA}</Text>
            ) : null}
            {onHumFallback ? (
              <TouchableOpacity
                style={styles.nextStepBtn}
                onPress={onHumFallback}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={HUM_FALLBACK_BUTTON}
              >
                <Text style={styles.nextStepBtnText}>{HUM_FALLBACK_BUTTON}</Text>
              </TouchableOpacity>
            ) : null}
            {onFindAnySong ? (
              <TouchableOpacity
                style={styles.bridgeBtn}
                onPress={onFindAnySong}
                activeOpacity={0.7}
              >
                <Text style={styles.bridgeBtnText}>{HUM_TO_MODERN_CTA}</Text>
                <Text style={styles.bridgeBtnHint}>{HUM_TO_MODERN_BLURB}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  }

  // ── Success Phase ──
  //
  // THE ONE RESULT SURFACE (bundle A, owner 10-02): the ambient library pass, the
  // hum/whistle/sing fallback and the modern flow all land HERE. src/services/
  // resultSurface.ts owns the decisions (which kind this is, what the sheet slot
  // does, where the score came from, every word below); this card renders them.
  const topMatch = phase.response.matches[0];
  const isPublicDomain = !!topMatch.is_public_domain;
  const kind = resultKindFor(phase.response);
  // The money path resolves through ONE helper: the first APPROVED retailer in the
  // backend's purchase-URL map (Sheet Music Direct, affiliate ID 67650, PRIMARY),
  // falling back to the backup only when the primary is absent. The match's own map
  // wins over the response-level fallback, so the commission can no longer land on
  // the backup retailer by default.
  const purchaseUrl = recognitionPurchaseUrl(
    topMatch.purchase_url,
    phase.response.purchase_url,
  );
  // PD pieces never get a purchase redirect — the backend guarantees purchase_url
  // is null for them, and we double-guard here so a stale response can never show a
  // buy button on a public-domain piece.
  const hasPurchaseUrl = !isPublicDomain && !!purchaseUrl;
  // THE SHEET SLOT. The hosted URL is the BACKEND'S/CATALOG'S (`sheet_music_url`)
  // and is never built here: `sheetUrlForPieceId()` is the key builder for gated
  // ingest, not a promise that a score exists, and resultSurfaceContract.ts fails
  // the gate if a result surface calls it. `sheet_music_available: false` beats a
  // URL that is present — the backend's quality gate is the truth, so the card
  // shows its honest line instead of opening a score the backend declined to serve.
  const sheetInput = {
    kind,
    hostedSheetUrl: topMatch.sheet_music_url,
    sheetMusicAvailable: topMatch.sheet_music_available,
    purchaseUrl,
  };
  const sheetDecision = sheetSurfaceDecision(sheetInput);
  const inlineSheetUrl = hostedSheetUrl(sheetInput);
  // The deduped SECONDARY offer, resolved by the money module: for a library/PD
  // (or hum) result the affiliate SEARCH for a printed arrangement (owner Q2/Q7 —
  // never a purchase claim while we host the score ourselves); for a modern match
  // the backend's backup retailer, and ONLY when it is a different page from the
  // one the primary CTA opens. Undefined = no second action at all.
  const secondaryOffer = resultSecondaryOfferUrl(
    topMatch.purchase_url,
    phase.response.purchase_url,
  );
  // The reader's URL: the tapped match's own score, else the hosted score this
  // card is already showing inline.
  const viewerSheetUrl = selectedMatch?.sheet_music_url ?? inlineSheetUrl;

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* The tapped match's sheet music, opened on top of this card — an
            OVERLAY, never a replacement for the card's own content: the card
            stays mounted underneath, so closing the sheet reveals it and no
            dialog is swapped while another one is being dismissed (the frame
            where a host could come back blank). Owner-reported blank page,
            v22 → v24; guarded by src/services/backExitContract.ts. */}
        {showScoreViewer && viewerSheetUrl && (
          <ScoreViewer
            url={viewerSheetUrl}
            title={selectedMatch?.title ?? topMatch.title}
            composer={selectedMatch?.composer ?? topMatch.composer}
            onClose={() => setShowScoreViewer(false)}
          />
        )}
        {/* The retailer page, opened on top of this card — the SAME overlay
            pattern as the score viewer above, and the same shell the piece page
            and History mount (bundle C, owner 10-02). BACK and the shell's own
            "← Back to NoteSnap" header both close it (onClose clears the URL), so
            the user lands back on this card and never leaves the app. */}
        {purchaseWebUrl && (
          <PurchaseWebView
            url={purchaseWebUrl}
            title={`${topMatch.title} — official sheet music`}
            onClose={() => setPurchaseWebUrl(null)}
          />
        )}
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.card}>
            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>

            {/* THE PROVENANCE KICKER — how we know this piece (owner sign-off
                item (b)). A hum match says so ("You hummed it — here it is")
                instead of pretending we heard the music; an ambient or modern
                match says "🎼 Recognized". The marker rides the response, set by
                the hum mapping (frontDoor.humMatchToResultResponse), never
                guessed from the match shape. */}
            <Text style={styles.kickerText}>{resultKicker(kind)}</Text>

            {/* Album art */}
            {topMatch?.album_art_url ? (
              <Image
                source={{ uri: topMatch.album_art_url }}
                style={styles.albumArt}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.albumArtPlaceholder}>🎼</Text>
            )}

            <Text style={styles.pieceTitle}>{topMatch.title}</Text>
            <Text style={styles.pieceComposer}>{topMatch.composer}</Text>

            {/* Confidence badge */}
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceText}>
                {Math.round(topMatch.confidence * 100)}% match
              </Text>
            </View>

            {/* Category + catalog info. The category is resolved by the genre
                module (a modern song reads "Modern song", a library piece the
                catalog's genre or the honest "Public domain"); the catalog
                number is shown as what it is — a number, never the genre. */}
            <Text style={styles.catalogText}>{resultGenreLabel(topMatch)}</Text>
            {topMatch.catalog && (
              <Text style={styles.catalogText}>{topMatch.catalog}</Text>
            )}

            {/* More matches */}
            {phase.response.matches.length > 1 && (
              <View style={styles.otherMatches}>
                <Text style={styles.otherMatchesTitle}>Other matches:</Text>
                {phase.response.matches.slice(1, 4).map((m, i) => (
                  <View key={m.piece_id ?? i} style={styles.otherMatchRow}>
                    <Text style={styles.otherMatchPiece}>{m.title}</Text>
                    <Text style={styles.otherMatchComposer}>
                      {m.composer} ({Math.round(m.confidence * 100)}%)
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── A MODERN (copyrighted) MATCH ──
                Identity, the copyright position, ONE licensed-retailer action and
                the retention levers — and NO notation of any kind: no score, no
                ABC, no chords. We host no copyrighted music, so the only thing
                this card can honestly offer is the way to the official sheet
                music (affiliate) plus something to do next.
                resultSurfaceContract.ts freezes this boundary as a predicate. */}
            {kind === 'modern' ? (
              <View style={styles.modernBlock}>
                <Text style={styles.copyrightNote}>{MODERN_COPYRIGHT_NOTE}</Text>

                {/* THE single purchase action, opened in the in-app shell above
                    (owner 10-02, audit D5) — never the system browser. */}
                {hasPurchaseUrl ? (
                  <TouchableOpacity
                    style={styles.purchaseBtn}
                    onPress={() => {
                      if (purchaseUrl) setPurchaseWebUrl(purchaseUrl);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Get the official sheet music"
                    accessibilityHint="Opens the licensed retailer page inside NoteSnap"
                  >
                    <Text style={styles.purchaseBtnText}>
                      🛒 Get the Official Sheet Music
                    </Text>
                  </TouchableOpacity>
                ) : (
                  /* No licensed link for this match: an HONEST line, never a
                     static "isn't linked yet" box — and the levers below are the
                     real next step (§E.2, the zero-promise rule). */
                  <Text style={styles.honestGapText}>{MODERN_NO_LINK_LINE}</Text>
                )}

                {/* The retention levers (owner 09-28). Each renders only with its
                    handler, so neither can become a decorative button. */}
                {onHumIt || onBrowseLibrary ? (
                  <View style={styles.leversBlock}>
                    <Text style={styles.leversTitle}>Keep playing</Text>
                    {onHumIt ? (
                      <TouchableOpacity
                        style={styles.leverBtn}
                        onPress={onHumIt}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                      >
                        <Text style={styles.leverBtnText}>{HUM_IT_LEVER_LABEL}</Text>
                        <Text style={styles.leverBtnHint}>{HUM_IT_LEVER_HINT}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {onBrowseLibrary ? (
                      <TouchableOpacity
                        style={styles.leverBtn}
                        onPress={onBrowseLibrary}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                      >
                        <Text style={styles.leverBtnText}>
                          {BROWSE_LIBRARY_LEVER_LABEL}
                        </Text>
                        <Text style={styles.leverBtnHint}>
                          {BROWSE_LIBRARY_LEVER_HINT}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ── THE INLINE SCORE (owner sign-off item (a)) ──
                A library/PD or hum match renders the piece's own score IN the
                card: the SAME viewer document the full-screen reader uses, at a
                bounded height, inside this file's Modal-rooted tree (the
                in-app-browser contract holds by construction — the score is
                embedded in the card, never a browser surface of its own; the tag
                carries javaScriptEnabled + domStorageEnabled for pdf.js).
                The "⛶ Full screen" chip opens the existing reader as an overlay,
                so the card is never replaced and always stays scrollable. */}
            {sheetDecision === 'inline' && inlineSheetUrl ? (
              <View style={styles.sheetBlock}>
                <Text style={styles.sheetBlockLabel}>{SHEET_BLOCK_LABEL}</Text>
                <WebView
                  key={inlineSheetUrl}
                  source={{ html: buildSheetViewerHtml(inlineSheetUrl) }}
                  style={styles.inlineSheet}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  domStorageEnabled
                  allowFileAccess
                  mixedContentMode="always"
                  androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
                  onError={() => setInlineSheetFailed(true)}
                  accessibilityLabel={resultSheetAccessibilityLabel(topMatch.title)}
                />
                {inlineSheetFailed ? (
                  <Text style={styles.sheetErrorText}>{SHEET_BLOCK_ERROR_LINE}</Text>
                ) : null}
                <TouchableOpacity
                  style={styles.fullScreenChip}
                  onPress={() => handleViewSheetMusic(topMatch)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={fullScreenChipAccessibilityLabel(topMatch.title)}
                >
                  <Text style={styles.fullScreenChipText}>{SHEET_FULL_SCREEN_CHIP}</Text>
                </TouchableOpacity>
              </View>
            ) : sheetDecision === 'open-full' && inlineSheetUrl ? (
              /* A surface that must NOT embed the document keeps the score one tap
                 away (the decision's 'open-full' value) instead of dropping it. */
              <TouchableOpacity
                style={styles.viewSheetBtn}
                onPress={() => handleViewSheetMusic(topMatch)}
              >
                <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>
              </TouchableOpacity>
            ) : isLibraryKind(kind) && sheetDecision === 'none' ? (
              /* A library/PD or hum match we hold NO hosted score for. The dashed
                 "🎼 Sheet music coming soon" box is GONE (audit D13): a promise we
                 cannot keep is a dead end, so the card states exactly what it has
                 — and the printed-arrangement search below is the real next step
                 when the backend gave us one. */
              <Text style={styles.honestGapText}>{NO_HOSTED_SCORE_LINE}</Text>
            ) : null}

            {/* ── THE SECONDARY OFFER ──
                At most ONE, and only when the money module resolved a target that
                is not the page the primary action opens: the affiliate SEARCH for
                a printed arrangement on a library/PD (or hum) result — free score
                first, never a purchase claim — or the deduped backup retailer on a
                modern match. Opened in the in-app shell above, like the primary. */}
            {secondaryOffer ? (
              <TouchableOpacity
                style={styles.secondaryOfferBtn}
                onPress={() => setPurchaseWebUrl(secondaryOffer)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityHint="Opens the retailer inside NoteSnap"
              >
                <Text style={styles.secondaryOfferText}>
                  {resultSecondaryOfferLabel(kind)}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* ── EXPORT MIDI (the hum take) ──
                Rendered from the CALLER's contract: the hum screen owns the take
                it just recorded, the export run and the outcome sentence. With no
                take there is no button (never a control that can only fail), and a
                failed export is ALWAYS shown — a silent one reads as a dead button
                (the v30 feature, guarded by midiExportContract.ts). */}
            {midiExport && midiExport.takeUri ? (
              <View style={styles.midiBlock}>
                <TouchableOpacity
                  style={styles.midiBtn}
                  onPress={midiExport.onExport}
                  disabled={midiExport.exporting}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={MIDI_EXPORT_LABEL}
                  accessibilityHint={MIDI_EXPORT_HINT}
                >
                  <Text style={styles.midiBtnText}>
                    {midiExport.exporting ? MIDI_EXPORT_BUSY_LABEL : MIDI_EXPORT_LABEL}
                  </Text>
                </TouchableOpacity>
                {midiExport.keyLine && (
                  <Text style={styles.midiKeyText}>{midiExport.keyLine}</Text>
                )}
                {midiExport.note && (
                  <Text style={styles.midiNoteText}>{midiExport.note}</Text>
                )}
              </View>
            ) : null}

            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContainer: {
    maxHeight: '85%',
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  closeBtnText: {
    color: '#a0a0b8',
    fontSize: 20,
    fontWeight: '700',
  },

  // Loading
  loadingText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 16,
  },
  loadingSubtext: {
    fontSize: 13,
    color: '#a0a0b8',
    marginTop: 6,
  },
  cancelBtn: {
    marginTop: 20,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  cancelBtnText: {
    color: '#a0a0b8',
    fontSize: 15,
    fontWeight: '600',
  },

  // Error / No-match
  errorEmoji: { fontSize: 48, marginBottom: 12 },
  limitEmoji: { fontSize: 48, marginBottom: 12 },
  noMatchEmoji: { fontSize: 48, marginBottom: 12 },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  limitText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  noMatchText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  // The capture diagnostics line (V26): small, muted, no verdict words — it
  // exists so a screenshot is measurable ("Captured 12.4s · level -18 dBFS")
  // without shipping a debug readout to a musician.
  captureLine: {
    fontSize: 12,
    color: '#6f6f88',
    textAlign: 'center',
    marginTop: -12,
    marginBottom: 16,
  },
  // The secondary-way-in label above the hum button (owner 09-25): the big red
  // button is identify-first, so the card names humming as the alternative.
  humSecondaryLabel: {
    fontSize: 13,
    color: '#a0a0b8',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    flex: 1,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  secondaryBtnText: {
    color: '#a0a0b8',
    fontSize: 15,
    fontWeight: '600',
  },

  // No-match card: the next-step actions (the inline hum fallback, and the
  // hum → modern bridge). Full width under the Cancel/Try Again row, quieter
  // than the primary, and only rendered when the caller supplies the handler.
  nextStepBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    width: '100%',
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  nextStepBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  bridgeBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    width: '100%',
    marginTop: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  bridgeBtnText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  bridgeBtnHint: {
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 6,
  },

  // Success
  albumArt: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginBottom: 16,
    marginTop: 8,
  },
  albumArtPlaceholder: {
    fontSize: 80,
    marginBottom: 16,
  },
  pieceTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  pieceComposer: {
    fontSize: 16,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 12,
  },
  confidenceBadge: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  confidenceText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
  },
  catalogText: {
    fontSize: 13,
    color: '#a0a0b8',
    marginBottom: 12,
  },

  // Other matches
  otherMatches: {
    width: '100%',
    marginTop: 8,
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  otherMatchesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#a0a0b8',
    marginBottom: 8,
  },
  otherMatchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  otherMatchPiece: {
    fontSize: 13,
    color: '#ffffff',
    flex: 1,
  },
  otherMatchComposer: {
    fontSize: 12,
    color: '#a0a0b8',
  },

  // Action buttons
  viewSheetBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  viewSheetText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // THE INLINE SCORE (bundle A). A bounded block inside the card: the sheet with
  // a label above it, the "⛶ Full screen" chip below it, and the card's own error
  // line when the WebView itself fails. `inlineSheet` is the height the card gives
  // the document — the reader (one chip away) is where a user goes to study the
  // score; here it only has to be legible and must never push the money path off
  // a small phone's screen (the card stays scrollable).
  sheetBlock: {
    width: '100%',
    marginTop: 4,
  },
  sheetBlockLabel: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  inlineSheet: {
    width: '100%',
    height: INLINE_SHEET_HEIGHT,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
  },
  sheetErrorText: {
    color: '#e94560',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    textAlign: 'center',
  },
  fullScreenChip: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  fullScreenChipText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
  },

  // The provenance kicker (bundle A): how this piece was found. Quiet, above the
  // art, so a hum match reads as an honest result rather than a claim we heard it.
  kickerText: {
    color: '#4ecdc4',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 12,
  },

  // A MODERN (copyrighted) match: the copyright position, the one licensed
  // retailer action, the deduped backup, and the retention levers. No notation.
  modernBlock: {
    width: '100%',
    marginTop: 4,
  },
  copyrightNote: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 10,
  },
  // The honest gap line (a library piece we hold no score for, or a modern match
  // with no licensed link). A statement of what we have — never a promise.
  honestGapText: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  leversBlock: {
    width: '100%',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  leversTitle: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  leverBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  leverBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  leverBtnHint: {
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 4,
  },

  // The SINGLE secondary offer (the printed-arrangement search on a library
  // result, the deduped backup retailer on a modern one). Quieter than the
  // purchase button on purpose: the free score is the offer.
  secondaryOfferBtn: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    width: '100%',
    marginTop: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  secondaryOfferText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },

  // "Export MIDI" from the caller's hum take (v30 feature, kept by bundle A).
  midiBlock: {
    width: '100%',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    alignItems: 'center',
  },
  midiBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  midiBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
  },
  midiKeyText: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  midiNoteText: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    textAlign: 'center',
  },
  purchaseBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 14,
    padding: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  purchaseBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  doneBtn: {
    marginTop: 16,
    padding: 8,
  },
  doneBtnText: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
