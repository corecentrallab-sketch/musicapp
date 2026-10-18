/**
 * SampleBadge — THE sample/excerpt badge, shared by every surface that shows a
 * bundled excerpt score (UX round 1, step 1; owner 10-18 item 5, spec
 * `ux-round-1/owner-five-items.md` §5 + `ux-blueprint.md` §3 rule 2).
 *
 * WHY IT EXISTS. The owner opened a transposed copy of the built-in four-bar
 * "Für Elise" and saw four bars — the DATA, not a broken renderer. Every bundled
 * ABC score is a 3-4 bar excerpt, so the fix is to SAY so. That label used to be
 * built inline on two screens (`TransposedScoreReaderScreen`,
 * `NotationEditorScreen`) with their own hard-coded dark colours; this component
 * is the ONE place it renders, so every surface shows the same words from the
 * same source and cannot drift apart.
 *
 * THE RULE THAT MUST SURVIVE (binding): the words are DERIVED FROM THE SCORE
 * ITSELF. There is deliberately NO `label`/`text` prop — a caller hands over the
 * score (`abc`) and the honest state of what the app holds for it
 * (`libraryState`), never a string. `services/sampleBadge.ts` owns both the
 * derivation and the honest-copy rule; `scripts/sampleBadge.test.ts` reads this
 * file and fails if a copy prop ever appears.
 *
 * TOKENS, NOT HEX (spec §3): the pill reads `chipBg` / `chipText` with an
 * `information-circle-outline` glyph in `accent` — information, never an action,
 * so it is never a filled accent block (accent is reserved for the one primary
 * CTA per screen) and it repaints correctly in light mode.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedStyles } from '../services/themeStore';
import { sampleBadgeLabel, type SampleLibraryState } from '../services/sampleBadge';

export interface SampleBadgeProps {
  /** THE SCORE the badge describes. The words are derived from this, never passed. */
  abc: string | null | undefined;
  /**
   * The caller's own sample assertion — the reader carries it in its route params
   * (set from `isSampleScore` at the editor's door). Omitted, the badge decides
   * purely from the score.
   */
  isSample?: boolean;
  /**
   * What THIS SURFACE has proven about a fuller score for the piece (see
   * services/sampleBadge.ts). Omitted = `unverified`, which makes no claim about
   * the library — the only safe default.
   */
  libraryState?: SampleLibraryState | null;
  /** Layout only (margin/alignment). Never copy. */
  style?: StyleProp<ViewStyle>;
}

/** The badge's words are computed here, so a screen-level test can read them too. */
export const SampleBadge: React.FC<SampleBadgeProps> = ({
  abc,
  isSample,
  libraryState,
  style,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const label = sampleBadgeLabel({ abc, isSample, libraryState });
  if (label === null) return null;
  return (
    <View
      style={[styles.badge, { backgroundColor: theme.chipBg, borderColor: theme.border }, style]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID="sample-excerpt-badge"
    >
      <Ionicons name="information-circle-outline" size={13} color={theme.accent} />
      <Text style={[styles.text, { color: theme.chipText }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  text: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
