/**
 * ModernSongInterstitial — the in-app result screen for a modern-song match
 * (Tier-1 recognize→buy funnel).
 *
 * Owner's hard UX rule (08-24): on a modern-song match we NEVER auto-redirect
 * to the retailer. We show an in-app interstitial with the song identity +
 * metadata, a "Get the official sheet music" button that opens the retailer
 * URL inside OUR OWN app shell (an in-app WebView with a back button), and
 * retention levers (save-to-history, hum-it, browse the free public-domain
 * library). We never host or provide any copyrighted file — only the retailer
 * link the backend supplied.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { ModernMatch } from '../types';

export interface ModernInterstitialState {
  /** true while the /api/recognize-modern request is in flight. */
  loading: boolean;
  /** user-facing error, or null. */
  error: string | null;
  /** The recognized song, or null when no confident match came back. */
  match: ModernMatch | null;
  /** true only when the server returned a real identified song. */
  recognized: boolean;
}

interface ModernSongInterstitialProps extends ModernInterstitialState {
  visible: boolean;
  onClose: () => void;
  onRetry: () => void;
  /** Opens the hum/whistle/sing flow so the user can find a FREE public-domain
   *  piece they can play right now instead of buying sheet music. */
  onHumIt: () => void;
  /** Navigates to the free public-domain Library. */
  onBrowseLibrary: () => void;
}

export const ModernSongInterstitial: React.FC<ModernSongInterstitialProps> = ({
  visible,
  loading,
  error,
  match,
  recognized,
  onClose,
  onRetry,
  onHumIt,
  onBrowseLibrary,
}) => {
  // In-app retailer WebView (our own app shell) — preserves the user's position
  // so they land back in NoteSnap. Opened only on explicit button tap.
  const [retailerUrl, setRetailerUrl] = useState<string | null>(null);

  if (!visible) return null;

  // ── Loading ──
  if (loading) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#e94560" />
            <Text style={styles.loadingTitle}>Listening for a song...</Text>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.emoji}>⚠️</Text>
            <Text style={styles.cardTitle}>Something went wrong</Text>
            <Text style={styles.bodyText}>{error}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Recognized song → in-app retailer WebView ──
  if (match && recognized && retailerUrl) {
    return (
      <View style={styles.webviewContainer}>
        <View style={styles.webviewHeader}>
          <TouchableOpacity
            style={styles.webviewBack}
            onPress={() => setRetailerUrl(null)}
          >
            <Text style={styles.webviewBackText}>← Back to NoteSnap</Text>
          </TouchableOpacity>
          <Text style={styles.webviewTitle} numberOfLines={1}>
            {match.song} — official sheet music
          </Text>
        </View>
        <WebView source={{ uri: retailerUrl }} style={styles.webview} />
      </View>
    );
  }

  // ── Recognized song → interstitial (no auto-redirect) ──
  if (match && recognized) {
    const canBuy = !!match.retailerUrl;
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.card}>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>

              <Text style={styles.kicker}>🎼 Recognized</Text>

              {match.albumArtUrl ? (
                <Image
                  source={{ uri: match.albumArtUrl }}
                  style={styles.albumArt}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.albumArtPlaceholder}>🎵</Text>
              )}

              <Text style={styles.songTitle}>{match.song}</Text>
              <Text style={styles.artist}>{match.artist}</Text>

              {match.composer ? (
                <Text style={styles.meta}>
                  Composer: {match.composer}
                </Text>
              ) : null}
              {match.album ? <Text style={styles.meta}>{match.album}</Text> : null}

              <Text style={styles.footerNote}>
                NoteSnap never hosts or distributes copyrighted sheet music —
                we only point you to licensed retailers.
              </Text>

              {canBuy ? (
                <TouchableOpacity
                  style={styles.buyBtn}
                  onPress={() => setRetailerUrl(match.retailerUrl!)}
                >
                  <Text style={styles.buyBtnText}>
                    🛒 Get the Official Sheet Music
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.noLinkCard}>
                  <Text style={styles.noLinkText}>
                    Official sheet music isn't linked yet — check back soon.
                  </Text>
                </View>
              )}

              {/* Retention levers */}
              <TouchableOpacity style={styles.humBtn} onPress={onHumIt}>
                <Text style={styles.humBtnText}>
                  🎤 Can't play it? Hum the melody to find a free public-domain piece
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.libraryBtn}
                onPress={onBrowseLibrary}
              >
                <Text style={styles.libraryBtnText}>
                  🎼 Or browse the free classical library
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  // ── No modern match (honest) ──
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🔍</Text>
          <Text style={styles.cardTitle}>No modern song found</Text>
          <Text style={styles.bodyText}>
            We couldn't identify that as a modern song. Try again closer to the
            speaker — or hum the melody to find a free public-domain piece you
            can play now.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onHumIt}>
              <Text style={styles.secondaryBtnText}>Hum it</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: { maxHeight: '90%', width: '100%' },
  scrollContent: { alignItems: 'center', paddingVertical: 20 },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  closeBtnText: { color: '#a0a0b8', fontSize: 20, fontWeight: '700' },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 16,
  },
  emoji: { fontSize: 44, marginBottom: 12 },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  buttonRow: { flexDirection: 'row', gap: 12 },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    flex: 1,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  secondaryBtnText: { color: '#a0a0b8', fontSize: 15, fontWeight: '600' },

  // Recognized interstitial
  kicker: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 12,
  },
  albumArt: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginBottom: 14,
  },
  albumArtPlaceholder: { fontSize: 72, marginBottom: 12 },
  songTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  artist: { fontSize: 16, color: '#a0a0b8', marginTop: 2, marginBottom: 10 },
  meta: { fontSize: 13, color: '#a0a0b8', textAlign: 'center', marginBottom: 2 },
  footerNote: {
    fontSize: 11,
    color: '#707090',
    textAlign: 'center',
    lineHeight: 16,
    marginVertical: 12,
  },
  buyBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 14,
    padding: 15,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e94560',
  },
  buyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  noLinkCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderStyle: 'dashed',
  },
  noLinkText: {
    color: '#a0a0b8',
    fontSize: 13,
    textAlign: 'center',
  },
  humBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  humBtnText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  libraryBtn: { padding: 10, marginTop: 4 },
  libraryBtnText: {
    color: '#a0a0b8',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  doneBtn: { marginTop: 12, padding: 8 },
  doneBtnText: { color: '#a0a0b8', fontSize: 14, fontWeight: '600' },

  // In-app retailer WebView
  webviewContainer: { flex: 1, backgroundColor: '#16213e' },
  webviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#16213e',
  },
  webviewBack: { marginRight: 12 },
  webviewBackText: { color: '#e94560', fontSize: 15, fontWeight: '700' },
  webviewTitle: { color: '#ffffff', fontSize: 15, fontWeight: '700', flex: 1 },
  webview: { flex: 1 },
});
