/**
 * ReinforcementMomentCard — the post-run celebration moment (slice 2).
 *
 * Rendered by the coached-practice card immediately BELOW the score, so the
 * order the user experiences is: what I played (score + coach feedback) → what it
 * built (streak / minutes / personal best) → share it.
 *
 * It renders ONLY what services/practiceReinforcementView.ts says is showable:
 * engine celebration payloads (emoji + title + the engine's one-liner), a quiet
 * streak line, and a share affordance for any celebration. Copy is never invented
 * here — no percentages, no guilt, no "don't break your streak". A run that
 * crossed nothing and has no streak renders nothing at all (the parent simply
 * does not mount this card).
 */
import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ShareCard } from './ShareCard';
import type { Celebration } from '../services/practiceReinforcement';
import type { ReinforcementMoment } from '../services/practiceReinforcementView';

interface ReinforcementMomentCardProps {
  moment: ReinforcementMoment;
  /** Piece title, for the share card. */
  title: string;
  /** Composer, for the share card. */
  composer?: string;
  /** Genre tag, for the share card (optional). */
  genre?: string;
  /** Called when the user dismisses the moment. */
  onDismiss: () => void;
}

export const ReinforcementMomentCard: React.FC<ReinforcementMomentCardProps> = ({
  moment,
  title,
  composer,
  genre,
  onDismiss,
}) => {
  // The celebration the user chose to share (any of them can be shared).
  const [sharing, setSharing] = useState<Celebration | null>(null);

  const closeShare = useCallback(() => setSharing(null), []);

  return (
    <View style={styles.card} testID="reinforcement-moment">
      {moment.hasMoment && (
        <>
          <Text style={styles.momentLabel}>What this run built</Text>
          {moment.celebrations.map((celebration) => (
            <View
              key={`${celebration.kind}-${celebration.threshold ?? celebration.value}`}
              style={styles.celebration}
            >
              <Text style={styles.celebrationTitle}>
                {celebration.emoji} {celebration.title}
              </Text>
              <Text style={styles.celebrationCopy}>{celebration.copy}</Text>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={() => setSharing(celebration)}
                testID="reinforcement-share"
              >
                <Text style={styles.shareBtnText}>📤 Share your moment</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {/* Quiet streak line — shown once per completion, never a fake moment. */}
      {moment.streakLine && (
        <Text style={styles.streakLine}>{moment.streakLine.text}</Text>
      )}

      <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} testID="reinforcement-dismiss">
        <Text style={styles.dismissText}>Nice</Text>
      </TouchableOpacity>

      {/* Reuses the app's existing share card (PieceDetail/History flow) with the
          engine's own share sentence as the message. */}
      <ShareCard
        visible={sharing !== null}
        title={title}
        composer={composer ?? 'NoteSnap'}
        genre={genre}
        streak={moment.streakDays}
        practiceMinutes={moment.runMinutes}
        minutesLabel="min this take"
        headline={sharing ? `${sharing.emoji} ${sharing.title}` : undefined}
        shareMessage={sharing?.shareText}
        onClose={closeShare}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  momentLabel: {
    color: '#4ecdc4',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  celebration: {
    marginBottom: 10,
  },
  celebrationTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  celebrationCopy: {
    color: '#d5d5e4',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  shareBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#e94560',
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  streakLine: {
    color: '#c0c0d0',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  dismissBtn: {
    alignSelf: Platform.OS === 'web' ? 'flex-start' : 'flex-end',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  dismissText: {
    color: '#4ecdc4',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default ReinforcementMomentCard;
