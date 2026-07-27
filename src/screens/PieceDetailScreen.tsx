/**
 * PieceDetailScreen — shows piece info with share card functionality.
 * Navigated to from daily challenge, history, or recommendations.
 */
import React, { useState, useCallback, useEffect } from 'react';
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
import { getStreakData } from '../services/storage';
import type { StreakData } from '../types';

interface PieceDetailScreenProps {
  piece: DailyChallengePiece;
  onBack: () => void;
  /** Whether this piece has been marked as "mastered" by the user. */
  isCompleted?: boolean;
}

/** Share variant types. */
type ShareVariant = 'played' | 'streak' | 'mastered' | 'challenge';

interface ShareOption {
  variant: ShareVariant;
  label: string;
  emoji: string;
}

const APP_CTA = 'Get it at notesnap.com';

export const PieceDetailScreen: React.FC<PieceDetailScreenProps> = ({
  piece,
  onBack,
  isCompleted = false,
}) => {
  const [sharing, setSharing] = useState(false);
  const [activeVariant, setActiveVariant] = useState<ShareVariant>('played');
  const [streakData, setStreakData] = useState<StreakData>({
    currentStreak: 0,
    lastPracticeDate: null,
    bestStreak: 0,
  });

  useEffect(() => {
    (async () => {
      const streak = await getStreakData();
      setStreakData(streak);
    })();
  }, []);

  // Build available share variants based on context
  const shareOptions: ShareOption[] = [
    { variant: 'played', label: 'Share what I played', emoji: '🎹' },
  ];

  if (streakData.currentStreak > 1) {
    shareOptions.push({
      variant: 'streak',
      label: `Share my ${streakData.currentStreak}-day streak`,
      emoji: '🔥',
    });
    shareOptions.push({
      variant: 'challenge',
      label: 'Challenge friends',
      emoji: '⚔️',
    });
  }

  if (isCompleted) {
    shareOptions.push({
      variant: 'mastered',
      label: 'Share that I mastered this',
      emoji: '🏆',
    });
  }

  // Build message based on active variant
  const getShareMessage = (variant: ShareVariant): string => {
    switch (variant) {
      case 'played':
        return `I just played "${piece.title}" by ${piece.composer} on NoteSnap 🎹\n\n${APP_CTA}`;
      case 'streak':
        return `I'm on a ${streakData.currentStreak}-day streak on NoteSnap 🔥\n\n${APP_CTA}`;
      case 'mastered':
        return `I just mastered "${piece.title}" by ${piece.composer} on NoteSnap 🎹\n\n${APP_CTA}`;
      case 'challenge':
        return `Can you beat my ${streakData.currentStreak}-day streak? Join me on NoteSnap 🎹\n\n${APP_CTA}`;
    }
  };

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const shareMessage = getShareMessage(activeVariant);

      if (Platform.OS === 'web') {
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
  }, [piece, activeVariant, streakData.currentStreak]);

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
          {isCompleted && (
            <View style={[styles.tag, styles.tagCompleted]}>
              <Text style={styles.tagText}>✅ Mastered</Text>
            </View>
          )}
        </View>

        <Text style={styles.description}>{piece.description}</Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.viewSheetBtn}>
          <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>
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

      {/* Share variant selector */}
      {shareOptions.length > 1 && (
        <View style={styles.variantSelector}>
          <Text style={styles.variantLabel}>Share as:</Text>
          <View style={styles.variantRow}>
            {shareOptions.map((opt) => (
              <TouchableOpacity
                key={opt.variant}
                style={[
                  styles.variantChip,
                  activeVariant === opt.variant && styles.variantChipActive,
                ]}
                onPress={() => setActiveVariant(opt.variant)}
              >
                <Text
                  style={[
                    styles.variantChipText,
                    activeVariant === opt.variant && styles.variantChipTextActive,
                  ]}
                >
                  {opt.emoji} {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Share card preview */}
      <View style={styles.shareCard}>
        <Text style={styles.shareCardLabel}>Share Preview</Text>
        <View style={styles.shareCardInner}>
          <Text style={styles.shareCardPiece}>{piece.title}</Text>
          <Text style={styles.shareCardComposer}>{piece.composer}</Text>
          <View style={styles.shareCardDivider} />
          <Text style={styles.shareCardTagline}>
            {getShareMessage(activeVariant).split('\n\n')[0]}
          </Text>
          <Text style={styles.shareCardApp}>
            NoteSnap · {APP_CTA}
          </Text>
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
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  tag: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagCompleted: {
    backgroundColor: '#1a3a2e',
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
  // Variant selector
  variantSelector: {
    marginTop: 16,
  },
  variantLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a0a0b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  variantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  variantChip: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  variantChipActive: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  variantChipText: {
    color: '#c0c0d0',
    fontSize: 13,
    fontWeight: '600',
  },
  variantChipTextActive: {
    color: '#ffffff',
  },
  // Share card preview
  shareCard: {
    marginTop: 20,
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
    textAlign: 'center',
  },
  shareCardApp: {
    fontSize: 13,
    color: '#e94560',
    fontWeight: '700',
  },
});
