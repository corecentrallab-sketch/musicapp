/**
 * RecognitionResultView — modal overlay showing music recognition results.
 *
 * States handled:
 * - Loading (API call in progress)
 * - Match found (public domain + optional purchase link)
 * - No match
 * - Error
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
}

/** Convert a RecognitionMatch to a shape the PieceDetailScreen can render. */
function matchToDailyChallenge(match: RecognitionMatch) {
  return {
    id: match.piece_id,
    title: match.title,
    composer: match.composer,
    genre: match.catalog ?? 'Classical',
    difficulty: 'Intermediate' as const,
    description: `Recognized with ${Math.round(match.confidence * 100)}% confidence`,
    sheetMusicUrl: match.sheet_music_url ?? undefined,
  };
}

/**
 * Diagnostic readout for capture-path debugging. Renders whatever was measured
 * on-device (dur/rate/channels/dBFS/bytes/format) plus the server's echo of what
 * it received (bytes/duration/sample rate). Values that are null render as "—".
 * This is the telemetry the owner reads off the phone to localise the defect.
 */
function TelemetryReadout({
  diagnostics,
  server,
}: {
  diagnostics?: CaptureDiagnostics | null;
  server?: RecognitionResponse['received_audio'] | null;
}) {
  const hasClient = !!diagnostics;
  const hasServer = !!server;
  if (!hasClient && !hasServer) return null;

  const f = (v: number | null | undefined, unit = ''): string =>
    v === null || v === undefined ? '—' : `${Math.round(v * 100) / 100}${unit}`;
  // dB metering: -inf/near -160 means silence, ~0 means clipping-loud.
  const dbuf = (v: number | null | undefined): string =>
    v === null || v === undefined
      ? '—'
      : v < -100
        ? `${Math.round(v)}dB (≈silent)`
        : `${Math.round(v)}dB`;

  const rows: { label: string; val: string }[] = [];
  if (hasClient) {
    rows.push(
      { label: '⏱ Recorded', val: f(diagnostics!.durationMs, 'ms') },
      { label: 'Hz', val: f(diagnostics!.sampleRate, '') },
      { label: 'Ch', val: f(diagnostics!.channels, '') },
      { label: 'Peak', val: dbuf(diagnostics!.peakDbFS) },
      { label: 'RMS', val: dbuf(diagnostics!.rmsDbFS) },
      { label: 'Bytes', val: f(diagnostics!.bytes, '') },
      { label: 'Format', val: diagnostics!.format ?? '—' },
    );
  }
  if (hasServer) {
    rows.push(
      { label: 'Server bytes', val: f(server!.bytes, '') },
      { label: 'Server dur', val: f(Math.round(server!.duration_s * 1000), 'ms') },
      { label: 'Server Hz', val: f(server!.sample_rate, '') },
      { label: 'Server fmt', val: server!.format ?? '—' },
    );
  }

  return (
    <View style={styles.telemetryCard}>
      <Text style={styles.telemetryTitle}>🔧 Capture telemetry</Text>
      <View style={styles.telemetryGrid}>
        {rows.map((r) => (
          <View key={r.label} style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>{r.label}</Text>
            <Text style={styles.telemetryValue}>{r.val}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.telemetryHint}>
        Compare recorded vs server: if both ≈12s and loud, the capture is fine
        and the defect is elsewhere; if short/silent, capture is the problem.
      </Text>
    </View>
  );
}

export const RecognitionResultView: React.FC<RecognitionResultViewProps> = ({
  visible,
  phase,
  onClose,
  onRetry,
  onUpgrade,
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

  // If viewing the ScoreViewer for a match that has a sheet_music_url
  if (showScoreViewer && selectedMatch && phase.type === 'success' && selectedMatch.sheet_music_url) {
    return (
      <ScoreViewer
        url={selectedMatch.sheet_music_url}
        title={selectedMatch.title}
        composer={selectedMatch.composer}
        onClose={() => setShowScoreViewer(false)}
      />
    );
  }

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
            <TelemetryReadout diagnostics={phase.diagnostics} />
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
            <Text style={styles.cardTitle}>No Match Found</Text>
            <Text style={styles.noMatchText}>
              {phase.message ??
                "We couldn't identify this piece — try again closer to the speaker, or in a quieter environment."}
            </Text>
            <TelemetryReadout
              diagnostics={phase.diagnostics}
              server={phase.server}
            />
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

  // ── Success Phase ──
  const topMatch = phase.response.matches[0];
  const sheetAvailable = !!topMatch.sheet_music_url;
  const isPublicDomain = !!topMatch.is_public_domain;
  // PD pieces never get a purchase redirect — the backend guarantees
  // purchase_url is null for them, and we double-guard here so a stale
  // response can never show a buy button on a public-domain piece.
  const hasPurchaseUrl =
    !isPublicDomain &&
    (topMatch.purchase_url?.musicnotes ||
      phase.response.purchase_url?.musicnotes);

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
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

            {/* Catalog info */}
            {topMatch.catalog && (
              <Text style={styles.catalogText}>{topMatch.catalog}</Text>
            )}

            <TelemetryReadout
              diagnostics={phase.diagnostics}
              server={phase.response.received_audio}
            />

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
                onPress={() =>
                  handleOpenPurchaseUrl(
                    topMatch.purchase_url?.musicnotes ??
                      phase.response.purchase_url!.musicnotes,
                  )
                }
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

  // Capture telemetry readout
  telemetryCard: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  telemetryTitle: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  telemetryRow: {
    width: '50%',
    flexDirection: 'row',
    marginBottom: 4,
  },
  telemetryLabel: {
    color: '#a0a0b8',
    fontSize: 12,
    width: 78,
  },
  telemetryValue: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  telemetryHint: {
    color: '#707090',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
  },
});
