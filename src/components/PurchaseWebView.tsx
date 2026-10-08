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
 *
 * A failed load is not a blank page (bundle C.4, owner 10-02). Retailers do
 * bot-check and networks do drop: the shell keeps its header (so the user is never
 * stranded) and, on a WebView error, says so and offers a real RETRY — the page is
 * re-mounted with a new key, which is what actually reloads it. There is
 * deliberately NO "open in the browser" escape: the whole point of this shell is
 * that a purchase route never leaves NoteSnap, and that promise is guarded by
 * src/services/purchaseCta.ts (`noPurchaseActionLeavesTheApp`).
 */
import { useThemedStyles } from '../services/themeStore';
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
  const { styles, theme } = useThemedStyles(baseStyles);
  // The retry counter is the WebView's `key`: bumping it re-mounts the page, which
  // is the only way to make a WebView that failed to load try again.
  const [attempt, setAttempt] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
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
        {failed && (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>
              This page didn't load. Your connection may be down, or the retailer
              is blocking this request.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              accessibilityRole="button"
              accessibilityLabel="Try loading the retailer page again"
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        <WebView
          key={attempt}
          source={{ uri: url }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          onError={() => setFailed(true)}
        />
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
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
  // A failed load: an honest line + a real retry, under the header (C.4).
  errorBar: {
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#0f3460',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: { color: '#a0a0b8', fontSize: 13, lineHeight: 19 },
  retryBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#0f3460',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e94560',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  webview: { flex: 1 },
});

export default PurchaseWebView;
