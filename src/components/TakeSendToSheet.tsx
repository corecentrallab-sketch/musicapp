/**
 * TakeSendToSheet.tsx — THE "SEND TO…" SURFACE ON CORRECT-YOUR-TAKE (v37 item 7,
 * backlog baa39e66).
 *
 * THE OWNER'S ASK. The corrected-take page gets a "Send to…" action so the piece
 * can leave the device for future use: (a) a PDF of the take, (b) the take to the
 * user's own email, (c) the MIDI export that already exists.
 *
 * HOW EACH ONE LEAVES — the SYSTEM SHARE SHEET, always:
 *   • PDF — built by the pure notation engine (services/takeNotationPdf.ts),
 *     parsed back by its own structure check, written to a derived file and handed
 *     to the OS (services/takeSendDevice.ts).
 *   • EMAIL — the same route: the platform share sheet, with the PDF when the
 *     device can attach a file and the plain text summary when it cannot. The user
 *     picks their mail app there. NOTHING is emailed from our side, no server is
 *     called, and no inbox of ours exists (takeSummaryText + sendToPlan are the one
 *     place that decides).
 *   • MIDI — NOT reimplemented here. The editor's own export (`shareTakeAsMidi`,
 *     v37 item 6) is handed IN as `onSendMidi`, so there is exactly one MIDI path
 *     on this page and this surface cannot drift from it.
 *
 * NO DEAD AREAS (release gate, owner 09-28): the destinations come from the pure
 * model (`sendToActions`), which returns NOTHING for a take with no notes — so the
 * button that opens this sheet is itself offered only when there is something to
 * send, and every outcome has an honest line under the button that produced it.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  SEND_TO_HONESTY,
  SEND_TO_TITLE,
  sendToActions,
  type SendToKind,
} from '../services/takeSendTo';
import {
  MIDI_EXPORT_BUSY_LABEL,
  type SavedCaptureTake,
} from '../services/midiExport';
import { exportTakePdfFromTake, sendTakeToEmail } from '../services/takeSendDevice';
import type { TakePdfChord } from '../services/takeNotationPdf';

/** The way back to the take. */
export const TAKE_SEND_BACK_CTA = '← Back to my take';
/** Shown while a file is being built or a share sheet is opening. */
export const TAKE_SEND_BUSY_LABEL = 'Preparing…';
/** Shown for a destination that cannot be used right now. */
export const TAKE_SEND_EMPTY_LINE = 'This take has no notes to send yet.';

export interface TakeSendToSheetProps {
  /** Whether the sheet is open (the editor owns this). */
  visible: boolean;
  /** The corrected take (the one worth sending — it is what the user fixed). */
  take: SavedCaptureTake | null | undefined;
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

export const TakeSendToSheet: React.FC<TakeSendToSheetProps> = ({
  visible,
  take,
  chords,
  title,
  onSendMidi,
  midiBusy,
  midiLine,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const actions = useMemo(() => sendToActions(take), [take]);
  /** Which destination is working right now (null = none). */
  const [busy, setBusy] = useState<SendToKind | null>(null);
  /** The outcome sentence per destination — a swallowed result is a dead button. */
  const [lines, setLines] = useState<Partial<Record<SendToKind, string>>>({});

  const run = useCallback(
    async (kind: SendToKind) => {
      if (busy) return;
      if (kind === 'midi') {
        // The editor's own export; its outcome line comes back through `midiLine`.
        await onSendMidi();
        return;
      }
      setBusy(kind);
      try {
        const outcome =
          kind === 'pdf'
            ? await exportTakePdfFromTake(take, { title, chords })
            : await sendTakeToEmail(take, { title, chords });
        setLines((current) => ({ ...current, [kind]: outcome.message }));
      } finally {
        setBusy(null);
      }
    },
    [busy, chords, onSendMidi, take, title],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={TAKE_SEND_BACK_CTA}
          >
            <Text style={styles.backText}>{TAKE_SEND_BACK_CTA}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{SEND_TO_TITLE}</Text>
        </View>

        <ScrollView style={styles.page} contentContainerStyle={styles.body}>
          <Text style={styles.honest}>{SEND_TO_HONESTY}</Text>

          {actions.length === 0 ? (
            <Text style={styles.honest}>{TAKE_SEND_EMPTY_LINE}</Text>
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
                      {isBusy ? TAKE_SEND_BUSY_LABEL : action.label}
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
