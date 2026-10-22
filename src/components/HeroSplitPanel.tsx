/**
 * HeroSplitPanel — THE equal-split hero panel (v44, owner-approved 10-22).
 *
 * ONE component with a `variant: 'listen' | 'hum'` prop, never two hand-copied
 * styles: two copies drift, and drift is exactly the failure the equal split
 * exists to remove (spec §1). Every number, hex and delta comes from
 * src/services/heroSplit.ts, which is the spec's own table in code — the tier-1
 * gate reads this file's source and fails if the fills are retyped here, if a
 * panel stops being a real button, or if the cores are shipped at full size.
 *
 * Spec: /home/team/shared/hum-button-concept/ENGINEER-NOTES.md (§1 layout,
 * §2 colours/pressed/elevation, §3 the emblem cores, §5 a11y, §8 runtime states).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ImageSourcePropType, StyleProp, ViewStyle } from 'react-native';
import {
  SPLIT_CORE_WIDTH,
  SPLIT_GEOMETRY,
  SPLIT_GLOW,
  SPLIT_PALETTES,
  SPLIT_PRESS,
  SPLIT_SHADOW,
  SPLIT_TEXT,
  SPLIT_TIP,
  gradientBands,
  panelWidthForScreen,
  rippleRadius,
  splitPanelFill,
  type SplitPuckState,
  type SplitVariant,
} from '../services/heroSplit';

/** The bundled cores are 320 px (spec §3) — the 512 px files are ~1 MB each. */
export const CORE_BUNDLE_PX = SPLIT_CORE_WIDTH;

/**
 * The supplied emblem cores, keyed by variant. Transparent outside the disc, so
 * NO background colour is set on the Image (the alpha is already keyed).
 */
const CORE_SOURCE: Record<SplitVariant, ImageSourcePropType> = {
  listen: require('../../assets/hero/split-core-listen-320.png'),
  hum: require('../../assets/hero/split-core-hum-320.png'),
};

