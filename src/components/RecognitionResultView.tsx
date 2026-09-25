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
  Linking,
} from 'react-native';
import type { RecognitionMatch, RecognitionResponse } from '../types';
import type { CaptureDiagnostics } from '../services/captureTelemetry';
import { PieceDetailScreen } from '../screens/PieceDetailScreen';
import { ScoreViewer } from './ScoreViewer';
// The money path resolves through ONE helper: the first APPROVED retailer in the
// backend's purchase-URL map (Sheet Music Direct, affiliate ID 67650, PRIMARY),
// falling back to Musicnotes only when the primary is absent. Naming a retailer
// key here is what the app used to do (`.musicnotes`) — the defect
// src/services/purchaseCta.ts guards with a source scan.
import { recognitionPurchaseUrl } from '../services/purchaseCta';
// The category a result card is allowed to claim. A match without a catalog
// number (every modern song) used to fall through to the literal "Classical" —
// and the catalog NUMBER was printed in the genre slot on a library piece.
// resultGenreLabel() owns that decision: modern → "Modern song", library →
// the catalog's genre, else the honest "Public domain".
import { resultGenreLabel } from '../services/resultGenre';
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
}) => {
  const [showDetail, setShowDetail] = React.useState(false);
  const [showScoreViewer, setShowScoreViewer] = React.useState(false);
  const [selectedMatch, setSelectedMatch] = React.useState<RecognitionMatch | null>(null);

  // Reset views when modal opens with new results
  React.useEffect(() => {
    if (visible) {
      setShowDetail(false);
      setShowScoreViewer(false);
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

  const handleOpenPurchaseUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      // Fallback — browser may not be available
    });
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
            <ActivityIndicator size="large" color="#e94560" />
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
  const topMatch = phase.response.matches[0];
  const sheetAvailable = !!topMatch.sheet_music_url;
  const isPublicDomain = !!topMatch.is_public_domain;
  // PD pieces never get a purchase redirect — the backend guarantees
  // purchase_url is null for them, and we double-guard here so a stale
  // response can never show a buy button on a public-domain piece.
  //
  // The link itself comes from the backend's purchase-URL map through
  // primaryPurchaseUrl() (Sheet Music Direct PRIMARY, Musicnotes backup only) —
  // never from a retailer key named in this component. The match's own map wins
  // over the response-level fallback, and the primary key wins over the backup in
  // both, so the commission can no longer land on the backup retailer by default.
  const purchaseUrl = recognitionPurchaseUrl(
    topMatch.purchase_url,
    phase.response.purchase_url,
  );
  const hasPurchaseUrl = !isPublicDomain && !!purchaseUrl;

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
        {showScoreViewer && selectedMatch?.sheet_music_url && (
          <ScoreViewer
            url={selectedMatch.sheet_music_url}
            title={selectedMatch.title}
            composer={selectedMatch.composer}
            onClose={() => setShowScoreViewer(false)}
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

            {/* Action buttons */}
            {sheetAvailable ? (
              <TouchableOpacity
                style={styles.viewSheetBtn}
                onPress={() => handleViewSheetMusic(topMatch)}
              >
                <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>
              </TouchableOpacity>
            ) : isPublicDomain ? (
              /* Honest "coming soon" state: public-domain piece, score not yet
                 curated. No broken button, no purchase redirect. */
              <View style={styles.comingSoonCard}>
                <Text style={styles.comingSoonTitle}>🎼 Sheet music coming soon</Text>
                <Text style={styles.comingSoonText}>
                  We're still curating a high-quality score for this
                  public-domain piece — check back soon.
                </Text>
              </View>
            ) : null}

            {/* Purchase button for copyrighted pieces */}
            {hasPurchaseUrl && (
              <TouchableOpacity
                style={styles.purchaseBtn}
                onPress={() => {
                  if (purchaseUrl) handleOpenPurchaseUrl(purchaseUrl);
                }}
              >
                <Text style={styles.purchaseBtnText}>
                  🛒 Get Official Sheet Music
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
  comingSoonCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#0f3460',
    borderStyle: 'dashed',
  },
  comingSoonTitle: {
    color: '#4ecdc4',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  comingSoonText: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 19,
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
