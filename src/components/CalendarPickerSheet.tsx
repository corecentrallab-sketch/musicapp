/**
 * CalendarPickerSheet — WHICH CALENDAR? (owner-approved 10-10, backlog b033ab48)
 *
 * Shown the first time the user turns "Add it to my calendar" on, and afterwards
 * only from `[ Change ]`. It lists ONLY calendars the user can add to (a read-only
 * "Holidays" calendar is omitted rather than offered and then failing on write),
 * pre-selects the device's own default where it is in that list, and says in one
 * line exactly what NoteSnap will and will not do with the calendar.
 *
 * Copy comes from the pure model (services/calendarReminder.ts) so the screen and
 * the tier1 gate read the same strings, and the modal carries `onRequestClose`
 * (the Android BACK contract — services/modalBackContract.ts). It builds no URL,
 * calls no network and knows nothing about billing: this is a local choice.
 */
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  CALENDAR_PICKER_CTA,
  CALENDAR_PICKER_HINT,
  CALENDAR_PICKER_TITLE,
  calendarChoiceLabel,
  type WritableCalendar,
} from '../services/calendarReminder';

export interface CalendarPickerSheetProps {
  visible: boolean;
  /** Writable calendars only — the seam filters out the read-only ones. */
  calendars: WritableCalendar[];
  /** The device default, pre-selected when it appears in the list. */
  defaultCalendarId?: string | null;
  /** The calendar in use right now, if any. */
  selectedCalendarId?: string | null;
  onClose: () => void;
  onSelect: (calendarId: string) => void;
}

export const CalendarPickerSheet: React.FC<CalendarPickerSheetProps> = ({
  visible,
  calendars,
  defaultCalendarId,
  selectedCalendarId,
  onClose,
  onSelect,
}) => {
  const initial =
    selectedCalendarId ?? (defaultCalendarId && defaultCalendarId.length > 0 ? defaultCalendarId : null);
  const [picked, setPicked] = useState<string | null>(initial);
  const list = Array.isArray(calendars) ? calendars : [];
  const effective = picked ?? initial ?? (list[0]?.id ?? null);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.back}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{CALENDAR_PICKER_TITLE}</Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {list.map((calendar) => {
              const isPicked = calendar.id === effective;
              return (
                <TouchableOpacity
                  key={calendar.id}
                  style={[styles.row, isPicked && styles.rowPicked]}
                  onPress={() => setPicked(calendar.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isPicked }}
                >
                  <Text style={styles.radio}>{isPicked ? '●' : '○'}</Text>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{calendarChoiceLabel(calendar)}</Text>
                    {defaultCalendarId === calendar.id && (
                      <Text style={styles.rowHint}>Your default calendar</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            {list.length === 0 && (
              <Text style={styles.emptyLine}>
                No calendar on this phone can be added to right now.
              </Text>
            )}
          </ScrollView>

          <Text style={styles.hint}>{CALENDAR_PICKER_HINT}</Text>

          <TouchableOpacity
            style={[styles.cta, effective === null && styles.ctaDisabled]}
            disabled={effective === null}
            onPress={() => {
              if (effective !== null) onSelect(effective);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{CALENDAR_PICKER_CTA}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  back: { color: '#a0a0b8', fontSize: 14, fontWeight: '600', marginRight: 12 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginBottom: 8,
  },
  rowPicked: { borderColor: '#e94560' },
  radio: { color: '#e94560', fontSize: 16, marginRight: 10 },
  rowCopy: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowHint: { color: '#a0a0b8', fontSize: 12, marginTop: 2 },
  emptyLine: { color: '#a0a0b8', fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  hint: { color: '#a0a0b8', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  cta: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
