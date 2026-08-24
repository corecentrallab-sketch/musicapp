/**
 * ScoreViewer — full-screen sheet music PDF/MusicXML viewer.
 *
 * Uses react-native-webview with embedded PDF.js for Expo Go compatibility.
 * Supports page turning via tap edges, swipe, and page indicator.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ScorePlayer } from './ScorePlayer';
import type { ScoreAudioSource } from '../hooks/useScoreAudio';

interface ScoreViewerProps {
  /** URL to the PDF or MusicXML file. */
  url: string;
  /** Title of the piece. */
  title: string;
  /** Composer name. */
  composer: string;
  /** Called when the user closes the viewer. */
  onClose: () => void;
  /**
   * Optional score audio (public-domain ONLY) for the practice player.
   * Accepts a remote/local uri or a bundled asset id. When omitted, the
   * viewer shows a subtle "practice audio coming soon" hint instead of a
   * (fake) player — never a broken or misleading control.
   */
  audioSource?: ScoreAudioSource | null;
  /** Short honest descriptor for the audio (e.g. "Score audio" / "Preview"). */
  audioLabel?: string;
}

/** Generate the HTML that wraps PDF.js for rendering. */
function generatePdfHtml(pdfUrl: string): string {
  // Escape the URL for safe embedding in HTML
  const escapedUrl = pdfUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    width: 100%;
    background: #1a1a2e;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    position: relative;
    touch-action: pan-x pan-y pinch-zoom;
  }
  #pageCanvas {
    max-width: 100%;
    max-height: 85%;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    border-radius: 4px;
    background: #fff;
  }
  #pageIndicator {
    position: absolute;
    bottom: 16px;
    left: 0;
    right: 0;
    text-align: center;
    color: #a0a0b8;
    font-size: 13px;
    font-weight: 600;
    pointer-events: none;
  }
  #loadingOverlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a2e;
    z-index: 10;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #0f3460;
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  #errorOverlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #1a1a2e;
    z-index: 10;
    padding: 32px;
  }
  #errorOverlay .err-icon { font-size: 48px; margin-bottom: 16px; }
  #errorOverlay .err-title { color: #fff; font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  #errorOverlay .err-body { color: #a0a0b8; font-size: 14px; text-align: center; line-height: 1.5; margin-bottom: 20px; }
  #errorOverlay .err-retry {
    background: #e94560;
    color: #fff;
    border: none;
    padding: 12px 28px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  /* Tap zones */
  .tap-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    z-index: 5;
  }
  .tap-zone-left { left: 0; }
  .tap-zone-right { right: 0; }
</style>
</head>
<body>
<div id="container">
  <div id="loadingOverlay"><div class="spinner"></div></div>
  <div id="errorOverlay">
    <div class="err-icon">⚠️</div>
    <div class="err-title">Could not load sheet music</div>
    <div class="err-body">The PDF may be unavailable or in an unsupported format.</div>
    <button class="err-retry" onclick="retry()">Retry</button>
  </div>
  <canvas id="pageCanvas"></canvas>
  <div id="pageIndicator"></div>
  <div class="tap-zone tap-zone-left" onclick="prevPage()"></div>
  <div class="tap-zone tap-zone-right" onclick="nextPage()"></div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let renderTask = null;

  const canvas = document.getElementById('pageCanvas');
  const ctx = canvas.getContext('2d');
  const loadingEl = document.getElementById('loadingOverlay');
  const errorEl = document.getElementById('errorOverlay');
  const indicator = document.getElementById('pageIndicator');

  function showLoading() {
    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';
  }

  function hideLoading() {
    loadingEl.style.display = 'none';
  }

  function showError() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'flex';
    // Notify RN about the error
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error' }));
    }
  }

  function updateIndicator() {
    indicator.textContent = 'Page ' + currentPage + ' of ' + totalPages;
    // Notify RN
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pageChange',
        page: currentPage,
        total: totalPages
      }));
    }
  }

  function renderPage(num) {
    if (renderTask) { renderTask.cancel(); }
    showLoading();

    pdfDoc.getPage(num).then(function(page) {
      var viewport = page.getViewport({ scale: 1 });
      var containerWidth = document.getElementById('container').clientWidth;
      var scale = (containerWidth * 0.92) / viewport.width;
      var scaledViewport = page.getViewport({ scale: scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      renderTask = page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      });

      renderTask.promise.then(function() {
        hideLoading();
        renderTask = null;
        updateIndicator();
      }).catch(function(err) {
        if (err.name === 'RenderingCancelledException') return;
        showError();
      });
    }).catch(function(err) {
      showError();
    });
  }

  function prevPage() {
    if (currentPage <= 1) return;
    currentPage--;
    renderPage(currentPage);
  }

  function nextPage() {
    if (currentPage >= totalPages) return;
    currentPage++;
    renderPage(currentPage);
  }

  function retry() {
    showLoading();
    renderPage(currentPage);
  }

  // Load the PDF
  pdfjsLib.getDocument('${escapedUrl}').promise.then(function(pdf) {
    pdfDoc = pdf;
    totalPages = pdf.numPages;
    currentPage = 1;
    renderPage(1);
    // Notify RN
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'loaded',
        totalPages: totalPages
      }));
    }
  }).catch(function(err) {
    showError();
  });

  // Swipe handling
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    // Only trigger if horizontal swipe dominates
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) {
        nextPage();
      } else {
        prevPage();
      }
    }
  });
