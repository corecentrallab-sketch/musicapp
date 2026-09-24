/**
 * BadgeToast — shows a celebratory toast when an achievement/medal is earned.
 *
 * NON-BLOCKING BY CONTRACT (medals design rule: an unlock never interrupts play
 * and is never a modal — see src/services/medals.ts `medalToastNeverBlocks`):
 * this component mounts no Modal, auto-dismisses on a timer, and stays
 * `pointerEvents="none"` unless it was given an `onAction` — only then may the
 * action button receive a tap. Without an action the toast cannot swallow a tap
 * meant for the screen underneath, so play continues untouched.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Badge } from '../types';

interface BadgeToastProps {
  badge: Badge;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
  /** Small eyebrow label above the name (defaults to the achievement wording). */
  label?: string;
  /** Optional action (the medals layer passes "Share" → the ShareCard). */
  onAction?: () => void;
  actionLabel?: string;
}

export const BadgeToast: React.FC<BadgeToastProps> = ({
  badge,
  visible,
  onDismiss,
  duration = 4000,
  label,
  onAction,
  actionLabel,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -20,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => onDismiss());
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, badge.id]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity, transform: [{ translateY }] }]}
      /* The toast only ever accepts a tap when it HAS an action (the medal
         "Share" button). Otherwise it must let every tap through to the screen
         underneath — an unlock never blocks play. */
      pointerEvents={onAction ? 'box-none' : 'none'}
    >
      <Text style={styles.emoji}>{badge.emoji}</Text>
      <Text style={styles.label}>{label ?? 'Achievement Unlocked!'}</Text>
      <Text style={styles.name}>{badge.name}</Text>
      <Text style={styles.desc}>{badge.description}</Text>
      {onAction ? (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? 'Share'}
        >
          <Text style={styles.actionBtnText}>{actionLabel ?? 'Share'}</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#16213e',
    borderWidth: 2,
    borderColor: '#e94560',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#e94560',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e94560',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  desc: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
  },
  // The optional action (medals: "Share") — the only tappable part of the toast.
  actionBtn: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4ecdc4',
    minHeight: 40,
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
  },
});
