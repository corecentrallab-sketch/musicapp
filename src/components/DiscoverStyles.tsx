/**
 * DiscoverStyles — BROWSE BY STYLE: the FIVE style families on Discover
 * (v45 slice 3b, owner-ratified all-genres scope 2026-10-26).
 *
 * This is the tile grid only. Every decision (which rows a layout renders, what
 * a tile's second line says, whether a count exists at all, what an empty
 * family's screen is) comes from `services/genreFamilies.ts`, which is pure and
 * unit-tested; the guard `familyTilesAreBackedByRealContent()` reads THIS file's
 * source to prove each tile is wired to a real family screen with the family id.
 *
 * Rules this surface implements (design sheets 6 and 7):
 *   • five families, always — no era is ever a top-level tile;
 *   • a tile with no free scores is NEVER greyed out and NEVER says "0 pieces":
 *     it carries "Official sheet music" instead and opens its family screen;
 *   • counts are shown only when they were derived from real catalog rows
 *     (`eraCounts` / `freeCount` are null until the catalog proves them);
 *   • the era chips live inside the Classical tile in the 'hero-classical'
 *     layout and move into Classical's family screen in the 'equal' layout.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  DISCOVER_STYLE_LABEL,
  ERA_CHIPS,
  FAMILY_OFFICIAL_LINE,
  discoverFamilyRows,
  discoverStyleNote,
  eraChipLabel,
  eraChipsRenderInTile,
  familyTileSecondLine,
  type DiscoverLayout,
  type EraCounts,
  type FamilyId,
  type GenreFamily,
} from '../services/genreFamilies';

export interface DiscoverStylesProps {
  /** The catalog's real total, or null until it is known. Never a constant. */
  freeCount: number | null;
  /** Per-era counts derived from real rows, or null (then no numbers render). */
  eraCounts: EraCounts | null;
  /** Opens the family screen for this family. The ONLY tile tap. */
  onOpenFamily: (id: FamilyId) => void;
  /** Which of the two layouts renders ('hero-classical' is the shipped default). */
  layout: DiscoverLayout;
}

export const DiscoverStyles: React.FC<DiscoverStylesProps> = ({
  freeCount,
  eraCounts,
  onOpenFamily,
  layout,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const rows = discoverFamilyRows(layout);
  const showEraChipsInTile = eraChipsRenderInTile(layout);

  const renderEraChips = () => (
    <View style={styles.eraRow}>
      {ERA_CHIPS.map((era) => (
        <View key={era.id} style={styles.eraChip} testID={`era-chip-${era.id}`}>
          <Text style={styles.eraChipText}>{eraChipLabel(era.id, eraCounts)}</Text>
        </View>
      ))}
    </View>
  );

  const renderTile = (family: GenreFamily, kind: 'hero' | 'tile' | 'wide') => {
    const secondLine = familyTileSecondLine(family, freeCount);
    const isHero = kind === 'hero';
    const isWide = kind === 'wide';
    return (
      <TouchableOpacity
        key={family.id}
        style={[
          styles.familyTile,
          isHero && styles.familyTileHero,
          kind === 'tile' && styles.familyTileHalf,
          isWide && styles.familyTileWide,
        ]}
        onPress={() => onOpenFamily(family.id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={
          secondLine.length > 0 ? `${family.name} — ${secondLine}` : family.name
        }
        testID={`family-tile-${family.id}`}
      >
        <View style={styles.familyTileText}>
          <Text style={[styles.familyName, isHero && styles.familyNameHero]} numberOfLines={2}>
            {family.name}
          </Text>
          {secondLine.length > 0 ? (
            <Text style={styles.familySecondLine} numberOfLines={1}>
              {family.content === 'none' ? `🛍 ${FAMILY_OFFICIAL_LINE}` : secondLine}
            </Text>
          ) : null}
          {isHero && showEraChipsInTile ? renderEraChips() : null}
        </View>
        <Text style={styles.familyChevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.styleLabel}>{DISCOVER_STYLE_LABEL}</Text>
      {/* The honest line: which family holds the free scores and where the rest
          resolve. The count is printed only when the catalog gave us one. */}
      <Text style={styles.styleNote}>{discoverStyleNote(freeCount)}</Text>
      <View style={styles.grid}>
        {rows.map((row) => renderTile(row.family, row.kind))}
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: {
    marginTop: 18,
  },
  styleLabel: {
    color: '#a0a0b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  // The honest sentence above the tiles (design sheet 7 §"Under the grid").
  styleNote: {
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  // Same shape, same fill, same hairline, same chevron for EVERY family — an
  // empty family must not look like a hole (no grey-out, no dashed border).
  familyTile: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  familyTileHero: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 16,
  },
  familyTileHalf: {
    flexGrow: 1,
    flexBasis: '46%',
  },
  familyTileWide: {
    width: '100%',
  },
  familyTileText: {
    flex: 1,
    marginRight: 8,
  },
  familyName: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  familyNameHero: {
    fontSize: 16,
  },
  familySecondLine: {
    color: '#a0a0b8',
    fontSize: 11,
    marginTop: 4,
  },
  familyChevron: {
    color: '#6c6c8a',
    fontSize: 20,
    fontWeight: '700',
  },
  eraRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
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
});
