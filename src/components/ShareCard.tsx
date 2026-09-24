/**
 * ShareCard — full-screen modal that renders a shareable progress card.
 *
 * Captures the card as an image via react-native-view-shot, then opens the
 * native share sheet with the PNG (expo-sharing) — falling back to a text-only
 * share when capture is unavailable.
 *
 * Owner-reported defect on v21 (0.1.16): "the share preview card is dead".
 * On Android the image was silently dropped, because React Native's
 * `Share.share` only sends `{ title, message }` to the OS intent and ignores a
 * `file://` `url` — the two Platform branches here used to be byte-identical,
 * so the iOS/Android split was a no-op and every Android share lost the card.
 * `expo-sharing`'s `shareAsync` is the path that actually delivers a file, and
 * it is already the pattern in src/services/cloudSync.ts.
 *
 * Failure paths are no longer silent: a failed capture logs + tells the user
 * the share is text-only, and the Share button always re-enables afterwards.
 */
import React, { useRef, useCallback, useState, useEffect } from 'react';
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
import * as Sharing from 'expo-sharing';
import {
  SHARE_CARD_FAILED_HINT,
  SHARE_CARD_IMAGE_UNAVAILABLE_HINT,
  buildShareCardPayload,
} from '../services/shareCardShare';

/** Is sharing a *file* (not just text) possible on this device? */
async function isImageSharingAvailable(): Promise<boolean> {
  try {
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

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
  /**
   * Celebration headline to show above the piece (e.g. "🏆 New personal best!").
   * Optional: the progress-share flow leaves it out entirely.
   */
  headline?: string;
  /**
   * Ready-to-share sentence. The reinforcement moment passes the engine's own
   * `shareText` so a celebration is shared in the engine's words; when omitted
   * the card keeps its original progress wording.
   */
  shareMessage?: string;
  /** Label under the minutes stat (default "min today"). */
  minutesLabel?: string;
  /**
   * A medal being celebrated (the achievements layer). Renders the medal block
   * above the context line, so an achievement card is THIS card with a medal on
   * it — never a second, forked share card. The title/composer props carry the
   * piece/song context the medal unlocked around.
   */
  medal?: {
    emoji: string;
    name: string;
    /** Optional progress line ("7 of 7 days in a row"). */
    progressLabel?: string;
  };
}

export const ShareCard: React.FC<ShareCardProps> = ({
  visible,
  title,
  composer,
  genre,
  streak,
  practiceMinutes,
  onClose,
  headline,
  shareMessage,
  minutesLabel,
  medal,
}) => {
  const cardRef = useRef<View>(null);
  const [capturing, setCapturing] = useState(false);
  // Honest, non-blocking status line: which form the share actually took, or
  // that the share sheet did not open at all.
  const [notice, setNotice] = useState<string | null>(null);

  const roundedMinutes = Math.round(practiceMinutes);

  const shareText =
    shareMessage ?? `I'm learning "${title}" by ${composer} on NoteSnap! Day ${streak} streak 🔥`;

  // A reopened modal starts clean — no stale notice from the last attempt.
  useEffect(() => {
    if (!visible) {
      setNotice(null);
    }
  }, [visible]);

  const handleShare = useCallback(async () => {
    setCapturing(true);
    setNotice(null);
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
      } catch (e) {
        // view-shot can fail (unsupported runtime, off-screen view, low memory).
        // Do not swallow it: log it and tell the user the share is text-only.
        console.warn('[share] capture failed', e);
        imageUri = undefined;
        setNotice(SHARE_CARD_IMAGE_UNAVAILABLE_HINT);
      }

      const imageSharingAvailable =
        !!imageUri && (await isImageSharingAvailable());

      const payload = buildShareCardPayload({
        shareText,
        imageUri,
        imageSharingAvailable,
      });

      if (payload.mode === 'image') {
        // The captured PNG — shared as a file. On Android this is the only
        // path that reaches the share sheet with the artwork attached.
        await Sharing.shareAsync(payload.imageUri, {
          mimeType: payload.mimeType,
          dialogTitle: payload.dialogTitle,
          UTI: undefined,
        });
      } else {
        // Text-only fallback (no PNG, or this platform cannot share files).
        // The brand link is already printed on the card artwork, so an
        // image-only share still carries it.
        if (imageUri) {
          setNotice(SHARE_CARD_IMAGE_UNAVAILABLE_HINT);
        }
        await Share.share({ message: payload.message });
      }
    } catch (e) {
      // Dismissing the sheet resolves without throwing; getting here means the
      // sheet genuinely failed — say so rather than looking tapped-dead.
      console.warn('[share] share sheet failed', e);
      setNotice(SHARE_CARD_FAILED_HINT);
    } finally {
      // Always re-enable the button, including every error path above.
      setCapturing(false);
    }
  }, [shareText]);

  return (
    /* onRequestClose is REQUIRED on Android (same defect class as the sheet
       viewer's dead BACK button): without it the hardware back press cannot
       reach JS, this card stays "open" in state, and the screen behind it —
       which renders only this modal while it is open — is left blank. */
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
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

              {/* Celebration headline (reinforcement moment only) */}
              {headline ? <Text style={styles.headline}>{headline}</Text> : null}

              {/* Medal block (achievements layer only) — the medal being
                  celebrated, on the SAME captured card as the context below. */}
              {medal ? (
                <View style={styles.medalBlock}>
                  <Text style={styles.medalEmoji}>{medal.emoji}</Text>
                  <Text style={styles.medalName}>{medal.name}</Text>
                  {medal.progressLabel ? (
                    <Text style={styles.medalProgress}>{medal.progressLabel}</Text>
                  ) : null}
                </View>
              ) : null}

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
                    {minutesLabel ?? 'min today'}
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
          {notice ? (
            <Text
              style={styles.noticeText}
              accessibilityLiveRegion="polite"
            >
              {notice}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.shareBtn, capturing && styles.shareBtnDisabled]}
            onPress={handleShare}
            disabled={capturing}
            accessibilityRole="button"
            accessibilityLabel="Share progress card"
            accessibilityState={{ busy: capturing, disabled: capturing }}
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

  // Celebration headline — only rendered by the reinforcement moment
  headline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#4ecdc4',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 24,
  },

  // Medal block — only rendered for an achievement card
  medalBlock: {
    alignItems: 'center',
    marginBottom: 18,
  },
  medalEmoji: {
    fontSize: 44,
    marginBottom: 6,
  },
  medalName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#4ecdc4',
    textAlign: 'center',
  },
  medalProgress: {
    fontSize: 12,
    color: '#a0a0b8',
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  noticeText: {
    color: '#4ecdc4',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 4,
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
