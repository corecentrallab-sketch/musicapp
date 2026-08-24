/**
 * PieceDetailScreen — shows piece info with share card functionality.
 * Navigated to from daily challenge, history, or recommendations.
 *
 * After practicing a piece for >2 minutes, prompts the user to share
 * their progress via the ShareCard component.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Platform,
  Alert,
} from 'react-native';
import type { DailyChallengePiece, StreakData } from '../types';
import { ScoreViewer } from '../components/ScoreViewer';
import { ShareCard } from '../components/ShareCard';
import {
  addPracticeMinutes,
  recordPractice,
  getStreakData,
  getTodayPracticeMinutes,
} from '../services/storage';
import { refreshStreakNudge } from '../services/notifications';

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
  const startedAt = useRef<number | null>(null);

  // Share-card state
  const [showShareCard, setShowShareCard] = useState(false);
  const [shareCardData, setShareCardData] = useState<{
    streak: number;
    practiceMinutes: number;
  }>({ streak: 0, practiceMinutes: 0 });

  // Track whether share prompt was already shown this session
  const sharePromptShown = useRef(false);

  useEffect(() => {
    if (!showScoreViewer) return;
    startedAt.current = Date.now();
    void recordPractice();
    return () => {
      const now = Date.now();
      const elapsedMinutes =
        (now - (startedAt.current ?? now)) / 60000;
      if (elapsedMinutes > 0) {
        void addPracticeMinutes(elapsedMinutes).then(() =>
          refreshStreakNudge(),
        );
      }
    };
  }, [showScoreViewer]);

  /**
   * When ScoreViewer closes, check if the user practiced long enough
   * to warrant a share prompt. Only shows once per session.
   */
  const handleCloseScoreViewer = useCallback(async () => {
    setShowScoreViewer(false);

    const elapsedMinutes =
      (Date.now() - (startedAt.current ?? Date.now())) / 60000;

    // Only prompt if they practiced > 2 minutes and haven't been asked yet
    if (elapsedMinutes >= 2 && !sharePromptShown.current) {
      sharePromptShown.current = true;

      // Small delay to let the modal dismiss animation finish
      setTimeout(async () => {
        const [streakData, todayMinutes] = await Promise.all([
          getStreakData(),
          getTodayPracticeMinutes(),
        ]);

        Alert.alert(
          '🎵 Nice practice session!',
          'Share your progress?',
          [
            {
              text: 'Not now',
              style: 'cancel',
            },
            {
              text: 'Share',
              onPress: () => {
                setShareCardData({
                  streak: streakData.currentStreak,
                  practiceMinutes: todayMinutes,
                });
                setShowShareCard(true);
              },
            },
          ],
          { cancelable: true },
        );
      }, 400);
    }
  }, []);

  const handleCloseShareCard = useCallback(() => {
    setShowShareCard(false);
  }, []);

  // If showing the ScoreViewer
  if (showScoreViewer && piece.sheetMusicUrl) {
    // Practice audio: use curated score audio when the backend supplies it;
    // otherwise fall back to a bundled public-domain preview so the
    // loop/time-stretch player is always usable for public-domain scores.
    // The label stays honest about which one is playing.
    const hasCuratedAudio = !!piece.audioUrl;
    const audioBundled = require('../../assets/audio/preview-fur-elise.wav');
    const audioSource = hasCuratedAudio
      ? (piece.audioUrl as string)
      : piece.isPublicDomain !== false
      ? audioBundled
      : null;
    return (
      <ScoreViewer
        url={piece.sheetMusicUrl}
        title={piece.title}
        composer={piece.composer}
        onClose={handleCloseScoreViewer}
        audioSource={audioSource}
        audioLabel={hasCuratedAudio ? 'Score audio' : 'Preview'}
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
    } catch {
      // User cancelled — no action needed
    } finally {
      setSharing(false);
    }
  }, [piece]);

  const handleViewSheetMusic = () => {
    if (piece.sheetMusicUrl) {
      sharePromptShown.current = false; // Reset for this session
      setShowScoreViewer(true);
    }
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

        {piece.description && (
          <Text style={styles.description}>{piece.description}</Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {piece.sheetMusicUrl ? (
          <TouchableOpacity
            style={styles.viewSheetBtn}
            onPress={handleViewSheetMusic}
          >
            <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>
          </TouchableOpacity>
        ) : (
          /* Honest "coming soon" state: piece with no curated sheet yet — no
             broken button, no dead end. */
          <View style={styles.comingSoonCard}>
            <Text style={styles.comingSoonTitle}>
              🎼 Sheet music coming soon
            </Text>
            <Text style={styles.comingSoonText}>
              We're still curating a high-quality score for this piece — check
              back soon.
            </Text>
          </View>
        )}

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

      {/* Share progress card modal */}
      <ShareCard
        visible={showShareCard}
        title={piece.title}
        composer={piece.composer}
        genre={piece.genre}
        streak={shareCardData.streak}
        practiceMinutes={shareCardData.practiceMinutes}
        onClose={handleCloseShareCard}
      />
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
  viewSheetText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  comingSoonCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderStyle: 'dashed',
  },
  comingSoonTitle: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  comingSoonText: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
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
