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
 * point of a full-screen reading view, so the window LOCKS to a both-ways lock
 * while it is open and puts back the lock it found when it closes
 * (`services/scoreWindow.scoreWindowOrientationPlan`). It does not UNLOCK: an
 * unlock hands the decision back to the device's auto-rotate setting, which is off
 * on a phone that has been locked upright — and App.tsx locks phones to portrait
 * itself at startup — so "unlock" was a no-op on the owner's handset (v65 F2). A
 * failure to talk to the orientation service is swallowed: reading a score must
 * never fail because a rotation could not be arranged.
 *
 * AND IT TELLS THE RENDERER WHERE IT IS (v66 F1/F3). The element handed in was
 * built for a card and carries a fixed-width reader drawing, so the window provides
 * `ScoreWindowContext` and `AbcScoreView` lays the score out for this box instead.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useThemedStyles } from '../services/themeStore';
import { SCORE_EXPAND_CLOSE_LABEL, fullScreenScoreBox } from '../services/scoreExpand';
import { scoreWindowOrientationPlan } from '../services/scoreWindow';
import { ScoreWindowContext } from './scoreWindowContext';

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
  const priorLock = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    /**
     * ── v65 F2: LOCK BOTH WAYS, DO NOT UNLOCK ─────────────────────────────────
     * The old code read the previous lock and then called `unlockAsync()` inside
     * ONE `try`. Both halves were wrong. The unlock hands the orientation decision
     * to the device's auto-rotate setting, which is OFF on a phone that has been
     * locked upright (and this app locks phones to portrait at startup, App.tsx),
     * so turning the phone still changed nothing; and because the read and the
     * unlock shared a `try`, an unreadable previous lock silently cancelled the
     * unlock as well. The READ now has its own `try` — a failed read is just
     * "nothing to restore" — and the window takes a real both-ways lock
     * (`scoreWindowOrientationPlan`).
     */
    const takeWindowLock = async (): Promise<void> => {
      let prior: string | null = null;
      try {
        // Read as `unknown`: the orientation service is allowed to answer junk, and an
        // `OrientationLock` is a string enum — narrowing it directly is a type error.
        const lock: unknown = await ScreenOrientation.getOrientationLockAsync();
        prior = typeof lock === 'string' && lock.length > 0 ? lock : null;
      } catch {
        // Nothing readable to restore — the honest answer is "nothing claimed".
        prior = null;
      }
      const plan = scoreWindowOrientationPlan(prior);
      if (!cancelled) priorLock.current = plan.close;
      try {
        await ScreenOrientation.lockAsync(
          plan.open as unknown as ScreenOrientation.OrientationLock,
        );
      } catch {
        // No orientation service on this platform — the window still works.
      }
    };
    void takeWindowLock();
    return () => {
      cancelled = true;
      const restore = async (): Promise<void> => {
        try {
          const lock = priorLock.current;
          if (lock === null) await ScreenOrientation.unlockAsync();
          else {
            await ScreenOrientation.lockAsync(
              lock as unknown as ScreenOrientation.OrientationLock,
            );
          }
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
      /* ── D37: LANDSCAPE ────────────────────────────────────────────────────
         A reading window is the one surface in the app that WANTS the phone
         sideways (the whole point of a wide staff). A React Native modal does
         not follow the device unless it is told which orientations it may be
         presented in, so it stayed in the orientation it was opened in and a
         rotated phone got a window drawn for the old one. */
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            {/* ── D37: NO CLIPPED HEADER TEXT ─────────────────────────────────
                Both of these were pinned to ONE line. A work's name plus the
                "Transposed · Am → Bm" chip is more than one line on a phone in
                landscape, so the title was ellipsised and the chip cut off —
                text the user cannot read is text the window lost. They wrap
                now, and the header grows to fit them. */}
            <Text style={styles.title} numberOfLines={2}>
              {title ?? 'Score'}
            </Text>
            {subtitle ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{subtitle}</Text>
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
            handed in lays out in the whole remaining rectangle. It is also where
            the window says WHO it is: the element handed in was built for a card
            and carries a fixed-width reader drawing, so `AbcScoreView` lays the
            score out for this box instead (vc66 F1/F3). */}
        <ScoreWindowContext.Provider value={visible}>
          <View style={styles.body}>{children}</View>
        </ScoreWindowContext.Provider>
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
