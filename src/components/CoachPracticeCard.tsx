/**
 * CoachPracticeCard — "Coached practice" section on the piece screen (slice 3).
 *
 * Renders the practice-coach flow for the piece in front of the user:
 *
 *   idle  ──🎙 Record a take──►  recording ──⏹ Stop──►  processing ──► result
 *
 * The card owns copy and layout ONLY: the microphone lives in
 * hooks/useAudioRecorder.ts (shared with hum/recognition), the state machine and
 * all numbers live in services/coachRun.ts, and the reference melody comes from
 * services/pieceAbc.ts. State states are the app's existing idle → recording →
 * processing → result language, so the coach feels like the same product.
 *
 * Honesty rules enforced here (see the slice-3 brief):
 *  - No pop-ups, alerts or navigation while recording.
 *  - A score is shown ONLY when one was measured. When the take could not be
 *    decoded (no on-device/decoder path in this build) or nothing was heard, the
 *    card shows the reason and keeps the accuracy row hidden.
 *  - A piece with no reference melody NEVER gets a promise of one (owner 10-01,
 *    v31): a modern song (no melody we may host, but a licensed page) shows ONE
 *    honest line and NO action, and a piece with neither shows nothing at all.
 *    The card is not a purchase surface — the page's single retailer CTA is the
 *    sheet-music card above it.
 */
import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCoachRun } from '../hooks/useCoachRun';
import { resolvePieceAbc } from '../services/pieceAbc';
import {
  COACH_NO_MELODY_NOTICE,
  coachMelodyCard,
  coachNoReferenceOutcome,
  MIN_COACH_RUN_SECONDS,
} from '../services/coachRun';
import { buildReinforcementMoment } from '../services/practiceReinforcementView';
import { ReinforcementMomentCard } from './ReinforcementMomentCard';
import type { SamplesProvider } from '../services/coachCapture';

interface CoachPracticeCardProps {
  /** Stable piece id — practice history is keyed by it. */
  pieceId: string;
  /** Piece title (also woven into the coach's positive feedback). */
  title: string;
  composer?: string;
  /** The piece's ABC from the catalog, when the backend supplies it. */
  abc?: string | null;
  /** Optional tempo override (otherwise the ABC's Q:, then 100 bpm). */
  tempoBpm?: number;
  /**
   * The licensed retailer link the piece was saved with (a modern song), when
   * the recognition carried one. It is a SIGNAL ONLY — it tells the card that
   * this piece is a modern song, whose melody we may not host, so the card can
   * tell the truth instead of promising a melody (owner 10-01). The card never
   * opens it and holds no purchase action of any kind: the piece page has exactly
   * ONE retailer CTA, the sheet-music card above (v31, one CTA per page).
   */
  purchaseUrl?: string | null;
  /** Inject a different capture path (tests / a future in-app decoder). */
  samplesProvider?: SamplesProvider;
  /**
   * True while this card is recording/scoring. The screen uses it to keep
   * outside-play surfaces (the streak nudge card) hidden during a run — the
   * reinforcement engine's nudge is `playSafeOnly`.
   */
  onSessionActiveChange?: (active: boolean) => void;
}

