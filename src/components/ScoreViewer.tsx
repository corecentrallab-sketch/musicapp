/**
 * ScoreViewer — full-screen sheet music PDF/MusicXML viewer.
 *
 * Uses react-native-webview with embedded PDF.js (document built by
 * src/services/sheetViewerHtml.ts) for Expo Go compatibility.
 *
 * v21 (owner request 2026-09-18 — the sheet was "visually hard to read"):
 *   • IMMERSIVE MODE — the ⛶ button in the header hides the header, the audio
 *     chrome and the bottom bar so the sheet fills the display; a small
 *     translucent ✕/contract button floats top-right so the user can always get
 *     back out, and the page counter stays visible as a pill inside the page.
 *   • BIGGER PAGE — the WebView document now contain-fits the page to the whole
 *     container (min of width/height fit, capped at 3×) instead of a width-only
 *     fit with an 85% height cap.
 *   • AUTO PAGE-TURN — the shared BPM-linked AutoScrollControl drives
 *     nextPage() through injectJavaScript, pauses on a page tap, and stops
 *     honestly at the last page.
 *
 * All geometry/speed/copy math lives in src/services/sheetViewerFit.ts and is
 * unit-tested by scripts/sheetViewerFit.test.ts. This component holds none.
 *
 * Page turning still works via tap edges, swipe, and the bottom bar.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ScorePlayer } from './ScorePlayer';
import { AutoScrollControl } from './AutoScrollControl';
import { useAutoScroll, type AutoScrollStatus } from '../hooks/useAutoScroll';
import { buildSheetViewerHtml } from '../services/sheetViewerHtml';
import {
  AUTO_TURN_TOGGLE_LABEL,
  IMMERSIVE_ENTER_LABEL,
  IMMERSIVE_EXIT_LABEL,
  autoTurnChipLabel,
  autoTurnEndedAtLastPage,
} from '../services/sheetViewerFit';
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
  /** Full-screen (immersive) mode: native chrome hidden, sheet fills the screen. */
  const [immersive, setImmersive] = useState(false);
  /** Auto-turn bar expanded by the user (it also shows while running/paused). */
  const [autoTurnExpanded, setAutoTurnExpanded] = useState(false);
  /** Auto-turn reached the last page and stopped itself. */
  const [autoTurnEnded, setAutoTurnEnded] = useState(false);
  const webViewRef = useRef<WebView>(null);

  const pdfHtml = useMemo(() => buildSheetViewerHtml(url), [url]);

  /** Inject one of the document's page-turn functions. */
  const turnPage = useCallback((direction: 'next' | 'prev') => {
    webViewRef.current?.injectJavaScript(
      direction === 'next' ? 'nextPage();' : 'prevPage();'
    );
  }, []);

  // Auto page-turn (BPM-linked): the shared hook owns the timer, the shared
  // control renders its state, and the viewer supplies the page turner — the
  // page count comes from the document's own 'loaded' message.
  const autoScroll = useAutoScroll({
    currentPage: pageInfo.page,
    pageCount: pageInfo.total,
    onTurnPage: useCallback(() => turnPage('next'), [turnPage]),
  });
  const {
    status: autoScrollStatus,
    toggle: toggleAutoScroll,
    stop: stopAutoScroll,
    secondsPerPage,
  } = autoScroll;

  // A tap on the page asks the viewer to decide (the document's tap zones post
  // {type:'tapPage'} and turn nothing themselves):
  //   • auto-turn running/paused → pause/resume and NO page turn (a tap can
  //     never double-advance past the turn the scheduler already made);
  //   • idle → the usual left edge = previous, right edge = next.
  // Held in a ref so the WebView message handler stays referentially stable.
  const tapRef = useRef<(zone: string) => void>(() => {});
  useEffect(() => {
    tapRef.current = (zone: string) => {
      if (autoScrollStatus !== 'idle') {
        toggleAutoScroll();
        return;
      }
      if (loading || error || pageInfo.total <= 0) return;
      turnPage(zone === 'left' ? 'prev' : 'next');
    };
  }, [
    autoScrollStatus,
    toggleAutoScroll,
    loading,
    error,
    pageInfo.total,
    turnPage,
  ]);

  // Re-assert immersive mode in the document after a (re)load — the ✕/⛶ state
  // must survive a reload triggered by the retry button.
  const immersiveRef = useRef(false);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'loaded':
          setLoading(false);
          setError(false);
          setPageInfo({ page: 1, total: data.totalPages });
          if (immersiveRef.current) {
            webViewRef.current?.injectJavaScript('setImmersive(true);');
          }
          break;
        case 'pageChange':
          setPageInfo({ page: data.page, total: data.total });
          break;
        case 'tapPage':
          tapRef.current(String(data.zone));
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

  // Hide/show the native chrome in the WebView document: it re-fits the page to
  // the taller container right away (and switches the page counter to its
  // compact immersive form).
  useEffect(() => {
    if (immersiveRef.current === immersive) return;
    immersiveRef.current = immersive;
    webViewRef.current?.injectJavaScript(`setImmersive(${immersive});`);
  }, [immersive]);

  // "Auto-turn stopped — last page": detect the running → idle transition on
  // the final page (the hook stops rather than overflowing), and clear the note
  // as soon as a new run starts or the user leaves the last page.
  const prevAutoScrollStatusRef = useRef<AutoScrollStatus>('idle');
  useEffect(() => {
    const previous = prevAutoScrollStatusRef.current;
    prevAutoScrollStatusRef.current = autoScrollStatus;
    if (
      autoTurnEndedAtLastPage(
        previous,
        autoScrollStatus,
        pageInfo.page,
        pageInfo.total
      )
    ) {
      setAutoTurnEnded(true);
    } else if (
      autoScrollStatus !== 'idle' ||
      pageInfo.total <= 0 ||
      pageInfo.page < pageInfo.total
    ) {
      setAutoTurnEnded(false);
    }
  }, [autoScrollStatus, pageInfo.page, pageInfo.total]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(false);
    webViewRef.current?.reload();
  }, []);

  /** Manual page navigation cancels auto-turn (same contract as the PDF viewer). */
  const handleManualTurn = useCallback(
    (direction: 'next' | 'prev') => {
      stopAutoScroll();
      turnPage(direction);
    },
    [stopAutoScroll, turnPage]
  );

  const showAutoTurnBar = autoTurnExpanded || autoScrollStatus !== 'idle';
  const atLastPage = pageInfo.total > 0 && pageInfo.page >= pageInfo.total;

  return (
    /* onRequestClose is REQUIRED on Android (v22 fix, kept): React Native's modal
       window consumes the BACK key press and hands it to the JS `onRequestClose`
       handler (ReactModalHostView.kt: "onRequestClose callback must be set if back
       key is expected to close the modal"). Without it the press can never reach
       JS, so a host's `showScoreViewer` flag would stay true.
       It is now ONE authority with the on-screen ✕ below (`onClose` for both) — a
       split between the two dismissals is what lets the host state drift.
       AND (owner-reported blank page, v22 → v24) RN raises onRequestClose only
       from an Android KEYCODE_BACK key event, which apps targeting SDK 36 no
       longer receive on Android 16 — plugins/withAndroidBackCompat.js opts this
       app back into the legacy dispatch, and
       src/services/backExitContract.ts fails the gate if that opt-out disappears.
       Belt and braces: every host now mounts this viewer as an OVERLAY inside its
       own body (never as a body-replacement return), so even a flag left true by
       a natively dismissed dialog can no longer leave a screen empty. */
    <Modal
      visible={true}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header bar — hidden in immersive mode (the floating exit button and
            the in-page counter take over). */}
        {!immersive && (
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close sheet music"
            >
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
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => setImmersive(true)}
              accessibilityRole="button"
              accessibilityLabel={IMMERSIVE_ENTER_LABEL}
            >
              <Ionicons name="expand-outline" size={22} color="#eaeaff" />
            </TouchableOpacity>
          </View>
        )}

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
              <Text style={styles.errorTitle}>Could not load sheet music</Text>
              <Text style={styles.errorBody}>
                The file may be unavailable or in an unsupported format.
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Immersive-only floating controls. The wrapper is box-none so only
              the two buttons take a tap; everything else falls through to the
              page (turn / pause) exactly as in normal mode. */}
          {immersive && (
            <View style={styles.immersiveOverlay} pointerEvents="box-none">
              <TouchableOpacity
                style={[styles.floatingButton, styles.floatingChip]}
                onPress={() => setAutoTurnExpanded((expanded) => !expanded)}
                accessibilityRole="button"
                accessibilityLabel={AUTO_TURN_TOGGLE_LABEL}
                accessibilityState={{ expanded: showAutoTurnBar }}
              >
                <Ionicons name="timer-outline" size={14} color="#eaeaff" />
                <Text style={styles.floatingChipText}>
                  {autoTurnChipLabel(autoScrollStatus, secondsPerPage)}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.floatingButton, styles.floatingExit]}
                onPress={() => setImmersive(false)}
                accessibilityRole="button"
                accessibilityLabel={IMMERSIVE_EXIT_LABEL}
                hitSlop={8}
              >
                <Ionicons name="contract-outline" size={18} color="#eaeaff" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Practice player: score audio + loop + time-stretch. Rendered only
          when an audio source exists; otherwise a subtle hint (no fake UI).
          Hidden in immersive mode (nothing plays under the sheet). */}
        {!immersive &&
          (audioSource ? (
            <ScorePlayer source={audioSource} label={audioLabel} />
          ) : (
            <View style={styles.audioHint}>
              <Text style={styles.audioHintText}>
                🎧 Practice audio coming soon
              </Text>
            </View>
          ))}

        {/* Auto page-turn (BPM-linked). Collapsible so it costs the sheet no
            space until the user wants it; always visible while running. */}
        {showAutoTurnBar && (
          <AutoScrollControl
            autoScroll={autoScroll}
            disabled={pageInfo.total < 2}
          />
        )}

        {/* Honest stop at the end of the piece. */}
        {autoTurnEnded && (
          <View style={styles.autoTurnEndedBar}>
            <Ionicons name="flag-outline" size={14} color="#a0a0b8" />
            <Text style={styles.autoTurnEndedText}>
              Auto-turn stopped — last page ({pageInfo.page} of {pageInfo.total})
            </Text>
          </View>
        )}

        {/* Bottom bar: page nav + indicator + auto-turn toggle. Hidden in
            immersive mode. */}
        {!immersive && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.pageNavBtn}
              onPress={() => handleManualTurn('prev')}
              disabled={pageInfo.page <= 1}
              accessibilityRole="button"
              accessibilityLabel="Previous page"
            >
              <Text
                style={[
                  styles.pageNavArrow,
                  pageInfo.page <= 1 && styles.pageNavArrowDisabled,
                ]}
              >
                ‹
              </Text>
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
              style={[styles.autoTurnToggle, showAutoTurnBar && styles.autoTurnToggleOn]}
              onPress={() => setAutoTurnExpanded((expanded) => !expanded)}
              accessibilityRole="button"
              accessibilityLabel={AUTO_TURN_TOGGLE_LABEL}
              accessibilityState={{ expanded: showAutoTurnBar }}
            >
              <Ionicons
                name="timer-outline"
                size={16}
                color={showAutoTurnBar ? '#ffffff' : '#a0a0b8'}
              />
              <Text
                style={[
                  styles.autoTurnToggleText,
                  showAutoTurnBar && styles.autoTurnToggleTextOn,
                ]}
              >
                Auto-turn
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pageNavBtn}
              onPress={() => handleManualTurn('next')}
              disabled={atLastPage}
              accessibilityRole="button"
              accessibilityLabel="Next page"
            >
              <Text
                style={[
                  styles.pageNavArrow,
                  atLastPage && styles.pageNavArrowDisabled,
                ]}
              >
                ›
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const FLOATING_TOP = Platform.OS === 'ios' ? 56 : 32;

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
    paddingTop: FLOATING_TOP,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  headerButton: {
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

  // Immersive floating controls
  immersiveOverlay: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: FLOATING_TOP,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    // Above the loading/error overlays (zIndex 10): an error inside immersive
    // mode must never hide the only way out of it.
    zIndex: 20,
  },
  floatingButton: {
    backgroundColor: 'rgba(22, 33, 62, 0.72)',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingChip: {
    flexDirection: 'row',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
  },
  floatingChipText: {
    color: '#eaeaff',
    fontSize: 12,
    fontWeight: '700',
  },
  floatingExit: {
    width: 36,
    height: 36,
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
    paddingHorizontal: 12,
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
  autoTurnEndedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  autoTurnEndedText: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '600',
  },
  pageNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  pageNavArrowDisabled: {
    color: '#3a3a5c',
  },
  autoTurnToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  autoTurnToggleOn: {
    backgroundColor: '#3a3a5c',
    borderColor: '#e94560',
  },
  autoTurnToggleText: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '700',
  },
  autoTurnToggleTextOn: {
    color: '#ffffff',
  },
  pageIndicatorContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  pageIndicator: {
    color: '#c0c0d0',
    fontSize: 14,
    fontWeight: '600',
  },
});
