/**
 * FamilyScreen — the pushed family screen for one of the five style families
 * (v45 slice 3b, owner-ratified all-genres scope 2026-10-26).
 *
 * ONE screen, five honest states. Everything it renders comes from
 * `familyScreenModel()` in services/genreFamilies.ts (pure, tier1-tested):
 *
 *   • a family with free scores (Classical) leads with the free library and
 *     keeps the official editions one row below it;
 *   • a family with NO free scores yet says so plainly ("No free scores in this
 *     style yet") and leads with the MONEY PATH — the live official-editions
 *     search for this style, built by the app's own affiliate URL builder
 *     (Sheet Music Direct, id 67650) and opened in the shared in-app shell on an
 *     explicit tap only. Never an auto-redirect (owner rule 08-24).
 *
 * ZERO DEAD ENDS: every family lands here, the first row of an empty family's
 * screen is a live retailer search, and the free library is always the row
 * underneath it — so a learner is never turned away, and an empty family is a
 * revenue surface rather than a gap. The retailer is never named before the tap;
 * the rows say "official sheet music" (design sheet 7 §"No retailer naming").
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PurchaseWebView } from './PurchaseWebView';
import { useHardwareBack } from '../hooks/useHardwareBack';
import {
  DISCOVER_LAYOUT,
  FAMILY_FOOTER_TEST_ID,
  eraChipLabel,
  eraChipsRenderInTile,
  familyById,
  familyScreenModel,
  type EraCounts,
  type FamilyId,
} from '../services/genreFamilies';

export interface FamilyScreenProps {
  /** Which family was tapped. */
  family: FamilyId;
  /** The catalog's real total, or null until it is known. Never a constant. */
  freeCount: number | null;
  /** Per-era counts derived from real rows, or null (then no numbers render). */
  eraCounts: EraCounts | null;
  /** Back to whoever opened this screen (its header chevron and Android BACK). */
  onClose: () => void;
  /** "Browse what is free now" → the Library tab. */
  onBrowseLibrary: () => void;
}

export const FamilyScreen: React.FC<FamilyScreenProps> = ({
  family,
  freeCount,
  eraCounts,
  onClose,
  onBrowseLibrary,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  // The retailer URL the user tapped. Tap-driven only: this is the ONLY writer,
  // so no code path can redirect the user to a store on its own (owner 08-24).
  const [retailerUrl, setRetailerUrl] = useState<string | null>(null);
  const handleOpenRetailer = useCallback((url: string) => {
    setRetailerUrl(url);
  }, []);
  const handleCloseRetailer = useCallback(() => {
    setRetailerUrl(null);
  }, []);

  // Android hardware BACK (in-place flow — owner bug class 09-23): unwind the
  // purchase shell first, then this screen. Guarded by backExitContract.
  useHardwareBack(() => {
    if (retailerUrl) {
      handleCloseRetailer();
      return true;
    }
    onClose();
    return true;
  });

  const entry = familyById(family);
  // An unknown id is neither a crash nor a blank body: the screen renders its
  // header (with the BACK affordance) and nothing else, so BACK always works.
  if (!entry) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  const model = familyScreenModel(entry, { freeCount, eraCounts });
  // In the 'equal' layout the era fold lives one tap deeper — here — so the chips
  // are not lost when the Classical tile has no room for them.
  const showEraChips = model.eraChips.length > 0 && !eraChipsRenderInTile(DISCOVER_LAYOUT);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.subtitle}>{model.subtitle}</Text>

        {/* The honest state card: what this style holds in the FREE library. */}
        <View style={styles.stateCard}>
          <Text style={styles.stateEyebrow}>{model.stateEyebrow}</Text>
          <Text style={styles.stateTitle}>{model.stateTitle}</Text>
          <Text style={styles.stateBody}>{model.stateBody}</Text>
          {showEraChips ? (
            <View style={styles.eraRow}>
              {model.eraChips.map((era) => (
                <View key={era.id} style={styles.eraChip}>
                  <Text style={styles.eraChipText}>{eraChipLabel(era.id, eraCounts)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* THE ROWS, in the model's order: for a family with no free scores the
            MONEY row is first, for Classical the free library is. */}
        {model.rows.map((row) => {
          const isMoney = row.kind === 'money';
          const url = row.url;
          return (
            <TouchableOpacity
              key={row.kind}
              style={[styles.row, isMoney ? styles.moneyRow : styles.freeRow]}
              activeOpacity={0.7}
              onPress={() => (isMoney && url ? handleOpenRetailer(url) : onBrowseLibrary())}
              accessibilityRole="button"
              accessibilityLabel={`${row.label} — ${row.hint}`}
              testID={isMoney ? 'family-money-row' : 'family-free-row'}
            >
              <Text style={styles.rowGlyph}>{isMoney ? '🛍' : '📚'}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, isMoney && styles.moneyRowLabel]}>
                  {row.label}
                </Text>
                <Text style={styles.rowHint} numberOfLines={2}>
                  {row.hint}
                </Text>
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </TouchableOpacity>
          );
        })}

        {/* The footer states the split plainly — derived from the family table,
            never typed ("Free scores today: 1 of 5 style families"). */}
        <Text style={styles.footer} testID={FAMILY_FOOTER_TEST_ID}>
          {model.footer}
        </Text>
      </ScrollView>

      {/* The retailer's own search page, in the shared in-app shell (Modal root,
          BACK / "← Back to NoteSnap" return HERE). Tap-only, never on mount. */}
      <PurchaseWebView
        url={retailerUrl}
        title={`Official sheet music · ${model.title}`}
        onClose={handleCloseRetailer}
      />
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 4,
  },
  backBtn: {
    marginRight: 12,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  stateCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 16,
    marginTop: 16,
  },
  stateEyebrow: {
    color: '#a0a0b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  stateTitle: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
  },
  stateBody: {
    color: '#a0a0b8',
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 6,
  },
  eraRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  eraChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  eraChipText: {
    color: '#cfe9ff',
    fontSize: 9.5,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 12,
  },
  // Money row: the brand rose edge carries the one sale (design sheet 7). The
  // FILL stays the ordinary card token so the two themes remap it correctly
  // (`#2a1c2c` would not be remapped, and white-on-plum would invert to
  // dark-on-dark in the light theme).
  moneyRow: {
    backgroundColor: '#16213e',
    borderColor: '#e94560',
  },
  // Free row: the ordinary card fill + hairline — an action, not a badge.
  freeRow: {
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
  },
  rowGlyph: {
    fontSize: 16,
    marginRight: 12,
  },
  rowText: {
    flex: 1,
    marginRight: 8,
  },
  rowLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  moneyRowLabel: {
    color: '#ff8fa3',
  },
  rowHint: {
    color: '#a0a0b8',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 3,
  },
  rowChevron: {
    color: '#6c6c8a',
    fontSize: 20,
    fontWeight: '700',
  },
  footer: {
    color: '#6c6c8a',
    fontSize: 11,
    marginTop: 18,
    textAlign: 'center',
  },
});
