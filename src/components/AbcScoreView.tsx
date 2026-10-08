/**
 * AbcScoreView — renders ABC notation to an interactive SVG score inside a
 * WebView using ABCjs (loaded from CDN, mirroring how ScoreViewer loads pdf.js
 * from CDN).
 *
 * This is the "renderer" for the notation editor: it draws the (possibly
 * transposed) ABC string so the user sees the result of every transpose
 * change. Re-rendering on a new ABC string is achieved by keying the HTML —
 * React reloads the WebView when `abc` changes.
 *
 * v33 slice C added the INK/PAPER seam so the SAME renderer can draw the melody
 * capture page's staff: the raw trace dimmed and the auto-cleaned line crisp
 * (see src/components/TakeStaffCard.tsx). `generateAbcHtml` is that seam — the
 * ink goes into the ABCjs options (`foregroundColor`) AND the document's own
 * CSS, so the notes, the staff lines and the title all take the colour.
 */

import { useThemedStyles } from '../services/themeStore';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

/** The ink a score is drawn in when the caller names none (near-black on paper). */
export const ABC_DEFAULT_INK = '#0b1220';
/** The paper a score is drawn on when the caller names none. */
export const ABC_DEFAULT_BACKGROUND = '#ffffff';
/**
 * THE FLOOR THIS VIEWER CAN NEVER COLLAPSE BELOW (v36 fix 3).
 *
 * WHY IT EXISTS. The container below is `flex: 1` and its WebView is `flex: 1`.
 * That is fine inside a box with a real height (the capture page's staff card: 132,
 * the take editor: 150), but inside an AUTO-HEIGHT parent a `flex: 1` child lays
 * out at ZERO — the notation editor's score card had no height, so it opened with a
 * title, a composer line and NO SCORE. The owner hit exactly that on the saved
 * transposed copy. A floor makes the collapse structurally impossible for every
 * present and future call site.
 */
export const ABC_MIN_HEIGHT = 120;

interface AbcScoreViewProps {
  /** The ABC string (header + body) to render. */
  abc: string;
  /**
   * The ink colour: staff lines, noteheads and the title (v33 slice C). The
   * notation editor leaves this unset (near-black on white paper); the capture
   * page's staff passes the dimmed grey for the raw trace and the app's teal for
   * the auto-cleaned line.
   */
  ink?: string;
  /** The paper colour behind the staff (the surface the score sits on). */
  background?: string;
  /**
   * Whether the score itself may receive touches. DEFAULT TRUE, so every existing
   * call site is unchanged.
   *
   * A score is decoration: it is drawn to be READ, and every page that hosts one
   * scrolls (the take editor, the notation editor). A WebView is a native view
   * outside RN's responder system, so when it is allowed to take a gesture the
   * page it sits in stops scrolling from that surface — which is the owner's
   * "page does not scroll down" (v34 tried `pointerEvents="none"` on the wrapper
   * and it was not enough). Pass `interactive={false}` and the viewer CLOSES THE
   * SURFACE OFF: the WebView cannot scroll and cannot receive touch, and a
   * transparent touch shield sits on top of it that hands every gesture straight
   * back to the page's scroller.
   */
  interactive?: boolean;
}

/**
 * Build the HTML document that pulls in ABCjs from CDN and renders the given
 * ABC to SVG, scaled to fit the container width.
 */
export function generateAbcHtml(
  abc: string,
  ink: string = ABC_DEFAULT_INK,
  background: string = ABC_DEFAULT_BACKGROUND,
): string {
  const abcJson = JSON.stringify(abc);
  const inkJson = JSON.stringify(ink);
  const backgroundJson = JSON.stringify(background);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; background: ${background}; }
  body { padding: 12px 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #paper { display: flex; flex-direction: column; align-items: center; }
  #paper svg { max-width: 100%; height: auto !important; }
  /* The caller's ink, applied to every drawn shape: staff lines (stroked paths),
     noteheads (filled paths), beams and the title text. */
  #paper svg path, #paper svg text, #paper svg tspan, #paper svg rect,
  #paper svg line, #paper svg polyline, #paper svg polygon, #paper svg ellipse {
    fill: ${ink}; stroke: ${ink};
  }
  #error {
    display: none; color: #e94560; font-size: 14px; text-align: center;
    padding: 24px 16px; line-height: 1.5;
  }
