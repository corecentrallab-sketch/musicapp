/**
 * MelodyCaptureWindow — the FULL-SCREEN melody-capture surface (owner 10-02,
 * rank-2 creator's tool; spec §2 "the recording experience (live) + the result
 * window").
 *
 * WHAT IT IS. The whole screen the user lands on the moment they choose to hum,
 * whistle or sing: a recording badge, a real-time VU meter fed by the recorder's
 * own metering samples, the elapsed time, a live note strip, and the stop
 * control. When the take ends the SAME window becomes the result: the note-by-
 * note sequence (as hummed, and auto-cleaned to the detected key), the detected
 * key, the SUGGESTED chords, and the actions — save the melody, write it as
 * MIDI, record another.
 *
 * WHY IT IS ITS OWN COMPONENT. The window owns no recorder, no network and no
 * storage: the flow that hosts it (src/screens/HumSearchScreen.tsx) owns the
 * take, the hum match and the persistence, and hands this component the numbers
 * to draw. That is what lets the same window render a re-opened melody from
 * History and keeps every rule about a take in one place.
 *
 * THE HONESTY RULES THE SURFACE RENDERS (they are decided in
 * src/services/melodyCapture.ts and asserted by scripts/melodyCapture.test.ts):
 *   • a cleaned sequence is ALWAYS labelled "Auto-cleaned …", said in words
 *     ("3 of 7 notes nudged onto the scale") — never a studio-transcription
 *     claim, and the as-hummed sequence is always shown beside it;
 *   • chords are ALWAYS labelled "Suggested", with the one-line reason a melody
 *     carries no harmony — and with no detected key there are NO chords, only
 *     the honest line saying why;
 *   • a take with nothing in it (or one we could not read) is its own state with
 *     its own honest copy, and the save/export actions are DISABLED WITH THE
 *     REASON — never a button that could only fail;
 *   • the live note strip says plainly when this build cannot show notes while
 *     the user sings (the take is read note by note when it ends). It never
 *     implies notes are appearing when they are not;
 *   • NOTHING here is about a matched song. Every note, key and chord on this
 *     window belongs to the USER'S OWN take. A PD match adds identity beside it
 *     (through the shared result surface); a modern-song match never renders
 *     generated notation for the song (standing rule).
 */
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  CAPTURE_WINDOW_TITLE,
  CHORDS_HONESTY_LINE,
  CLEANED_SEQUENCE_LABEL,
  LIVE_BADGE_LABEL,
  RAW_SEQUENCE_LABEL,
  SAVED_MELODY_CTA,
  SAVE_MELODY_CTA,
  SAVE_MELODY_HINT,
  STOP_CTA_LABEL,
  SUGGESTED_CHORDS_LABEL,
  buildLiveTrace,
  type MelodyAnalysis,
  type MelodyWindowCopy,
} from '../services/melodyCapture';
import {
  MIDI_EXPORT_BUSY_LABEL,
  MIDI_EXPORT_HINT,
  MIDI_EXPORT_LABEL,
} from '../services/midiExport';

export type MelodyWindowPhase = 'recording' | 'analysing' | 'review';

export interface MelodyCaptureWindowProps {
  /** Which face of the window to show. */
  phase: MelodyWindowPhase;
  /** Live dBFS samples from the recorder (the meter's real source). */
  levels: number[];
  /** How long the take has been recording, in milliseconds. */
  elapsedMs: number;
  /** Note names a live pitch source produced (none in this build — see below). */
  liveNotes?: string[];
  /** Whether this build has a live pitch source at all. */
  liveSourceReady?: boolean;
  /** The analysed take (null until one has been read). */
  analysis: MelodyAnalysis | null;
  /** The bonus match line ("That's Für Elise — it's in our library"). */
  matchLine?: string | null;
  /** Open the matched piece's own page (the PD bonus). */
  onOpenMatch?: () => void;
  onStop: () => void;
  onClose: () => void;
  onRecordAgain: () => void;
  onSave: () => void;
  /** True once the take is in History. */
  saved: boolean;
  saveNote?: string | null;
  onExportMidi: () => void;
  exporting: boolean;
  exportNote?: string | null;
  exportKeyLine?: string | null;
  /** Copy owned by the hosting flow (the mode-naming lines it must render). */
  copy: MelodyWindowCopy;
  /** The flow's own notices (the no-match card, the error card). */
  children?: React.ReactNode;
}

