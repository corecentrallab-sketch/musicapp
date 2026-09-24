/**
 * AbcScoreView — renders ABC notation to an interactive SVG score inside a
 * WebView using ABCjs (loaded from CDN, mirroring how ScoreViewer loads pdf.js
 * from CDN).
 *
 * This is the "renderer" for the notation editor: it draws the (possibly
 * transposed) ABC string so the user sees the result of every transpose
 * change. Re-rendering on a new ABC string is achieved by keying the HTML —
 * React reloads the WebView when `abc` changes.
 */

import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface AbcScoreViewProps {
  /** The ABC string (header + body) to render. */
  abc: string;
}

/**
 * Build the HTML document that pulls in ABCjs from CDN and renders the given
 * ABC to SVG, scaled to fit the container width.
 */
function generateAbcHtml(abc: string): string {
  const abcJson = JSON.stringify(abc);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; background: #fff; }
  body { padding: 12px 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #paper { display: flex; flex-direction: column; align-items: center; }
  #paper svg { max-width: 100%; height: auto !important; }
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
    try {
      window.ABCJS.renderAbc('paper', abc, {
        responsive: 'resize',
        paddingtop: 0,
        paddingbottom: 0,
        add_classes: true
      });
    } catch (e) {
      document.getElementById('error').style.display = 'block';
    }
  })();
</script>
</body>
</html>`;
}

export const AbcScoreView: React.FC<AbcScoreViewProps> = ({ abc }) => {
  // Use the abc text as a rendering key so a fresh WebView reloads whenever
  // the (transposed) score changes.
  const html = useMemo(() => generateAbcHtml(abc), [abc]);
  const key = useMemo(() => `abc-score-${abc.length}-${abc.charCodeAt(0)}`, [abc]);

  return (
    <View style={styles.container}>
      <WebView
        key={key}
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
