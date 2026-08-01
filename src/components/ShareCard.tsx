/**
 * ShareCard — full-screen modal that renders a shareable progress card.
 *
 * Captures the card as an image via react-native-view-shot,
 * then opens the native share sheet with the image + text message.
 */
import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Share,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

interface ShareCardProps {
  /** Whether the modal is visible. */
  visible: boolean;
  /** Piece title. */
  title: string;
  /** Composer name. */
  composer: string;
  /** Genre tag (optional). */
  genre?: string;
  /** Current streak count. */
  streak: number;
  /** Today's practice minutes, rounded. */
  practiceMinutes: number;
  /** Called when user dismisses the modal without sharing. */
  onClose: () => void;
}

export const ShareCard: React.FC<ShareCardProps> = ({
  visible,
  title,
  composer,
  genre,
  streak,
  practiceMinutes,
  onClose,
}) => {
  const cardRef = useRef<View>(null);
  const [capturing, setCapturing] = useState(false);

  const roundedMinutes = Math.round(practiceMinutes);

  const shareText = `I'm learning "${title}" by ${composer} on NoteSnap! Day ${streak} streak 🔥`;

  const handleShare = useCallback(async () => {
    setCapturing(true);
    try {
      // Try to capture the card as an image
      let imageUri: string | undefined;
      try {
        if (cardRef.current) {
          imageUri = await captureRef(cardRef.current, {
            format: 'png',
            quality: 1.0,
          });
        }
      } catch {
        // view-shot may fail in some environments — fall back to text-only
      }

      if (imageUri) {
        await Share.share(
          Platform.OS === 'ios'
            ? {
                message: shareText,
                url: imageUri,
              }
            : {
                message: shareText,
                url: imageUri,
              },
        );
      } else {
        // Text-only fallback
        await Share.share({
          message: `${shareText}\n\nhttps://notesnap.app`,
        });
      }
    } catch {
      // User cancelled — no action needed
    } finally {
      setCapturing(false);
    }
  }, [title, composer, streak, shareText]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
    >
      <View style={styles.container}>
        {/* Header bar */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Share Progress</Text>
          <View style={styles.closeBtn} />
        </View>

        {/* The card — captured by view-shot */}
        <View style={styles.cardWrapper}>
          <View ref={cardRef} style={styles.card} collapsable={false}>
            {/* Accent stripe */}
            <View style={styles.accentStripe} />

            {/* Card body */}
            <View style={styles.cardBody}>
              {/* Logo */}
              <Text style={styles.logo}>🎵 NoteSnap</Text>

              {/* Piece title & composer — the focus */}
              <Text style={styles.pieceTitle} numberOfLines={3}>
                {title}
              </Text>
              <Text style={styles.pieceComposer}>{composer}</Text>

              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statEmoji}>🔥</Text>
                  <Text style={styles.statValue}>{streak}</Text>
                  <Text style={styles.statLabel}>
                    Day{streak !== 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statEmoji}>⏱️</Text>
                  <Text style={styles.statValue}>{roundedMinutes}</Text>
                  <Text style={styles.statLabel}>
                    min today
                  </Text>
                </View>
              </View>

              {/* Genre tag */}
              {genre ? (
                <View style={styles.genreTag}>
                  <Text style={styles.genreText}>{genre}</Text>
                </View>
              ) : null}

              {/* Bottom branding */}
              <Text style={styles.branding}>notesnap.app</Text>
            </View>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.shareBtn, capturing && styles.shareBtnDisabled]}
            onPress={handleShare}
            disabled={capturing}
          >
            {capturing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.shareBtnText}>📤 Share</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.dismissBtn} onPress={onClose}>
            <Text style={styles.dismissBtnText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#a0a0b8',
    fontSize: 20,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },

  // Card wrapper — centers the card on screen
  cardWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // The card itself — exactly what gets captured
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#16213e',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  accentStripe: {
    height: 6,
    backgroundColor: '#e94560',
    width: '100%',
  },
  cardBody: {
    padding: 28,
    alignItems: 'center',
  },

  // Logo
  logo: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e94560',
    marginBottom: 20,
  },

  // Piece info — the focus
  pieceTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
    lineHeight: 28,
  },
  pieceComposer: {
    fontSize: 15,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 22,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: '#a0a0b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 50,
    backgroundColor: '#0f3460',
  },

  // Genre tag
  genreTag: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 18,
  },
  genreText: {
    color: '#c0c0d0',
    fontSize: 13,
    fontWeight: '600',
  },

  // Bottom branding
  branding: {
    fontSize: 12,
    color: '#e94560',
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Action buttons
  actions: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 12,
  },
  shareBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  shareBtnDisabled: {
    opacity: 0.7,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  dismissBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f3460',
  },
  dismissBtnText: {
    color: '#a0a0b8',
    fontSize: 16,
    fontWeight: '600',
  },
});
