/**
 * PracticeVideoSendToSheet.tsx — THE PRACTICE-VIDEO EXPORT SURFACE (owner GO
 * 10-10, decision 5; backlog a49fbe2d; design brief §4.4).
 *
 * THE SAME ROUTE AS v37's SEND-TO, WITH THE VIDEO ADDED. Three pieces, one
 * surface:
 *
 *   • PRACTICE VIDEO — the filmed .mp4, already a documents file, handed to the
 *     platform's share sheet (services/videoSendDevice.ts).
 *   • TAKE AS PDF — the EXISTING v37 export (`exportTakePdfFromTake`): one PDF
 *     engine, not a second one, so the page the user prints is the notation the
 *     app already draws.
 *   • TAKE AS MIDI — the editor's own export, handed IN as `onSendMidi` (one MIDI
 *     path, never a second).
 *   • PLAIN SUMMARY — text, the honest fallback when the platform cannot attach a
 *     file.
 *
 * EVERY LINE ON THE SURFACE IS THE TRUTH ABOUT STAGE 1 (decision 5): the pair
 * line says the video has no notes drawn on it yet, and `SEND_TO_HONESTY` — reused
 * verbatim — says everything leaves through the user's own device.
 *
 * NO DEAD AREAS: the destinations come from `videoSendActions`, which returns
 * nothing for a record with neither a video nor a take, so this sheet is only ever
 * opened where something can really be sent.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  VIDEO_SEND_BACK_CTA,
  VIDEO_SEND_BUSY_LABEL,
  VIDEO_SEND_EMPTY_LINE,
  VIDEO_SEND_PAIR_LINE,
  VIDEO_SEND_TITLE,
  videoSendActions,
  type VideoSendKind,
  type VideoSendRecord,
} from '../services/videoSendTo';
import { SEND_TO_HONESTY } from '../services/takeSendTo';
import { MIDI_EXPORT_BUSY_LABEL } from '../services/midiExport';
import { exportTakePdfFromTake } from '../services/takeSendDevice';
import { sendPracticeSummary, sendPracticeVideo } from '../services/videoSendDevice';
import type { TakePdfChord } from '../services/takeNotationPdf';

export interface PracticeVideoSendToSheetProps {
  /** Whether the sheet is open (the playback surface owns this). */
  visible: boolean;
  /** The filmed take and its video ref — the pair this sheet exports. */
  record: VideoSendRecord;
  /** The take's suggested chords, printed above the staff in the PDF. */
  chords?: ReadonlyArray<TakePdfChord> | null;
  /** A title for the file name and the share dialog. */
  title?: string | null;
  /** The editor's EXISTING MIDI export (one path, not two). */
  onSendMidi: () => void | Promise<void>;
  /** True while that export is encoding — the surface must not double-fire it. */
  midiBusy: boolean;
  /** The export's own outcome sentence ('' until it has run). */
  midiLine: string | null;
  onClose: () => void;
}

export const PracticeVideoSendToSheet: React.FC<PracticeVideoSendToSheetProps> = ({
  visible,
  record,
  chords,
  title,
  onSendMidi,
  midiBusy,
  midiLine,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const actions = useMemo(() => videoSendActions(record), [record]);
  const [busy, setBusy] = useState<VideoSendKind | null>(null);
  /** The outcome sentence per destination — a swallowed result is a dead button. */
  const [lines, setLines] = useState<Partial<Record<VideoSendKind, string>>>({});

  const run = useCallback(
    async (kind: VideoSendKind) => {
      if (busy) return;
      if (kind === 'midi') {
        // The editor's own export; its outcome line comes back through `midiLine`.
        await onSendMidi();
        return;
      }
      setBusy(kind);
      try {
        const outcome =
          kind === 'video'
            ? await sendPracticeVideo(record, { title })
            : kind === 'pdf'
              ? await exportTakePdfFromTake(record.take, { title, chords })
              : await sendPracticeSummary(record, { title });
        setLines((current) => ({ ...current, [kind]: outcome.message }));
      } finally {
        setBusy(null);
      }
    },
    [busy, chords, onSendMidi, record, title],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={VIDEO_SEND_BACK_CTA}
          >
            <Text style={styles.backText}>{VIDEO_SEND_BACK_CTA}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{VIDEO_SEND_TITLE}</Text>
        </View>

        <ScrollView style={styles.page} contentContainerStyle={styles.body}>
          <Text style={styles.pairLine}>{VIDEO_SEND_PAIR_LINE}</Text>
          <Text style={styles.honest}>{SEND_TO_HONESTY}</Text>

          {actions.length === 0 ? (
            <Text style={styles.honest}>{VIDEO_SEND_EMPTY_LINE}</Text>
          ) : (
            actions.map((action) => {
              const isBusy = action.kind === 'midi' ? midiBusy : busy === action.kind;
              const line =
                action.kind === 'midi'
                  ? (midiLine ?? lines.midi ?? null)
                  : (lines[action.kind] ?? null);
              return (
                <View key={action.kind} style={styles.actionBlock}>
                  <TouchableOpacity
                    style={[styles.actionBtn, isBusy && styles.actionBtnOff]}
                    onPress={() => void run(action.kind)}
                    disabled={Boolean(isBusy)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    accessibilityHint={action.hint}
                  >
                    <Text style={styles.actionBtnText}>
                      {isBusy
                        ? action.kind === 'midi'
                          ? MIDI_EXPORT_BUSY_LABEL
                          : VIDEO_SEND_BUSY_LABEL
                        : action.label}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>{action.hint}</Text>
                  {line ? <Text style={styles.line}>{line}</Text> : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  page: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 32 },
  pairLine: { color: '#cfe4ff', fontSize: 13, lineHeight: 19, marginTop: 10 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 10 },
  actionBlock: { marginTop: 18 },
  actionBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnOff: { opacity: 0.5 },
  actionBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  hint: { color: '#6f7590', fontSize: 12, lineHeight: 17, marginTop: 8 },
  line: { color: '#4ecdc4', fontSize: 12, lineHeight: 17, marginTop: 8 },
});
