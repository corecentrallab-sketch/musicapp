/**
 * SearchExternalSection — the "Official sheet music" block on the Find-a-Piece
 * search screen (owner direction 10-01: the search box must return BOTH our
 * internal catalog results AND external licensed-retailer results).
 *
 * It is a thin, purely presentational renderer: every decision (is the section
 * visible, what are the URLs, is the secondary CTA shown, what does the subtitle
 * say) comes from `services/searchExternal.ts`, which is unit-tested. This file
 * owns only the pixels and the taps.
 *
 * Three rules it implements:
 *   • it renders NOTHING when the query is empty — there is nothing to search for;
 *   • it renders the section for ANY non-empty query, including one our catalog
 *     does not hold at all (the no-dead-end rule). The zero-match state must never
 *     be a wall;
 *   • each card is an ACTION: it hands its retailer URL to the caller, which opens
 *     it in the shared in-app browser shell (`PurchaseWebView` — Modal root, BACK
 *     returns to this screen). No auto-redirect: nothing here opens a page on
 *     mount, only on a tap (the owner's 08-24 rule, same as the modern-song
 *     interstitial).
 *
 * We host nothing: both URLs are the retailer's own search-results page, which
 * carries its own previews and its own checkout. The copy says so, and it never
 * promises free access to a copyrighted work.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  EXTERNAL_HOSTING_NOTE,
  EXTERNAL_MUSICNOTES_CTA_LABEL,
  EXTERNAL_SECTION_NOTE,
  EXTERNAL_SECTION_TITLE,
  EXTERNAL_SMD_CTA_LABEL,
  type ExternalSearchSection as ExternalSearchSectionModel,
} from '../services/searchExternal';

interface SearchExternalSectionProps {
  /** The pure decision from `externalSearchSection(query, internalMatches)`. */
  section: ExternalSearchSectionModel;
  /** Opens a retailer URL in the shared in-app browser shell. Tap-driven only. */
  onOpen: (url: string) => void;
}

export const SearchExternalSection: React.FC<SearchExternalSectionProps> = ({
  section,
  onOpen,
}) => {
  // Empty query → nothing to search for, so no section at all.
  if (!section.visible) return null;
  const smdUrl = section.smdUrl;
  if (!smdUrl) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{EXTERNAL_SECTION_TITLE}</Text>
      <Text style={styles.subtitle}>{section.subtitle}</Text>

      {/* PRIMARY — Sheet Music Direct (affiliate id 67650, the paying retailer).
          The card shows the user's own query, so the destination is never a
          surprise: it is the words they typed, searched on the retailer's site. */}
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => onOpen(smdUrl)}
        accessibilityRole="button"
        accessibilityLabel={`${EXTERNAL_SMD_CTA_LABEL} for ${section.query}`}
      >
        <Text style={styles.cardEmoji}>🎼</Text>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{EXTERNAL_SMD_CTA_LABEL}</Text>
          <Text style={styles.cardQuery} numberOfLines={1}>
            “{section.query}”
          </Text>
          <Text style={styles.cardHint}>Official sheet music — opens the retailer</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      {/* SECONDARY — Musicnotes (UX-only: no affiliate program, owner 09-28).
          Rendered only when it is a genuinely different destination, so the two
          cards can never offer the same page twice. */}
      {section.showMusicnotes && section.musicnotesUrl ? (
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.7}
          onPress={() => onOpen(section.musicnotesUrl as string)}
          accessibilityRole="button"
          accessibilityLabel={`${EXTERNAL_MUSICNOTES_CTA_LABEL} for ${section.query}`}
        >
          <Text style={styles.secondaryBtnText}>🎵 {EXTERNAL_MUSICNOTES_CTA_LABEL}</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.note}>{EXTERNAL_SECTION_NOTE}</Text>
      <Text style={styles.hostingNote}>{EXTERNAL_HOSTING_NOTE}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 24,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ecdc4',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#a0a0b8',
    lineHeight: 18,
    marginTop: 6,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  cardEmoji: { fontSize: 20, marginRight: 10 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  cardQuery: { fontSize: 13, color: '#4ecdc4', marginTop: 2 },
  cardHint: { fontSize: 11, color: '#8a8aa3', marginTop: 4 },
  cardChevron: { fontSize: 22, color: '#8a8aa3', marginLeft: 8 },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  note: { fontSize: 11, color: '#8a8aa3', lineHeight: 15, marginTop: 12 },
  hostingNote: { fontSize: 11, color: '#8a8aa3', lineHeight: 15, marginTop: 6 },
});

export default SearchExternalSection;