/** Seconds → "0:07". */
function clockLabel(elapsedSec: number): string {
  const total = Math.max(0, Math.floor(elapsedSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const MelodyCaptureWindow: React.FC<MelodyCaptureWindowProps> = ({
  phase,
  levels,
  elapsedMs,
  liveNotes,
  liveSourceReady,
  analysis,
  matchLine,
  onOpenMatch,
  onStop,
  onClose,
  onRecordAgain,
  onSave,
  saved,
  saveNote,
  onExportMidi,
  exporting,
  exportNote,
  exportKeyLine,
  copy: text,
  children,
}) => {
  const trace = buildLiveTrace({ levels, elapsedMs, liveNotes, liveSourceReady });
  const newestDb = levels.length > 0 ? levels[levels.length - 1] : null;
  const analysing = phase === 'analysing';
  const recording = phase === 'recording';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backText}>{recording ? '✕ Cancel' : '← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{CAPTURE_WINDOW_TITLE}</Text>
      </View>

      {recording ? (
        <View style={styles.liveStage}>
          <View style={styles.liveRow}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>{LIVE_BADGE_LABEL}</Text>
            </View>
            <Text style={styles.clock}>{clockLabel(trace.elapsedSec)}</Text>
          </View>

          <Text style={styles.headline}>{text.headline}</Text>
          <Text style={styles.intro}>{text.intro}</Text>

          {/* THE VU METER: real metering samples from the recorder, newest at the
              right. Nothing here is animated on a timer of its own — every bar is
              a dB reading the microphone actually produced. */}
          <View style={styles.meterBox}>
            <View style={styles.meterRow}>
              {trace.bars.map((bar, index) => (
                <View
                  key={index}
                  style={[
                    styles.meterBar,
                    {
                      height: 8 + Math.round(bar * 76),
                      opacity: 0.35 + 0.65 * bar,
                      backgroundColor: bar >= 0.85 ? '#e94560' : '#4ecdc4',
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.meterReadout}>
              {newestDb === null ? '—' : `${Math.round(newestDb)} dB`}
            </Text>
          </View>

          {/* THE LIVE NOTE STRIP. It renders the notes a live pitch source has
              supplied; when this build has no live source it says so in words
              (NO_LIVE_NOTES_LINE) rather than implying notes are on their way. */}
          <View style={styles.stripBox}>
            <Text style={styles.stripLabel}>Live notes</Text>
            <Text style={styles.stripText}>{trace.statusLine}</Text>
            {!trace.liveNotesUnavailable && trace.liveNotes.length > 0 && (
              <Text style={styles.stripChip}>heard so far</Text>
            )}
          </View>

          <Text style={styles.recordingLine}>{text.recordingLine}</Text>
          <Text style={styles.hint}>{text.hint}</Text>

          <TouchableOpacity style={styles.stopBtn} onPress={onStop} activeOpacity={0.8}>
            <Text style={styles.stopBtnText}>{STOP_CTA_LABEL}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.reviewStage}>
          {analysing && (
            <View style={styles.analysingCard}>
              <ActivityIndicator size="large" color="#e94560" />
              <Text style={styles.analysingText}>{text.analysingLine}</Text>
              <Text style={styles.analysingSub}>{text.analysingSubline}</Text>
            </View>
          )}

          {!analysing && analysis && (
            <>
              {analysis.state !== 'ready' && (
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>{analysis.stateTitle}</Text>
                  <Text style={styles.stateLine}>{analysis.stateLine}</Text>
                </View>
              )}

              {analysis.state === 'ready' && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Your notes</Text>
                  <Text style={styles.sectionSub}>{RAW_SEQUENCE_LABEL}</Text>
                  <Text style={styles.sequence}>{analysis.rawSequence}</Text>
                  {analysis.rawHidden > 0 && (
                    <Text style={styles.hiddenNote}>and {analysis.rawHidden} more notes</Text>
                  )}
                </View>
              )}

              {analysis.state === 'ready' && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{CLEANED_SEQUENCE_LABEL}</Text>
                  <Text style={styles.sequenceCleaned}>{analysis.cleanedSequence}</Text>
                  {analysis.cleanedHidden > 0 && (
                    <Text style={styles.hiddenNote}>and {analysis.cleanedHidden} more notes</Text>
                  )}
                  {/* THE MANDATORY LABEL — "Auto-cleaned …", never a studio claim. */}
                  <Text style={styles.cleanedLabel}>{analysis.cleanedLabel}</Text>
                </View>
              )}

              {analysis.state === 'ready' && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Key</Text>
                  <Text style={analysis.keyLine ? styles.keyLine : styles.keyNone}>
                    {analysis.keyLine ?? 'No key detected in this take'}
                  </Text>
                  {analysis.keyLine === null && (
                    <Text style={styles.sectionSub}>
                      A take this thin does not name a key — we will not guess one.
                    </Text>
                  )}
                </View>
              )}

              {analysis.state === 'ready' && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {SUGGESTED_CHORDS_LABEL} chords
                  </Text>
                  {analysis.chords.chords.length > 0 ? (
                    <>
                      <Text style={styles.chordLine}>
                        {analysis.chords.chords.map((chord) => chord.name).join('  ·  ')}
                      </Text>
                      <Text style={styles.chordDegreeLine}>
                        {analysis.chords.chords
                          .map((chord) => `${chord.degree} ${chord.name}`)
                          .join('   ')}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.chordNone}>{analysis.chords.honestLine}</Text>
                  )}
                  <Text style={styles.chordsHonesty}>
                    {SUGGESTED_CHORDS_LABEL} — {CHORDS_HONESTY_LINE}
                  </Text>
                </View>
              )}

              {matchLine ? (
                <View style={styles.matchCard}>
                  <Text style={styles.matchText}>{matchLine}</Text>
                  {onOpenMatch && (
                    <TouchableOpacity style={styles.matchBtn} onPress={onOpenMatch} activeOpacity={0.7}>
                      <Text style={styles.matchBtnText}>Open the piece</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}

              {/* THE MONEY-FREE, HONEST ACTION ROW. Save and Export are gated on
                  what the take really supports, with the reason printed under a
                  disabled control. */}
              <TouchableOpacity
                style={[styles.primaryBtn, !analysis.canSave && styles.btnDisabled]}
                onPress={onSave}
                disabled={!analysis.canSave}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>{saved ? SAVED_MELODY_CTA : SAVE_MELODY_CTA}</Text>
              </TouchableOpacity>
              {analysis.canSave ? (
                <Text style={styles.actionHint}>{SAVE_MELODY_HINT}</Text>
              ) : (
                <Text style={styles.actionReason}>{analysis.disabledReason}</Text>
              )}
              {saveNote ? <Text style={styles.actionNote}>{saveNote}</Text> : null}

              <TouchableOpacity
                style={[styles.midiBtn, !analysis.canExportMidi && styles.btnDisabled]}
                onPress={onExportMidi}
                disabled={!analysis.canExportMidi || exporting}
                activeOpacity={0.8}
              >
                <Text style={styles.midiBtnText}>
                  {exporting ? MIDI_EXPORT_BUSY_LABEL : MIDI_EXPORT_LABEL}
                </Text>
              </TouchableOpacity>
              {analysis.canExportMidi ? (
                <Text style={styles.actionHint}>{MIDI_EXPORT_HINT}</Text>
              ) : (
                <Text style={styles.actionReason}>{analysis.disabledReason}</Text>
              )}
              {exportKeyLine ? <Text style={styles.exportKey}>{exportKeyLine}</Text> : null}
              {exportNote ? <Text style={styles.actionNote}>{exportNote}</Text> : null}

              <TouchableOpacity style={styles.secondaryBtn} onPress={onRecordAgain} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>Record another melody</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quietBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.quietBtnText}>Done</Text>
              </TouchableOpacity>
            </>
          )}

          {children}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  backBtn: { marginRight: 12 },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  liveStage: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 8 },
  liveRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3a1020',
    borderColor: '#e94560',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e94560',
    marginRight: 8,
  },
  liveBadgeText: { color: '#ff8fa3', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  clock: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  headline: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  intro: {
    color: '#a0a0b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  meterBox: {
    width: '100%',
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 88,
    width: '100%',
  },
  meterBar: { width: 6, borderRadius: 3 },
  meterReadout: { color: '#4ecdc4', fontSize: 13, fontWeight: '700', marginTop: 8 },
  stripBox: {
    width: '100%',
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 14,
    marginTop: 14,
    minHeight: 76,
    justifyContent: 'center',
  },
  stripLabel: { color: '#7d7d99', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  stripText: { color: '#ffffff', fontSize: 15, fontWeight: '600', marginTop: 6, lineHeight: 21 },
  stripChip: { color: '#4ecdc4', fontSize: 12, fontWeight: '700', marginTop: 6 },
  recordingLine: { color: '#ff8fa3', fontSize: 14, fontWeight: '700', marginTop: 18 },
  hint: { color: '#a0a0b8', fontSize: 13, textAlign: 'center', marginTop: 6 },
  stopBtn: {
    marginTop: 24,
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
  },
  stopBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  reviewStage: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 60 },
  analysingCard: { alignItems: 'center', paddingTop: 40 },
  analysingText: { color: '#ffffff', fontSize: 17, fontWeight: '700', marginTop: 14 },
  analysingSub: { color: '#a0a0b8', fontSize: 13, marginTop: 6 },
  stateCard: {
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e94560',
    padding: 16,
    marginBottom: 14,
  },
  stateTitle: { color: '#ffb347', fontSize: 16, fontWeight: '700' },
  stateLine: { color: '#c0c0d0', fontSize: 13, lineHeight: 19, marginTop: 6 },
  section: {
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  sectionSub: { color: '#7d7d99', fontSize: 12, marginTop: 4 },
  sequence: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 26,
  },
  sequenceCleaned: {
    color: '#4ecdc4',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
    lineHeight: 26,
  },
  hiddenNote: { color: '#7d7d99', fontSize: 12, marginTop: 4 },
  cleanedLabel: { color: '#a0a0b8', fontSize: 12, lineHeight: 18, marginTop: 10 },
  keyLine: { color: '#ffffff', fontSize: 18, fontWeight: '700', marginTop: 8 },
  keyNone: { color: '#a0a0b8', fontSize: 15, fontWeight: '600', marginTop: 8 },
  chordLine: { color: '#4ecdc4', fontSize: 20, fontWeight: '800', marginTop: 8 },
  chordDegreeLine: { color: '#c0c0d0', fontSize: 13, marginTop: 6 },
  chordNone: { color: '#a0a0b8', fontSize: 13, lineHeight: 19, marginTop: 8 },
  chordsHonesty: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 10 },
  matchCard: {
    backgroundColor: '#0f3460',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  matchText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  matchBtn: {
    marginTop: 10,
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  matchBtnText: { color: '#4ecdc4', fontSize: 14, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  btnDisabled: { backgroundColor: '#3a3a52' },
  actionHint: { color: '#a0a0b8', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  actionReason: {
    color: '#ffb347',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 6,
  },
  actionNote: { color: '#4ecdc4', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  midiBtn: {
    backgroundColor: '#0f3460',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  midiBtnText: { color: '#4ecdc4', fontSize: 15, fontWeight: '700' },
  exportKey: { color: '#4ecdc4', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  secondaryBtn: {
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  secondaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  quietBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  quietBtnText: { color: '#a0a0b8', fontSize: 14, fontWeight: '600' },
});
