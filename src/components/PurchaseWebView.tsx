/**
 * PurchaseWebView — the ONE in-app browser shell a PIECE PAGE opens a licensed
 * retailer in (History dead-end sprint, owner 10-01).
 *
 * Why it is its own component, not a branch inside PieceDetailScreen: the app's
 * browser contract (src/services/inAppBrowserContract.ts) requires every
 * returned tree that renders a `<WebView>` to have a `<Modal>` with
 * `onRequestClose` as its ROOT — and PieceDetailScreen's root is the page body,
 * which mounts the sheet viewer and this shell as overlays. Rendering the WebView
 * in this file gives the surface its own returned tree, exactly as
 * ModernSongInterstitial's retailer branch does, so the contract holds by
 * construction rather than by exception.
 *
 * Two owner rules it implements:
 *   • the retailer page opens INSIDE our app shell, so BACK and the header land
 *     the user back on the piece page they came from (never out of the app);
 *   • the runtime flags: on Android react-native-webview defaults
 *     `domStorageEnabled` to FALSE, and Sheet Music Direct's page is a
 *     JavaScript app that initialises its session storage on load — without both
 *     flags it rendered its empty "No results" state for every query
 *     (owner-reproduced, RC v26 Test 6). `javaScriptEnabled` +
 *     `domStorageEnabled` are REQUIRED by the contract, not optional polish.
 *
 * It hosts nothing: the URL is one the backend supplied for the user's own
 * recognition and it is opened only on an explicit tap.
 */
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface PurchaseWebViewProps {
  /** The retailer URL to open. Null closes the shell entirely. */
  url: string | null;
  /** Header line — the piece the user is buying sheet music for. */
  title: string;
  onClose: () => void;
}

export const PurchaseWebView: React.FC<PurchaseWebViewProps> = ({
  url,
  title,
  onClose,
}) => {
  if (!url) return null;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={onClose}>
            <Text style={styles.backText}>← Back to NoteSnap</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <WebView
          source={{ uri: url }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#16213e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#16213e',
  },
  back: { marginRight: 12 },
  backText: { color: '#e94560', fontSize: 15, fontWeight: '700' },
  title: { color: '#ffffff', fontSize: 15, fontWeight: '700', flex: 1 },
  webview: { flex: 1 },
});

export default PurchaseWebView;