export interface HeroSplitPanelProps {
  variant: SplitVariant;
  title: string;
  body: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** rest · listening (sonar) · recording (save-state ring) — spec §8. */
  puckState?: SplitPuckState;
  /** Draw the coach mark's three pulse rings around THIS panel (spec §7). */
  tipRings?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The listening treatment's sonar rings (emblem README §4.3/§4.4). */
const SONAR = {
  count: 3,
  /** Rose-white on the dark theme — never cyan: cyan belongs to the emblem. */
  color: '#FFD8E0',
  fromScale: 1,
  toScale: 2.6,
  durationMs: 1800,
  staggerMs: 600,
} as const;

function SonarRings({ size }: { size: number }) {
  const progress = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = progress.map((value, index) => {
      value.setValue(0);
      return Animated.loop(
        Animated.sequence([
          Animated.delay(index * SONAR.staggerMs),
          Animated.timing(value, {
            toValue: 1,
            duration: SONAR.durationMs,
            useNativeDriver: true,
          }),
          Animated.delay((SONAR.count - 1 - index) * SONAR.staggerMs),
        ]),
      );
    });
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [progress]);
  return (
    <>
      {progress.map((value, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={[
            styles.sonarRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: SONAR.color,
              opacity: value.interpolate({
                inputRange: [0, 1],
                outputRange: [0.55, 0],
              }),
              transform: [
                {
                  scale: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [SONAR.fromScale, SONAR.toScale],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </>
  );
}

/** The three coach-mark pulse rings around the hum panel ONLY (spec §7). */
function SplitTipRings() {
  const progress = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = progress.map((value, index) => {
      value.setValue(0);
      return Animated.loop(
        Animated.sequence([
          Animated.delay(index * SPLIT_TIP.staggerMs),
          Animated.timing(value, {
            toValue: 1,
            duration: SPLIT_TIP.loopMs,
            useNativeDriver: true,
          }),
          Animated.delay((SPLIT_TIP.ringOffsets.length - 1 - index) * SPLIT_TIP.staggerMs),
        ]),
      );
    });
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [progress]);
  return (
    <>
      {SPLIT_TIP.ringOffsets.map((offset, index) => (
        <Animated.View
          key={offset}
          pointerEvents="none"
          style={[
            styles.tipRing,
            {
              top: -offset,
              left: -offset,
              right: -offset,
              bottom: -offset,
              borderRadius: SPLIT_GEOMETRY.radius + offset,
              borderColor: SPLIT_TIP.ringColor,
              borderWidth: SPLIT_TIP.ringStroke,
              opacity: progress[index].interpolate({
                inputRange: [0, 1],
                outputRange: [SPLIT_TIP.ringAlphas[index], 0],
              }),
              transform: [
                {
                  scale: progress[index].interpolate({
                    inputRange: [0, 1],
                    outputRange: [SPLIT_TIP.scaleFrom, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </>
  );
}

export function HeroSplitPanel({
  variant,
  title,
  body,
  accessibilityLabel,
  onPress,
  puckState = 'rest',
  tipRings = false,
  testID,
  style,
}: HeroSplitPanelProps) {
  const { width: screenWidth } = useWindowDimensions();
  const panelWidth = Math.max(
    SPLIT_GEOMETRY.panelMinWidth,
    panelWidthForScreen(screenWidth),
  );
  const palette = SPLIT_PALETTES[variant];

  // The gradient is painted as interpolated bands: this project ships no
  // linear-gradient module, and a JS-only slice may not add a native dependency.
  const restBands = useMemo(
    () => gradientBands(palette.top, palette.bottom),
    [palette.top, palette.bottom],
  );

  const recording = puckState === 'recording';
  const saveRing = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(saveRing, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(saveRing, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, saveRing]);

  // "Glow pulls in" on press (spec §2): 168 → 96 of 255, in 90 ms, out 140 ms.
  const glow = useRef(new Animated.Value(0)).current;
  const animateGlow = (toValue: number, duration: number) => {
    Animated.timing(glow, { toValue, duration, useNativeDriver: true }).start();
  };
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [
      (SPLIT_PRESS.glowAlphaRest / 255) * 0.28,
      (SPLIT_PRESS.glowAlphaPressed / 255) * 0.28,
    ],
  });

  return (
    <View style={[styles.wrap, style]}>
      {/* The ambient brand glow sits BEHIND the fill, outside the clipping panel
          (spec §2 elevation). */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            backgroundColor: palette.glow,
            opacity: glowOpacity,
            shadowColor: palette.glow,
            shadowOpacity: SPLIT_PRESS.glowAlphaRest / 255,
            shadowRadius: SPLIT_PRESS.glowBlurRest,
            top: -SPLIT_GLOW.darkInset,
            left: -SPLIT_GLOW.darkInset,
            right: -SPLIT_GLOW.darkInset,
            bottom: -SPLIT_GLOW.darkInset,
          },
        ]}
      />
      {tipRings && <SplitTipRings />}
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={() => animateGlow(1, SPLIT_PRESS.inMs)}
        onPressOut={() => animateGlow(0, SPLIT_PRESS.outMs)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        android_ripple={{
          color: `rgba(255,255,255,${SPLIT_PRESS.rippleAlpha})`,
          borderless: false,
          radius: rippleRadius(panelWidth),
        }}
        style={({ pressed }) => [
          styles.panel,
          { minWidth: SPLIT_GEOMETRY.panelMinWidth, minHeight: SPLIT_GEOMETRY.panelMinHeight },
          styles.shadow,
        ]}
      >
        {({ pressed }) => {
          const fill = splitPanelFill(variant, pressed);
          const bands = pressed ? gradientBands(fill.top, fill.bottom) : restBands;
          return (
            <>
              {/* The fill (spec §2: vertical, top → bottom, no angle). */}
              <View pointerEvents="none" style={styles.fillColumn}>
                {bands.map((color, index) => (
                  <View key={index} style={{ flex: 1, backgroundColor: color }} />
                ))}
              </View>

              {/* Rest: the top inner highlight that makes it a raised surface. */}
              {!pressed && <View pointerEvents="none" style={styles.topHighlight} />}
              {/* Pressed: highlight removed, inner top edge shadow in its place. */}
              {pressed && <View pointerEvents="none" style={styles.innerShadow} />}

              {/* Chevron, top-right (30 dp from top, 19 dp from the right). */}
              <View
                pointerEvents="none"
                style={[
                  styles.chevron,
                  { opacity: pressed ? SPLIT_PRESS.chevronPressed : SPLIT_PRESS.chevronRest },
                ]}
              >
                <View style={[styles.chevronBar, styles.chevronUp]} />
                <View style={[styles.chevronBar, styles.chevronDown]} />
              </View>

              {/* The emblem puck: 96 dp, 26 dp from the panel top (spec §1 §3). */}
              <View style={styles.puckWell}>
                {puckState === 'listening' && <SonarRings size={SPLIT_GEOMETRY.puck} />}
                <View
                  style={[
                    styles.puck,
                    {
                      backgroundColor:
                        puckState === 'rest' ? palette.core : palette.listening,
                    },
                  ]}
                >
                  <Image
                    source={CORE_SOURCE[variant]}
                    style={{ width: SPLIT_GEOMETRY.puck, height: SPLIT_GEOMETRY.puck }}
                    resizeMode="contain"
                  />
                </View>
                {recording && (
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.saveRing, { opacity: saveRing }]}
                  />
                )}
              </View>

              {/* The copy well: below the puck, never inside the top 45 %. */}
              <View style={styles.copyWell}>
                <Text
                  style={styles.title}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.25}
                >
                  {title}
                </Text>
                <Text
                  style={styles.body}
                  numberOfLines={3}
                  maxFontSizeMultiplier={1.25}
                >
                  {body}
                </Text>
              </View>
            </>
          );
        }}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // The peer slot: flex 1 so both panels are ALWAYS equal (spec §1).
  wrap: {
    flex: 1,
    justifyContent: 'center',
  },
  panel: {
    flex: 1,
    borderRadius: SPLIT_GEOMETRY.radius,
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: 14,
  },
  // Rest: the drop shadow that keeps the panel a physical raised surface (§2).
  shadow: {
    shadowColor: SPLIT_SHADOW.color,
    shadowOpacity: SPLIT_SHADOW.opacity,
    shadowRadius: SPLIT_SHADOW.radius,
    shadowOffset: { width: 0, height: SPLIT_SHADOW.offsetY },
    elevation: SPLIT_SHADOW.elevation,
  },
  fillColumn: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SPLIT_GEOMETRY.radius,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  glow: {
    position: 'absolute',
    borderRadius: SPLIT_GEOMETRY.radius + 2,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: SPLIT_GEOMETRY.radius,
    right: SPLIT_GEOMETRY.radius,
    height: SPLIT_PRESS.topHighlightHeight,
    borderTopLeftRadius: SPLIT_GEOMETRY.radius,
    borderTopRightRadius: SPLIT_GEOMETRY.radius,
    backgroundColor: `rgba(255,255,255,${SPLIT_PRESS.topHighlightAlpha})`,
  },
  innerShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SPLIT_PRESS.innerShadowHeight,
    backgroundColor: `rgba(0,0,0,${SPLIT_PRESS.innerShadowAlpha})`,
  },
  chevron: {
    position: 'absolute',
    top: SPLIT_GEOMETRY.chevronTop,
    right: SPLIT_GEOMETRY.chevronRight,
    width: SPLIT_GEOMETRY.chevronWidth,
    height: SPLIT_GEOMETRY.chevronHeight,
    justifyContent: 'center',
  },
  chevronBar: {
    position: 'absolute',
    width: SPLIT_GEOMETRY.chevronStroke,
    height: 7,
    borderRadius: SPLIT_GEOMETRY.chevronStroke / 2,
    backgroundColor: SPLIT_TEXT.chevron,
    right: 2,
  },
  chevronUp: {
    top: 1,
    transform: [{ rotate: '45deg' }],
  },
  chevronDown: {
    bottom: 1,
    transform: [{ rotate: '-45deg' }],
  },
  puckWell: {
    marginTop: SPLIT_GEOMETRY.puckTop,
    width: SPLIT_GEOMETRY.puck,
    height: SPLIT_GEOMETRY.puck,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puck: {
    width: SPLIT_GEOMETRY.puck,
    height: SPLIT_GEOMETRY.puck,
    borderRadius: SPLIT_GEOMETRY.puck / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sonarRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  saveRing: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: (SPLIT_GEOMETRY.puck + 12) / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  tipRing: {
    position: 'absolute',
  },
  copyWell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPLIT_GEOMETRY.copyInset,
    paddingTop: 10,
  },
  title: {
    color: SPLIT_TEXT.title,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: SPLIT_TEXT.body,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 6,
    textAlign: 'center',
  },
});
