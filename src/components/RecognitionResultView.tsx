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
import { PieceDetailScreen } from '../screens/PieceDetailScreen';
import { ScoreViewer } from './ScoreViewer';

export type RecognitionPhase =
  | { type: 'loading' }
  | { type: 'success'; response: RecognitionResponse }
  | { type: 'no-match' }
  | { type: 'error'; message: string };

interface RecognitionResultViewProps {
  visible: boolean;
  phase: RecognitionPhase | null;
  onClose: () => void;
  onRetry: () => void;
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

export const RecognitionResultView: React.FC<RecognitionResultViewProps> = ({
  visible,
  phase,
  onClose,
  onRetry,
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
      <Modal visible={true} animationType="slide">
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
      <Modal visible={true} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#e94560" />
            <Text style={styles.loadingText}>Identifying music...</Text>
            <Text style={styles.loadingSubtext}>
              Analyzing audio fingerprint
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Error Phase ──
  if (phase.type === 'error') {
    return (
      <Modal visible={true} transparent animationType="fade">
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
    return (
      <Modal visible={true} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.noMatchEmoji}>🔍</Text>
            <Text style={styles.cardTitle}>No Match Found</Text>
            <Text style={styles.noMatchText}>
              We couldn't identify this piece — try again closer to the speaker,
              or in a quieter environment.
            </Text>
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
    <Modal visible={true} transparent animationType="fade">
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

  // Error / No-match
  errorEmoji: { fontSize: 48, marginBottom: 12 },
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
});
