/**
 * PieceDetailScreen — shows piece info with share card functionality.
 * Navigated to from daily challenge, history, or recommendations.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native';
import type { DailyChallengePiece } from '../types';
import { ScoreViewer } from '../components/ScoreViewer';

interface PieceDetailScreenProps {
  piece: DailyChallengePiece;
  onBack: () => void;
}

export const PieceDetailScreen: React.FC<PieceDetailScreenProps> = ({
  piece,
  onBack,
}) => {
  const [sharing, setSharing] = useState(false);
  const [showScoreViewer, setShowScoreViewer] = useState(false);

  // If showing the ScoreViewer
  if (showScoreViewer && piece.sheetMusicUrl) {
    return (
      <ScoreViewer
        url={piece.sheetMusicUrl}
        title={piece.title}
        composer={piece.composer}
        onClose={() => setShowScoreViewer(false)}
      />
    );
  }

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const shareMessage = `I just played "${piece.title}" by ${piece.composer} on NoteSnap! 🎹\n\nDiscover sheet music for any song: [notesnap.app]`;

      if (Platform.OS === 'web') {
        // Web fallback — copy to clipboard concept
        Alert.alert('Share', shareMessage);
      } else {
        await Share.share({
          message: shareMessage,
          title: `🎵 ${piece.title} — NoteSnap`,
        });
      }
    } catch (err) {
      // User cancelled — no action needed
    } finally {
      setSharing(false);
    }
  }, [piece]);

  const handleViewSheetMusic = () => {
    if (piece.sheetMusicUrl) {
      setShowScoreViewer(true);
    }
    // If no URL, the button will be disabled (see below)
  };

  const difficultyEmoji =
    piece.difficulty === 'Beginner'
      ? '🌱'
      : piece.difficulty === 'Intermediate'
      ? '🌿'
      : '🌳';

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {/* Hero card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroEmoji}>🎼</Text>
        <Text style={styles.heroTitle}>{piece.title}</Text>
        <Text style={styles.heroComposer}>{piece.composer}</Text>

        <View style={styles.tags}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{piece.genre}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>
              {difficultyEmoji} {piece.difficulty}
            </Text>
          </View>
        </View>

        <Text style={styles.description}>{piece.description}</Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.viewSheetBtn,
            !piece.sheetMusicUrl && styles.viewSheetBtnDisabled,
          ]}
          onPress={handleViewSheetMusic}
          disabled={!piece.sheetMusicUrl}
        >
          <Text
            style={[
              styles.viewSheetText,
              !piece.sheetMusicUrl && styles.viewSheetTextDisabled,
            ]}
          >
            🎵 View Sheet Music
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.shareBtn, sharing && styles.shareBtnDisabled]}
          onPress={handleShare}
          disabled={sharing}
        >
          <Text style={styles.shareText}>
            {sharing ? '⏳ Sharing...' : '📤 Share'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Share card preview */}
      <View style={styles.shareCard}>
        <Text style={styles.shareCardLabel}>Share Preview</Text>
        <View style={styles.shareCardInner}>
          <Text style={styles.shareCardPiece}>{piece.title}</Text>
          <Text style={styles.shareCardComposer}>{piece.composer}</Text>
          <View style={styles.shareCardDivider} />
          <Text style={styles.shareCardTagline}>
            I just played this on NoteSnap 🎹
          </Text>
          <Text style={styles.shareCardApp}>notesnap.app</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  backBtn: {
    marginBottom: 16,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  heroCard: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  heroEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  heroComposer: {
    fontSize: 16,
    color: '#a0a0b8',
    marginBottom: 14,
  },
  tags: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tag: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagText: {
    color: '#c0c0d0',
    fontSize: 13,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  viewSheetBtn: {
    flex: 1,
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  viewSheetBtnDisabled: {
    backgroundColor: '#3a3a5c',
    opacity: 0.6,
  },
  viewSheetText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  viewSheetTextDisabled: {
    color: '#8888aa',
  },
  shareBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f3460',
  },
  shareBtnDisabled: {
    opacity: 0.6,
  },
  shareText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  shareCard: {
    marginTop: 28,
  },
  shareCardLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a0a0b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  shareCardInner: {
    backgroundColor: '#0f3460',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e94560',
  },
  shareCardPiece: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  shareCardComposer: {
    fontSize: 14,
    color: '#c0c0d0',
    marginBottom: 12,
  },
  shareCardDivider: {
    height: 1,
    width: '60%',
    backgroundColor: '#e94560',
    marginBottom: 12,
  },
  shareCardTagline: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 4,
  },
  shareCardApp: {
    fontSize: 13,
    color: '#e94560',
    fontWeight: '700',
  },
});
