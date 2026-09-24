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
  ScrollView,
} from 'react-native';
import type { DailyChallengePiece } from '../types';
import { ScoreViewer } from '../components/ScoreViewer';
import { ShareCard } from '../components/ShareCard';
import { CoachPracticeCard } from '../components/CoachPracticeCard';
import { StreakNudgeCard } from '../components/StreakNudgeCard';
import { useHardwareBack } from '../hooks/useHardwareBack';
import {
  addPracticeMinutes,
  recordPractice,
  getTodayPracticeMinutes,
} from '../services/storage';
import { getDisplayStreakLocal } from '../services/reinforcementStore';
import { refreshStreakNudge } from '../services/notifications';
import {
  resolveShareCardPreviewData,
  sharePreviewAccessibilityLabel,
} from '../services/shareCardShare';

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

  // True while the coach is recording/scoring — keeps the outside-play nudge
  // card off the screen during a run (the engine's Nudge is playSafeOnly).
  const [coachActive, setCoachActive] = useState(false);

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
        // Streak comes from the practice-reinforcement engine (practice history),
        // never from the legacy counter — one source for every streak number.
        const [streakData, todayMinutes] = await Promise.all([
          getDisplayStreakLocal(),
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
                  streak: streakData.currentDays,
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

  /**
   * The Share Preview card is tappable (owner rule: a card that looks tappable
   * must act). It opens the SAME full-screen ShareCard modal the post-practice
   * alert and the coach celebration use, populated from the same two sources —
   * it previews exactly the card that gets shared. Tapping never records
   * practice, never moves the streak, and never fires a share sheet by itself.
   */
  const handleOpenSharePreview = useCallback(async () => {
    // Honest fallbacks: a failed/no-history read still opens a truthful card
    // (0 days, 0 min today) rather than a dead tap or a NaN on the artwork.
    let streakDays: number | undefined;
    let todayMinutes: number | undefined;
    try {
      const [streakData, minutes] = await Promise.all([
        getDisplayStreakLocal(),
        getTodayPracticeMinutes(),
      ]);
      streakDays = streakData.currentDays;
      todayMinutes = minutes;
    } catch (e) {
      console.warn('[share] preview data unavailable', e);
    }

    setShareCardData(
      resolveShareCardPreviewData({ streakDays, todayMinutes }),
    );
    setShowShareCard(true);
  }, []);

  // Android hardware BACK (owner-reproduced on device, 09-23: "streak day →
  // featured piece → sheet music page → BACK → the app exits"). This page is an
  // IN-PLACE flow — Home / History / Find-a-Piece / the hum flow replace their
  // tab body with it, so the route never changes and nothing else consumes the
  // key. Without this handler the press reaches React Navigation, whose last
  // route is "Tabs" with nothing to pop, and the activity finishes.
  //
  // It unwinds ONE level: out of the score first (when the ScoreViewer modal is
  // up it consumes the press itself via onRequestClose, so this branch is the
  // belt-and-braces path), then back to whoever opened the piece. Returning true
  // is the "I consumed this press" signal — returning false would fall straight
  // through to the exiting behaviour this exists to prevent.
  // src/services/backExitContract.ts guards the whole class in the tier1 gate.
  useHardwareBack(() => {
    if (showScoreViewer) {
      void handleCloseScoreViewer();
      return true;
    }
    onBack();
    return true;
  });

  // Practice audio for the sheet viewer: use curated score audio when the backend
  // supplies it; otherwise fall back to a bundled public-domain preview so the
  // loop/time-stretch player is always usable for public-domain scores. The label
  // stays honest about which one is playing.
  //
  // Computed here (unconditionally, like every hook above) because the viewer is
  // now an overlay inside the page body below — not a body-replacing early return.
  const hasCuratedScoreAudio = !!piece.audioUrl;
  const bundledScoreAudio = require('../../assets/audio/preview-fur-elise.wav');
  const scoreAudioSource = hasCuratedScoreAudio
    ? (piece.audioUrl as string)
    : piece.isPublicDomain !== false
    ? bundledScoreAudio
    : null;

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
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

      {/* Coached practice — the practice-coach MVP surface (slice 3).
          Lives on the piece screen (not Home): the sheet music, the loop/
          time-stretch player and this coach all belong to the piece in hand.
          The reference melody resolves from the catalog's abc when present,
          otherwise from the bundled public-domain seeds; a piece with neither
          gets an honest "coming soon" line instead of a dead button. */}
      <CoachPracticeCard
        pieceId={piece.id}
        title={piece.title}
        composer={piece.composer}
        abc={piece.abc}
        onSessionActiveChange={setCoachActive}
      />

      {/* Outside-play streak nudge (slice 2): low-weight, dismissible, hidden
          while a run is being recorded or scored. Copy comes from the engine's
          nudge payload — positive framing only. */}
      <StreakNudgeCard surface="piece-detail" hidden={coachActive} />

      {/* Share card preview — tappable. Opens the real ShareCard modal (the
          same one the post-practice alert and the coach celebration use), so
          the preview shows exactly the card that gets shared. It never fires a
          share sheet on its own. */}
      <TouchableOpacity
        style={styles.shareCard}
        onPress={handleOpenSharePreview}
        accessibilityRole="button"
        accessibilityLabel={sharePreviewAccessibilityLabel(piece.title)}
        accessibilityHint="Opens the share card so you can share it"
      >
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
        <Text style={styles.shareCardCta}>Tap to open the share card →</Text>
      </TouchableOpacity>

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
      </ScrollView>

      {/* Full-screen sheet-music viewer — an OVERLAY inside this always-mounted
          page body, never a body replacement (owner-reported blank page, v22 →
          v24: a viewer flag left true by a natively dismissed dialog left the
          host rendering an empty screen). Guarded by
          src/services/backExitContract.ts (the blank-return contract). */}
      {showScoreViewer && piece.sheetMusicUrl && (
        <ScoreViewer
          url={piece.sheetMusicUrl}
          title={piece.title}
          composer={piece.composer}
          onClose={handleCloseScoreViewer}
          audioSource={scoreAudioSource}
          audioLabel={hasCuratedScoreAudio ? 'Score audio' : 'Preview'}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 48,
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
  shareCardCta: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#4ecdc4',
    textAlign: 'center',
  },
});
