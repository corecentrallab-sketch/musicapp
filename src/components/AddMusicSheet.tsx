/**
 * AddMusicSheet.tsx — DESIGNER SPEC §2: THE "+ ADD MUSIC" BOTTOM SHEET (v43).
 *
 * The ONE modal surface behind the Library header's `+`. Full width, top radius 28,
 * SHEET fill, a scrim over the header/search/list that blocks them, and three
 * equal-weight rows that open flows the app already has (camera scan, the Library's
 * file import, the catalog search). No close ✕ — there are three ways out and all
 * three work: the grabber swipe, the scrim tap and the Cancel row.
 *
 * EVERY colour here comes from the role map (services/addMusicSheet.ts →
 * `addMusicPalette`) which resolves the spec's roles against services/theme.ts, so
 * this file carries no hex and no inline rgb() — the light theme needs only the
 * token swap. The scrim's dim is the spec's own `ADD_MUSIC_SCRIM` constant, imported
 * rather than re-typed.
 *
 * The model, its geometry and the guards over this file live in
 * services/addMusicSheet.ts; scripts/uxr-v43-add-music.test.ts reads this source.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeMode } from '../services/themeStore';
import {
  ADD_MUSIC_CANCEL,
  ADD_MUSIC_ROWS,
  ADD_MUSIC_SCRIM,
  ADD_MUSIC_SPEC,
  ADD_MUSIC_SUBTITLE,
  ADD_MUSIC_SWIPE_DISMISS_DP,
  ADD_MUSIC_SWIPE_VELOCITY,
  ADD_MUSIC_TITLE,
  addMusicPalette,
  type AddMusicRowId,
} from '../services/addMusicSheet';

export interface AddMusicSheetProps {
  /** Whether the sheet is open — the Library owns this. */
  visible: boolean;
  /** Row 1 → the camera/scan flow. */
  onScanLiveScore: () => void;
  /** Row 2 → the Library's existing file import. */
  onUploadFile: () => void;
  /** Row 3 → the existing catalog search (browse state). */
  onBrowseOnlineLibrary: () => void;
  /** Grabber swipe, scrim tap and the Cancel row all come here. */
  onClose: () => void;
}

export const AddMusicSheet: React.FC<AddMusicSheetProps> = ({
  visible,
  onScanLiveScore,
  onUploadFile,
  onBrowseOnlineLibrary,
  onClose,
}) => {
  const { tokens } = useThemeMode();
  const palette = addMusicPalette(tokens);
  const insets = useSafeAreaInsets();
  /** How far the sheet has been dragged down (0 = in place). */
  const drag = useRef(new Animated.Value(0)).current;

  const settle = useCallback(() => {
    Animated.spring(drag, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  }, [drag]);

  /**
   * DISMISSAL 1 of 3 — the grabber swipe. A downward drag of the grip: past the
   * dismiss distance (or a downward fling) the sheet closes; anything shorter
   * springs back so the gesture never half-closes the sheet.
   */
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dy > 0) drag.setValue(gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy >= ADD_MUSIC_SWIPE_DISMISS_DP || gesture.vy > ADD_MUSIC_SWIPE_VELOCITY) {
            onClose();
          }
          settle();
        },
        onPanResponderTerminate: () => settle(),
      }),
    [drag, onClose, settle]
  );

  const rowHandlers = useMemo<Record<AddMusicRowId, () => void>>(
    () => ({
      scan: onScanLiveScore,
      upload: onUploadFile,
      browse: onBrowseOnlineLibrary,
    }),
    [onBrowseOnlineLibrary, onScanLiveScore, onUploadFile]
  );

  const runRow = useCallback(
    (id: AddMusicRowId) => {
      // The sheet closes first: each row opens its OWN flow, never a sheet on top
      // of a flow (a scan screen behind an open sheet would be unreachable).
      onClose();
      rowHandlers[id]();
    },
    [onClose, rowHandlers]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* DISMISSAL 2 of 3 — the scrim. It covers the header, the search field and
            the list, and it BLOCKS them: nothing behind it can be tapped. */}
        <Pressable
          style={[styles.scrim, { backgroundColor: ADD_MUSIC_SCRIM }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close add music"
          testID="add-music-scrim"
        />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: palette.SHEET, paddingBottom: 12 + insets.bottom },
            { transform: [{ translateY: drag }] },
          ]}
        >
          {/* The grabber: 40 × 4 in LINE2, and the drag target for dismissal 1. */}
          <View
            style={styles.grabberHit}
            {...swipe.panHandlers}
            accessibilityLabel="Drag down to close"
          >
            <View style={[styles.grabber, { backgroundColor: palette.LINE2 }]} />
          </View>

          <Text style={[styles.sheetTitle, { color: palette.TXT }]}>{ADD_MUSIC_TITLE}</Text>
          <Text style={[styles.sheetSubtitle, { color: palette.SUB }]}>{ADD_MUSIC_SUBTITLE}</Text>

          <View style={styles.rows}>
            {ADD_MUSIC_ROWS.map((row, index) => (
              <View key={row.id}>
                {index > 0 ? (
                  <View style={[styles.rowHairline, { backgroundColor: palette.LINE }]} />
                ) : null}
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => runRow(row.id)}
                  accessibilityRole="button"
                  accessibilityLabel={row.label}
                  accessibilityHint={row.subtitle}
                  testID={`add-music-row-${row.id}`}
                >
                  <View style={[styles.rowTile, { backgroundColor: palette.SOFTFILL }]}>
                    <Ionicons name={row.icon} size={20} color={palette.HUM} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowLabel, { color: palette.TXT }]} numberOfLines={1}>
                      {row.label}
                    </Text>
                    <Text style={[styles.rowSub, { color: palette.SUB }]} numberOfLines={1}>
                      {row.subtitle}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={ADD_MUSIC_SPEC.chevronSize}
                    color={palette.SUB}
                    style={styles.rowChevron}
                  />
                </Pressable>
              </View>
            ))}
          </View>

          {/* DISMISSAL 3 of 3 — the Cancel row. Always present, never conditional. */}
          <View style={[styles.cancelHairline, { backgroundColor: palette.LINE }]} />
          <Pressable
            style={({ pressed }) => [styles.cancelRow, pressed && styles.rowPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={ADD_MUSIC_CANCEL}
            testID="add-music-cancel"
          >
            <Text style={[styles.cancelText, { color: palette.HUM }]}>{ADD_MUSIC_CANCEL}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 0,
  },
  /* +12 grabber @+12, header @+30, subtitle @+54, first row @+102 (spec §2). */
  grabberHit: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', paddingLeft: 20, marginTop: 12 },
  sheetSubtitle: { fontSize: 12, lineHeight: 16, paddingLeft: 20, marginTop: 2 },
  rows: { marginTop: 26 },
  rowHairline: { height: StyleSheet.hairlineWidth, marginLeft: 88, marginRight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingLeft: 20,
    paddingRight: 20,
  },
  rowPressed: { opacity: 0.6 },
  rowTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { marginLeft: 12, flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 4 },
  rowChevron: { marginLeft: 8 },
  cancelHairline: { height: StyleSheet.hairlineWidth, marginLeft: 20, marginRight: 20 },
  cancelRow: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700' },
});
