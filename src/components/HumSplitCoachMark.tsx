/**
 * HumSplitCoachMark — the ONE-TIME first-run bubble over the hum panel
 * (v44 equal split, spec §7 / still 04, owner-approved 10-22).
 *
 * Spec, verbatim in numbers: 176 × 74 dp bubble, radius 14, right-aligned to the
 * content edge so it sits over the HUM panel, y 26 → 100 dp (i.e. ABOVE the pair,
 * its bottom 8 dp above the panel top), an 18 × 11 dp arrow pointing DOWN at the
 * hum panel's centre. The three pulse rings live inside HeroSplitPanel so they
 * track the panel exactly.
 *
 * Hard rules it may never break:
 *  · never overlaps the Listen panel — the bubble is right-aligned and its width is
 *    capped at the hum panel's own width (heroSplit.tipBubbleWidth), so a narrow
 *    phone cannot push it over its peer;
 *  · never scrims the page — a dim layer would darken the peer and break the
 *    EQUALITY the split exists to prove; the bubble is `pointerEvents="none"`, so
 *    the user's first tap goes where they aimed it and the screen dismisses it;
 *  · reduced motion: the bubble still shows, the pulse does not run.
 */
import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useThemeMode } from '../services/themeStore';
import {
  SPLIT_GEOMETRY,
  SPLIT_TIP,
  SPLIT_TIP_COPY,
  tipArrowLeftInBubble,
  tipBubbleWidth,
} from '../services/heroSplit';

export interface HumSplitCoachMarkProps {
  testID?: string;
}

export function HumSplitCoachMark({ testID }: HumSplitCoachMarkProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { mode } = useThemeMode();
  const dark = mode !== 'light';
  const width = tipBubbleWidth(screenWidth);
  const fill = dark ? SPLIT_TIP.darkFill : SPLIT_TIP.lightFill;
  const ink = dark ? SPLIT_TIP.darkText : SPLIT_TIP.lightText;

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.layer,
        {
          // Right-aligned to the content edge — over the hum panel, never over
          // its peer. On a narrow screen the bubble narrows instead of sliding.
          right: 0,
          width,
          maxWidth: SPLIT_TIP.width,
          height: SPLIT_TIP.height,
        },
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: fill,
            borderColor: SPLIT_TIP.border,
            borderRadius: SPLIT_TIP.radius,
            width,
            height: SPLIT_TIP.height,
          },
        ]}
      >
        <Text
          style={[styles.text, { color: ink, fontSize: SPLIT_TIP.textSize }]}
          numberOfLines={3}
          maxFontSizeMultiplier={1.25}
        >
          {SPLIT_TIP_COPY}
        </Text>
      </View>
      {/* The arrow points down at the hum panel's centre (x = 302 dp at 412). */}
      <View
        style={[
          styles.arrow,
          {
            left: tipArrowLeftInBubble(screenWidth),
            borderTopColor: fill,
            borderLeftWidth: SPLIT_TIP.arrowWidth / 2,
            borderRightWidth: SPLIT_TIP.arrowWidth / 2,
            borderTopWidth: SPLIT_TIP.arrowHeight,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the pair: the bubble's bottom sits 8 dp above the panel top (100 → 108).
  layer: {
    position: 'absolute',
    top: -(SPLIT_TIP.height + SPLIT_TIP.bottomGap),
    alignItems: 'flex-end',
    zIndex: 20,
  },
  bubble: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  text: {
    textAlign: 'center',
    lineHeight: 16,
    fontWeight: '600',
  },
  arrow: {
    position: 'absolute',
    bottom: -SPLIT_TIP.arrowHeight,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

/** The gap the bubble keeps from the pair, exported for the screen's layout. */
export const TIP_BOTTOM_GAP = SPLIT_TIP.bottomGap;
/** The panel radius the rings start from (spec §7: radius 22 + offset). */
export const TIP_PANEL_RADIUS = SPLIT_GEOMETRY.radius;