</script>
</body>
</html>`;
}

export const ScoreViewer: React.FC<ScoreViewerProps> = ({
  url,
  title,
  composer,
  onClose,
  audioSource,
  audioLabel,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 0 });
  const webViewRef = useRef<WebView>(null);

  const pdfHtml = useMemo(() => generatePdfHtml(url), [url]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'loaded':
          setLoading(false);
          setError(false);
          setPageInfo({ page: 1, total: data.totalPages });
          break;
        case 'pageChange':
          setPageInfo({ page: data.page, total: data.total });
          break;
        case 'error':
          setLoading(false);
          setError(true);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <Modal visible={true} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {/* Header bar */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.headerComposer} numberOfLines={1}>
              {composer}
            </Text>
          </View>
          {/* Spacer for symmetry */}
          <View style={styles.closeBtn} />
        </View>

        {/* WebView PDF viewer */}
        <View style={styles.webviewContainer}>
          <WebView
            ref={webViewRef}
            source={{ html: pdfHtml }}
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowFileAccess={true}
            mixedContentMode="always"
            onMessage={handleMessage}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            androidLayerType={
              Platform.OS === 'android' ? 'hardware' : undefined
            }
          />

          {/* Native loading overlay */}
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#e94560" />
              <Text style={styles.loadingText}>Loading sheet music...</Text>
            </View>
          )}

          {/* Native error overlay */}
          {error && (
            <View style={styles.errorOverlay}>
              <Text style={styles.errorEmoji}>⚠️</Text>
              <Text style={styles.errorTitle}>
                Could not load sheet music
              </Text>
              <Text style={styles.errorBody}>
                The file may be unavailable or in an unsupported format.
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Practice player: score audio + loop + time-stretch. Rendered only
          when an audio source exists; otherwise a subtle hint (no fake UI). */}
        {audioSource ? (
          <ScorePlayer source={audioSource} label={audioLabel} />
        ) : (
          <View style={styles.audioHint}>
            <Text style={styles.audioHintText}>
              🎧 Practice audio coming soon
            </Text>
          </View>
        )}

        {/* Bottom bar: page indicator + tap hints */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.pageNavBtn}
            onPress={() => {
              webViewRef.current?.injectJavaScript('prevPage();');
            }}
          >
            <Text style={styles.pageNavArrow}>‹</Text>
          </TouchableOpacity>

          <View style={styles.pageIndicatorContainer}>
            {!loading && !error && pageInfo.total > 0 ? (
              <Text style={styles.pageIndicator}>
                Page {pageInfo.page} of {pageInfo.total}
              </Text>
            ) : (
              <Text style={styles.pageIndicator}>
                {loading ? 'Loading...' : error ? 'Error' : '—'}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.pageNavBtn}
            onPress={() => {
              webViewRef.current?.injectJavaScript('nextPage();');
            }}
          >
            <Text style={styles.pageNavArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#a0a0b8',
    fontSize: 20,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerComposer: {
    color: '#a0a0b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 2,
  },

  // WebView
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  // Loading overlay (native fallback)
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  loadingText: {
    color: '#a0a0b8',
    fontSize: 14,
    marginTop: 16,
  },

  // Error overlay (native fallback)
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 10,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorBody: {
    color: '#a0a0b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
  },
  audioHint: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    alignItems: 'center',
  },
  audioHintText: {
    color: '#6a6a85',
    fontSize: 13,
  },
  pageNavBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavArrow: {
    color: '#e94560',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 30,
  },
  pageIndicatorContainer: {
    flex: 1,
    alignItems: 'center',
  },
  pageIndicator: {
    color: '#c0c0d0',
    fontSize: 14,
    fontWeight: '600',
  },
});
