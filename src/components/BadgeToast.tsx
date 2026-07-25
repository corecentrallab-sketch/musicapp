/**
 * BadgeToast — shows a celebratory toast when an achievement is earned.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import type { Badge } from '../types';

interface BadgeToastProps {
  badge: Badge;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

export const BadgeToast: React.FC<BadgeToastProps> = ({
  badge,
  visible,
  onDismiss,
  duration = 4000,
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
      pointerEvents="none"
    >
      <Text style={styles.emoji}>{badge.emoji}</Text>
      <Text style={styles.label}>Achievement Unlocked!</Text>
      <Text style={styles.name}>{badge.name}</Text>
      <Text style={styles.desc}>{badge.description}</Text>
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
});