</style>
</head>
<body>
  <div id="paper"></div>
  <div id="error">Could not render this ABC score.</div>
<script src="https://cdn.jsdelivr.net/npm/abcjs@6.2.3/dist/abcjs-basic-min.js"></script>
<script>
  (function () {
    var abc = ${abcJson};
    var ink = ${inkJson};
    try {
      window.ABCJS.renderAbc('paper', abc, {
        responsive: 'resize',
        paddingtop: 0,
        paddingbottom: 0,
        add_classes: true,
        foregroundColor: ink
      });
    } catch (e) {
      document.getElementById('error').style.display = 'block';
    }
  })();
</script>
</body>
</html>`;
}

/**
 * The WebView's rendering key for a score (v33 §F5b, owner 10-04).
 *
 * WHY IT EXISTS. The view used to key on `abc.length` and the FIRST character of
 * the ABC string. A transposed copy of a score has very nearly the same length
 * and the same first character as the original, so re-opening the saved copy
 * reused the WebView that was already showing the ORIGINAL — the transposed score
 * never appeared. The owner hit exactly that. Keying on the WHOLE content (a
 * fingerprint over every character, plus the ink and the paper, which both change
 * the document) means any difference at all repaints.
 *
 * PURE and exported so the gate can assert the property directly: two different
 * ABCs may never share a key, and the same ABC with the same ink/paper must.
 */
export function abcRenderKey(
  abc: string,
  ink: string = ABC_DEFAULT_INK,
  background: string = ABC_DEFAULT_BACKGROUND,
): string {
  const text = typeof abc === 'string' ? abc : '';
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = (hash * 16777619) >>> 0;
  }
  return `abc-${text.length}-${hash.toString(36)}-${ink}-${background}`;
}

export const AbcScoreView: React.FC<AbcScoreViewProps> = ({
  abc,
  ink = ABC_DEFAULT_INK,
  background = ABC_DEFAULT_BACKGROUND,
  interactive = true,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  // Use the abc text (and the ink, which changes the document) as a rendering
  // key so a fresh WebView reloads whenever the score or its colour changes.
  const html = useMemo(() => generateAbcHtml(abc, ink, background), [abc, ink, background]);
  const key = useMemo(() => abcRenderKey(abc, ink, background), [abc, ink, background]);

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <WebView
        key={key}
        source={{ html }}
        style={[styles.webview, { backgroundColor: background }]}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        scrollEnabled={interactive}
        androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
        pointerEvents={interactive ? 'auto' : 'none'}
      />
      {/* THE TOUCH SHIELD (v36 fix 1; only when the caller says the score is
          decoration). It is drawn AFTER the WebView, so it is the topmost sibling
          in this box and a finger on the staff hits THIS, never the native
          WebView. It claims the touch so nothing below it sees it, and it lets
          the page's ScrollView take the gesture back the moment the finger moves
          (`onShouldBlockNativeResponder` → false = "do not disallow the native
          scroller"), which is exactly how a button inside a scroller behaves.
          Net effect: the biggest surface on the page scrolls the page. */}
      {!interactive && (
        <View
          style={styles.shield}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => false}
          onResponderTerminationRequest={() => true}
          onShouldBlockNativeResponder={() => false}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: ABC_MIN_HEIGHT,
    backgroundColor: ABC_DEFAULT_BACKGROUND,
    borderRadius: 12,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: ABC_DEFAULT_BACKGROUND,
  },
  shield: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