export const CoachPracticeCard: React.FC<CoachPracticeCardProps> = ({
  pieceId,
  title,
  composer,
  abc,
  tempoBpm,
  purchaseUrl,
  samplesProvider,
  onSessionActiveChange,
}) => {
  // The piece's reference melody: catalog abc → bundled public-domain seed → none.
  const resolved = useMemo(
    () => resolvePieceAbc({ abc, title, composer, pieceId }),
    [abc, title, composer, pieceId],
  );

  const coach = useCoachRun({
    pieceId,
    pieceTitle: title,
    abc: resolved.abc,
    tempoBpm,
    samplesProvider,
  });

  const { phase, outcome, history, error } = coach;

  // Tempo the reference is read at: shown with the record control so the user
  // knows what to play along to. Only the tempo is read from this outcome — its
  // copy is never rendered (a melody-less piece gets no promise; v31).
  const noReference = useMemo(
    () => coachNoReferenceOutcome({ abc: resolved.abc, tempoBpm }),
    [resolved.abc, tempoBpm],
  );

  const tempoLabel = `${outcome?.tempoBpm ?? noReference.tempoBpm} bpm`;

  /**
   * Which reference-melody state this card is in — decided in ONE pure place
   * (services/coachRun.ts `coachMelodyCard`) so the branch order is pinned by the
   * tier1 gate instead of remembered here:
   *   • a written melody → the record/score flow (unchanged);
   *   • no melody we may use, but a licensed page (a modern song) → ONE honest
   *     notice and NO action (the page's single purchase CTA is one tap away);
   *   • neither → nothing is rendered at all (v31: hiding, not promising).
   */
  const melody = coachMelodyCard({
    hasReference: coach.hasReference,
    purchaseUrl,
  });

  const isRecording = phase === 'recording';
  const isProcessing = phase === 'processing';
  const showResult = phase === 'result' && outcome != null;
  const canRecord = coach.hasReference && !isProcessing;

  // Practice-reinforcement moment (retention layer, slice 2): built from the
  // engine's payload for the run that was just saved. Null when the run crossed
  // nothing and there is no streak to report — the card then shows nothing extra.
  const moment = useMemo(
    () => buildReinforcementMoment(coach.reinforcement, { durationSec: outcome?.durationSec }),
    [coach.reinforcement, outcome?.durationSec],
  );

  // Tell the screen when a run/capture is live, so outside-play surfaces stay off.
  useEffect(() => {
    onSessionActiveChange?.(isRecording || isProcessing);
  }, [isRecording, isProcessing, onSessionActiveChange]);

  // v31 (owner 10-01): a piece with no melody we may use and no licensed page
  // renders NOTHING — never the old "Reference melody coming soon" promise. All
  // hooks above have already run, so this early return is safe.
  if (melody.kind === 'hidden') return null;

  const recordLabel = (() => {
    if (isProcessing) return 'Scoring your take…';
    if (isRecording) return '⏹ Stop & get feedback';
    if (showResult || phase === 'error') return '🎙 Record another take';
    return '🎙 Record a take';
  })();

  return (
    <View style={styles.card} testID="coach-practice-card">
      {melody.kind === 'notice' ? (
        /* A modern song: we hold no melody we may host (copyright), so there is
           nothing to coach — and v31 gives the page exactly ONE purchase action,
           the sheet-music card above (owner 10-01: "duplicate CTA box"). So this
           card states the truth in ONE line and holds NO action at all: no buy
           button, no stacked box repeating the same offer. */
        <Text style={styles.noticeText} testID="coach-no-melody-notice">
          {COACH_NO_MELODY_NOTICE}
        </Text>
      ) : (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.label}>🎧 Coached practice</Text>
            <View style={styles.tempoChip}>
              <Text style={styles.tempoText}>{tempoLabel}</Text>
            </View>
          </View>

          <Text style={styles.pieceLine} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subLine}>
            {resolved.source === 'seed'
              ? `Reference melody: ${resolved.seed?.title ?? 'public-domain phrase'} (practice phrase)`
              : resolved.source === 'piece'
              ? 'Reference melody: from the catalog'
              : 'We score your take against the written melody.'}
          </Text>

          {/* Record / stop / processing control */}
          <TouchableOpacity
            style={[
              styles.recordBtn,
              isRecording && styles.recordBtnActive,
              isProcessing && styles.recordBtnDisabled,
              !canRecord && styles.recordBtnDisabled,
            ]}
            disabled={!canRecord}
            onPress={() => {
              if (isRecording) {
                void coach.stopAndScore();
              } else {
                void coach.start();
              }
            }}
          >
            <Text style={styles.recordBtnText}>{recordLabel}</Text>
          </TouchableOpacity>

          {isRecording && (
            <View style={styles.listeningRow}>
              <View style={styles.liveDot} />
              <Text style={styles.listeningText}>
                Listening — play the phrase now. Tap stop when you are done.
              </Text>
            </View>
          )}

          {isProcessing && (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color="#4ecdc4" />
              <Text style={styles.processingText}>Finding the notes in your take…</Text>
            </View>
          )}

          {error && phase !== 'recording' && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={coach.openSettings}>
                <Text style={styles.retryText}>Open settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Result: feedback headline + up to 3 specific lines + the numbers we measured */}
          {showResult && outcome != null && (
            <View style={styles.resultBlock}>
              <Text style={styles.headline}>{outcome.headline}</Text>
              {outcome.lines.slice(0, 3).map((line) => (
                <Text key={line} style={styles.issueLine}>
                  • {line}
                </Text>
              ))}

              {outcome.accuracyPct != null && (
                <View style={styles.scoreRow}>
                  <View style={styles.scorePill}>
                    <Text style={styles.scorePillLabel}>This take</Text>
                    <Text style={styles.scorePillValue}>{outcome.accuracyPct}%</Text>
                  </View>
                  <View style={styles.scorePill}>
                    <Text style={styles.scorePillLabel}>Best</Text>
                    <Text style={styles.scorePillValue}>
                      {history.bestAccuracyPct != null ? `${history.bestAccuracyPct}%` : '—'}
                    </Text>
                  </View>
                  <View style={styles.scorePill}>
                    <Text style={styles.scorePillLabel}>Runs</Text>
                    <Text style={styles.scorePillValue}>{history.runCount}</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Reinforcement moment — what this run built (streak / minutes /
              personal best), straight after the score. Renders nothing when the
              run crossed nothing and there is no streak to report. */}
          {showResult && moment && (
            <ReinforcementMomentCard
              moment={moment}
              title={title}
              composer={composer}
              onDismiss={coach.dismissReinforcement}
            />
          )}

          {/* Last/best for this piece when nothing has been played this session */}
          {!showResult && !isRecording && !isProcessing && (
            <Text style={styles.historyLine}>
              {history.runCount > 0
                ? `Last take ${history.lastAccuracyPct ?? '—'}% · Best ${
                    history.bestAccuracyPct ?? '—'
                  }% · ${history.runCount} run${history.runCount === 1 ? '' : 's'}`
                : `No coached takes yet. Record at least ${MIN_COACH_RUN_SECONDS} second of playing.`}
            </Text>
          )}

          <Text style={styles.footnote}>
            Accuracy is a practice metric from the notes we hear — only scored
            takes are added to your practice history.
          </Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    color: '#4ecdc4',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tempoChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tempoText: {
    color: '#c0c0d0',
    fontSize: 12,
    fontWeight: '700',
  },
  pieceLine: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  subLine: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12,
    lineHeight: 17,
  },
  recordBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  recordBtnActive: {
    backgroundColor: '#b52f47',
  },
  recordBtnDisabled: {
    opacity: 0.55,
  },
  recordBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  listeningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e94560',
  },
  listeningText: {
    color: '#c0c0d0',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  processingText: {
    color: '#a0a0b8',
    fontSize: 12,
    flex: 1,
  },
  errorRow: {
    marginTop: 10,
  },
  errorText: {
    color: '#e94560',
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  retryText: {
    color: '#4ecdc4',
    fontSize: 12,
    fontWeight: '700',
  },
  resultBlock: {
    marginTop: 14,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
  },
  headline: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  issueLine: {
    color: '#c0c0d0',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  scorePill: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  scorePillLabel: {
    color: '#a0a0b8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scorePillValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  historyLine: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 12,
    lineHeight: 17,
  },
  /**
   * The modern-song state's ONE honest line (v31, owner 10-01): plain text with
   * no box chrome and no button — the sheet-music card above this card is the
   * page's single purchase action.
   */
  noticeText: {
    color: '#c0c0d0',
    fontSize: 13,
    lineHeight: 19,
  },
  footnote: {
    color: '#6f6f88',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
  },
});

export default CoachPracticeCard;
