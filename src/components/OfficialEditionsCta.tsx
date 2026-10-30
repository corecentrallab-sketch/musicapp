/**
 * OfficialEditionsCta — THE money CTA on a page that has NO hosted score
 * (v47.1 Part B, items 1 + 2 + 3).
 *
 * One full-width primary action, alone in its own block, directly under the
 * page's action row — the position a thumb reaches without scrolling past the
 * page furniture. Every decision (which label, which URL, whether it renders at
 * all) comes from `services/v471bMoneyCta.ts`, which is unit-tested; this file
 * owns only the pixels and the tap.
 *
 * WHY IT IS A SEPARATE BLOCK AND NOT A ROW CHILD (the #199 / v46 red-bar class):
 * `styles.actions` on the piece page is a `flexDirection: 'row'`. A primary
 * money CTA sharing that row with the Share button is squeezed to its padding
 * minimum the moment a third, intrinsically-sized child lands beside it — the
 * accent pill collapses to a 32dp sliver with its label clipped to nothing.
 * This block is `alignSelf: 'stretch'`, a COLUMN, and holds exactly ONE
 * pressable. `moneyCtaBlockIsFullWidth()` + `moneyCtaBlockHasNoRowSibling()`
 * fail the gate if either property is lost.
 *
 * HONEST COPY: the disclosure under the button is the shared
 * `AFFILIATE_DISCLOSURE` constant — commission, no extra cost, opens in the
 * in-app browser. No urgency, no "recommended by", no claim the retailer's page
 * is ours.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AFFILIATE_DISCLOSURE,
  resolveUnscoredMoneyCta,
} from '../services/v471bMoneyCta';

interface OfficialEditionsCtaProps {
  /** The piece's own title — used verbatim in the retailer search pre-fill. */
  title: string;
  /** The piece's own composer — the disambiguating half of the pre-fill. */
  composer?: string | null;
  /** The row's own licensed retailer page, when the catalog carries one. */
  purchaseUrl?: string | null;
  /** Opens the retailer in the page's shared in-app browser shell. Tap only. */
  onOpen: (url: string) => void;
}

export const OfficialEditionsCta: React.FC<OfficialEditionsCtaProps> = ({
  title,
  composer,
  purchaseUrl,
  onOpen,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const cta = resolveUnscoredMoneyCta({ title, composer, purchaseUrl });
  // No destination → no block. Never a disabled button, never a placeholder.
  if (cta.kind === 'none' || !cta.url) return null;
  const url = cta.url;
  return (
    <View style={styles.moneyCtaBlock}>
      <TouchableOpacity
        style={styles.moneyCtaBtn}
        onPress={() => onOpen(url)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={cta.label}
        accessibilityHint="Opens the licensed retailer inside NoteSnap"
      >
        <Text style={styles.moneyCtaBtnText}>{cta.label}</Text>
        {cta.query ? (
          <Text style={styles.moneyCtaQuery} numberOfLines={1}>
            “{cta.query}”
          </Text>
        ) : null}
      </TouchableOpacity>
      <Text style={styles.moneyCtaDisclosure}>{AFFILIATE_DISCLOSURE}</Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  // FULL-WIDTH BLOCK: stretched to the page column, a COLUMN layout, no flex.
  moneyCtaBlock: {
    alignSelf: 'stretch',
    marginHorizontal: 20,
    marginTop: 14,
  },
  // THE ONE primary control in this block, and it fills it.
  moneyCtaBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  moneyCtaBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  moneyCtaQuery: {
    color: '#ffe3e8',
    fontSize: 12,
    marginTop: 3,
    textAlign: 'center',
  },
  moneyCtaDisclosure: {
    color: '#8a8aa3',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 8,
  },
});

export default OfficialEditionsCta;
