/**
 * FullScreenScore — THE ONE FULL-SCREEN SCORE WINDOW (v43 fix batch, slice 3,
 * item E). Every notation surface in the app draws its score inside a card; this
 * is the card, full bleed.
 *
 * PRESENTATION ONLY, AND THAT IS A RULE, NOT A STYLE CHOICE. The children are the
 * SAME element the surface already renders — same notation, same ink, same paper,
 * same page index — so opening and closing this window cannot change what the
 * user is looking at. It owns no score state at all (there is deliberately no
 * state in this file): a second copy of the score would be a second thing to keep
 * transposed, paged and cleaned in step with the first, and the first divergence
 * would be invisible until a user saw the wrong key in full screen.
 *
 * ANDROID BACK. The modal carries `onRequestClose`, which is what makes BACK close
 * the expander ALONE and leave the screen underneath exactly as it was
 * (services/modalBackContract.ts source-scans every `<Modal>` in src/ and fails
 * the gate without it).
 *
 * LANDSCAPE. A phone held sideways is a genuinely wide staff, which is the whole
 * point of a full-screen reading view, so the window unlocks the orientation while
 * it is open and puts back the lock it found when it closes. A failure to talk to
 * the orientation service is swallowed: reading a score must never fail because a
 * rotation could not be arranged.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useThemedStyles } from '../services/themeStore';
import { SCORE_EXPAND_CLOSE_LABEL, fullScreenScoreBox } from '../services/scoreExpand';

/**
 * THE BOX THIS WINDOW GIVES THE RENDERER, on this device. Every surface computes
 * the same number through the same call, so the modal can never be a different
 * size in two places — and the math stays in the pure module
 * (services/scoreExpand.fullScreenScoreBox), where the gate can assert it.
 */
export function useFullScreenScoreBox(): number {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  return fullScreenScoreBox({
    windowHeight: window.height,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
}

export interface FullScreenScoreProps {
  /** Whether the window is open. The surface owns this (it also owns the renderer it shows). */
  visible: boolean;
  /** Close it. Called by the ✕ and by Android BACK. */
  onClose: () => void;
  /** The work's name, for the header. */
  title?: string | null;
  /** The derived second line ("Transposed · Am → Bm"), or null for no chip. */
  subtitle?: string | null;
  /** THE SURFACE'S OWN RENDERER ELEMENT — handed in, never rebuilt here. */
  children?: React.ReactNode;
}

export const FullScreenScore: React.FC<FullScreenScoreProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  children,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  /** The orientation lock that was in force before this window opened. */
  const priorLock = useRef<ScreenOrientation.OrientationLock | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const allowLandscape = async (): Promise<void> => {
      try {
        const lock = await ScreenOrientation.getOrientationLockAsync();
        if (!cancelled) priorLock.current = lock;
        await ScreenOrientation.unlockAsync();
      } catch {
        // No orientation service on this platform — the window still works.
      }
    };
    void allowLandscape();
    return () => {
      cancelled = true;
      const restore = async (): Promise<void> => {
        try {
          const lock = priorLock.current;
          if (lock === null) await ScreenOrientation.unlockAsync();
          else await ScreenOrientation.lockAsync(lock);
        } catch {
          // Same: best effort, and never a reason to block closing.
        }
      };
      void restore();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {title ?? 'Score'}
            </Text>
            {subtitle ? (
              <View style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={SCORE_EXPAND_CLOSE_LABEL}
            testID="full-screen-score-close"
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>
        </View>
        {/* THE BODY IS THE SCORE'S OWN BOX: flex 1, so the renderer the surface
            handed in lays out in the whole remaining rectangle. */}
        <View style={styles.body}>{children}</View>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#12122b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  headerText: { flex: 1, paddingRight: 12 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#0f3460',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  chipText: { color: '#cfe9ff', fontSize: 11, fontWeight: '700' },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  closeButtonPressed: { backgroundColor: '#16213e' },
  body: { flex: 1 },
});
